#!/usr/bin/env python3
"""수영대회 수집기 · 알림 변이 시험 — 고친 곳을 옛 동작으로 되돌리면 시험이 실제로 실패하는지 확인한다.

각 변이는 임시 폴더의 사본에만 적용한다(원본 파일은 건드리지 않는다).
실행: python scripts/mutation_test_swim.py   (모든 변이가 '잡힘'이어야 ALL PASS)
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ["collect_swim.py", "swim_regions.py", "swim_alerts.py", "test_swim_collect.py"]
MUTANTS = [
    ("robots.txt 무시", "collect_swim.py", "return rp is None or rp.can_fetch(UA_TOKEN, url)", "return True",
     "ParserTests.test_robots_respected"),
    ("점검 페이지(HTTP 200)를 성공으로", "collect_swim.py",
     'raise StructureError("대한수영연맹 대회일정 목록에서 \'대회기간\' 항목을 찾지 못함")', "break",
     "ParserTests.test_maintenance_page_is_failure_not_success"),
    ("'다이빙 미개최'를 다이빙으로", "collect_swim.py", 's = _NEGATED.sub(" ", " ".join(clean(t) for t in texts))',
     's = " ".join(clean(t) for t in texts)', "FreestyleTests.test_negated_discipline"),
    ("마스터즈 대회와 국가대표 선발대회를 합침", "collect_swim.py",
     '    if kind_conflict(a.get("title", ""), b.get("title", "")):\n        return False\n', "",
     "SameMeetTests.test_distinct_meets"),
    ("whoisfast 수영장 규격(전부 50m)을 근거로 씀", "collect_swim.py",
     'apply_close=apply_close, kind_hint="masters",', 'apply_close=apply_close, kind_hint="masters", pool=pool_length(meta),',
     "ParserTests.test_whoisfast_pool_length_ignored"),
    ("'경기종목'의 경기를 경기도로", "swim_regions.py",
     'if alias == "경기" and nxt and _HANGUL.match(nxt) and nxt != "도":', 'if False:',
     "RegionTests.test_common_words_are_not_regions"),
    ("마이랭킹(robots 금지) 자료를 이관", "collect_swim.py",
     'if "마이랭킹" in src or "myranking" in (x.get("source_url") or "") or "캐치레인" in src:', "if False:",
     "RefreshTests.test_lifecycle"),
    ("목록 사이트 관측 열쇠에 날짜 포함(일정 변경이 안 바뀜)", "collect_swim.py",
     '    return o["source"] + ":" + core_key(o["title"])\n', '    return o["source"] + ":" + core_key(o["title"]) + "@" + o.get("start_date", "")\n',
     "RefreshTests.test_lifecycle"),
    ("자유형 '거리 목록'에 없는 거리를 불가로 안 봄", "collect_swim.py",
     "f50 = True if 50 in found else (False if listed else None)", "f50 = True if 50 in found else None",
     "FreestyleTests.test_explicit_and_table"),
    ("요강 표에서 자유형 칸 위치를 무시(발차기 칸 때문에 열 어긋남)", "collect_swim.py",
     'idx, ncol = cols.index("자유형"), len(cols)', 'idx, ncol = 0, len(cols)', "FreestyleTests.test_explicit_and_table"),
    ("안내문을 경기 종목으로", "collect_swim.py", '        events = ""                                  # \'단체전 종목', '        pass  # \'단체전 종목',
     "ParserTests.test_notice_events_must_be_events"),
    ("알림 첫 실행 기준선 없음(기존 대회 전부 '새 대회'로 발송)", "swim_alerts.py", "    if state is None:\n", "    if False:\n",
     "AlertTests.test_run_baseline_does_not_send"),
    ("같은 알림 반복", "swim_alerts.py", "        if key in sent:\n            return\n", "", "AlertTests.test_baseline_then_changes_once"),
    ("광주시를 광주광역시로", "swim_regions.py", '_OWNERS["광주시"] = ["경기"]', '_OWNERS["광주시"] = ["광주"]',
     "RegionTests.test_nationwide"),
]


def run(dirpath, test):
    return subprocess.run([sys.executable, "-m", "unittest", f"test_swim_collect.{test}"], cwd=dirpath,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                          env={"SWIM_TODAY": "2026-11-03", "PATH": "/usr/bin:/bin", "PYTHONPATH": str(dirpath),
                               # 변이 전후 파일 크기·시각이 같으면 옛 .pyc 를 다시 쓰므로 바이트코드를 만들지 않는다
                               "PYTHONDONTWRITEBYTECODE": "1"}).returncode


def main():
    caught = 0
    for name, fname, old, new, test in MUTANTS:
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            for f in FILES:
                shutil.copy(HERE / f, d / f)
            (d / "data").mkdir()
            src = (d / fname).read_text(encoding="utf-8")
            if src.count(old) != 1:
                print(f"FAIL 변이 위치를 못 찾음: {name}")
                sys.exit(1)
            if run(d, test) != 0:
                print(f"FAIL 변이 전 시험이 이미 실패: {test}")
                sys.exit(1)
            (d / fname).write_text(src.replace(old, new), encoding="utf-8")
            rc = run(d, test)
            ok = rc != 0
            caught += ok
            print(("PASS 잡힘   " if ok else "FAIL 못잡음 ") + name + " → " + test)
    if caught != len(MUTANTS):
        sys.exit(1)
    print(f"ALL PASS 수영대회 변이 {caught}/{len(MUTANTS)}종 잡힘")


if __name__ == "__main__":
    main()
