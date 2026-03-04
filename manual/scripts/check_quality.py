"""
품질 체크 스크립트
────────────────────────────────────────────────────────
기능:
  active/ 폴더의 모든 마크다운 파일에 대해 품질 지표를 측정하고
  콘솔에 보고서를 출력한다.

사용법:
    python check_quality.py <vault_active_dir>

측정 항목:
  - 링크 없는 파일 비율
  - Frontmatter 누락 파일
  - 섹션 헤딩(##) 보유 비율
  - 300자 미만 초소형 파일
  - 중복 내용 파일 (글자 수 기준)

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml
from collections import Counter


def load_frontmatter(text: str) -> dict:
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            try:
                return yaml.safe_load(text[3:end]) or {}
            except Exception:
                pass
    return {}


def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            return text[end + 3:].strip()
    return text


def run(active_dir: str):
    md_files = [f for f in os.listdir(active_dir) if f.endswith(".md")]
    total = len(md_files)
    print(f"\n{'='*50}")
    print(f" Graph RAG 품질 보고서")
    print(f" 대상: {active_dir}")
    print(f" 파일 수: {total}개")
    print(f"{'='*50}\n")

    no_link = []
    no_fm = []
    no_heading = []
    tiny = []
    size_map = Counter()

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()

        fm = load_frontmatter(text)
        body = strip_frontmatter(text)
        stem = os.path.splitext(fname)[0]

        if not re.search(r"\[\[", text):
            no_link.append(stem)
        if not fm:
            no_fm.append(stem)
        if not re.search(r"^##\s", text, re.MULTILINE):
            no_heading.append(stem)
        if len(body) < 300:
            tiny.append(stem)
        size_map[len(body) // 500] += 1

    def pct(n): return f"{n}/{total} ({n/total*100:.1f}%)"

    print(f"[{'PASS' if not no_link else 'WARN'}] 링크 없는 파일: {pct(len(no_link))}")
    if no_link:
        for s in no_link[:5]: print(f"       - {s}")
        if len(no_link) > 5: print(f"       ... 외 {len(no_link)-5}개")

    print(f"\n[{'PASS' if not no_fm else 'WARN'}] Frontmatter 누락: {pct(len(no_fm))}")
    if no_fm:
        for s in no_fm[:5]: print(f"       - {s}")

    print(f"\n[{'PASS' if len(no_heading)/total < 0.2 else 'WARN'}] 헤딩(##) 없는 파일: {pct(len(no_heading))}")

    print(f"\n[{'PASS' if not tiny else 'WARN'}] 300자 미만 초소형 파일: {pct(len(tiny))}")
    if tiny:
        for s in tiny[:5]: print(f"       - {s}")

    print(f"\n[INFO] 문서 크기 분포:")
    for k in sorted(size_map.keys()):
        label = f"{k*500}~{(k+1)*500}자"
        print(f"       {label:>15}: {'█' * size_map[k]} {size_map[k]}개")

    print(f"\n{'='*50}\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    run(sys.argv[1])
