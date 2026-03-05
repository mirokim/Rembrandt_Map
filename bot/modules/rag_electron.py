"""
rag_electron.py — Rembrandt Map Electron RAG API 클라이언트

Electron 앱이 실행 중일 때 localhost:7331에서
TF-IDF + wiki-link 그래프 BFS 검색을 사용합니다.
실행 중이 아니면 None을 반환 → 호출 측에서 rag_simple로 폴백.
"""
import json
import urllib.request
import urllib.parse

RAG_API_URL = "http://127.0.0.1:7331/search"
_CONNECT_TIMEOUT = 1.5   # 연결 확인용 (빠른 폴백)
_SEARCH_TIMEOUT  = 12.0  # 실제 검색 (TF-IDF + BFS)


def search_via_electron(
    query: str,
    top_n: int = 5,
) -> list[dict] | None:
    """
    Electron RAG API에 검색 요청.
    성공 시 결과 list 반환, 실패/미실행 시 None 반환.

    결과 dict 형식:
      {doc_id, filename, stem, title, date, tags, body, score}
    """
    params = urllib.parse.urlencode({"q": query, "n": top_n})
    url = f"{RAG_API_URL}?{params}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=_SEARCH_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data if isinstance(data, list) else None
    except Exception:
        return None
