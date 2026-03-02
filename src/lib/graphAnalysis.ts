/**
 * graphAnalysis.ts
 *
 * 여섯 가지 분석 도구를 제공합니다:
 *   A. TfIdfIndex      — 코사인 유사도 기반 문서 검색 + 묵시적 연결 발견
 *   B. computePageRank — 연결 중요도 기반 문서 순위 (인기 허브 감지)
 *   C. detectClusters  — Union-Find 연결 컴포넌트 (주제 클러스터 감지)
 *   D. detectBridgeNodes — 여러 클러스터를 연결하는 브릿지 노드 탐지
 *   E. getClusterTopics  — 클러스터별 TF-IDF 상위 키워드 추출
 *   F. findImplicitLinks — WikiLink 없이 의미적으로 유사한 숨겨진 연결 발견
 */

import type { LoadedDocument } from '@/types'
import { logger } from '@/lib/logger'

// ── 공유 토크나이저 ──────────────────────────────────────────────────────────

const KO_SUFFIXES = [
  '이라는', '이라고', '에서는', '에게서', '한테서', '으로서', '으로써', '으로는',
  '에서의', '으로의', '에서도', '으로도',
  '이라', '에서', '에게', '한테', '까지', '부터', '처럼', '같은', '같이',
  '만큼', '으로', '이랑', '라는', '라고', '이란', '에는', '하고',
  '은', '는', '이', '가', '을', '를', '와', '과',
  '에', '도', '만', '의', '로',
]

function stemKorean(token: string): string[] {
  const results = [token]
  for (const suffix of KO_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      results.push(token.slice(0, -suffix.length))
      break
    }
  }
  return [...new Set(results)]
}

export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[\s,.\-_?!;:()[\]{}'"《》「」【】]+/)
    .filter(t => t.length > 1)

  const stems: string[] = []
  for (const token of raw) {
    for (const stem of stemKorean(token)) {
      stems.push(stem)
    }
  }
  return [...new Set(stems)]
}

// ── A. TF-IDF Index ──────────────────────────────────────────────────────────

export interface TfIdfResult {
  docId: string
  filename: string
  speaker: string
  score: number
}

interface TfIdfDoc {
  docId: string
  filename: string
  speaker: string
  vector: Map<string, number>
  norm: number
}

export interface ImplicitLink {
  docAId: string
  docBId: string
  filenameA: string
  filenameB: string
  similarity: number
}

// Serialized form stored in IndexedDB (Maps → plain arrays for JSON compatibility)
export interface SerializedTfIdf {
  schemaVersion: 2
  fingerprint: string
  idf: [string, number][]
  docs: { docId: string; filename: string; speaker: string; vector: [string, number][]; norm: number }[]
}

export class TfIdfIndex {
  private docs: TfIdfDoc[] = []
  private idf: Map<string, number> = new Map()
  private built = false
  private _implicitLinks: ImplicitLink[] | null = null
  private _implicitAdjRef: Map<string, string[]> | null = null

  get isBuilt() { return this.built }
  get docCount() { return this.docs.length }

  /** Serialize index state to a plain object suitable for IndexedDB storage. */
  serialize(fingerprint: string): SerializedTfIdf {
    return {
      schemaVersion: 2,
      fingerprint,
      idf: [...this.idf.entries()],
      docs: this.docs.map(d => ({
        docId: d.docId,
        filename: d.filename,
        speaker: d.speaker,
        vector: [...d.vector.entries()],
        norm: d.norm,
      })),
    }
  }

  /** Restore index state from a previously serialized object. */
  restore(data: SerializedTfIdf): void {
    this.idf = new Map(data.idf)
    this.docs = data.docs.map(d => ({
      docId: d.docId,
      filename: d.filename,
      speaker: d.speaker,
      vector: new Map(d.vector),
      norm: d.norm,
    }))
    this._implicitLinks = null
    this._implicitAdjRef = null
    this.built = true
    logger.debug(`[graphAnalysis] TF-IDF 인덱스 캐시 복원: ${this.docs.length}개 문서`)
  }

