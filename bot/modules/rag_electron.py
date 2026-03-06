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
RAG_ASK_URL     = RAG_API_BASE + "/ask"
RAG_SETTINGS_URL = RAG_API_BASE + "/settings"
_CONNECT_TIMEOUT = 1.5   # 연결 확인용 (빠른 폴백)
_SEARCH_TIMEOUT  = 12.0  # 실제 검색 (TF-IDF + BFS)
_ASK_TIMEOUT     = 65.0  # 전체 RAG + LLM 생성 대기
_ASK_VISION_TIMEOUT = 95.0  # Vision + RAG + LLM 생성 대기 (이미지 포함 시)

# Slack 태그 → settingsStore DirectorId 매핑
TAG_TO_DIRECTOR: dict[str, str] = {
    "chief": "chief_director",
    "art":   "art_director",
    "spec":  "plan_director",
    "tech":  "prog_director",
}

import time as _time

_cached_settings: dict | None = None
_settings_fetched_at: float = 0.0
_SETTINGS_TTL = 300.0  # 5분 TTL — Electron에서 설정 변경 시 자동 반영


def get_electron_settings(timeout: float = 3.0) -> dict | None:
    """
    Electron 앱의 현재 설정 반환.
    {personaModels: {chief_director: 'model-id', ...}}
    5분 TTL 캐시 적용. 실패 시 None 반환.
    """
    global _cached_settings, _settings_fetched_at
    now = _time.monotonic()
    if _cached_settings is not None and (now - _settings_fetched_at) < _SETTINGS_TTL:
        return _cached_settings
    try:
        with urllib.request.urlopen(RAG_SETTINGS_URL, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _cached_settings = data
            _settings_fetched_at = now
            return data
    except Exception:
        return _cached_settings  # 실패 시 만료된 캐시라도 반환


def get_model_for_tag(tag: str, fallback: str = "claude-sonnet-4-6") -> str:
    """태그(chief/art/spec/tech)에 해당하는 Electron 설정 모델 반환."""
    settings = get_electron_settings()
    if settings:
        director_id = TAG_TO_DIRECTOR.get(tag, "chief_director")
        model = settings.get("personaModels", {}).get(director_id)
        if model:
            return model
    return fallback


def ask_via_electron(
    query: str,
    tag: str = "chief",
    history: list[dict] | None = None,
    images: list[dict] | None = None,
) -> str | None:
    """
    Electron 앱에 질문을 보내고 완성된 AI 답변을 받아옴.
    렘브란트 맵의 BFS RAG + 페르소나 LLM 파이프라인을 그대로 사용.
    history: [{"role": "user"|"assistant", "content": "..."}] 이전 대화 히스토리.
    images: [{"data": "<base64>", "mediaType": "image/png"}] 첨부 이미지.
    실패/미실행 시 None 반환 → 호출 측에서 폴백.
    """
    director_id = TAG_TO_DIRECTOR.get(tag, "chief_director")
    payload: dict = {"q": query, "director": director_id}
    if history:
        payload["history"] = history
    if images:
        payload["images"] = images
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        req = urllib.request.Request(
            RAG_ASK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        timeout = _ASK_VISION_TIMEOUT if images else _ASK_TIMEOUT
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("answer") if isinstance(result, dict) else None
    except Exception:
        return None


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
