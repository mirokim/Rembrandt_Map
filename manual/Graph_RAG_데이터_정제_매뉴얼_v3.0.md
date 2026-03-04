Graph RAG

데이터 정제 매뉴얼

Obsidian Vault 기반 지식 그래프 품질 향상 통합 가이드

외부 데이터 수집 · 변환 · 정제 · 링크 강화 · 품질 관리 · 자동 오류 수정 전 과정을 다룬다.

v3.0  |  2026-03-04

# 1.  개요

Graph RAG(Retrieval-Augmented Generation)는 문서 간 연결 구조(그래프)를 활용하여 관련 컨텍스트를 탐색한다. 원본 데이터를 그대로 투입하면 고립 노드·중복 문서·의미 없는 허브가 생겨 검색 품질이 크게 저하된다. 본 매뉴얼은 이를 체계적으로 해소하는 단계별 방법론을 기술한다.

## 1.1  핵심 판단 기준

"AI가 이 문서를 읽으면 현재 의사결정에 도움이 되는가?"

이 질문을 기준으로 모든 문서의 보존·삭제·수정을 판단한다.

## 1.2  적용 환경

## 1.3  핵심 품질 지표

# 2.  파이프라인 전체 흐름

아래 14단계를 순서대로 수행한다. 각 단계는 이전 단계의 결과물에 의존한다.

# 3.  데이터 분류 기준

## 3.1  삭제 대상 — 완전 노이즈

완료되고 후속이 없는 단발성 이슈 트래킹 (한두 줄짜리 완료 메모)

회의실 예약·총무 공지·식사 안내 등 운영성 내용

'추후 작성 예정'처럼 내용이 없는 빈 페이지 또는 스텁

임시 메모성 글 (날짜 + 한두 줄)

내용이 완전히 동일한 중복 파일 (파일명만 다른 경우)

## 3.2  격리(archive/) 대상 — 낮은 우선순위

6개월 이상 된 스펙 중 이미 바뀐 내용이 명확한 것

폐기된 기획안, 취소된 기능

리팩토링 이전의 구 아키텍처 문서

개인별 주간 업무보고 원본 (월별 통합본을 따로 생성)

Graph RAG 시스템에서 archive/ 폴더를 탐색 제외 설정하되, 파일 자체는 유지한다.

## 3.3  수정 대상 — 구버전 문서

완전 삭제보다 교정 표시 방식을 권장한다.

---

status: outdated

superseded_by: [[신규_문서명]]

---

> ⚠️ 이 문서는 구 버전입니다. 현재 기준은 [[신규_문서명]]을 참조하세요.

superseded_by 위키링크를 달아두면 Graph RAG가 그래프를 타고 신뢰도 높은 최신 문서를 우선 참조한다.

## 3.4  보강 대상 — 기록되지 않은 내용

기록이 없는 내용은 아래 우선순위로 추가한다.

현재 살아있는 시스템·기능의 설계 의도

팀에서 반복적으로 나오는 질문들 ("왜 이렇게 했냐"에 대한 답)

최근 6개월 결정사항 중 위키에 없는 것

# 4.  HTML · PDF → Markdown 변환

## 4.1  HTML 변환 핵심 처리

HTML 파싱 후 본문 텍스트 추출 (BeautifulSoup 등)

HTML 테이블 → Markdown 테이블 변환

첨부 이미지 경로 → ![[파일명.확장자]] 형식으로 변환

Frontmatter 자동 생성: title, date, type, status, tags, source, origin

## 4.2  PDF 변환 파이프라인

## 4.3  PDF 노이즈 제거 기준

# 5.  대용량 문서 분할 — 허브-스포크 구조

단일 대형 문서를 그대로 투입하면 BFS 탐색 시 한 노드에 토큰이 집중되어 비효율적이다. 허브 문서 + 스포크 문서로 분할한다.

## 5.1  분할 기준

## 5.2  허브 문서 패턴