  build(loadedDocuments: LoadedDocument[]): void {
    this.docs = []
    this.idf = new Map()
    this.built = false

    const docTerms: Map<string, Map<string, number>> = new Map()
    const docFreq: Map<string, number> = new Map()

    for (const doc of loadedDocuments) {
      // 파일명 + 태그 + 스피커 + 모든 섹션을 하나의 텍스트로 합산
      const allText = [
        doc.filename.replace(/\.md$/i, ''),
        doc.tags?.join(' ') ?? '',
        doc.speaker ?? '',
        ...doc.sections.map(s => `${s.heading} ${s.body}`),
        doc.rawContent ?? '',
      ].join(' ')

      const tokens = tokenize(allText)
      const termCount = new Map<string, number>()
      for (const token of tokens) {
        termCount.set(token, (termCount.get(token) ?? 0) + 1)
      }
      docTerms.set(doc.id, termCount)

      for (const term of termCount.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      }
    }

    const N = loadedDocuments.length

    // Smoothed IDF: log((N+1)/(df+1)) + 1
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N + 1) / (df + 1)) + 1)
    }

    // TF-IDF 벡터 + L2 norm 계산
    for (const doc of loadedDocuments) {
      const termCount = docTerms.get(doc.id)!
      const totalTerms = [...termCount.values()].reduce((a, b) => a + b, 0)

      const vector = new Map<string, number>()
      let normSq = 0
      for (const [term, count] of termCount) {
        const tf = count / totalTerms
        const idf = this.idf.get(term) ?? 1
        const tfidf = tf * idf
        vector.set(term, tfidf)
        normSq += tfidf * tfidf
      }

      this.docs.push({
        docId: doc.id,
        filename: doc.filename,
        speaker: doc.speaker ?? 'unknown',
        vector,
        norm: Math.sqrt(normSq),
      })
    }

    // 재빌드 시 묵시적 링크 캐시 무효화
    this._implicitLinks = null
    this._implicitAdjRef = null

    this.built = true
    logger.debug(`[graphAnalysis] TF-IDF 인덱스 빌드 완료: ${this.docs.length}개 문서`)
  }

  search(query: string, topN: number = 8): TfIdfResult[] {
    if (!this.built || this.docs.length === 0) return []

    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) return []

    // 쿼리 벡터 (TF=1/n for each term, IDF from corpus)
    const queryVec = new Map<string, number>()
    let queryNormSq = 0
    for (const term of queryTerms) {
      // OOV 처리: 코퍼스에 없는 단어는 IDF=log(2) 사용
      const idf = this.idf.get(term) ?? Math.log(2)
      queryVec.set(term, idf)
      queryNormSq += idf * idf
    }
    const queryNorm = Math.sqrt(queryNormSq)
    if (queryNorm === 0) return []

    const scored: { doc: TfIdfDoc; score: number }[] = []
    for (const doc of this.docs) {
      if (doc.norm === 0) continue
      let dot = 0
      for (const [term, qScore] of queryVec) {
        const dScore = doc.vector.get(term) ?? 0
        dot += qScore * dScore
      }
      const cosine = dot / (queryNorm * doc.norm)
      if (cosine > 0.005) scored.push({ doc, score: cosine })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topN).map(s => ({
      docId: s.doc.docId,
      filename: s.doc.filename,
      speaker: s.doc.speaker,
      score: Math.min(1, s.score),
    }))
  }

  /**
   * WikiLink로 연결되지 않은 문서 중 의미적으로 유사한 쌍을 반환합니다.
   * TF-IDF 코사인 유사도가 threshold 이상인 쌍이 대상입니다.
   *
   * adjacency 참조가 바뀌지 않으면 캐시된 결과를 반환합니다 (O(N²) 연산 1회).
   *
   * @param adjacency  기존 WikiLink 인접 맵 (이미 연결된 쌍 제외 용도)
   * @param topN       반환할 최대 쌍 수
   * @param threshold  코사인 유사도 최소값 (기본 0.25)
   */
  findImplicitLinks(
    adjacency: Map<string, string[]>,
    topN: number = 6,
    threshold: number = 0.25
  ): ImplicitLink[] {
    if (!this.built || this.docs.length < 2) return []

    // adjacency 참조 기준 캐시
    if (this._implicitLinks && this._implicitAdjRef === adjacency) {
      return this._implicitLinks.slice(0, topN)
    }

    // 기존 WikiLink 쌍을 Set으로 구성 — O(1) 조회
    const existingLinks = new Set<string>()
    for (const [from, neighbors] of adjacency) {
      for (const to of neighbors) {
        const key = from < to ? `${from}|${to}` : `${to}|${from}`
        existingLinks.add(key)
      }
    }

    // 성능 상한: 최대 250개 문서 대상 O(N²) 계산
    const docs = this.docs.slice(0, 250)
    const pairs: ImplicitLink[] = []

    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const a = docs[i], b = docs[j]
        if (a.norm === 0 || b.norm === 0) continue

        const key = a.docId < b.docId ? `${a.docId}|${b.docId}` : `${b.docId}|${a.docId}`
        if (existingLinks.has(key)) continue

        // 코사인 유사도: a 벡터를 기준으로 공유 항목만 계산
        let dot = 0
        for (const [term, aScore] of a.vector) {
          const bScore = b.vector.get(term) ?? 0
          dot += aScore * bScore
        }
        const sim = dot / (a.norm * b.norm)
        if (sim >= threshold) {
          pairs.push({
            docAId: a.docId,
            docBId: b.docId,
            filenameA: a.filename,
            filenameB: b.filename,
            similarity: sim,
          })
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity)
    this._implicitLinks = pairs
    this._implicitAdjRef = adjacency
    logger.debug(`[graphAnalysis] 묵시적 연결 ${pairs.length}쌍 발견 (threshold=${threshold})`)

    return pairs.slice(0, topN)
  }
}

