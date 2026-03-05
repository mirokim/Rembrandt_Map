"""
slack_bot.py — Rembrandt Map Slack 봇
────────────────────────────────────
사용법:
    python slack_bot.py

Slack 멘션 문법:
    @rembrandt 질문                       → 기본 페르소나(chief)로 답변
    @rembrandt [chief] 질문               → 수석 디렉터
    @rembrandt [art] 아트 파이프라인은?   → 아트 디렉터
    @rembrandt [spec] 밸런스 기준 알려줘  → 기획자
    @rembrandt [tech] 빌드 시스템 구조는? → 테크 리드

설정:
    vault_bot/config.json 에 slack_bot_token, slack_app_token 추가
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from modules.persona_config import resolve_persona
from modules.rag_simple import search_vault, build_rag_context
from modules.claude_client import ClaudeClient

CONFIG_PATH = Path(__file__).parent / "config.json"

# ── 설정 로드 ──────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


# ── 메시지 파싱 ───────────────────────────────────────────────────────────────

PERSONA_TAG_RE = re.compile(r"\[([^\]]+)\]")
BOT_MENTION_RE = re.compile(r"<@[A-Z0-9]+>")


def parse_message(text: str) -> tuple[str, str]:
    """
    멘션 텍스트에서 (persona_tag, clean_query) 추출.
    예) "<@U123> [chief] 피드백 요약해줘" → ("chief", "피드백 요약해줘")
    """
    # 봇 멘션 제거
    text = BOT_MENTION_RE.sub("", text).strip()

    # [persona] 태그 추출
    persona_tag = "chief"
    m = PERSONA_TAG_RE.search(text)
    if m:
        persona_tag = m.group(1).strip()
        text = text[:m.start()] + text[m.end():]

    query = text.strip()
    return persona_tag, query


# ── Claude 호출 ───────────────────────────────────────────────────────────────

def ask_claude(
    query: str,
    rag_context: str,
    persona: dict,
    client: ClaudeClient,
    model: str,
) -> str:
    system = persona["system"]
    if rag_context:
        system += f"\n\n{rag_context}"

    user_msg = query
    try:
        return client.complete(system, user_msg, max_tokens=1500)
    except Exception as e:
        return f"❌ Claude API 오류: {e}"


# ── 메인 봇 ──────────────────────────────────────────────────────────────────

def run_slack_bot():
    try:
        from slack_bolt import App
        from slack_bolt.adapter.socket_mode import SocketModeHandler
    except ImportError:
        print("❌ slack-bolt 패키지가 필요합니다: pip install slack-bolt")
        sys.exit(1)

    cfg = load_config()

    bot_token = cfg.get("slack_bot_token", "").strip()
    app_token = cfg.get("slack_app_token", "").strip()
    vault_path = cfg.get("vault_path", "").strip()
    api_key = cfg.get("claude_api_key", "").strip()
    model = cfg.get("slack_model", cfg.get("worker_model", "claude-haiku-4-5-20251001"))
    top_n = cfg.get("slack_rag_top_n", 5)

    if not bot_token or not app_token:
        print("❌ config.json에 slack_bot_token / slack_app_token 이 없습니다.")
        print("   api.slack.com 에서 앱을 생성하고 토큰을 발급받으세요.")
        sys.exit(1)

    if not vault_path or not Path(vault_path).exists():
        print(f"❌ 볼트 경로가 없거나 존재하지 않습니다: {vault_path!r}")
        sys.exit(1)

    if not api_key:
        print("⚠️  claude_api_key 없음 — RAG 컨텍스트만 사용 (Claude 미호출)")

    client = ClaudeClient(api_key, model) if api_key else None
    custom_personas = cfg.get("personas", {})

    app = App(token=bot_token)

    @app.event("app_mention")
    def handle_mention(event, say, logger):
        text = event.get("text", "")
        thread_ts = event.get("thread_ts") or event.get("ts")
        channel = event["channel"]

        persona_tag, query = parse_message(text)
        if not query:
            say(text="무엇을 도와드릴까요? 질문을 입력해주세요.", thread_ts=thread_ts)
            return

        persona = resolve_persona(persona_tag, custom_personas)
        emoji = persona.get("emoji", "🤖")
        name = persona.get("name", persona_tag)

        logger.info(f"[Slack] 페르소나={name}, 질문={query[:80]}")

        # 1. RAG 검색
        results = search_vault(query, vault_path, top_n=top_n)
        rag_context = build_rag_context(results, max_chars=6000)

        # 2. 처리 중 표시 (즉시 반응)
        thinking_resp = say(
            text=f"{emoji} *{name}* 이 답변을 준비 중입니다...",
            thread_ts=thread_ts,
        )

        # 3. Claude 호출
        if client:
            answer = ask_claude(query, rag_context, persona, client, model)
        elif rag_context:
            answer = f"(API 키 없음 — 관련 문서만 표시)\n\n{rag_context}"
        else:
            answer = "관련 문서를 찾지 못했습니다."

        # 4. 참고 문서 목록 (최대 3개)
        sources = ""
        if results:
            src_lines = [f"• `{r['stem']}` ({r['date']})" for r in results[:3]]
            sources = "\n\n📂 *참고 문서*\n" + "\n".join(src_lines)

        # 5. 처리 중 메시지를 최종 답변으로 업데이트
        try:
            from slack_sdk import WebClient
            web = WebClient(token=bot_token)
            web.chat_update(
                channel=channel,
                ts=thinking_resp["ts"],
                text=f"{emoji} *{name}*\n\n{answer}{sources}",
            )
        except Exception:
            # update 실패 시 새 메시지로 전송
            say(
                text=f"{emoji} *{name}*\n\n{answer}{sources}",
                thread_ts=thread_ts,
            )

    print("🚀 Vault Bot Slack 연결 중...")
    print(f"   볼트: {vault_path}")
    print(f"   모델: {model}")
    print(f"   RAG top-N: {top_n}")
    print("   Ctrl+C 로 종료\n")

    handler = SocketModeHandler(app, app_token)
    handler.start()


if __name__ == "__main__":
    run_slack_bot()
