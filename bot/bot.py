"""
Rembrandt Map Source Management Bot — 볼트 관리 + Slack 봇 통합 GUI
──────────────────────────────────────────────────────────────────
기능:
  - vault MD 파일 스캔 + keyword_index.json 자동 관리
  - wikilink 주입 + 클러스터 링크 강화
  - index_YYYYMMDD.md 자동 갱신 (타이머 1h / 5h)
  - index MD 파일 브라우저 (생성된 인덱스 열람)
  - Slack 봇 (Socket Mode, 페르소나 + RAG)

실행:
    python bot.py
"""

import json
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, scrolledtext, filedialog, messagebox
from datetime import datetime, timedelta
from pathlib import Path

# 모듈 경로 추가
sys.path.insert(0, str(Path(__file__).parent))

from modules.vault_scanner import scan_vault, find_active_folders
from modules.keyword_store import KeywordStore
from modules.claude_client import ClaudeClient
from modules.wikilink_updater import process_folder
from modules.index_generator import generate_index

CONFIG_PATH = Path(__file__).parent / "config.json"


# ─────────────────────────────────────────────────────────────────────────────
# Config helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "vault_path": "",
        "claude_api_key": "",
        "interval_hours": 1,
        "auto_run": False,
        "keyword_index_path": ".rembrandt/keyword_index.json",
        "max_files_per_keyword_scan": 20,
        "worker_model": "claude-haiku-4-5-20251001",
    }


def save_config(cfg: dict):
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# Bot logic (runs in background thread)
# ─────────────────────────────────────────────────────────────────────────────