/** TF-IDF 싱글톤 — 볼트 로드 시 build() 호출 필요 */
export const tfidfIndex = new TfIdfIndex()

// ── B. PageRank ───────────────────────────────────────────────────────────────

/**
 * 문서 그래프에서 PageRank를 계산합니다.
 * 많은 문서로부터 참조될수록 높은 순위를 받습니다.
 *
 * @returns Map<docId, normalizedRank 0..1>
 */
export function computePageRank(
  adjacency: Map<string, string[]>,
  iterations: number = 25,
  damping: number = 0.85
): Map<string, number> {
  const nodes = [...adjacency.keys()]
  const N = nodes.length
  if (N === 0) return new Map()

  // 역방향 엣지 (in-edges) 사전 계산 — O(N+M) 순회를 위해
  const inEdges = new Map<string, string[]>()
  for (const id of nodes) inEdges.set(id, [])
  for (const [from, neighbors] of adjacency) {
    for (const to of neighbors) {
      if (!inEdges.has(to)) inEdges.set(to, [])
      inEdges.get(to)!.push(from)
    }
  }

  const rank = new Map<string, number>()
  for (const id of nodes) rank.set(id, 1 / N)

  for (let iter = 0; iter < iterations; iter++) {
    // 아웃링크 없는 노드의 랭크 합 (dangling nodes)
    const danglingSum = nodes
      .filter(id => (adjacency.get(id)?.length ?? 0) === 0)
      .reduce((sum, id) => sum + (rank.get(id) ?? 0), 0)

    const newRank = new Map<string, number>()
    for (const id of nodes) {
      const inSum = (inEdges.get(id) ?? []).reduce((sum, from) => {
        const outDegree = adjacency.get(from)?.length ?? 1
        return sum + (rank.get(from) ?? 0) / outDegree
      }, 0)
      newRank.set(id, (1 - damping) / N + damping * (inSum + danglingSum / N))
    }

    for (const [id, r] of newRank) rank.set(id, r)
  }

  // 0..1 정규화
  const max = Math.max(1e-10, ...rank.values())
  for (const [id, r] of rank) rank.set(id, r / max)

  return rank
}

// ── C. 클러스터 감지 (Union-Find) ─────────────────────────────────────────────

/**
 * Union-Find로 연결 컴포넌트(클러스터)를 감지합니다.
 * 같은 WikiLink 네트워크로 연결된 문서들은 같은 클러스터 번호를 받습니다.
 *
 * @returns Map<docId, clusterId> — clusterId 0이 가장 큰 클러스터
 */
export function detectClusters(
  adjacency: Map<string, string[]>
): Map<string, number> {
  const parent = new Map<string, string>()

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const [id, neighbors] of adjacency) {
    for (const nb of neighbors) union(id, nb)
  }

  // 루트별 그룹화
  const groups = new Map<string, string[]>()
  for (const id of adjacency.keys()) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
  }

  // 클러스터 크기 내림차순 정렬 (0 = 가장 큰 클러스터)
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length)
  const clusterMap = new Map<string, number>()
  sorted.forEach((members, idx) => {
    for (const id of members) clusterMap.set(id, idx)
  })

  return clusterMap
}

