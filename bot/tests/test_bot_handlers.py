"""
tests/test_bot_handlers.py — SlackBotRunner 이벤트 핸들러 로직 유닛 테스트

handle_dm / handle_mention 의 필터 로직과 히스토리 키 형식을 검증.
bot.py 전체를 임포트하지 않고, 해당 로직만 인라인으로 추출해서 테스트.

실행: python -m pytest bot/tests/ -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.slack_utils import extract_slack_files


# ─────────────────────────────────────────────────────────────────────────────
# handle_dm 필터 로직 (bot.py의 handle_dm 조건 추출)
# ─────────────────────────────────────────────────────────────────────────────

def _dm_should_process(event: dict) -> bool:
    """handle_dm의 필터 조건 — bot.py와 동기화 유지 필요."""
    if event.get("channel_type") != "im":
        return False
    subtype = event.get("subtype")
    if event.get("bot_id") or (subtype and subtype != "file_share"):
        return False
    return True


class TestHandleDmFilter(unittest.TestCase):

    def test_normal_dm_passes(self):
        self.assertTrue(_dm_should_process({"channel_type": "im", "text": "안녕"}))

    def test_non_im_channel_filtered(self):
        self.assertFalse(_dm_should_process({"channel_type": "channel", "text": "hello"}))

    def test_missing_channel_type_filtered(self):
        self.assertFalse(_dm_should_process({"text": "hello"}))

    def test_bot_message_filtered(self):
        self.assertFalse(_dm_should_process({"channel_type": "im", "bot_id": "B123"}))

    def test_file_share_subtype_passes(self):
        self.assertTrue(_dm_should_process({
            "channel_type": "im",
            "subtype": "file_share",
            "files": [{"id": "F1"}],
        }))

    def test_message_changed_subtype_filtered(self):
        self.assertFalse(_dm_should_process({
            "channel_type": "im",
            "subtype": "message_changed",
        }))

    def test_message_deleted_subtype_filtered(self):
        self.assertFalse(_dm_should_process({
            "channel_type": "im",
            "subtype": "message_deleted",
        }))

    def test_none_subtype_passes(self):
        """subtype=None은 일반 메시지."""
        self.assertTrue(_dm_should_process({"channel_type": "im", "subtype": None}))

    def test_bot_id_with_file_share_still_filtered(self):
        """봇 자신이 올린 파일은 처리하지 않음."""
        self.assertFalse(_dm_should_process({
            "channel_type": "im",
            "bot_id": "B123",
            "subtype": "file_share",
        }))


# ─────────────────────────────────────────────────────────────────────────────
# 히스토리 키 형식
# ─────────────────────────────────────────────────────────────────────────────

class TestConvHistoryKey(unittest.TestCase):

    def _make_key(self, channel: str, thread_ts: str | None) -> str:
        return f"{channel}:{thread_ts or 'dm'}"

    def test_dm_key_uses_dm_suffix(self):
        self.assertEqual(self._make_key("D12345", None), "D12345:dm")

    def test_thread_key_uses_thread_ts(self):
        self.assertEqual(
            self._make_key("C12345", "1711234567.123456"),
            "C12345:1711234567.123456",
        )

    def test_empty_thread_ts_treated_as_dm(self):
        self.assertEqual(self._make_key("D99999", ""), "D99999:dm")

    def test_different_channels_produce_different_keys(self):
        k1 = self._make_key("D111", None)
        k2 = self._make_key("D222", None)
        self.assertNotEqual(k1, k2)

    def test_same_channel_different_thread_produces_different_keys(self):
        k1 = self._make_key("C999", "100.0")
        k2 = self._make_key("C999", "200.0")
        self.assertNotEqual(k1, k2)


# ─────────────────────────────────────────────────────────────────────────────
# _conv_history 관리 (메모리 누수 방지 로직)
# ─────────────────────────────────────────────────────────────────────────────

class TestConvHistoryManagement(unittest.TestCase):

    def _apply_history_update(
        self,
        conv_history: dict,
        hist_key: str,
        history: list,
        query: str,
        answer: str,
        max_keys: int = 1000,
    ) -> None:
        """bot.py의 히스토리 업데이트 로직 추출."""
        conv_history[hist_key] = (history + [
            {"role": "user",      "content": query},
            {"role": "assistant", "content": answer},
        ])[-40:]
        if len(conv_history) > max_keys:
            for old_key in list(conv_history)[:len(conv_history) - max_keys]:
                del conv_history[old_key]

    def test_history_grows_to_40_messages(self):
        h = {}
        history: list = []
        for i in range(25):
            self._apply_history_update(h, "k", history, f"q{i}", f"a{i}")
            history = h["k"]
        self.assertLessEqual(len(h["k"]), 40)

    def test_history_truncated_at_40(self):
        h = {}
        history: list = []
        for i in range(30):  # 30턴 = 60 메시지 → 40으로 truncate
            self._apply_history_update(h, "k", history, f"q{i}", f"a{i}")
            history = h["k"]
        self.assertEqual(len(h["k"]), 40)

    def test_old_keys_evicted_at_max(self):
        h = {}
        max_k = 5
        for i in range(7):
            self._apply_history_update(h, f"key:{i}", [], "q", "a", max_keys=max_k)
        self.assertLessEqual(len(h), max_k)

    def test_most_recent_keys_kept_after_eviction(self):
        h = {}
        max_k = 3
        for i in range(5):
            self._apply_history_update(h, f"key:{i}", [], "q", "a", max_keys=max_k)
        # 최신 키들이 보존되어야 함
        self.assertIn("key:4", h)
        self.assertIn("key:3", h)
        self.assertIn("key:2", h)

    def test_no_eviction_below_max(self):
        h = {}
        for i in range(5):
            self._apply_history_update(h, f"key:{i}", [], "q", "a", max_keys=10)
        self.assertEqual(len(h), 5)


# ─────────────────────────────────────────────────────────────────────────────
# respond()의 image_files 필터 (mimetype 확인)
# ─────────────────────────────────────────────────────────────────────────────

class TestImageFilesFilter(unittest.TestCase):

    def _get_image_files(self, files: list) -> list:
        """respond()의 image_files 필터 추출."""
        return [f for f in (files or []) if f.get("mimetype", "").startswith("image/")]

    def test_png_included(self):
        files = [{"mimetype": "image/png", "id": "F1"}]
        self.assertEqual(len(self._get_image_files(files)), 1)

    def test_jpeg_included(self):
        files = [{"mimetype": "image/jpeg", "id": "F1"}]
        self.assertEqual(len(self._get_image_files(files)), 1)

    def test_pdf_excluded(self):
        files = [{"mimetype": "application/pdf", "id": "F1"}]
        self.assertEqual(self._get_image_files(files), [])

    def test_mixed_keeps_only_images(self):
        files = [
            {"mimetype": "image/png",        "id": "F1"},
            {"mimetype": "application/pdf",  "id": "F2"},
            {"mimetype": "image/gif",        "id": "F3"},
            {"mimetype": "text/plain",       "id": "F4"},
        ]
        result = self._get_image_files(files)
        self.assertEqual(len(result), 2)
        ids = [f["id"] for f in result]
        self.assertIn("F1", ids)
        self.assertIn("F3", ids)

    def test_none_files_returns_empty(self):
        self.assertEqual(self._get_image_files(None), [])

    def test_missing_mimetype_excluded(self):
        files = [{"id": "F1"}]  # mimetype 없음
        self.assertEqual(self._get_image_files(files), [])


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main(verbosity=2)
