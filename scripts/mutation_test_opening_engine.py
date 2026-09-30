#!/usr/bin/env python3
"""Mutation tests for opening engine changes A-2/A-3.

Each mutation intentionally restores an unsafe/old behavior. The behavioral probe
must fail; if it passes, CI fails because the test suite would not detect the regression.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "backtest_opening_rebreak.py"
TMP = ROOT / "scripts" / "_mutant_opening_engine.py"


def kill_mutant(label, old, new, probe):
    src = SRC.read_text(encoding="utf-8")
    if old not in src:
        raise AssertionError(f"{label}: mutation target missing")
    mutant = src.replace(old, new, 1)
    TMP.write_text(mutant, encoding="utf-8")
    try:
        code = (
            "import sys;sys.path.insert(0,'scripts');"
            "import _mutant_opening_engine as m;"
            + probe
        )
        r = subprocess.run(
            [sys.executable, "-c", code],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if r.returncode == 0:
            raise AssertionError(
                f"{label}: MUTANT SURVIVED\nstdout={r.stdout}\nstderr={r.stderr}"
            )
        print(f"✓ mutation killed: {label}")
    finally:
        try:
            TMP.unlink()
        except FileNotFoundError:
            pass


def main():
    kill_mutant(
        "A-2 low/high stop touch must use low, not close",
        'stop_hit = z["l"] <= stop_px',
        'stop_hit = z["c"] <= stop_px',
        (
            "p=m.Params('baseline',stop=1.0,take_profit=1.5);"
            "a=[{'hm':905,'o':100,'h':100,'l':100,'c':100,'v':1,'signal_h':100},"
            "{'hm':906,'o':100,'h':102,'l':98,'c':100,'v':1,'signal_h':100},"
            "{'hm':930,'o':100,'h':100,'l':100,'c':100,'v':1,'signal_h':100}];"
            "z=m.simulate_exit(a,0,100,p,{'totalPct':0},'lowhigh');"
            "assert z['reason']=='stop' and z['exitTime']==906,z"
        ),
    )
    kill_mutant(
        "A-3 VTS calibration must require 30 complete matches",
        "VTS_MIN_MATCHES = 30",
        "VTS_MIN_MATCHES = 0",
        (
            "z=m.opening_friction(15000,{'completeMatches':1,'observedRoundTripSlippagePct':0.42});"
            "assert z['source']=='2.5tick-fallback',z"
        ),
    )
    kill_mutant(
        "A-3 fallback must include 2.5 ticks each side",
        "FALLBACK_TICKS_PER_SIDE = 2.5",
        "FALLBACK_TICKS_PER_SIDE = 0.0",
        (
            "z=m.opening_friction(15000,{'completeMatches':0});"
            "assert z['totalPct']>0.55,z"
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
