# Vault Bot

Rembrandt Map 볼트를 타이머 기반으로 관리하는 독립 프로그램.

## 기능
- 볼트 MD 파일 스캔
- **Claude Haiku** 기반 핵심 키워드 + 허브 문서 자동 발견
- `keyword_index.json` 유지관리 (`.rembrandt/keyword_index.json`)
- `wikilink` 자동 주입 (첫 등장 키워드 → `[[hub_stem|display]]`)
- 태그 기반 클러스터 링크 (`## 관련 문서` 섹션)
- `index_YYYYMMDD.md` 자동 갱신
- 타이머 자동 실행 (1시간 / 5시간)

## 설치 및 실행

```bash
cd vault_bot
pip install -r requirements.txt
python bot.py
```

Python 3.11+ 필요. Tkinter는 표준 라이브러리 포함.

## 설정

| 항목 | 설명 |
|------|------|
| 볼트 경로 | Obsidian 볼트 루트 폴더 |
| Claude API Key | Anthropic API 키 (키워드 발견용, 선택사항) |
| 실행 주기 | 1시간 / 5시간 / 수동 |

API 키 없이도 기존 `keyword_index.json`을 이용한 wikilink 주입은 작동함.

## 파일 구조

```
vault/
├── active_20260305/       ← Confluence 가져온 파일
│   ├── 문서1.md
│   ├── index_20260305.md  ← 자동 생성
│   └── ...
├── archive_20260305/      ← 아카이브
└── .rembrandt/
    └── keyword_index.json ← 키워드 인덱스 (봇이 관리)
```

## keyword_index.json 구조

```json
{
  "version": 1,
  "updated": "2026-03-05T12:00:00",
  "keywords": {
    "스칼렛": {
      "hub_stem": "07. 캐릭터 _ 스칼렛_432514018",
      "display": "스칼렛",
      "added": "2026-03-05",
      "hit_count": 12
    }
  }
}
```