class VaultBot:
    def __init__(self, cfg: dict, log_fn, on_done_fn):
        self.cfg = cfg
        self._log_fn = log_fn      # must be called via after() — not directly from threads
        self.on_done = on_done_fn
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def log(self, msg: str):
        """Thread-safe log: schedules the call on the Tk main thread."""
        self._log_fn(msg)          # _log_fn is App._log_threadsafe which uses after()

    def _run_cycle(self):
        cfg = self.cfg
        vault_path = cfg.get("vault_path", "").strip()
        api_key = cfg.get("claude_api_key", "").strip()

        if not vault_path or not Path(vault_path).exists():
            self.log("❌ 볼트 경로가 없거나 존재하지 않습니다.")
            return

        self.log(f"\n{'='*50}")
        self.log(f"🚀 실행 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.log(f"볼트: {vault_path}")

        # 1. 볼트 스캔
        self.log("\n📂 볼트 스캔 중...")
        docs = scan_vault(vault_path)
        self.log(f"  총 {len(docs)}개 MD 파일 발견")

        active_folders = find_active_folders(vault_path)
        self.log(f"  active 폴더: {len(active_folders)}개 → {[Path(f).name for f in active_folders]}")

        # 2. Keyword store 로드
        store = KeywordStore(vault_path, cfg.get("keyword_index_path", ".rembrandt/keyword_index.json"))
        loaded = store.load()
        self.log(f"\n🔑 키워드 인덱스: {'로드됨' if loaded else '새로 생성'} ({store.count()}개 키워드)")

        # 3. Claude로 새 키워드 발견 (API key 있을 때만)
        if api_key:
            self.log("\n🤖 Claude Haiku — 키워드 발견 중...")
            try:
                client = ClaudeClient(api_key, cfg.get("worker_model", "claude-haiku-4-5-20251001"))
                # active 폴더의 최신 문서 샘플
                sample_docs = []
                for d in docs:
                    if any(d.path.startswith(f) for f in active_folders[:1]):
                        sample_docs.append({
                            "stem": d.stem,
                            "title": d.title,
                            "body_snippet": d.body[:400],
                        })
                    if len(sample_docs) >= cfg.get("max_files_per_keyword_scan", 20):
                        break

                if sample_docs:
                    new_kws = client.discover_keywords(sample_docs)
                    added = 0
                    for item in new_kws:
                        kw = item.get("keyword", "")
                        hub = item.get("hub_stem", "")
                        display = item.get("display", kw)
                        if kw and hub:
                            store.upsert(kw, hub, display)
                            added += 1
                    self.log(f"  {added}개 키워드 발견/갱신")
                else:
                    self.log("  active 폴더에 문서 없음 — 스킵")
            except Exception as e:
                self.log(f"  ⚠️ Claude API 오류: {e}")
        else:
            self.log("\n⚠️  API 키 없음 — 키워드 발견 스킵 (기존 인덱스 사용)")

        store.save()
        self.log(f"  키워드 인덱스 저장 완료 ({store.count()}개)")

        # 4. active 폴더별 wikilink 처리
        keyword_map = store.to_inject_map()
        total_updated = 0
        total_hits: dict = {}

        for folder in active_folders:
            self.log(f"\n🔗 wikilink 처리: {Path(folder).name}")
            result = process_folder(folder, keyword_map, log_fn=self.log)
            total_updated += result["updated"]
            for kw, cnt in result["keyword_hits"].items():
                total_hits[kw] = total_hits.get(kw, 0) + cnt

        self.log(f"\n  총 {total_updated}개 파일 업데이트")
        if total_hits:
            top = sorted(total_hits.items(), key=lambda x: -x[1])[:5]
            self.log(f"  키워드 히트 TOP5: {', '.join(f'{k}({v})' for k,v in top)}")

        # 5. index 갱신 (최신 active 폴더)
        if active_folders:
            self.log(f"\n📋 인덱스 갱신: {Path(active_folders[0]).name}")
            generate_index(active_folders[0], log_fn=self.log)

        self.log(f"\n✅ 완료: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.on_done()

    def run_once(self):
        def _safe():
            try:
                self._run_cycle()
            except Exception as e:
                self.log(f"❌ 치명적 오류: {e}")
            finally:
                self.on_done()
        t = threading.Thread(target=_safe, daemon=True)
        t.start()

    def start_timer(self, interval_hours: float):
        self._stop.clear()

        def loop():
            while not self._stop.is_set():
                try:
                    self._run_cycle()
                except Exception as e:
                    self.log(f"❌ 치명적 오류: {e}")
                finally:
                    self.on_done()
                # interval 대기 (10초마다 stop 체크)
                end_time = time.time() + interval_hours * 3600
                while time.time() < end_time and not self._stop.is_set():
                    time.sleep(10)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def stop_timer(self):
        self._stop.set()


# ─────────────────────────────────────────────────────────────────────────────
# Slack Bot Runner
# ─────────────────────────────────────────────────────────────────────────────

class SlackBotRunner:
    """Slack SocketModeHandler를 백그라운드 스레드로 관리."""

    def __init__(self, cfg: dict, log_fn, on_status_fn):
        self.cfg = cfg
        self._log = log_fn          # thread-safe (after() 기반)
        self._on_status = on_status_fn
        self._handler = None
        self._thread: threading.Thread | None = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        """슬랙 봇 시작. 성공 시 True."""
        try:
            from slack_bolt import App
            from slack_bolt.adapter.socket_mode import SocketModeHandler
            from slack_sdk import WebClient
        except ImportError:
            self._log("❌ slack-bolt 패키지 필요: pip install slack-bolt")
            return False

        from modules.persona_config import resolve_persona
        from modules.rag_simple import search_vault, build_rag_context
        from modules.rag_electron import search_via_electron, get_model_for_tag

        cfg = self.cfg
        bot_token  = cfg.get("slack_bot_token", "").strip()
        app_token  = cfg.get("slack_app_token", "").strip()
        vault_path = cfg.get("vault_path", "").strip()
        api_key    = cfg.get("claude_api_key", "").strip()
        top_n      = cfg.get("slack_rag_top_n", 5)

        if not bot_token or not app_token:
            self._log("❌ slack_bot_token / slack_app_token 이 설정에 없습니다.")
            return False
        if not vault_path or not Path(vault_path).exists():
            self._log(f"❌ 볼트 경로 없음: {vault_path!r}")
            return False

        import re as _re
        web = WebClient(token=bot_token)
        app    = App(token=bot_token)

        PERSONA_TAG_RE = _re.compile(r"\[([^\]]+)\]")
        BOT_MENTION_RE = _re.compile(r"<@[A-Z0-9]+>")

        def parse_msg(text: str):
            text = BOT_MENTION_RE.sub("", text).strip()
            tag = "chief"
            m = PERSONA_TAG_RE.search(text)
            if m:
                tag = m.group(1).strip()
                text = text[:m.start()] + text[m.end():]
            return tag, text.strip()

        @app.event("app_mention")
        def handle_mention(event, say, logger):
            text      = event.get("text", "")
            thread_ts = event.get("thread_ts") or event.get("ts")
            channel   = event["channel"]

            tag, query = parse_msg(text)
            if not query:
                say(text="무엇을 도와드릴까요?", thread_ts=thread_ts)
                return

            persona = resolve_persona(tag)
            emoji   = persona.get("emoji", "🤖")
            name    = persona.get("name", tag)
            self._log(f"[Slack] {name}: {query[:60]}")

            thinking = say(text=f"{emoji} *{name}* 답변 준비 중...", thread_ts=thread_ts)

            # Electron RAG 우선, 미실행 시 단순 키워드 검색 폴백
            results = search_via_electron(query, top_n=top_n)
            if results is None:
                results = search_vault(query, vault_path, top_n=top_n)
                self._log(f"[RAG] fallback → simple search ({len(results)}건)")
            else:
                self._log(f"[RAG] Electron TF-IDF ({len(results)}건)")
            rag_context = build_rag_context(results, max_chars=6000)

            # 페르소나별 모델을 Electron 설정에서 가져옴
            model  = get_model_for_tag(tag)
            claude = ClaudeClient(api_key, model) if api_key else None
            self._log(f"[모델] {model}")

            if claude:
                system = persona["system"] + (f"\n\n{rag_context}" if rag_context else "")
                try:
                    answer = claude.complete(system, query, max_tokens=1500)
                except Exception as e:
                    answer = f"❌ Claude 오류: {e}"
            elif rag_context:
                answer = f"_(API 키 없음)_\n\n{rag_context}"
            else:
                answer = "관련 문서를 찾지 못했습니다."

            sources = ""
            if results:
                lines = [f"• `{r['stem']}` ({r['date']})" for r in results[:3]]
                sources = "\n\n📂 *참고 문서*\n" + "\n".join(lines)

            final = f"{emoji} *{name}*\n\n{answer}{sources}"
            try:
                web.chat_update(channel=channel, ts=thinking["ts"], text=final)
            except Exception:
                say(text=final, thread_ts=thread_ts)

        self._handler = SocketModeHandler(app, app_token)

        def _run():
            try:
                self._handler.start()
            except Exception as e:
                self._log(f"❌ Slack 봇 종료: {e}")
            finally:
                self._on_status(False)

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        self._log(f"🟢 Slack 봇 시작 — 모델: {model}")
        return True

    def stop(self):
        if self._handler:
            try:
                self._handler.close()
            except Exception:
                pass
        self._handler = None
        self._log("🔴 Slack 봇 중지")


# ─────────────────────────────────────────────────────────────────────────────
# Tkinter GUI
# ─────────────────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Rembrandt Map Source Management Bot")
        self.geometry("720x640")
        self.resizable(True, True)
        self.cfg = load_config()
        self.bot: VaultBot | None = None
        self.timer_running = False
        self._next_run_time: datetime | None = None
        self._slack_runner: SlackBotRunner | None = None
        self._build_ui()
        self._load_cfg_to_ui()
        self._tick()  # 타이머 카운트다운 업데이트

    # ── UI 빌드 ───────────────────────────────────────────────────────────────

    def _build_ui(self):
        pad = {"padx": 8, "pady": 4}

        # ── 상단: 설정 패널 ──────────────────────────────────────────────────
        frame_cfg = ttk.LabelFrame(self, text="설정", padding=8)
        frame_cfg.pack(fill="x", padx=10, pady=(10, 4))

        # 볼트 경로
        ttk.Label(frame_cfg, text="볼트 경로:").grid(row=0, column=0, sticky="w", **pad)
        self.var_vault = tk.StringVar()
        ttk.Entry(frame_cfg, textvariable=self.var_vault, width=52).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(frame_cfg, text="찾기", command=self._browse_vault, width=6).grid(row=0, column=2, padx=4)

        # API Key
        ttk.Label(frame_cfg, text="Claude API Key:").grid(row=1, column=0, sticky="w", **pad)
        self.var_key = tk.StringVar()
        ttk.Entry(frame_cfg, textvariable=self.var_key, show="*", width=52).grid(row=1, column=1, sticky="ew", padx=4)

        # 실행 주기
        ttk.Label(frame_cfg, text="실행 주기:").grid(row=2, column=0, sticky="w", **pad)
        interval_frame = ttk.Frame(frame_cfg)
        interval_frame.grid(row=2, column=1, sticky="w")
        self.var_interval = tk.IntVar(value=1)
        for label, val in [("1시간", 1), ("5시간", 5), ("수동", 0)]:
            ttk.Radiobutton(
                interval_frame, text=label, variable=self.var_interval, value=val
            ).pack(side="left", padx=6)

        ttk.Button(frame_cfg, text="저장", command=self._save_cfg, width=6).grid(row=2, column=2, padx=4)
        frame_cfg.columnconfigure(1, weight=1)

        # ── 중단: 실행 제어 ──────────────────────────────────────────────────
        frame_ctrl = ttk.Frame(self)
        frame_ctrl.pack(fill="x", padx=10, pady=4)

        self.btn_run = ttk.Button(frame_ctrl, text="▶ 지금 실행", command=self._run_now, width=14)
        self.btn_run.pack(side="left", padx=4)

        self.btn_timer = ttk.Button(frame_ctrl, text="⏱ 타이머 시작", command=self._toggle_timer, width=14)
        self.btn_timer.pack(side="left", padx=4)

        self.lbl_status = ttk.Label(frame_ctrl, text="상태: 대기", foreground="gray")
        self.lbl_status.pack(side="left", padx=12)

        self.lbl_next = ttk.Label(frame_ctrl, text="", foreground="steelblue")
        self.lbl_next.pack(side="right", padx=8)

        # ── 탭: 로그 / 키워드 ────────────────────────────────────────────────
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=(4, 10))

        # 로그 탭
        tab_log = ttk.Frame(self.notebook)
        self.notebook.add(tab_log, text="📋 실행 로그")
        self.txt_log = scrolledtext.ScrolledText(tab_log, wrap="word", state="disabled",
                                                  font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4")
        self.txt_log.pack(fill="both", expand=True)
        btn_clear = ttk.Button(tab_log, text="로그 지우기", command=self._clear_log)
        btn_clear.pack(anchor="e", padx=4, pady=2)

        # 키워드 탭
        tab_kw = ttk.Frame(self.notebook)
        self.notebook.add(tab_kw, text="🔑 키워드 인덱스")

        kw_top = ttk.Frame(tab_kw)
        kw_top.pack(fill="x", padx=4, pady=4)
        self.lbl_kw_count = ttk.Label(kw_top, text="키워드: 0개")
        self.lbl_kw_count.pack(side="left")
        ttk.Button(kw_top, text="새로고침", command=self._refresh_keywords).pack(side="left", padx=8)
        ttk.Button(kw_top, text="+ 키워드 추가", command=self._add_keyword_dialog).pack(side="left", padx=4)

        cols = ("keyword", "hub_stem", "display", "added", "hits")
        self.kw_tree = ttk.Treeview(tab_kw, columns=cols, show="headings", height=16)
        for col, label, width in [
            ("keyword", "키워드", 120),
            ("hub_stem", "허브 문서 stem", 280),
            ("display", "표시명", 100),
            ("added", "추가일", 90),
            ("hits", "히트", 50),
        ]:
            self.kw_tree.heading(col, text=label)
            self.kw_tree.column(col, width=width, minwidth=40)
        self.kw_tree.pack(fill="both", expand=True, padx=4, pady=4)

        kw_scroll = ttk.Scrollbar(tab_kw, orient="vertical", command=self.kw_tree.yview)
        self.kw_tree.configure(yscrollcommand=kw_scroll.set)
        kw_scroll.pack(side="right", fill="y")

        # 오른쪽 클릭 메뉴
        self.kw_menu = tk.Menu(self, tearoff=0)
        self.kw_menu.add_command(label="삭제", command=self._delete_keyword)
        self.kw_tree.bind("<Button-3>", self._show_kw_menu)

        # ── 인덱스 파일 탭 ────────────────────────────────────────────────────
        tab_idx = ttk.Frame(self.notebook)
        self.notebook.add(tab_idx, text="📄 인덱스 파일")

        idx_top = ttk.Frame(tab_idx)
        idx_top.pack(fill="x", padx=6, pady=4)
        self.lbl_idx_count = ttk.Label(idx_top, text="인덱스 파일: 0개")
        self.lbl_idx_count.pack(side="left")
        ttk.Button(idx_top, text="새로고침", command=self._refresh_index_list).pack(side="left", padx=8)

        idx_pane = tk.PanedWindow(tab_idx, orient="horizontal", sashwidth=5, relief="flat")
        idx_pane.pack(fill="both", expand=True, padx=6, pady=(0, 6))

        # 왼쪽: 파일 목록
        list_frame = ttk.Frame(idx_pane)
        self.idx_listbox = tk.Listbox(list_frame, width=30, selectmode="single",
                                      font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4",
                                      selectbackground="#264f78", activestyle="none")
        self.idx_listbox.pack(fill="both", expand=True, side="left")
        lbscroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.idx_listbox.yview)
        self.idx_listbox.configure(yscrollcommand=lbscroll.set)
        lbscroll.pack(side="right", fill="y")
        self.idx_listbox.bind("<<ListboxSelect>>", self._on_index_select)
        idx_pane.add(list_frame, minsize=160)

        # 오른쪽: 파일 내용
        content_frame = ttk.Frame(idx_pane)
        self.idx_content = scrolledtext.ScrolledText(
            content_frame, wrap="word", state="disabled",
            font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4")
        self.idx_content.pack(fill="both", expand=True)
        idx_pane.add(content_frame, minsize=300)

        # 파일 경로 저장용
        self._idx_paths: list[str] = []

        # ── Slack 봇 탭 ──────────────────────────────────────────────────────
        tab_slack = ttk.Frame(self.notebook)
        self.notebook.add(tab_slack, text="💬 Slack 봇")

        # 설정 영역
        slack_cfg = ttk.LabelFrame(tab_slack, text="Slack 설정", padding=8)
        slack_cfg.pack(fill="x", padx=8, pady=(8, 4))

        def slack_row(row, label, var, show=""):
            ttk.Label(slack_cfg, text=label).grid(row=row, column=0, sticky="w", padx=6, pady=3)
            e = ttk.Entry(slack_cfg, textvariable=var, show=show, width=50)
            e.grid(row=row, column=1, sticky="ew", padx=4)

        self.var_slack_bot_token = tk.StringVar()
        self.var_slack_app_token = tk.StringVar()
        self.var_slack_top_n     = tk.IntVar(value=5)

        slack_row(0, "Bot Token (xoxb-...):  ", self.var_slack_bot_token, show="*")
        slack_row(1, "App Token (xapp-...):  ", self.var_slack_app_token, show="*")

        ttk.Label(slack_cfg, text="RAG top-N:").grid(row=2, column=0, sticky="w", padx=6, pady=3)
        ttk.Spinbox(slack_cfg, textvariable=self.var_slack_top_n,
                    from_=1, to=20, width=5).grid(row=2, column=1, sticky="w", padx=4)
        ttk.Label(slack_cfg, text="(모델은 렘브란트 맵 설정을 따름)",
                  foreground="gray").grid(row=3, column=0, columnspan=2, sticky="w", padx=6)
        slack_cfg.columnconfigure(1, weight=1)

        # 저장 버튼
        ttk.Button(slack_cfg, text="저장", command=self._save_cfg, width=6).grid(
            row=2, column=1, sticky="e", padx=4)

        # 제어 영역
        slack_ctrl = ttk.Frame(tab_slack)
        slack_ctrl.pack(fill="x", padx=8, pady=4)

        self.btn_slack = ttk.Button(slack_ctrl, text="▶ Slack 봇 시작",
                                     command=self._toggle_slack, width=16)
        self.btn_slack.pack(side="left", padx=4)

        self.lbl_slack_status = ttk.Label(slack_ctrl, text="상태: 중지", foreground="gray")
        self.lbl_slack_status.pack(side="left", padx=10)

        # Slack 전용 로그
        self.txt_slack_log = scrolledtext.ScrolledText(
            tab_slack, wrap="word", state="disabled",
            font=("Consolas", 9), bg="#0d1117", fg="#7ee787", height=16)
        self.txt_slack_log.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        ttk.Button(tab_slack, text="로그 지우기",
                   command=self._clear_slack_log).pack(anchor="e", padx=8, pady=2)

    # ── Config UI 연결 ────────────────────────────────────────────────────────

    def _load_cfg_to_ui(self):
        self.var_vault.set(self.cfg.get("vault_path", ""))
        self.var_key.set(self.cfg.get("claude_api_key", ""))
        self.var_interval.set(self.cfg.get("interval_hours", 1))
        self.var_slack_bot_token.set(self.cfg.get("slack_bot_token", ""))
        self.var_slack_app_token.set(self.cfg.get("slack_app_token", ""))
        self.var_slack_top_n.set(self.cfg.get("slack_rag_top_n", 5))
        self.after(100, self._refresh_index_list)  # UI 초기화 후 인덱스 목록 로드

    def _save_cfg(self):
        self.cfg["vault_path"]       = self.var_vault.get().strip()
        self.cfg["claude_api_key"]   = self.var_key.get().strip()
        self.cfg["interval_hours"]   = self.var_interval.get()
        self.cfg["slack_bot_token"]  = self.var_slack_bot_token.get().strip()
        self.cfg["slack_app_token"]  = self.var_slack_app_token.get().strip()
        self.cfg["slack_rag_top_n"]  = self.var_slack_top_n.get()
        save_config(self.cfg)
        self._log("💾 설정 저장됨")

    def _browse_vault(self):
        folder = filedialog.askdirectory(title="볼트 폴더 선택")
        if folder:
            self.var_vault.set(folder)

    # ── 로그 ─────────────────────────────────────────────────────────────────

    def _log_threadsafe(self, msg: str):
        """백그라운드 스레드에서 안전하게 호출 가능 — after()로 메인 스레드에 위임."""
        self.after(0, lambda m=msg: self._log_direct(m))

    def _log_direct(self, msg: str):
        """메인 스레드 전용. Tkinter 위젯 직접 수정."""
        self.txt_log.configure(state="normal")
        ts = datetime.now().strftime("%H:%M:%S")
        self.txt_log.insert("end", f"[{ts}] {msg}\n")
        self.txt_log.see("end")
        self.txt_log.configure(state="disabled")

    def _log(self, msg: str):
        """메인 스레드에서 호출 (버튼 클릭, 설정 저장 등)."""
        self._log_direct(msg)

    def _clear_log(self):
        self.txt_log.configure(state="normal")
        self.txt_log.delete("1.0", "end")
        self.txt_log.configure(state="disabled")

    # ── 실행 제어 ─────────────────────────────────────────────────────────────

    def _make_bot(self) -> VaultBot:
        self._save_cfg()
        return VaultBot(self.cfg, log_fn=self._log_threadsafe, on_done_fn=self._on_cycle_done)

    def _set_running(self, running: bool):
        self.lbl_status.config(
            text="상태: 실행 중..." if running else "상태: 대기",
            foreground="orange" if running else "gray",
        )
        self.btn_run.config(state="disabled" if running else "normal")

    def _run_now(self):
        self._set_running(True)
        bot = self._make_bot()
        bot.run_once()

    def _on_cycle_done(self):
        """백그라운드 스레드에서 호출됨 — 모든 UI 조작을 after()로 위임."""
        def _main():
            self._set_running(False)
            self._refresh_keywords()
            self._refresh_index_list()
            if self.timer_running and self.cfg["interval_hours"] > 0:
                h = self.cfg["interval_hours"]
                self._next_run_time = datetime.now() + timedelta(hours=h)
        self.after(0, _main)

    def _toggle_timer(self):
        if self.timer_running:
            # 타이머 중지
            if self.bot:
                self.bot.stop_timer()
            self.timer_running = False
            self._next_run_time = None
            self.btn_timer.config(text="⏱ 타이머 시작")
            self.lbl_status.config(text="상태: 대기", foreground="gray")
            self._log("⏹ 타이머 중지")
        else:
            h = self.var_interval.get()
            if h == 0:
                messagebox.showinfo("알림", "수동 모드에서는 타이머를 사용할 수 없습니다.")
                return
            self.bot = self._make_bot()
            self.bot.start_timer(h)
            self.timer_running = True
            self._next_run_time = datetime.now() + timedelta(hours=h)
            self.btn_timer.config(text="⏹ 타이머 중지")
            self.lbl_status.config(text=f"상태: 타이머 실행 ({h}h)", foreground="green")
            self._log(f"⏱ 타이머 시작 — {h}시간 주기")

    def _tick(self):
        """매 초 카운트다운 업데이트"""
        if self._next_run_time:
            remaining = self._next_run_time - datetime.now()
            if remaining.total_seconds() > 0:
                h, rem = divmod(int(remaining.total_seconds()), 3600)
                m, s = divmod(rem, 60)
                self.lbl_next.config(text=f"다음 실행까지 {h:02d}:{m:02d}:{s:02d}")
            else:
                self.lbl_next.config(text="")
        else:
            self.lbl_next.config(text="")
        self.after(1000, self._tick)

    # ── 키워드 탭 ─────────────────────────────────────────────────────────────

    def _refresh_keywords(self):
        vault = self.var_vault.get().strip()
        if not vault:
            return
        store = KeywordStore(vault, self.cfg.get("keyword_index_path", ".rembrandt/keyword_index.json"))
        store.load()
        kws = store.get_keywords()
        self.lbl_kw_count.config(text=f"키워드: {len(kws)}개")

        # 트리뷰 갱신
        for row in self.kw_tree.get_children():
            self.kw_tree.delete(row)
        for kw, info in sorted(kws.items()):
            self.kw_tree.insert("", "end", values=(
                kw,
                info.get("hub_stem", ""),
                info.get("display", kw),
                info.get("added", ""),
                info.get("hit_count", 0),
            ))

    def _show_kw_menu(self, event):
        item = self.kw_tree.identify_row(event.y)
        if item:
            self.kw_tree.selection_set(item)
            self.kw_menu.post(event.x_root, event.y_root)

    def _delete_keyword(self):
        selected = self.kw_tree.selection()
        if not selected:
            return
        kw = self.kw_tree.item(selected[0])["values"][0]
        if not messagebox.askyesno("확인", f"'{kw}' 키워드를 삭제하시겠습니까?"):
            return
        vault = self.var_vault.get().strip()
        store = KeywordStore(vault, self.cfg.get("keyword_index_path", ".rembrandt/keyword_index.json"))
        store.load()
        store.remove(kw)
        store.save()
        self._refresh_keywords()
        self._log(f"🗑 키워드 삭제: {kw}")

    def _add_keyword_dialog(self):
        dialog = tk.Toplevel(self)
        dialog.title("키워드 추가")
        dialog.geometry("440x160")
        dialog.resizable(False, False)
        dialog.grab_set()

        frm = ttk.Frame(dialog, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="키워드:").grid(row=0, column=0, sticky="w", pady=4)
        var_kw = tk.StringVar()
        ttk.Entry(frm, textvariable=var_kw, width=35).grid(row=0, column=1, sticky="ew", padx=4)

        ttk.Label(frm, text="허브 문서 stem:").grid(row=1, column=0, sticky="w", pady=4)
        var_hub = tk.StringVar()
        ttk.Entry(frm, textvariable=var_hub, width=35).grid(row=1, column=1, sticky="ew", padx=4)

        ttk.Label(frm, text="표시명 (선택):").grid(row=2, column=0, sticky="w", pady=4)
        var_disp = tk.StringVar()
        ttk.Entry(frm, textvariable=var_disp, width=35).grid(row=2, column=1, sticky="ew", padx=4)

        def on_ok():
            kw = var_kw.get().strip()
            hub = var_hub.get().strip()
            if not kw or not hub:
                messagebox.showwarning("입력 오류", "키워드와 허브 stem을 입력하세요.", parent=dialog)
                return
            vault = self.var_vault.get().strip()
            store = KeywordStore(vault, self.cfg.get("keyword_index_path", ".rembrandt/keyword_index.json"))
            store.load()
            store.upsert(kw, hub, var_disp.get().strip() or kw)
            store.save()
            dialog.destroy()
            self._refresh_keywords()
            self._log(f"➕ 키워드 추가: {kw} → {hub}")

        btn_frm = ttk.Frame(frm)
        btn_frm.grid(row=3, column=0, columnspan=2, pady=8)
        ttk.Button(btn_frm, text="추가", command=on_ok, width=10).pack(side="left", padx=4)
        ttk.Button(btn_frm, text="취소", command=dialog.destroy, width=10).pack(side="left", padx=4)
        frm.columnconfigure(1, weight=1)

    # ── 인덱스 파일 탭 ────────────────────────────────────────────────────────

    def _refresh_index_list(self):
        vault = self.var_vault.get().strip()
        if not vault or not Path(vault).exists():
            return
        # vault 전체에서 index_*.md 파일 수집
        paths = sorted(
            Path(vault).rglob("index_*.md"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        self._idx_paths = [str(p) for p in paths]
        self.lbl_idx_count.config(text=f"인덱스 파일: {len(paths)}개")
        self.idx_listbox.delete(0, "end")
        for p in paths:
            # 상대 경로로 표시
            try:
                rel = p.relative_to(vault)
            except ValueError:
                rel = p
            self.idx_listbox.insert("end", str(rel))

    def _on_index_select(self, event=None):
        sel = self.idx_listbox.curselection()
        if not sel:
            return
        idx = sel[0]
        if idx >= len(self._idx_paths):
            return
        path = Path(self._idx_paths[idx])
        try:
            content = path.read_text(encoding="utf-8")
        except Exception as e:
            content = f"❌ 파일 읽기 실패: {e}"
        self.idx_content.configure(state="normal")
        self.idx_content.delete("1.0", "end")
        self.idx_content.insert("end", content)
        self.idx_content.configure(state="disabled")

    # ── Slack 탭 ─────────────────────────────────────────────────────────────

    def _slack_log(self, msg: str):
        """메인 스레드 전용 — Slack 로그 위젯에 직접 출력."""
        self.txt_slack_log.configure(state="normal")
        ts = datetime.now().strftime("%H:%M:%S")
        self.txt_slack_log.insert("end", f"[{ts}] {msg}\n")
        self.txt_slack_log.see("end")
        self.txt_slack_log.configure(state="disabled")

    def _slack_log_threadsafe(self, msg: str):
        """백그라운드 스레드에서 호출 — after()로 위임."""
        self.after(0, lambda m=msg: self._slack_log(m))

    def _clear_slack_log(self):
        self.txt_slack_log.configure(state="normal")
        self.txt_slack_log.delete("1.0", "end")
        self.txt_slack_log.configure(state="disabled")

    def _set_slack_status(self, running: bool):
        if running:
            self.btn_slack.config(text="⏹ Slack 봇 중지")
            self.lbl_slack_status.config(text="상태: 실행 중", foreground="green")
        else:
            self.btn_slack.config(text="▶ Slack 봇 시작")
            self.lbl_slack_status.config(text="상태: 중지", foreground="gray")

    def _on_slack_stopped(self, running: bool):
        """SlackBotRunner가 종료 시 호출 (백그라운드 스레드에서)."""
        self.after(0, lambda: self._set_slack_status(running))

    def _toggle_slack(self):
        if self._slack_runner and self._slack_runner.is_running():
            self._slack_runner.stop()
            self._slack_runner = None
            self._set_slack_status(False)
        else:
            self._save_cfg()
            runner = SlackBotRunner(
                self.cfg,
                log_fn=self._slack_log_threadsafe,
                on_status_fn=self._on_slack_stopped,
            )
            ok = runner.start()
            if ok:
                self._slack_runner = runner
                self._set_slack_status(True)


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
