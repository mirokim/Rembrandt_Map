# Rembrandt Map

**AI Director Proxy System** — Obsidian 볼트를 지식 그래프로 시각화하고, 여러 AI 페르소나가 그래프를 탐색하며 심층 인사이트를 제공하는 데스크톱 애플리케이션입니다.

---

## 목차

1. [개요](#개요)
2. [주요 기능](#주요-기능)
3. [사용 기술 스택](#사용-기술-스택)
4. [핵심 알고리즘 및 이론](#핵심-알고리즘-및-이론)
5. [Multi-Agent RAG 아키텍처](#multi-agent-rag-아키텍처)
6. [시스템 아키텍처](#시스템-아키텍처)
7. [설치 및 실행](#설치-및-실행)
8. [사용 방법](#사용-방법)
9. [볼트 구조 가이드](#볼트-구조-가이드)
10. [LLM 설정](#llm-설정)
11. [프로젝트 구조](#프로젝트-구조)

---

## 개요

Rembrandt Map은 Obsidian 스타일의 마크다운 볼트를 읽어 **위키링크 기반 지식 그래프**를 시각화하고, 5명의 AI 디렉터 페르소나가 그래프를 탐색하며 프로젝트에 대한 구체적인 피드백과 인사이트를 제공합니다.

```
볼트 폴더 (.md 파일들)
  ↓ 로드 + 파싱
지식 그래프 (WikiLink 연결)
  ↓ directVaultSearch + TF-IDF + BFS + PageRank
컨텍스트 수집
  ↓ Multi-Agent RAG (Chief + Worker LLMs)
구체적 인사이트 (스트리밍)
```

---

## 주요 기능

### 지식 그래프 시각화
- **2D 그래프 (SVG)**: d3-force 물리 시뮬레이션 기반 인터랙티브 그래프 — 일반 모드에서 사용
- **2D 그래프 (Canvas)**: Fast Mode 전용 Canvas 렌더러 — 대용량 볼트에서 고성능 렌더링
- **3D 그래프**: Three.js + d3-force-3d 기반 입체 그래프
- **Obsidian-style 노드 크기**: 링크 수(degree)에 비례해 노드 크기 자동 조절 — 허브 문서는 크게, 고립 문서는 작게 (√degree 스케일)
- **노드 색상 모드**: 문서 유형 / 담당자(speaker) / 폴더 / 태그 / 주제별 색상 구분
- **팬텀 노드**: 링크 대상이 아직 없는 위키링크도 그래프에 표시 (Obsidian 동작 동일)
- **이미지 노드**: `![[image.png]]`로 명시적 참조된 이미지가 그래프 노드로 시각화 (다이아몬드 형태, 보라색)
- **AI 노드 하이라이트**: AI 답변에서 언급된 문서를 그래프에서 자동 하이라이트 + 펄스 애니메이션
- **노드 라벨 토글**: 상단 바에서 전체 노드 라벨 표시/숨기기 전환
- **Fast Mode**: Canvas 렌더러 강제 전환 + 호버 스킵 + 동기 물리 틱으로 대용량 볼트에서도 부드러운 렌더링

### Graph-Augmented RAG (그래프 증강 검색)
- **directVaultSearch**: 날짜명 파일(`[2026.01.28] 피드백.md`) 및 정확한 제목 매칭을 위한 grep-style 직접 검색 — TF-IDF 이전 우선 실행
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

### Multi-Agent RAG _(신규)_
- **Chief + Worker 구조**: 주요 문서는 Chief(메인) LLM이 20K 전체 읽기, 보조 문서는 Worker(저렴한) LLM이 병렬로 200자 요약 후 전달
- **자동 Worker 모델 선택**: 현재 페르소나 모델의 제공자에 맞는 저렴한 모델 자동 선택 (Claude Haiku / GPT-4.1-mini / Gemini Flash Lite / Grok-mini)
- **병렬 요약**: 보조 문서 최대 4개를 `Promise.all`로 동시 처리 → 지연 최소화
- **폴백 안전**: Worker 실패 시 문서 앞 300자로 자동 대체
- **토글 가능**: 설정 패널 AI 탭에서 Multi-Agent RAG 켜기/끄기

### 컨텍스트 컴팩션 _(신규)_
- **자동 대화 압축**: 채팅 히스토리 총 글자 수가 20,000자를 초과하면 오래된 메시지를 Worker LLM으로 자동 요약 → 시스템 프롬프트에 "이전 대화 요약" 섹션으로 주입
- **최근 8개 메시지 보존**: 최신 대화 맥락은 그대로 유지, 오래된 내용만 압축
- **AI 메모리 자동 저장**: 컴팩션 시 요약 내용을 영구 메모리(`memoryStore`)에 자동 추가 → 다음 세션에도 인사이트 누적

### AI 메모리 _(신규)_
- **대화 요약 저장 버튼** (📝): 채팅 패널에서 클릭 시 현재 대화를 AI가 요약하여 영구 메모리에 추가
- **수동 + 자동**: 버튼으로 수동 저장 또는 컨텍스트 컴팩션 발동 시 자동 저장
- **누적 메모리**: 이전 세션의 결정사항/인사이트가 현재 AI 프롬프트에 자동 주입

### AI 분석 패널
- **노드 선택 분석**: 특정 문서 선택 후 해당 노드와 연결된 모든 문서를 AI가 분석
- **전체 분석**: 노드 선택 없이도 전체 프로젝트를 허브 기반으로 분석
- **멀티패스 UI**: "탐색 중 → 분석 중" 단계별 진행 표시
- **QuickQuestions**: 페르소나별 풀에서 랜덤 추천 질문 제공
- **currentSituation 컨텍스트**: 현재 상황/이슈를 설정해두면 모든 AI 프롬프트에 자동 주입
- **이미지 자동 첨부**: 선택한 문서에 `![[...]]` 이미지가 있으면 채팅 전송 시 자동 첨부 → AI vision 분석 가능

### 다중 LLM 페르소나
- 5명의 디렉터 페르소나 (총괄 / 아트 / 디자인 / 레벨 / 테크)
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
- **페르소나 기반 참여자**: 동일한 API 키로 여러 페르소나가 동시 참여 가능
- API 키가 설정된 페르소나만 참여 후보로 표시
- 참고 자료 첨부 (텍스트 / 이미지 / PDF), 실시간 스트리밍 표시

### 파일 트리
- 폴더 / 담당자 / 태그별 분류 표시
- 이름 / 수정일 기준 정렬
- 우클릭 컨텍스트 메뉴: 편집기 열기 / 복사 / 북마크 / 이름 변경 / 삭제

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
| Vitest | 단위/통합 테스트 (425개 테스트 전체 통과) |
| @testing-library/react | 컴포넌트 테스트 |
| jsdom | DOM 시뮬레이션 |

---

## 핵심 알고리즘 및 이론

### 1. directVaultSearch — Grep-style 직접 검색 (`src/lib/graphRAG.ts`)

날짜명 파일(`[2026.01.28] 피드백 회의.md`)처럼 TF-IDF가 잘 찾지 못하는 제목 기반 검색을 처리합니다.

**검색 전략**:
1. **강한 매칭** (score ≥ 0.4): 파일명 포함 / 제목 일치 / 숫자 추출 매칭
2. **약한 매칭** (score < 0.4): 본문 substring 매칭

**특징**:
- 한국어 조사 제거: "2월26일의" → "2월26일"
- 숫자 추출: "2026년 1월 28일" 쿼리 → `["2026", "0128", "26"]` 등 복수 패턴 생성
- 강한 매칭 시 해당 문서를 TF-IDF 결과보다 우선하여 "직접 지목 문서"로 처리

```typescript
// 강한 매칭 → 직접 지목 문서 (전체 20K 내용 Chief LLM이 읽음)
if (strongPinnedHits.length > 0) {
  // Top-1: 전체 내용 (20K)
  // Doc 2-5: Worker LLM 병렬 요약 (200자)
}
```

---

### 2. TF-IDF 벡터 검색 (`src/lib/graphAnalysis.ts`)

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
```

---

### 3. BFS 그래프 탐색 (`src/lib/graphRAG.ts`)

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

### 4. PageRank (`src/lib/graphAnalysis.ts`)

**이론**: Google PageRank 알고리즘

많은 문서로부터 위키링크로 참조될수록 높은 중요도를 받습니다.

```
PR(d) = (1 - d) / N + d × Σ [PR(i) / OutDegree(i)] for all i linking to d

d = damping factor (0.85)
N = 전체 문서 수
```

**구현 최적화**: 역방향 엣지 사전 계산으로 O(N+M) 시간 복잡도 달성 (25회 반복).

---

### 5. Union-Find 클러스터 감지 (`src/lib/graphAnalysis.ts`)

**이론**: Disjoint Set Union (Union-Find)

위키링크로 연결된 문서 그룹을 자동으로 클러스터로 분류합니다.

```
A - B - C      D - E      F
  클러스터 1    클러스터 2  클러스터 3
```

**경로 압축(Path Compression)** 포함으로 거의 O(1) amortized 복잡도.

---

### 6. d3-force 물리 시뮬레이션

**이론**: Force-Directed Graph Layout

노드 간 반발력(charge)과 링크 인장력(link force)의 균형으로 자연스러운 그래프 레이아웃을 생성합니다.

**파라미터 (실시간 조정 가능)**:
| 파라미터 | 기본값 | 범위 | 설명 |
|---------|-------|------|------|
| centerForce | 0.8 | 0~1 | 중심으로 당기는 힘 |
| charge | -80 | -1000~0 | 노드 간 반발력 |
| linkStrength | 0.7 | 0~2 | 링크 인장력 |
| linkDistance | 60 | 20~300 | 목표 링크 길이 |

---

### 7. Korean 형태소 처리 (간이 토크나이저)

완전한 형태소 분석기 없이 **그리디 조사 제거**로 한국어 검색 품질을 향상시킵니다.

```
"스칼렛이라는" → suffix "이라는" 제거 → "스칼렛"
"전투에서의"   → suffix "에서의" 제거 → "전투"
"게임에"       → suffix "에" 제거     → "게임"
```

---

### 8. 묵시적 연결 발견 (`src/lib/graphAnalysis.ts`)

WikiLink로 직접 연결되지 않은 문서 쌍 중 **TF-IDF 코사인 유사도가 임계값(0.25) 이상**인 쌍을 "숨겨진 연관"으로 감지합니다.

```
문서 A (전투 시스템) + 문서 B (캐릭터 성장)
  → 직접 WikiLink 없음
  → TF-IDF 유사도 = 0.72  ≥  threshold 0.25
  → "숨겨진 연관" 감지
  → AI 구조 헤더에 포함
```

---

### 9. 패시지-레벨 검색 (`src/lib/graphRAG.ts`)

**이론**: Passage-level Relevance Scoring

쿼리 토큰과 가장 많이 매칭되는 **섹션을 선별**합니다.

```
"전투 밸런스" 쿼리
  섹션 1 "## 개요": 0개 매칭
  섹션 2 "## 전투 로직": 2개 매칭  ← 선택
  섹션 3 "## 버그 기록": 0개 매칭
```

---

### 10. getStrippedBody — 프론트매터 제거 (`src/lib/graphRAG.ts`)

AI 컨텍스트에 문서를 주입할 때 YAML 프론트매터를 제거하고 본문만 전달합니다.

```typescript
// YAML 프론트매터 + (intro) 섹션 제거 후 본문만 반환
export function getStrippedBody(doc: LoadedDocument): string
```

- `rawContent`가 있으면 YAML `---` 블록 제거
- `(intro)` 섹션 헤더 생략
- 모든 처리 실패 시 `rawContent` 원문 폴백

---

## Multi-Agent RAG 아키텍처

```
사용자 쿼리
    │
    ├─ directVaultSearch() ← 날짜명/제목 직접 검색 (grep-style)
    │       │
    │       └─ 강한 매칭(score≥0.4)?
    │               ├─ YES → "직접 지목 문서" 경로
    │               │
    │               │   Top-1 문서
    │               │     └─ Chief LLM → 전체 내용 20K 읽기
    │               │
    │               │   Doc 2~5 (병렬)
    │               │     └─ Worker LLM × N → 각 200자 요약
    │               │           (실패 시 앞 300자 폴백)
    │               │
    │               └─ NO → TF-IDF 경로
    │
    └─ TF-IDF 코사인 유사도 검색 → 상위 8개 후보
            │
            ├─ 재순위화 (keyword overlap + speaker affinity)
            ├─ 시드 < 2개? → 허브 노드 자동 보완
            └─ BFS 그래프 탐색 (3홉, 최대 20개 문서)
                    │
                    └─ buildDeepGraphContext()
                            └─ LLM에 컨텍스트 주입

                                    ↓
                    컨텍스트 컴팩션 (자동)
                    ├─ 히스토리 > 20K chars?
                    │   └─ Worker LLM → 오래된 메시지 요약
                    │         → systemPrompt에 "이전 대화 요약" 주입
                    │         → memoryStore에 자동 저장
                    └─ 최근 8개 메시지 보존
```

### Worker 모델 자동 선택

| Chief 모델 제공자 | Worker 모델 |
|-----------------|------------|
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI | `gpt-4.1-mini` |
| Google | `gemini-2.5-flash-lite` |
| xAI | `grok-3-mini` |

**효과**: Chief LLM은 가장 중요한 문서 1개에 집중, Worker LLM이 보조 문서를 저비용으로 병렬 처리 → 응답 품질 ↑, API 비용 최적화

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
  → 2D/3D 그래프 렌더링

  [백그라운드, setTimeout(0)]
  → buildFingerprint(docs) → 지문 생성
  → loadTfIdfCache(vaultPath, fingerprint)
      ├─ 캐시 히트: tfidfIndex.restore(cached)  ← ms 단위 복원
      └─ 캐시 미스: tfidfIndex.build(docs) → saveTfIdfCache(...)
  → findImplicitLinks(adjacency)  ← 묵시적 연결 사전 계산

  [백그라운드, void async IIFE]
  → 전체 docs의 imageRefs 수집 (중복 제거)
  → 10개씩 배치 병렬 readImage() IPC
  → imageDataCache (filename → base64 dataUrl) 에 저장
  → 채팅 전송 시 캐시에서 즉시 첨부 (IPC 왕복 없음)
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

### 테스트

```bash
# 전체 테스트 실행 (425개)
npm run test
```

### Python 백엔드 실행 (선택)

ChromaDB 벡터 검색을 사용하려면 백엔드를 실행합니다. 없어도 TF-IDF + directVaultSearch로 동작합니다.

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
  - `"2월 26일 피드백 내용을 알려주세요"` → directVaultSearch로 날짜 파일 직접 검색
  - `"RPG 전투 밸런싱 개선점을 알려주세요"` → TF-IDF로 관련 문서 검색 + BFS 탐색
  - `"전체 프로젝트 인사이트를 알려주세요"` → 전체 그래프 탐색
- **이미지 자동 첨부**: 그래프에서 `![[image.png]]`가 있는 문서를 선택하면 채팅창에 "🖼️ N개 이미지 자동 첨부" 배지 표시 → 전송 시 이미지가 AI에게 자동 전달되어 vision 분석 가능

### 5. 대화 요약 저장 (📝)

- 채팅 패널 상단의 📝 버튼 클릭
- AI가 현재 대화를 핵심 결정사항/인사이트 중심으로 요약
- 요약 결과가 AI 메모리에 추가되어 이후 대화에 자동 참고됨

### 6. 마크다운 에디터

- 파일 트리에서 파일 더블클릭 또는 우클릭 → "에디터에서 열기"
- `[[` 입력 시 볼트 내 문서 자동완성
- 저장: `Ctrl+S` 또는 1.2초 후 자동 저장

---

## 볼트 구조 가이드

Rembrandt Map은 Obsidian과 완전히 호환됩니다. 더 풍부한 AI 인사이트를 위해 다음 구조를 권장합니다.

### 추천 프론트매터

```yaml
---
speaker: tech_director    # 담당자 (AI 페르소나 매칭)
date: 2024-01-15
tags: [전투, 밸런싱, RPG]
type: design              # 문서 유형
---
```

### 위키링크 및 이미지 임베드 활용

```markdown
## 전투 시스템

기본 공격 메커니즘은 [[스킬 트리]]와 연동됩니다.
밸런싱 기준은 [[게임 디자인 원칙]]을 따릅니다.

![[combat_flowchart.png]]
```

**위키링크가 많을수록** BFS 탐색 범위가 넓어져 AI 인사이트의 품질이 향상됩니다.

**날짜 파일명 권장**: `[2024.01.28] 피드백 회의.md` 형식으로 저장하면 "1월 28일 피드백"처럼 자연어로 검색 가능합니다.

### Speaker ID 목록

| ID | 역할 |
|----|------|
| `chief_director` | 총괄 디렉터 |
| `art_director` | 아트 디렉터 |
| `design_director` | 디자인 디렉터 |
| `level_director` | 레벨 디렉터 |
| `tech_director` | 테크 디렉터 |

---

## LLM 설정

설정 패널 (상단 설정 버튼) → API 키 입력 → 페르소나별 모델 선택:

| 제공자 | 지원 모델 | 이미지 지원 |
|--------|---------|-----------|
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | ✅ |
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4o, o3, o4-mini | ✅ |
| Google Gemini | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite | ✅ |
| xAI Grok | grok-3, grok-3-mini, grok-3-fast | ❌ |

**페르소나별 모델 독립 설정**: 각 디렉터 페르소나마다 다른 모델을 지정할 수 있습니다.
동일한 API 키로 여러 페르소나에게 서로 다른 모델을 할당하거나, 토론 모드에서 같은 제공자로 여러 참여자를 구성할 수 있습니다.

**Multi-Agent RAG 설정**: AI 탭에서 Worker LLM 병렬 요약 기능을 켜기/끄기 할 수 있습니다. 기본값은 활성화입니다.

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
│   └── settings/       # 설정 모달 (페르소나별 모델 + currentSituation + Multi-Agent 토글)
│
├── lib/
│   ├── graphAnalysis.ts    # TF-IDF + PageRank + 클러스터링 + serialize/restore
│   ├── graphRAG.ts         # Graph-Augmented RAG 파이프라인 (directVaultSearch + BFS + getStrippedBody)
│   ├── graphBuilder.ts     # 노드/링크 생성 (팬텀 노드 + 이미지 노드 포함)
│   ├── markdownParser.ts   # YAML 프론트매터 + WikiLink + imageRefs 파싱 (비동기 청크)
│   ├── tfidfCache.ts       # IndexedDB TF-IDF 캐시 (저장/복원/지문 검증)
│   ├── speakerConfig.ts    # 페르소나 ID + 라벨 + 색상 중앙 설정
│   ├── modelConfig.ts      # 모델 → 제공자 매핑 + 모델 목록
│   ├── personaVaultConfig.ts # 볼트 내 .rembrant/personas.md 파싱
│   └── nodeColors.ts       # 해시 기반 결정론적 노드 색상 + degree-proportional 크기 계산
│
├── services/
│   ├── debateEngine.ts     # 토론 모드 엔진 (페르소나 기반 참여자)
│   ├── debateRoles.ts      # 토론 역할 + 라벨/색상 설정
│   ├── llmClient.ts        # 다중 LLM 통합 인터페이스 (Multi-Agent RAG + 컨텍스트 컴팩션)
│   └── providers/          # Anthropic / OpenAI / Gemini / Grok
│
├── stores/
│   ├── graphStore.ts       # 노드/링크/선택 상태
│   ├── vaultStore.ts       # 로드된 문서 + imagePathRegistry + imageDataCache
│   ├── settingsStore.ts    # API 키 + 페르소나 모델 + currentSituation + multiAgentRAG (persist)
│   ├── memoryStore.ts      # AI 영구 메모리 (대화 요약 누적, persist)
│   ├── backendStore.ts     # Python 백엔드 상태
│   └── uiStore.ts          # 테마 + 탭 + 편집 문서
│
├── hooks/
│   ├── useVaultLoader.ts       # 볼트 로드 + TF-IDF 캐시 + 이미지 사전 인덱싱
│   ├── useGraphSimulation.ts   # 2D d3-force 시뮬레이션 (Canvas + Fast Mode)
│   └── useGraphSimulation3D.ts # 3D 물리 시뮬레이션
│
└── __tests__/              # Vitest 단위/통합 테스트 (425개 전체 통과)
    ├── graphRAG.test.ts        # directVaultSearch + getStrippedBody + buildDeepGraphContext
    ├── graphAnalysis.test.ts   # TF-IDF + PageRank + 클러스터링
    ├── llmClient.test.ts       # Multi-Agent RAG + 컨텍스트 컴팩션
    └── ...                     # 컴포넌트 테스트
```

---

## 라이선스

MIT License

---

> "문서가 많아질수록 그래프는 더 깊어지고, AI는 더 넓게 탐색합니다."
