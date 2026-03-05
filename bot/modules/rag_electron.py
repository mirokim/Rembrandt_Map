"""
rag_electron.py — Rembrandt Map Electron RAG API 클라이언트

Electron 앱이 실행 중일 때 localhost:7331에서
TF-IDF + wiki-link 그래프 BFS 검색을 사용합니다.
실행 중이 아니면 None을 반환 → 호출 측에서 rag_simple로 폴백.
"""
import json
import urllib.request
import urllib.parse

RAG_API_BASE    = "http://127.0.0.1:7331"
RAG_API_URL     = RAG_API_BASE + "/search"
RAG_SETTINGS_URL = RAG_API_BASE + "/settings"
_CONNECT_TIMEOUT = 1.5   # 연결 확인용 (빠른 폴백)
_SEARCH_TIMEOUT  = 12.0  # 실제 검색 (TF-IDF + BFS)

# Slack 태그 → settingsStore DirectorId 매핑
TAG_TO_DIRECTOR: dict[str, str] = {
    "chief": "chief_director",
    "art":   "art_director",
    "spec":  "plan_director",
    "tech":  "prog_director",
}

_cached_settings: dict | None = None


def get_electron_settings(timeout: float = 3.0) -> dict | None:
    """
    Electron 앱의 현재 설정 반환.
    {personaModels: {chief_director: 'model-id', ...}}
    실패 시 None 반환.
    """
    global _cached_settings
    if _cached_settings is not None:
        return _cached_settings
    try:
        with urllib.request.urlopen(RAG_SETTINGS_URL, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _cached_settings = data
            return data
    except Exception:
        return None


def get_model_for_tag(tag: str, fallback: str = "claude-sonnet-4-6") -> str:
    """태그(chief/art/spec/tech)에 해당하는 Electron 설정 모델 반환."""
    settings = get_electron_settings()
    if settings:
        director_id = TAG_TO_DIRECTOR.get(tag, "chief_director")
        model = settings.get("personaModels", {}).get(director_id)
        if model:
            return model
    return fallback


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