허브 문서는 목차 역할만 하며, 실제 내용은 스포크 문서에 위임한다.

---

tags: [주제명, 허브]

date: YYYY-MM-DD

---

# 주제명

> 한줄 요약

## 목차

- [[주제명 - 섹션A|1. 섹션A]]

- [[주제명 - 섹션B|2. 섹션B]]

# 6.  프론트매터 통일

## 6.1  필드 정의

---

date: YYYY-MM-DD        # 필수 — 최신도 판단 기준

type: spec              # spec / decision / meeting / guide / reference

status: active          # active / outdated / deprecated

tags: [도메인, 세부주제] # 핵심 도메인 1 + 세부 주제 1~2

source: "https://..."   # 원본 URL (외부 문서)

origin: confluence      # 출처 플랫폼 식별자

---

## 6.2  type 분류 기준

## 6.3  태그 지정 절차

팀 공용 태그 목록(태그_정의서.md) 먼저 확인

없으면 자유 입력 후 태그_정의서.md에 추가

핵심 도메인 1개 + 세부 주제 1~2개 조합이 기본

특수 역할 태그(예: chief)는 Graph RAG 쿼리 필터 기준이 된다. 해당 인물·주제 관련 모든 문서에 일관되게 태그를 달아야 피드백 아카이브 탐색이 정상 동작한다.

# 7.  Wiki 링크 1차 강화

링크가 없는 고립 노드를 해소하여 BFS 탐색이 시작될 수 있도록 최소한의 연결을 확보한다.

→ 스크립트: .manual/scripts/enhance_wikilinks.py

## 7.1  클러스터 링크 주입

같은 tag를 가진 파일들 사이에 상호 링크를 자동 추가

각 파일 하단에 ## 관련 문서 섹션 생성 후 동일 태그 파일들을 [[wikilink]] 형식으로 나열

## 7.2  제목 매칭 링크 (Placeholder 방식)

본문 내에 다른 파일의 제목이 텍스트로 등장하면 자동으로 [[wikilink]] 변환

기존 [[...]] 구간은 반드시 보호해야 함 — placeholder 방식 필수

기존 [[...]] 블록 → \x00WLINK{n}\x00 placeholder로 치환

→ 정규식으로 키워드 교체 → \x00WLINK{n}\x00 원복

Python re 모듈은 가변 길이 lookbehind를 지원하지 않는다. 반드시 placeholder 방식을 사용할 것. 미적용 시 기존 링크 stem이 오염된다 (inject_keywords v1 버그 참조).

# 8.  Wiki 링크 2차 강화

→ 스크립트: .manual/scripts/strengthen_links.py

## 8.1  깨진 브래킷 수정

re.sub(r'\[{3,}([^\[\]]+?)\]{2}', r'[[\1]]', text)

## 8.2  도메인 허브 링크 주입

특정 엔티티명이 본문에 등장하면 해당 허브 문서 링크 자동 추가

ENTITY_HUB = {

'엔티티명A': '허브_파일_stem_A',

}

## 8.3  Ghost → Real 허브 교체

## 8.4  태그 기반 Fallback 링크

위 모든 방법 적용 후에도 링크가 없는 파일 → 같은 태그의 대표 허브 문서 링크 강제 주입

TAG_HUB = {

'art':  '아트_허브_stem',

'tech': '기술_허브_stem',

}

# 9.  키워드 링크 주입

핵심 키워드(캐릭터명, 시스템명 등)가 본문 텍스트로 등장하는 첫 번째 위치를 [[허브_stem|키워드]] 형식으로 자동 교체한다.

→ 스크립트: .manual/scripts/inject_keywords.py

## 9.1  KEYWORD_MAP 설정

KEYWORD_MAP: dict[str, tuple[str, str]] = {

# '키워드': ('허브_파일_stem', '표시_텍스트'),

'다이잔': ('06. 캐릭터 _ 다이잔_416014685', '다이잔'),

'이사장': ('chief persona(0.1.0)',          '이사장'),

}

