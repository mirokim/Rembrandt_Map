# Rembrandt Map

**AI Director Proxy System** — Obsidian 볼트를 지식 그래프로 시각화하고, 여러 AI 페르소나가 그래프를 탐색하며 심층 인사이트를 제공하는 데스크톱 애플리케이션입니다.

---

## 목차

1. [개요](#개요)
2. [주요 기능](#주요-기능)
3. [사용 기술 스택](#사용-기술-스택)
4. [핵심 알고리즘 및 이론](#핵심-알고리즘-및-이론)
   - TF-IDF 벡터 검색 · BFS · PageRank · Union-Find · d3-force · Korean 토크나이저
   - 묵시적 연결 발견 · 클러스터 주제 키워드 · 브릿지 노드 · 패시지-레벨 검색
5. [시스템 아키텍처](#시스템-아키텍처)
6. [설치 및 실행](#설치-및-실행)
7. [사용 방법](#사용-방법)
8. [볼트 구조 가이드](#볼트-구조-가이드)
9. [LLM 설정](#llm-설정)
10. [프로젝트 구조](#프로젝트-구조)

---

## 개요

Rembrandt Map은 Obsidian 스타일의 마크다운 볼트를 읽어 **위키링크 기반 지식 그래프**를 시각화하고, 5명의 AI 디렉터 페르소나가 그래프를 탐색하며 프로젝트에 대한 구체적인 피드백과 인사이트를 제공합니다.

```
볼트 폴더 (.md 파일들)
  ↓ 로드 + 파싱
지식 그래프 (WikiLink 연결)
  ↓ BFS + TF-IDF + PageRank
AI 컨텍스트 수집
  ↓ LLM 스트리밍
구체적 인사이트
```

---

## 주요 기능

### 지식 그래프 시각화
- **2D 그래프**: d3-force 물리 시뮬레이션 기반 인터랙티브 그래프 (Canvas 렌더링)
- **3D 그래프**: Three.js + d3-force-3d 기반 입체 그래프
- **노드 색상 모드**: 문서 유형 / 담당자(speaker) / 폴더 / 태그 / 주제별 색상 구분
- **팬텀 노드**: 링크 대상이 아직 없는 위키링크도 그래프에 표시 (Obsidian 동작 동일)
- **AI 노드 하이라이트**: AI 답변에서 언급된 문서를 그래프에서 자동 하이라이트
- **노드 라벨 토글**: 상단 바에서 전체 노드 라벨 표시/숨기기 전환
- **Fast Mode**: 2D 강제 전환 + 호버 스킵 + 동기 물리 틱으로 대용량 볼트에서도 부드러운 렌더링

### Graph-Augmented RAG (그래프 증강 검색)
- **TF-IDF 벡터 검색**: 볼트 로드 시 자동 인덱싱, 의미적 유사도로 관련 문서 검색
- **IndexedDB 캐싱**: 볼트 재오픈 시 TF-IDF 인덱스를 캐시에서 복원 (파일 변경 없으면 재계산 없음)
- **패시지-레벨 검색**: 쿼리와 가장 관련된 섹션만 선택 (문서 앞부분 고정 방식 탈피)
- **BFS 그래프 탐색**: 위키링크를 따라 최대 4홉까지 관련 문서 자동 수집
- **PageRank 기반 허브 시드**: 연결도가 높은 허브 노드를 탐색 시작점으로 자동 보완
- **전체 탐색 모드**: "전체 프로젝트 인사이트" 등 광범위한 쿼리에 자동 전환
- **최근 문서 우선 정렬**: RAG 결과에서 최근 수정된 문서를 우선 반영, 날짜 레이블 표시
- **묵시적 연결 발견**: WikiLink 없이도 TF-IDF 유사도가 높은 숨겨진 연관 문서 쌍 감지
- **클러스터 주제 레이블**: 각 클러스터의 TF-IDF 상위 키워드 자동 추출
- **브릿지 노드 탐지**: 여러 클러스터를 연결하는 아키텍처 핵심 문서 감지

### AI 분석 패널
- **노드 선택 분석**: 특정 문서 선택 후 해당 노드와 연결된 모든 문서를 AI가 분석
- **전체 분석**: 노드 선택 없이도 전체 프로젝트를 허브 기반으로 분석
- **멀티패스 UI**: "탐색 중 → 분석 중" 단계별 진행 표시
- **QuickQuestions**: 페르소나별 100개 풀에서 랜덤 추천 질문 제공
- **currentSituation 컨텍스트**: 현재 상황/이슈를 설정해두면 모든 AI 프롬프트에 자동 주입 (실세계 컨텍스트 연결)

### 다중 LLM 페르소나
- 5명의 디렉터 페르소나 (총괄 / 아트 / 기획 / 레벨 / 프로그램)
- 지원 제공자: **Anthropic Claude**, **OpenAI GPT**, **Google Gemini**, **xAI Grok**
- 이미지 첨부 지원 (Anthropic, OpenAI, Gemini)
- 페르소나별 커스텀 시스템 프롬프트 설정 가능

### 마크다운 에디터 (CodeMirror 6)
- Obsidian 스타일 `[[WikiLink]]` WYSIWYG 렌더링 + 자동완성
- `~~취소선~~`, `==하이라이트==`, `%% 주석 %%` 시각적 처리
- 키보드 단축키: `Ctrl+Shift+S` (취소선), `Ctrl+Shift+H` (하이라이트), `Ctrl+Shift+C` (인라인 코드)
- Enter 키 스마트 계속: 번호 목록 자동 증가 / 인용문 계속
- 1.2초 자동 저장

### 토론 모드
- 5명의 디렉터 페르소나 중 선택하여 특정 주제를 두고 토론 (라운드로빈 / 자유 토론 / 역할 배정 / 결전모드)
- **페르소나 기반 참여자**: 동일한 API 키로 여러 페르소나가 동시 참여 가능 (ex. Anthropic 키 하나로 Chief + Prog 토론)
- AI 설정에서 API 키가 설정된 페르소나만 참여 후보로 표시
- 참고 자료 첨부 (텍스트 / 이미지 / PDF), 실시간 스트리밍 표시

### 파일 트리
- 폴더 / 담당자 / 태그별 분류 표시
- 이름 / 수정일 기준 정렬
- 우클릭 컨텍스트 메뉴: 편집기 열기 / 복사 / 북마크 / 이름 변경 / 삭제

### Confluence 연동
- Confluence API를 통한 스페이스 페이지 일괄 가져오기
- HTML → Obsidian 마크다운 변환

---

## 사용 기술 스택

### 프론트엔드
| 기술 | 버전 | 용도 |
|------|------|------|
| React | 19.x | UI 컴포넌트 |
| TypeScript | 5.5 | 타입 안전성 |
| Vite | 5.4 | 빌드 도구 + HMR |
| Tailwind CSS | 4.x | 유틸리티 CSS |
| Zustand | 5.x | 전역 상태 관리 (persist 플러그인) |
| Framer Motion | 12.x | 애니메이션 |
| Lucide React | 0.400 | 아이콘 |

### 그래프 시각화
| 기술 | 버전 | 용도 |
|------|------|------|
| d3-force | 3.x | 2D 물리 시뮬레이션 |
| d3-force-3d | 3.x | 3D 물리 시뮬레이션 |
| Three.js | 0.175 | 3D 렌더링 (WebGL) |

### 에디터
| 기술 | 버전 | 용도 |
|------|------|------|
| CodeMirror | 6.x | 마크다운 에디터 코어 |
| @codemirror/lang-markdown | 6.5 | 마크다운 문법 + 파서 |
| @lezer/highlight | 1.2 | 구문 강조 |

### 마크다운 파싱
| 기술 | 버전 | 용도 |
|------|------|------|
| gray-matter | 4.x | YAML 프론트매터 파싱 |
| unified / remark-parse | 11.x | 마크다운 AST 파싱 |
| react-markdown | 10.x | 마크다운 렌더링 |

### 데스크톱 (Electron)
| 기술 | 버전 | 용도 |
|------|------|------|
| Electron | 31.x | 데스크톱 앱 래퍼 |
| electron-builder | 24.x | 설치 파일 빌드 |

### 백엔드 (선택적)
| 기술 | 용도 |
|------|------|
| Python FastAPI | REST API 서버 |
| ChromaDB | 벡터 데이터베이스 (시맨틱 검색) |

### 테스트
| 기술 | 용도 |
|------|------|
| Vitest | 단위/통합 테스트 |
| @testing-library/react | 컴포넌트 테스트 |
| jsdom | DOM 시뮬레이션 |

---

## 핵심 알고리즘 및 이론

### 1. TF-IDF 벡터 검색 (`src/lib/graphAnalysis.ts`)

**이론**: Term Frequency-Inverse Document Frequency

키워드 매칭이 아닌 **통계적 의미 유사도**로 문서를 검색합니다. 문서 제목이 달라도 내용이 관련되면 찾아냅니다.

```
TF(t, d)  = 문서 d에서 단어 t의 빈도 / 문서 d의 전체 단어 수
IDF(t)    = log((전체 문서 수 + 1) / (t를 포함하는 문서 수 + 1)) + 1  ← Smoothed IDF
TF-IDF    = TF × IDF

코사인 유사도 = (쿼리 벡터 · 문서 벡터) / (|쿼리 벡터| × |문서 벡터|)
```

**구현 특징**:
- 볼트 로드 시 `setTimeout(0)`으로 백그라운드 인덱싱 (UI 블로킹 없음)
- 한국어 조사 제거(형태소 처리): "스칼렛이라는" → "스칼렛"
- OOV(Out-of-Vocabulary) 단어: `IDF = log(2)` 폴백
- **IndexedDB 캐싱**: 파일 mtime 기반 지문(fingerprint)으로 캐시 유효성 검사 → 재오픈 시 ms 단위 복원

```typescript
// 볼트 로드 완료 후 — 캐시 히트 시 복원, 미스 시 빌드 후 저장
const fingerprint = buildFingerprint(docs)  // "id1:mtime1|id2:mtime2|..."
setTimeout(async () => {
  const cached = await loadTfIdfCache(dirPath, fingerprint)
  if (cached) {
    tfidfIndex.restore(cached)              // IndexedDB에서 즉시 복원
  } else {
    tfidfIndex.build(docs)                  // 최초 빌드
    void saveTfIdfCache(dirPath, tfidfIndex.serialize(fingerprint))
  }
}, 0)

// 검색 사용 예시
const results = tfidfIndex.search("전투 밸런싱", 8)
```

---

### 2. BFS 그래프 탐색 (`src/lib/graphRAG.ts`)

**이론**: Breadth-First Search (너비 우선 탐색)

WikiLink로 연결된 문서들을 최대 N홉까지 탐색하여 관련 컨텍스트를 수집합니다.

```
시드 문서 (hop=0) → 1홉 연결 문서 → 2홉 연결 문서 → 3홉 연결 문서
     ↑                    ↑                ↑                ↑
 전체 내용 수집       600자 수집        280자 수집       120자 수집
```

**홉 거리별 내용 예산**: 가까운 문서일수록 더 많은 내용을 수집합니다.
```
hop=0 (직접): 1200자
hop=1 (1홉):   600자
hop=2 (2홉):   280자
hop=3 (3홉):   120자
```

**허브 노드 보완**: TF-IDF 시드가 2개 미만이면 연결도 상위 5개 허브 노드를 자동으로 시드에 추가합니다.

---

### 3. PageRank (`src/lib/graphAnalysis.ts`)

**이론**: Google PageRank 알고리즘

많은 문서로부터 위키링크로 참조될수록 높은 중요도를 받습니다.

```
PR(d) = (1 - d) / N + d × Σ [PR(i) / OutDegree(i)] for all i linking to d

d = damping factor (0.85)
N = 전체 문서 수
```

**구현 최적화**: 역방향 엣지 사전 계산으로 O(N+M) 시간 복잡도 달성 (25회 반복).

```typescript
// 역방향 엣지로 효율적 계산
const inEdges = new Map<string, string[]>()
for (const [from, neighbors] of adjacency) {
  for (const to of neighbors) inEdges.get(to)!.push(from)
}
```

**용도**: AI 컨텍스트 헤더의 "주요 허브 문서" 표시, 전체 탐색 시작점 결정

---

### 4. Union-Find 클러스터 감지 (`src/lib/graphAnalysis.ts`)

**이론**: Disjoint Set Union (Union-Find)

위키링크로 연결된 문서 그룹을 자동으로 클러스터로 분류합니다. 같은 클러스터 = 직간접적으로 연결된 문서 집합.

```
A - B - C      D - E      F
  클러스터 1    클러스터 2  클러스터 3
```

**경로 압축(Path Compression)** 포함으로 거의 O(1) amortized 복잡도:

```typescript
function find(x: string): string {
  if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))  // 경로 압축
  return parent.get(x)!
}
```

**용도**: AI 컨텍스트 헤더에 "클러스터별 문서 그룹" 표시, LLM이 프로젝트 구조 파악

---

### 5. d3-force 물리 시뮬레이션

**이론**: Force-Directed Graph Layout

노드 간 반발력(charge)과 링크 인장력(link force)의 균형으로 자연스러운 그래프 레이아웃을 생성합니다.

```
합력 = 중심 인력 + 노드 간 반발력 + 링크 인장력
     = centerForce + charge (-80 기본) + linkStrength × (distance - linkDistance)
```

**파라미터 (실시간 조정 가능)**:
| 파라미터 | 기본값 | 범위 | 설명 |
|---------|-------|------|------|
| centerForce | 0.8 | 0~1 | 중심으로 당기는 힘 |
| charge | -80 | -1000~0 | 노드 간 반발력 |
| linkStrength | 0.7 | 0~2 | 링크 인장력 |
| linkDistance | 60 | 20~300 | 목표 링크 길이 |

---

### 6. Korean 형태소 처리 (간이 토크나이저)

완전한 형태소 분석기 없이 **그리디 조사 제거**로 한국어 검색 품질을 향상시킵니다.

```
"스칼렛이라는" → suffix "이라는" 제거 → "스칼렛"
"전투에서의"   → suffix "에서의" 제거 → "전투"
"게임에"       → suffix "에" 제거     → "게임"
```

조사 목록은 최장 일치 우선(greedy longest match)으로 처리합니다.

---

### 7. 묵시적 연결 발견 (`src/lib/graphAnalysis.ts`)

**이론**: Pairwise Cosine Similarity Filtering

WikiLink로 직접 연결되지 않은 문서 쌍 중 **TF-IDF 코사인 유사도가 임계값(0.25) 이상**인 쌍을 "숨겨진 연관"으로 감지합니다. 사용자가 미처 발견하지 못한 개념적 연결을 AI가 표면화할 수 있습니다.

```
문서 A (전투 시스템) + 문서 B (캐릭터 성장)
  → 직접 WikiLink 없음
  → TF-IDF 유사도 = 0.72  ≥  threshold 0.25
  → "숨겨진 연관" 감지
  → AI 구조 헤더에 포함
```

**구현 최적화**:
- 최대 250개 문서 대상 O(N²) 계산
- adjacency 참조 기준 캐시 (볼트 재로드 시만 재계산)
- 볼트 로드 완료 후 `setTimeout(0)` 백그라운드 사전 계산

---

### 8. 클러스터 주제 키워드 (`src/lib/graphAnalysis.ts`)

**이론**: Cluster-level TF Aggregation

각 클러스터 내 모든 문서의 텍스트를 합산하여 **고빈도 토큰 상위 K개**를 주제 키워드로 추출합니다.

```
클러스터 1 (12개 문서):
  전체 텍스트 합산 → 토큰 빈도 계산
  상위 3개: ["전투", "스킬", "밸런스"]

AI 구조 헤더: "클러스터 1 [전투/스킬/밸런스] (12개): ..."
```

**효과**: AI가 클러스터의 주제를 한눈에 파악 → 더 정확한 영역별 분석 가능

---

### 9. 브릿지 노드 탐지 (`src/lib/graphAnalysis.ts`)

**이론**: Cross-cluster Connectivity Analysis

자신과 **다른 클러스터에 속한 이웃을 1개 이상 가진 노드** = 브릿지 노드. 이런 노드는 여러 주제 영역을 연결하는 **아키텍처 핵심 문서**입니다.

```
"캐릭터" 문서
  이웃: 전투 클러스터 3개 + 스토리 클러스터 2개 + 아이템 클러스터 1개
  → 연결 클러스터 수 = 4 (자신 포함)
  → 브릿지 노드로 감지
  → AI 구조 헤더에 "핵심 브릿지 문서"로 표시
```

**효과**: 프로젝트에서 가장 중요한 연결 문서를 AI가 우선 파악

---

### 10. 패시지-레벨 검색 (`src/lib/graphRAG.ts`)

**이론**: Passage-level Relevance Scoring

기존에는 BFS로 탐색된 문서의 **처음 N자**를 사용했습니다. 개선된 방식은 쿼리 토큰과 가장 많이 매칭되는 **섹션을 선별**합니다.

```
기존: 문서 rawContent[:1200] (앞부분 고정)
개선: 각 섹션에서 queryTerms 매칭 수 계산 → 최다 매칭 섹션 선택

"전투 밸런스" 쿼리
  섹션 1 "## 개요": 0개 매칭
  섹션 2 "## 전투 로직": 2개 매칭  ← 선택
  섹션 3 "## 버그 기록": 0개 매칭
```

**효과**: 같은 토큰 예산으로 더 관련된 내용 → 더 정확한 인사이트

---

### 11. Graph-Augmented RAG 전체 파이프라인

```
볼트 로드 완료
    │
    ├─ TF-IDF 인덱스 빌드 (background)
    │       └─ 묵시적 연결 사전 계산 (adjacency 기반 캐시)
    │
    └─ 클러스터 + PageRank 메트릭 캐시

사용자 쿼리
    │
    ├─ 전체 탐색 인텐트? ("전체", "전반적", "모든 문서" ...)
    │       └─ buildGlobalGraphContext()
    │              └─ 허브 8개 → BFS 4홉 → 최대 35개 문서 (패시지-레벨)
    │
    └─ 일반 쿼리
            │
            ├─ TF-IDF 코사인 유사도 검색 → 상위 8개 후보
            │   └─ (TF-IDF 미빌드 시) 키워드 매칭 폴백
            │
            ├─ 스코어 > 0.05 필터
            │
            ├─ 재순위화 (keyword overlap + speaker affinity)
            │
            ├─ 시드 < 2개? → 허브 노드 자동 보완
            │
            └─ BFS 그래프 탐색 (3홉, 최대 20개 문서)
                    │ queryTerms 전달 → 패시지-레벨 섹션 선택
                    │
                    └─ 구조 헤더 생성
                            ├─ PageRank 상위 허브 5개
                            ├─ C. 클러스터별 주제 키워드 레이블
                            ├─ D. 브릿지 노드 (다중 클러스터 연결)
                            └─ A. 숨겨진 의미적 연관 쌍 (상위 4개)
                                    │
                                    └─ LLM에 컨텍스트 주입
```

**컨텍스트 구조 예시**:
```
## 프로젝트 구조 개요
총 클러스터: 5개 | 탐색 문서: 23개
주요 허브 문서 (PageRank 상위): 전투시스템, 캐릭터설계, 레벨디자인...

클러스터별 주제 그룹:
  • 클러스터 1 [전투/스킬/밸런스] (12개): 전투시스템, 스킬트리...
  • 클러스터 2 [UI/HUD/인벤토리] (8개): UI설계, HUD...

핵심 브릿지 문서 (다중 클러스터 연결): 캐릭터(4개 클러스터 연결), 아이템(3개)

숨겨진 의미적 연관 (WikiLink 없음):
  • "전투시스템" ↔ "캐릭터성장" (유사도 72%)
  • "레벨디자인" ↔ "밸런스가이드" (유사도 65%)

## 관련 문서 (그래프 탐색)
[직접] 전투시스템 (prog_director)
### 전투 로직  ← 패시지-레벨 선택된 섹션
전투 밸런스 관련 내용...

[1홉] 캐릭터스탯 (plan_director)
### 스탯 밸런싱  ← 쿼리와 가장 관련된 섹션
스탯 설계 내용...
```

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                   Electron Shell                    │
│  ┌─────────────────┐      ┌────────────────────┐   │
│  │   Main Process  │      │  Renderer Process  │   │
│  │  (electron/     │ IPC  │  (React + Vite)    │   │
│  │   main.cjs)     │ ←──→ │                    │   │
│  │                 │      │  ┌──────────────┐  │   │
│  │  • File System  │      │  │  Graph UI    │  │   │
│  │  • Path Watch   │      │  │  (2D + 3D)   │  │   │
│  │  • Python Mgr   │      │  ├──────────────┤  │   │
│  └─────────────────┘      │  │  Chat Panel  │  │   │
│                            │  │  (5 Personas)│  │   │
│  ┌─────────────────┐      │  ├──────────────┤  │   │
│  │ Python Backend  │      │  │  MD Editor   │  │   │
│  │ (FastAPI +      │ HTTP │  │  (CodeMirror)│  │   │
│  │  ChromaDB)      │ ←──→ │  └──────────────┘  │   │
│  └─────────────────┘      └────────────────────┘   │
└─────────────────────────────────────────────────────┘
         ↕                           ↕
   .md Vault Files         LLM APIs (Claude/GPT/
   (로컬 파일 시스템)        Gemini/Grok)
```

### 데이터 흐름

```
.md 파일 로드
  → markdownParser.ts (YAML 프론트매터 + WikiLink 파싱, 비동기 청크 처리)
  → LoadedDocument[]
  → buildGraph() → GraphNode[] + GraphLink[]
  → graphStore / vaultStore 저장
  → 2D/3D 그래프 렌더링 (Canvas)

  [백그라운드, setTimeout(0)]
  → buildFingerprint(docs) → 지문 생성
  → loadTfIdfCache(vaultPath, fingerprint)
      ├─ 캐시 히트: tfidfIndex.restore(cached)  ← ms 단위 복원
      └─ 캐시 미스: tfidfIndex.build(docs) → saveTfIdfCache(...)
  → findImplicitLinks(adjacency)  ← 묵시적 연결 사전 계산
```

---

## 설치 및 실행

### 사전 요구사항
- Node.js 18+
- Python 3.10+ (백엔드 선택 사용 시)

### 개발 환경 실행

```bash
# 의존성 설치
npm install

# Electron + Vite 동시 실행
npm run electron:dev
```

### 프로덕션 빌드

```bash
npm run electron:build
```

### Python 백엔드 실행 (선택)

ChromaDB 벡터 검색을 사용하려면 백엔드를 실행합니다. 없어도 TF-IDF 검색으로 동작합니다.

```bash
pip install -r requirements.txt
python -m uvicorn backend.main:app --port 8765
```

---

## 사용 방법

### 1. 볼트 로드

1. 앱 실행 → 시작 화면에서 "볼트 열기" 클릭
2. Obsidian 볼트 폴더 선택 (`.md` 파일이 있는 폴더)
3. 그래프가 자동으로 생성됩니다

### 2. 그래프 탐색

- **마우스 드래그**: 그래프 회전/이동
- **스크롤**: 줌 인/아웃
- **노드 클릭**: 문서 선택 (우측 문서 뷰어에 내용 표시)
- **노드 더블클릭**: 에디터에서 열기
- **팔레트 버튼** (좌하단): 노드 색상 모드 변경

### 3. AI 분석

**특정 노드 분석**:
1. 그래프에서 노드 클릭으로 선택
2. "AI 분석" 버튼 클릭 (좌하단)
3. 해당 문서와 연결된 모든 관련 문서를 AI가 자동 탐색 후 분석

**전체 프로젝트 분석**:
1. 노드 선택 없이 "AI 전체 분석" 버튼 클릭
2. 허브 노드 기반으로 전체 볼트를 탐색하여 프로젝트 개요 분석

### 4. AI 채팅

- 우측 패널에서 AI 디렉터 페르소나 선택
- 자연어로 질문: 쿼리에 따라 자동으로 관련 문서를 찾아 답변
  - `"RPG 전투 밸런싱 개선점을 알려주세요"` → TF-IDF로 관련 문서 검색 + BFS 탐색
  - `"전체 프로젝트 인사이트를 알려주세요"` → 전체 그래프 탐색

### 5. 마크다운 에디터

- 파일 트리에서 파일 더블클릭 또는 우클릭 → "에디터에서 열기"
- `[[` 입력 시 볼트 내 문서 자동완성
- 저장: `Ctrl+S` 또는 1.2초 후 자동 저장

---

## 볼트 구조 가이드

Rembrandt Map은 Obsidian과 완전히 호환됩니다. 더 풍부한 AI 인사이트를 위해 다음 구조를 권장합니다.

### 추천 프론트매터

```yaml
---
speaker: prog_director    # 담당자 (AI 페르소나 매칭)
date: 2024-01-15
tags: [전투, 밸런싱, RPG]
type: design              # 문서 유형
---
```

### 위키링크 활용

```markdown
## 전투 시스템

기본 공격 메커니즘은 [[스킬 트리]]와 연동됩니다.
밸런싱 기준은 [[게임 디자인 원칙]]을 따릅니다.
```

**위키링크가 많을수록** BFS 탐색 범위가 넓어져 AI 인사이트의 품질이 향상됩니다.

### Speaker ID 목록

| ID | 역할 |
|----|------|
| `chief_director` | 총괄 디렉터 |
| `art_director` | 아트 디렉터 |
| `plan_director` | 기획 디렉터 |
| `level_director` | 레벨 디렉터 |
| `prog_director` | 프로그램 디렉터 |

---

## LLM 설정

설정 패널 (상단 설정 버튼) → API 키 입력 → 페르소나별 모델 선택:

| 제공자 | 지원 모델 | 이미지 지원 |
|--------|---------|-----------|
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | ✅ |
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4o, o3, o4-mini | ✅ |
| Google Gemini | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash | ✅ |
| xAI Grok | grok-3, grok-3-mini, grok-3-fast | ❌ |

**페르소나별 모델 독립 설정**: 각 디렉터 페르소나마다 다른 모델을 지정할 수 있습니다.
동일한 API 키로 여러 페르소나에게 서로 다른 모델을 할당하거나, 토론 모드에서 같은 제공자로 여러 참여자를 구성할 수 있습니다.

---

## 프로젝트 구조

```
src/
├── components/
│   ├── chat/           # 채팅 패널 + 토론 모드 (DebateEngine, QuickQuestions)
│   ├── editor/         # CodeMirror 마크다운 에디터
│   ├── fileTree/       # 파일 트리 + 컨텍스트 메뉴
│   ├── graph/          # Graph2D (Canvas), Graph3D, GraphPanel (AI 분석)
│   ├── layout/         # 메인 레이아웃 + 상단 바 (노드 라벨 토글)
│   └── settings/       # 설정 모달 (페르소나별 모델 + currentSituation)
│
├── lib/
│   ├── graphAnalysis.ts    # TF-IDF + PageRank + 클러스터링 + serialize/restore
│   ├── graphRAG.ts         # Graph-Augmented RAG 파이프라인 + 최근성 정렬
│   ├── graphBuilder.ts     # 노드/링크 생성 (팬텀 노드 포함)
│   ├── markdownParser.ts   # YAML 프론트매터 + WikiLink 파싱 (비동기 청크)
│   ├── tfidfCache.ts       # IndexedDB TF-IDF 캐시 (저장/복원/지문 검증)
│   ├── speakerConfig.ts    # 페르소나 ID + 라벨 + 색상 중앙 설정
│   ├── modelConfig.ts      # 모델 → 제공자 매핑 + 모델 목록
│   ├── personaVaultConfig.ts # 볼트 내 .rembrant/personas.md 파싱
│   └── nodeColors.ts       # 해시 기반 결정론적 노드 색상
│
├── services/
│   ├── debateEngine.ts     # 토론 모드 엔진 (페르소나 기반 참여자)
│   ├── debateRoles.ts      # 토론 역할 + 라벨/색상 설정
│   ├── llmClient.ts        # 다중 LLM 통합 인터페이스
│   └── providers/          # Anthropic / OpenAI / Gemini / Grok
│
├── stores/
│   ├── graphStore.ts       # 노드/링크/선택 상태
│   ├── vaultStore.ts       # 로드된 문서 리스트
│   ├── settingsStore.ts    # API 키 + 페르소나 모델 + currentSituation (persist)
│   ├── backendStore.ts     # Python 백엔드 상태
│   └── uiStore.ts          # 테마 + 탭 + 편집 문서
│
└── hooks/
    ├── useVaultLoader.ts       # 볼트 로드 + TF-IDF 캐시 통합
    ├── useGraphSimulation.ts   # 2D d3-force 시뮬레이션 (Canvas + Fast Mode)
    └── useGraphSimulation3D.ts # 3D 물리 시뮬레이션
```

---

## 라이선스

MIT License

---

> "문서가 많아질수록 그래프는 더 깊어지고, AI는 더 넓게 탐색합니다."
