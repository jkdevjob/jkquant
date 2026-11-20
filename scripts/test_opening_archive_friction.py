"""시초가 장마감 보관(opening-monitor.yml)의 strategy.friction 표기 — 거래마다 남긴 마찰 기록 그대로 (2026-11-20)

2026-11-19 사용자 "단타 연구 봇에도 공통 수수료 적용해" 뒤에도 보관 파일 머리말이 옛 고정 문구 "0.25%" 였다.
지금은 그날 거래의 trades[].friction.fixedPct(공통 수수료 왕복 + 거래세 0.20 · 전 0.23)를 그대로 적는다.
워크플로의 jq 프로그램을 그대로 꺼내 작은 입력으로 돌린다(jq 필요 · GitHub 러너에 있음).
"""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

WF = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "opening-monitor.yml"
START = "jq -s --slurpfile live live-ledger.json --arg gen \"$GEN\" '"


def program(text):
    i = text.index(START) + len(START)
    j = text.index("\n", text.index("' history-0.json", i))
    prog = text[i:text.rindex("'", i, j)]
    assert "'" not in prog, "jq 프로그램 안에 작은따옴표가 있으면 셸 따옴표가 깨진다"
    return prog


def run(prog, trades_by_part):
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        files = []
        for k in range(5):
            p = d / f"history-{k}.json"
            p.write_text(json.dumps({"date": "2026-11-20", "universe": [], "errors": [],
                                     "trades": trades_by_part.get(k, []), "shadowVariants": []}), encoding="utf-8")
            files.append(str(p))
        live = d / "live-ledger.json"
        live.write_text('{"ok":false,"ledger":null}', encoding="utf-8")
        r = subprocess.run(["jq", "-s", "--slurpfile", "live", str(live), "--arg", "gen", "2026-11-20T15:40:00+09:00", prog, *files],
                           capture_output=True, text=True)
        if r.returncode:
            raise AssertionError("jq 실패: " + r.stderr[:400])
        return json.loads(r.stdout)


def trade(code, fixed, total):
    return {"code": code, "entryTime": "09:05", "pnl": 0.1, "friction": {"fixedPct": fixed, "totalPct": total, "costModel": "common-fee-v1"}}


@unittest.skipIf(shutil.which("jq") is None, "jq 없음")
class OpeningArchiveFriction(unittest.TestCase):
    def check(self, prog):
        new = run(prog, {0: [trade("A", 0.7, 1.4), trade("B", 0.7, 1.1)], 2: [trade("C", 0.7, 1.2)]})
        f = new["strategy"]["friction"]
        self.assertIn("고정 0.7% + 호가", f)          # 공통 율 0.25% → 0.20 + 0.50 = 0.70 · 같은 값은 한 번만
        self.assertNotIn("0.25%", f)
        mixed = run(prog, {1: [trade("A", 0.23, 0.9)], 3: [trade("B", 0.7, 1.3)]})["strategy"]["friction"]
        self.assertIn("고정 0.23% / 0.7%", mixed)     # 다시 보관한 지난 날 · 율이 바뀐 날은 기록값 그대로
        empty = run(prog, {})["strategy"]["friction"]
        self.assertTrue(empty.startswith("거래마다 기록") and "공통 수수료 왕복" in empty and "0.25%" not in empty, empty)
        self.assertEqual(new["strategy"]["finalExit"], "09:30")
        self.assertEqual(len(new["trades"]), 3)

    def test_label_follows_recorded_trade_friction(self):
        self.check(program(WF.read_text(encoding="utf-8")))

    def test_mutants_fail(self):
        prog = program(WF.read_text(encoding="utf-8"))
        expr = re.search(r"friction: \((.*?)\n\s*\)\n\s*\},", prog, re.S)
        self.assertIsNotNone(expr, "friction 식을 찾지 못함")
        for name, mutant in [
            ("옛 고정 문구", prog.replace(expr.group(0), 'friction: "0.25%"\n                },')),
            ("unique 빠짐", prog.replace("| numbers ] | unique", "| numbers ]")),
            ("총마찰로 표기", prog.replace(".fixedPct | numbers", ".totalPct | numbers")),
        ]:
            self.assertNotEqual(mutant, prog, name)
            with self.assertRaises(AssertionError, msg=name):
                self.check(mutant)


if __name__ == "__main__":
    unittest.main()
