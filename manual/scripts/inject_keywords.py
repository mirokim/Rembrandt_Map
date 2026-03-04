"""
키워드 자동 링크 주입 스크립트 (inject_keywords.py)  v2.0
────────────────────────────────────────────────────────
기능:
  본문에 등장하는 핵심 키워드의 첫 번째 언급을 [[허브_stem|키워드]] 형태로
  자동 교체한다. 파일 1개당 키워드 1개는 최초 1회만 링크로 교체한다.

⚠️  v1에서 발견된 버그 수정:
  기존 wikilink의 stem 안에 키워드가 포함되면 stem이 오염되는 문제가 있었음.
  예) [[07. 캐릭터 _ 스칼렛_432514018|스칼렛]]
    → [[07. 캐릭터 _ [[07. 캐릭터 _ 스칼렛_432514018|스칼렛]]_432514018|스칼렛]]
  v2에서는 기존 [[ ... ]] 범위 전체를 마스킹한 후 교체를 수행하여 방지한다.

사용법:
    python inject_keywords.py <vault_active_dir>

설정:
    KEYWORD_MAP 딕셔너리를 프로젝트에 맞게 수정한다.
    "키워드": ("허브_파일_stem", "표시 텍스트")

의존 패키지:
    없음 (표준 라이브러리만 사용)
"""

import os
import re
import sys

# ── 설정 ─────────────────────────────────────────────────────────────────────
# 프로젝트에 맞게 수정
KEYWORD_MAP: dict[str, tuple[str, str]] = {
    # "키워드": ("허브_파일_stem", "표시 텍스트"),
    # 예시:
    # "다이잔":   ("06. 캐릭터 _ 다이잔_416014685",  "다이잔"),
    # "이사장":   ("chief persona(0.1.0)",             "이사장"),
    # "TLS":      ("TLS(TimeLineSkill)시스템_588781620","TLS"),
}
# ─────────────────────────────────────────────────────────────────────────────

PLACEHOLDER = "\x00WLINK{idx}\x00"   # 마스킹 플레이스홀더
LINK_PAT    = re.compile(r'\[\[.*?\]\]', re.DOTALL)


def _mask_links(text: str) -> tuple[str, list[str]]:
    """기존 [[...]] 링크를 플레이스홀더로 치환 (중첩 방지)"""
    saved: list[str] = []
    def replacer(m: re.Match) -> str:
        idx = len(saved)
        saved.append(m.group(0))
        return f"\x00WLINK{idx}\x00"
    masked = LINK_PAT.sub(replacer, text)
    return masked, saved


def _restore_links(masked: str, saved: list[str]) -> str:
    """플레이스홀더를 원래 링크로 복원"""
    def replacer(m: re.Match) -> str:
        idx = int(m.group(1))
        return saved[idx]
    return re.sub(r'\x00WLINK(\d+)\x00', replacer, masked)


def _is_code_block(text: str, pos: int) -> bool:
    """pos가 코드블록(```) 안인지 확인"""
    code_ranges: list[tuple[int, int]] = []
    for m in re.finditer(r'```[\s\S]*?```', text):
        code_ranges.append((m.start(), m.end()))
    return any(s <= pos < e for s, e in code_ranges)


def inject(text: str, keyword_map: dict[str, tuple[str, str]]) -> str:
    """Frontmatter 이후 본문에 키워드 첫 등장 링크 주입"""
    # frontmatter 범위 계산
    fm_end = 0
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            fm_end = end + 4
    frontmatter = text[:fm_end]
    body        = text[fm_end:]

    # 기존 링크를 마스킹 → 안전하게 순수 본문 텍스트만 대상
    masked, saved = _mask_links(body)

    for keyword, (hub_stem, display) in keyword_map.items():
        pat = re.compile(re.escape(keyword))
        replaced = False
        offset = 0
        new_masked = masked

        for m in pat.finditer(masked):
            pos = m.start()
            if _is_code_block(masked, pos):
                continue
            link_text = f"[[{hub_stem}|{display}]]"
            new_masked = (masked[:pos + offset]
                          + link_text
                          + masked[m.end() + offset:])
            offset += len(link_text) - len(keyword)
            replaced = True
            break   # 파일 내 첫 1회만

        if replaced:
            masked = new_masked

    return frontmatter + _restore_links(masked, saved)


def run(active_dir: str) -> None:
    files = [f for f in os.listdir(active_dir) if f.endswith(".md")]
    updated = 0
    keyword_hit: dict[str, int] = {k: 0 for k in KEYWORD_MAP}

    for fname in sorted(files):
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            original = f.read()

        new_text = inject(original, KEYWORD_MAP)

        if new_text != original:
            for kw, (hub_stem, display) in KEYWORD_MAP.items():
                link = f"[[{hub_stem}|{display}]]"
                if original.count(link) < new_text.count(link):
                    keyword_hit[kw] += 1

            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
            updated += 1

    print(f"완료: {updated}개 파일 업데이트")
    print()
    print(f"{'키워드':<25} {'파일 수':>8}")
    print("-" * 36)
    for kw, cnt in sorted(keyword_hit.items(), key=lambda x: -x[1]):
        if cnt > 0:
            print(f"{kw:<25} {cnt:>8}개 파일")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    run(sys.argv[1])
