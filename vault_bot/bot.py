"""
Vault Bot — Rembrandt Map 볼트 관리 봇
────────────────────────────────────
기능:
  - vault MD 파일 스캔
  - keyword_index.json 자동 관리 (Claude Haiku 기반 키워드 발견)
  - wikilink 주입 + 클러스터 링크 강화
  - index_YYYYMMDD.md 자동 갱신
  - 타이머 기반 자동 실행 (1h / 5h)

실행:
    python bot.py
"""

import json
import os
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
# Tkinter GUI
# ─────────────────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Vault Bot — Rembrandt Map")
        self.geometry("720x640")
        self.resizable(True, True)
        self.cfg = load_config()
        self.bot: VaultBot | None = None
        self.timer_running = False
        self._next_run_time: datetime | None = None
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

    # ── Config UI 연결 ────────────────────────────────────────────────────────

    def _load_cfg_to_ui(self):
        self.var_vault.set(self.cfg.get("vault_path", ""))
        self.var_key.set(self.cfg.get("claude_api_key", ""))
        self.var_interval.set(self.cfg.get("interval_hours", 1))

    def _save_cfg(self):
        self.cfg["vault_path"] = self.var_vault.get().strip()
        self.cfg["claude_api_key"] = self.var_key.get().strip()
        self.cfg["interval_hours"] = self.var_interval.get()
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


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
