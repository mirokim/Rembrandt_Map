"""
rag_simple.py — Slack 봇용 간단 키워드 RAG
vault_scanner는 vault_bot/modules/ 에서 공유
"""
import re
import sys
from pathlib import Path

# vault_bot/modules/vault_scanner 공유 참조
_VAULT_BOT = Path(__file__).parent.parent.parent / "vault_bot"
if str(_VAULT_BOT) not in sys.path:
    sys.path.insert(0, str(_VAULT_BOT))

from modules.vault_scanner import scan_vault, find_active_folders, VaultDoc


def _tokenize(text: str) -> list[str]:
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
            score += min(count * 0.5, 3.0)
    return score


def search_vault(
    query: str,
    vault_path: str,
    top_n: int = 5,
    active_only: bool = True,
) -> list[dict]:
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
        results.append({
            "title": doc.title,
            "stem": doc.stem,
            "body": doc.body.strip()[:2000],
            "score": score,
            "date": doc.date_str,
            "tags": doc.tags,
        })
    return results


def build_rag_context(results: list[dict], max_chars: int = 8000) -> str:
    if not results:
        return ""

    parts = ["## 참고 문서\n"]
    total = 0
    for r in results:
        tag_str = " ".join(f"`{t}`" for t in (r["tags"] or []))
        header = f"### {r['title']} ({r['date']}) {tag_str}\n"
        body = r["body"]
        available = max_chars - total - len(header) - 10
        if available <= 100:
            break
        if len(body) > available:
            body = body[:available] + "…"
        chunk = header + body + "\n\n"
        parts.append(chunk)
        total += len(chunk)

    return "".join(parts)
