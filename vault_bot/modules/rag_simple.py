"""
rag_simple.py — Slack 봇용 간단 키워드 RAG
TF-IDF 없이 키워드 substring 매칭으로 상위 문서 추출
"""
import re
from pathlib import Path
from .vault_scanner import scan_vault, find_active_folders, VaultDoc


def _tokenize(text: str) -> list[str]:
    """공백/특수문자로 분리, 2자 이상 토큰만"""
    tokens = re.split(r"[\s\[\](),./|_\-]+", text.lower())
    return [t for t in tokens if len(t) >= 2]


def _score_doc(doc: VaultDoc, query_tokens: list[str]) -> float:
    title_lower = doc.title.lower()
    stem_lower = doc.stem.lower()
    body_lower = doc.body.lower()
    score = 0.0
    for token in query_tokens:
        if token in title_lower:
            score += 3.0
        if token in stem_lower:
            score += 2.0
        count = body_lower.count(token)
        if count > 0:
            score += min(count * 0.5, 3.0)  # body 히트는 최대 3점
    return score


def search_vault(
    query: str,
    vault_path: str,
    top_n: int = 5,
    active_only: bool = True,
) -> list[dict]:
    """
    볼트에서 query와 관련된 상위 top_n 문서 반환.
    returns: [{"title": ..., "stem": ..., "body": ..., "score": ...}]
    """
    query_tokens = _tokenize(query)
    if not query_tokens:
        return []

    docs = scan_vault(vault_path)

    if active_only:
        active_folders = find_active_folders(vault_path)
        active_set = {str(Path(f).resolve()) for f in active_folders}
        docs = [
            d for d in docs
            if str(Path(d.path).parent.resolve()) in active_set
        ]

    # 스코어링
    scored = []
    for doc in docs:
        if doc.stem.startswith("index_"):
            continue
        s = _score_doc(doc, query_tokens)
        if s > 0:
            scored.append((s, doc))

    scored.sort(key=lambda x: -x[0])

    results = []
    for score, doc in scored[:top_n]:
        # 본문은 최대 2000자로 자름
        body_snippet = doc.body.strip()[:2000]
        results.append({
            "title": doc.title,
            "stem": doc.stem,
            "body": body_snippet,
            "score": score,
            "date": doc.date_str,
            "tags": doc.tags,
        })
    return results


def build_rag_context(results: list[dict], max_chars: int = 8000) -> str:
    """검색 결과를 LLM context 문자열로 변환"""
    if not results:
        return ""

    parts = ["## 참고 문서\n"]
    total = 0
    for r in results:
        tag_str = " ".join(f"`{t}`" for t in (r["tags"] or []))
        header = f"### {r['title']} ({r['date']}) {tag_str}\n"
        body = r["body"]

        # 남은 예산에 맞춰 잘라냄
        available = max_chars - total - len(header) - 10
        if available <= 100:
            break
        if len(body) > available:
            body = body[:available] + "…"

        chunk = header + body + "\n\n"
        parts.append(chunk)
        total += len(chunk)

    return "".join(parts)
