#!/usr/bin/env python3
import importlib.util
import sys
import types
from pathlib import Path

# Unit tests exercise pure builders/safety rules only; deployment workflow installs real requests.
sys.modules.setdefault("requests", types.ModuleType("requests"))

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bp", ROOT / "scripts" / "backfill_scalping_paper.py")
bp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bp)


def test_account_return():
    d = {"maxTrades": 3, "trades": [{"pnl": 3.0}, {"pnl": -1.0}]}
    assert abs(bp.account_return("daytrading", d) - (2.0 / 3.0)) < 1e-12
    c = {"trades": [{"pnlPct": 0.5}]}
    assert abs(bp.account_return("crypto", c) - 0.5) < 1e-12


def test_global_reference():
    old_rows, old_today = bp.csv_rows, bp.local_today
    try:
        bp.csv_rows = lambda path: [
            {"date": "2026-10-01", "strategyVersion": "btc_midnight_orb_v2", "action": "no_trade", "decisionReason": "none"},
            {"date": "2026-10-02", "strategyVersion": "btc_midnight_orb_v2", "action": "trade",
             "signalTimeKst": "00:05", "entryTimeKst": "00:10", "exitTimeKst": "01:00",
             "entryPrice": "100", "exitPrice": "101", "exitReason": "time_exit", "pnlPct": "0.86"},
            {"date": "2026-10-03", "strategyVersion": "btc_midnight_orb_v2", "action": "trade", "pnlPct": "9"},
        ]
        bp.local_today = lambda strategy: "2026-10-03"
        ref = bp.build_global_reference("crypto")
        assert set(ref) == {"2026-10-01", "2026-10-02"}
        assert ref["2026-10-01"]["trades"] == []
        assert ref["2026-10-02"]["trades"][0]["status"] == "closed"
        assert ref["2026-10-02"]["summary"]["accountReturnPct"] == 0.86
    finally:
        bp.csv_rows, bp.local_today = old_rows, old_today


def test_daytrading_reference():
    old_rows, old_json, old_today = bp.csv_rows, bp.fetch_json, bp.local_today
    try:
        bp.csv_rows = lambda path: [
            {"date": "2026-10-01", "strategyVersion": "daytrading_vwap_breakout_v1", "rank": "1", "code": "000001",
             "name": "A", "signalTime": "1000", "entryTime": "1001", "entryPrice": "100",
             "exitTime": "1010", "exitPrice": "102", "reason": "take_profit", "pnl": "1.75"},
            {"date": "2026-10-01", "strategyVersion": "daytrading_vwap_breakout_v1", "rank": "2", "code": "000002",
             "name": "B", "signalTime": "1002", "entryTime": "1003", "entryPrice": "100",
             "exitTime": "1011", "exitPrice": "99", "reason": "stop", "pnl": "-1.25"},
        ]
        bp.fetch_json = lambda path: {"variants": [{"params": {"name": "baseline", "max_trades": 3},
            "summary": {"daily": [{"date": "2026-10-01", "returnPct": 1.0/6.0, "trades": 2},
                                  {"date": "2026-10-02", "returnPct": 0, "trades": 0}]}}]}
        bp.local_today = lambda strategy: "2026-10-03"
        ref = bp.build_daytrading_reference()
        assert len(ref["2026-10-01"]["trades"]) == 2
        assert ref["2026-10-02"]["trades"] == []
        assert ref["2026-10-01"]["maxTrades"] == 3
    finally:
        bp.csv_rows, bp.fetch_json, bp.local_today = old_rows, old_json, old_today


def test_worker_safety():
    g = (ROOT / "worker/global-intraday-scheduler/src/index.js").read_text(encoding="utf-8")
    d = (ROOT / "worker/daytrading-scheduler/src/index.js").read_text(encoding="utf-8")
    for src in (g, d):
        assert 'u.pathname==="/paper-import"' in src
        assert 'historical import requires completed date' in src
        assert 'if(existing)return {imported:false,kept:true' in src
        assert 'historical-research-import-no-order' in src
        assert 'u.pathname==="/paper-dates"' in src


if __name__ == "__main__":
    test_account_return()
    test_global_reference()
    test_daytrading_reference()
    test_worker_safety()
    print("scalping paper backfill tests: PASS")