// ── 그래프 메트릭 캐시 ────────────────────────────────────────────────────────

export interface GraphMetrics {
  pageRank: Map<string, number>
  clusters: Map<string, number>
  clusterCount: number
}

let _metricsCache: GraphMetrics | null = null
let _metricsLinksRef: unknown = null

/**
 * PageRank + 클러스터를 한 번 계산하고 캐시합니다.
 * links 배열 참조가 바뀌면 자동으로 재계산됩니다.
 */
export function getGraphMetrics(
  adjacency: Map<string, string[]>,
  linksRef: unknown
): GraphMetrics {
  if (_metricsCache && _metricsLinksRef === linksRef) return _metricsCache

  const pageRank = computePageRank(adjacency)
  const clusters = detectClusters(adjacency)
  const clusterCount = new Set(clusters.values()).size

  _metricsCache = { pageRank, clusters, clusterCount }
  _metricsLinksRef = linksRef
  return _metricsCache
}

// ── D. 브릿지 노드 탐지 ───────────────────────────────────────────────────────

export interface BridgeNode {
  docId: string
  /** 이 노드가 연결하는 서로 다른 클러스터 수 (자신의 클러스터 포함) */
  clusterCount: number
}

/**
 * 여러 클러스터에 걸쳐 이웃을 가진 브릿지 노드를 탐지합니다.
 *
 * 브릿지 노드 = 자신과 다른 클러스터에 속한 이웃을 1개 이상 가진 노드.
 * 이런 노드는 주제 영역들을 연결하는 아키텍처 핵심 문서입니다.
 *
 * @returns clusterCount 내림차순으로 정렬된 배열
 */
export function detectBridgeNodes(
  adjacency: Map<string, string[]>,
  clusters: Map<string, number>
): BridgeNode[] {
  const results: BridgeNode[] = []

  for (const [docId, neighbors] of adjacency) {
    const ownCluster = clusters.get(docId)
    if (ownCluster === undefined) continue

    const neighborClusters = new Set<number>([ownCluster])
    for (const nb of neighbors) {
      const nbCluster = clusters.get(nb)
      if (nbCluster !== undefined) neighborClusters.add(nbCluster)
    }

    if (neighborClusters.size >= 2) {
      results.push({ docId, clusterCount: neighborClusters.size })
    }
  }

  return results.sort((a, b) => b.clusterCount - a.clusterCount)
}

// ── E. 클러스터 주제 키워드 ──────────────────────────────────────────────────

/**
 * 각 클러스터의 TF-IDF 상위 키워드를 추출합니다.
 *
 * 클러스터 내 모든 문서의 텍스트를 합산하여 가장 고빈도 토큰을 반환합니다.
 * 구조 헤더에 "클러스터 1 [전투/스킬/밸런스]" 형태로 활용됩니다.
 *
 * @param clusters  Map<docId, clusterId>
 * @param docs      볼트 문서 배열
 * @param topK      클러스터당 반환할 키워드 수
 * @returns Map<clusterId, topKeywords[]>
 */
export function getClusterTopics(
  clusters: Map<string, number>,
  docs: LoadedDocument[],
  topK: number = 3
): Map<number, string[]> {
  const clusterTexts = new Map<number, string[]>()

  for (const doc of docs) {
    const cId = clusters.get(doc.id)
    if (cId === undefined) continue
    if (!clusterTexts.has(cId)) clusterTexts.set(cId, [])

    const text = [
      doc.filename.replace(/\.md$/i, ''),
      ...(doc.tags ?? []),
      ...doc.sections.map(s => `${s.heading} ${s.body}`),
    ].join(' ')
    clusterTexts.get(cId)!.push(text)
  }

  const result = new Map<number, string[]>()
  for (const [cId, texts] of clusterTexts) {
    const freq = new Map<string, number>()
    for (const text of texts) {
      for (const token of tokenize(text)) {
        freq.set(token, (freq.get(token) ?? 0) + 1)
      }
    }
    const keywords = [...freq.entries()]
      .filter(([t]) => t.length >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([t]) => t)
    result.set(cId, keywords)
  }

  return result
}
