#!/usr/bin/env python3
"""Mutation checks for SCALPING_IMPROVEMENTS_v2 A-1~A-4.

Each mutation deliberately re-introduces a defect. The focused value suite must fail.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ENGINE=ROOT/"scripts/backtest_opening_rebreak.py"
TEST=ROOT/"scripts/test_opening_improvements_v2.py"
COLLECT=ROOT/"scripts/collect_scalping_data.py"
BACKFILL=ROOT/"scripts/backfill_opening_paths.py"
JS_ENGINE=ROOT/"functions/api/_opening.js"
JS_TEST=ROOT/"scripts/test_opening_js_accounting.mjs"

PY_MUTATIONS=[
    ("A1 incomplete 30m window","complete=observed>=30","complete=observed>=31"),
    ("A2 use close instead of low",'low=z["l"] if z["l"]>0 else z["c"]','low=z["c"]'),
    ("A2 target before stop",
     '        if hit_stop:\n            lh_px,lh_hm,lh_reason=stop_px,z["hm"],"stop";break\n        if hit_target:\n            lh_px,lh_hm,lh_reason=target_px,z["hm"],"take_profit";break',
     '        if hit_target:\n            lh_px,lh_hm,lh_reason=target_px,z["hm"],"take_profit";break\n        if hit_stop:\n            lh_px,lh_hm,lh_reason=stop_px,z["hm"],"stop";break'),
    ("A3 fixed cost old value","FIXED_COST_PCT = 0.23","FIXED_COST_PCT = 0.25"),
    ("A3 fallback slips only 1.5 ticks","DEFAULT_SLIP_TICKS_PER_SIDE = 2.5","DEFAULT_SLIP_TICKS_PER_SIDE = 1.5"),
    ("A3 observed VTS accepted before 30","VTS_MIN_MATCHES = 30","VTS_MIN_MATCHES = 0"),
    ("A4 keep designed date",
     '    return [x for x in trades if x.get("date") not in designed]',
     '    return list(trades)'),
    ("A4 remove K13 correction","MULTIPLE_TESTING_K = 13","MULTIPLE_TESTING_K = 1"),
]

JS_MUTATIONS=[
    ("A3 JS fixed cost old value","export const OPENING_FIXED_COST_PCT=.23;","export const OPENING_FIXED_COST_PCT=.25;"),
    ("A3 JS fallback 1.5 ticks","export const OPENING_DEFAULT_SLIP_TICKS_PER_SIDE=2.5;","export const OPENING_DEFAULT_SLIP_TICKS_PER_SIDE=1.5;"),
    ("A3 JS VTS threshold removed","export const OPENING_VTS_MIN_MATCHES=30;","export const OPENING_VTS_MIN_MATCHES=0;"),
    ("baseline stop mutated","  stop:1,","  stop:.8,"),
]


def run_py_mutation(label,old,new):
    src=ENGINE.read_text(encoding="utf-8")
    if old not in src:
        raise AssertionError(f"mutation target missing: {label}")
    mutated=src.replace(old,new,1)
    with tempfile.TemporaryDirectory() as td:
        d=Path(td)
        (d/"backtest_opening_rebreak.py").write_text(mutated,encoding="utf-8")
        shutil.copy2(TEST,d/TEST.name)
        shutil.copy2(COLLECT,d/COLLECT.name)
        shutil.copy2(BACKFILL,d/BACKFILL.name)
        p=subprocess.run([os.environ.get("PYTHON","python"),str(d/TEST.name)],cwd=d,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        if p.returncode==0:
            raise AssertionError(f"mutation survived: {label}\n{p.stdout}")


def run_js_mutation(label,old,new):
    src=JS_ENGINE.read_text(encoding="utf-8")
    if old not in src:
        raise AssertionError(f"mutation target missing: {label}")
    mutated=src.replace(old,new,1)
    with tempfile.TemporaryDirectory() as td:
        pth=Path(td)/"_opening.mjs"
        pth.write_text(mutated,encoding="utf-8")
        env={**os.environ,"OPENING_JS_PATH":str(pth)}
        p=subprocess.run(["node",str(JS_TEST)],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        if p.returncode==0:
            raise AssertionError(f"mutation survived: {label}\n{p.stdout}")


def main():
    total=0
    for m in PY_MUTATIONS:
        run_py_mutation(*m);total+=1
        print("✓ killed",m[0])
    for m in JS_MUTATIONS:
        run_js_mutation(*m);total+=1
        print("✓ killed",m[0])
    print(f"opening improvements mutations: PASS ({total}/{total} killed)")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