## 9.2  Placeholder 방식 (필수)

기존 [[...]] 링크 안의 stem이나 display 텍스트에 키워드가 포함되면 오염된다. v2에서 placeholder 방식으로 수정하였다.

v1 버그: [[07. 캐릭터 _ 스칼렛_432514018|스칼렛]] 에서 '스칼렛' 키워드를 교체하면 → [[07. 캐릭터 _ [[07. 캐릭터 _ 스칼렛_432514018|스칼렛]]_432514018|스칼렛]] 처럼 중첩 링크가 생성되어 파일이 손상된다.

v2 수정 내용:

기존 [[...]] 블록 전체를 \x00WLINK{n}\x00 placeholder로 치환

placeholder가 적용된 텍스트에만 키워드 정규식 적용

교체 완료 후 placeholder를 원래 링크로 복원

## 9.3  주의사항

파일 1개당 키워드 1회만 교체 (최초 등장 위치)

코드 블록(```) 내 키워드는 건너뜀

Frontmatter 영역은 교체 대상에서 제외

# 10.  섹션 헤딩 및 BFS 최적화

## 10.1  섹션 헤딩(##) 추가

Passage-level retrieval: 각 ## 섹션이 독립 검색 단위가 됨

헤딩 보유 비율 80% 이상 권장

헤딩 없는 문서: 첫 문단을 ## 개요로 감싸는 것만으로도 효과적

## 10.2  BFS Hop 최적화 — 문서 앞부분 배치

Graph RAG는 BFS로 Hop-1 → Hop-4를 탐색한다. 토큰 한계로 인해 앞 내용일수록 더 많이 읽힌다.

# 11.  PageRank 최적화 — 연도별 허브 구조

Graph RAG는 높은 PageRank(인바운드 링크 수)를 가진 노드를 우선 탐색한다. Ghost 노드(파일 없는 링크)가 상위 PageRank를 점유하면 탐색이 의미 없는 노드에서 종료된다.

## 11.1  연도별 허브 구조 구축

대량의 회의록·피드백 문서가 있는 경우 연도별 허브 파일을 생성하여 모든 하위 문서를 연결한다.

chief persona (최상위 허브)

└── 회의록_2025 (연도 허브)

├── [2025.03.01] 이사장님 피드백_XXXXXX

├── [2025.05.12] 이사장님 피드백_XXXXXX

└── ... (전체 목록)

## 11.2  BackLink 확인 방법

Obsidian Graph View에서 노드 크기로 인바운드 링크 수를 확인한다. 크기가 작은 중요 문서가 있다면 상위 허브에 링크를 추가한다.

## 11.3  이사장 피드백 아카이브 패턴

특정 인물의 피드백 문서가 다수인 경우 아래 패턴으로 계층화한다.

개별 피드백 문서에 chief 태그가 누락되면 Graph RAG가 해당 문서를 피드백 클러스터에서 찾지 못한다. 파일명에 '이사장' '피드백' '정례보고'가 포함된 모든 파일에 chief 태그를 반드시 지정한다.

# 12.  이미지 링크 관리

Obsidian의 ![[이미지.png]] 형식은 attachmentFolderPath 설정에 따라 실제 파일 경로를 결정한다. 이 경로가 맞지 않으면 이미지가 표시되지 않고 Graph RAG에서 깨진 링크(Broken Node)가 생성된다.

## 12.1  .obsidian/app.json 설정

{

"attachmentFolderPath": "attachments",

"newFileLocation": "folder",

"newFileFolderPath": "active",

"alwaysUpdateLinks": true

}

## 12.2  깨진 이미지 링크 처리

다음 두 가지 방법 중 택일한다.

attachments/ 폴더에 실제 이미지 파일이 없으면서 ![[]] 링크가 있으면 Graph RAG에서 Phantom Node를 생성하여 PageRank를 왜곡한다. audit_and_fix.py --fix 로 일괄 제거 가능.

# 13.  품질 감사 및 자동 수정

check_quality.py로 현황 파악 후, audit_and_fix.py로 자동 수정한다.

## 13.1  check_quality.py — 품질 보고서

→ 스크립트: .manual/scripts/check_quality.py

python check_quality.py <vault_active_dir> [--vault <vault_root>]

## 13.2  audit_and_fix.py — 자동 수정

→ 스크립트: .manual/scripts/audit_and_fix.py

# 감사만 (수정 없음)

python audit_and_fix.py <active_dir> --vault <vault_root>

# 감사 + 자동 수정

python audit_and_fix.py <active_dir> --vault <vault_root> --fix

# 상세 출력

python audit_and_fix.py <active_dir> --vault <vault_root> --fix --verbose

## 13.3  MANUAL_MAP 활용

자동 해결 불가한 broken link (예: 다른 폴더의 문서, 외부 시스템 링크)는 MANUAL_MAP에 수동 등록한다.

MANUAL_MAP: dict[str, str] = {

# 'broken_stem': 'real_stem',

'TLS': 'TLS(TimeLineSkill)시스템_588781620',

}

## 13.4  3중 대괄호 false positive 패턴

Obsidian 파일명에 [범주] 접두사 패턴(예: [기획] 파일명, [2025.01.01] 날짜)이 사용되면 wikilink가 [[[범주] stem]] 형태로 나타난다. 이는 유효한 Obsidian 링크이므로 수정 대상이 아니다.

# 14.  보조 문서 생성

## 14.1  currentSituation.md

Graph RAG 쿼리 시 항상 포함되는 최상위 컨텍스트 문서. AI가 프로젝트의 현재 상태를 파악하는 출발점이다.

## 14.2  index_YYYYMMDD.md (active_YYYYMMDD/ 루트)

Confluence 가져오기 1회분에 해당하는 인덱스 문서. 파일명은 실행 날짜를 포함한다 (예: `index_20260304.md`).

전체 active 파일을 날짜 역순으로 정렬한 인덱스 내용

월별 그룹핑으로 시간 흐름 파악 용이

문서 추가/삭제 시 gen_index.py로 자동 갱신 (출력 파일명도 날짜 스탬프 형식 유지)

# 15.  Obsidian 설정

.obsidian/app.json이 없으면 Obsidian이 attachments/ 경로를 인식하지 못해 이미지가 표시되지 않는다.

# 16.  품질 체크리스트

전체 정제 작업 완료 후 아래 항목을 check_quality.py 실행 및 수동 확인으로 점검한다.

# 17.  운영 가이드

## 17.1  신규 문서 추가 시

Frontmatter 필수 필드 작성: date, type, status, tags

## 개요 섹션에 핵심 내용 요약 (BFS Hop-1 최적화)

관련 문서에 [[wikilink]] 삽입 + 상위 허브에도 역방향 링크 추가

특수 태그(chief 등) 해당 여부 확인

gen_index.py 실행 → index_YYYYMMDD.md 갱신 (날짜 스탬프 파일명)

## 17.2  정기 정제 주기

## 17.3  스크립트 목록 (.manual/scripts/)

## 17.4  권장 폴더 구조

vault/

├── active/           # 현재 문서

│   ├── meeting/      # 회의록

│   ├── spec/         # 스펙·설계

│   ├── decision/     # 의사결정

│   ├── guide/        # 가이드·매뉴얼

│   └── reference/    # 참고 자료

├── .archive/         # 폐기·구버전 (AI 탐색 제외)

├── attachments/      # 이미지·파일 첨부

├── .manual/          # 정제 스크립트·매뉴얼

│   └── scripts/

├── currentSituation.md   # vault 루트

└── .obsidian/app.json    # Obsidian 설정

# 변경 이력