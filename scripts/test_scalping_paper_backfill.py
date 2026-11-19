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
        assert 'if(existing){' in src
        assert 'rememberPaperDate(env' in src
        assert 'return {imported:false,kept:true' in src
        assert 'historical-research-import-no-order' in src
        assert 'u.pathname==="/paper-dates"' in src


def test_friction_change_keeps_old_records():
    # 2026-11-19 공통 수수료: 연구 CSV 는 지금 율(코인 0.54), DB 지난 기록은 그때 율(0.14) — 덮어쓰지 않고 비교에서만 맞춘다
    ref = {"frictionPct": 0.54, "trades": [{"pnlPct": 1 - 0.54, "frictionPct": 0.54}]}
    db = {"frictionPct": 0.14, "summary": {"accountReturnPct": 1 - 0.14}, "trades": [{"pnlPct": 1 - 0.14, "frictionPct": 0.14}]}
    ok, want, got, gap = bp.ledger_matches("crypto", ref, db)
    assert ok and abs(gap - 0.40) < 1e-12 and abs(want - got) < 1e-9, (ok, want, got, gap)
    bad = {"frictionPct": 0.14, "trades": [{"pnlPct": 1.2 - 0.14, "frictionPct": 0.14}]}          # 체결가가 다르면 그대로 잡힌다
    assert not bp.ledger_matches("crypto", ref, bad)[0]
    more = {"frictionPct": 0.14, "trades": [{"pnlPct": 0.86, "frictionPct": 0.14}, {"pnlPct": 0.1, "frictionPct": 0.14}]}
    assert not bp.ledger_matches("crypto", ref, more)[0]                                          # 거래 수 다름
    # 데이트레이딩: 3칸 자금 — 차이도 3으로 나눈다(거래 2건 × 0.47 / 3)
    dref = {"maxTrades": 3, "summary": {"accountReturnPct": ((1 - 0.72) + (2 - 0.72)) / 3}, "trades": [{"pnl": 1 - 0.72, "frictionPct": 0.72}, {"pnl": 2 - 0.72, "frictionPct": 0.72}]}
    ddb = {"maxTrades": 3, "frictionPct": 0.25, "summary": {"accountReturnPct": ((1 - 0.25) + (2 - 0.25)) / 3}, "trades": [{"pnl": 0.75}, {"pnl": 1.75}]}
    ok, want, got, gap = bp.ledger_matches("daytrading", dref, ddb)
    assert ok and abs(gap - 2 * 0.47 / 3) < 1e-12, (ok, want, got, gap)
    # 같은 율이면 차이 0
    same = {"frictionPct": 0.54, "trades": [{"pnlPct": 0.46, "frictionPct": 0.54}]}
    ok, want, got, gap = bp.ledger_matches("crypto", ref, same)
    assert ok and gap == 0.0 and abs(want - 0.46) < 1e-12 and abs(got - 0.46) < 1e-12, (ok, want, got, gap)


def test_friction_mutation_is_caught():
    src = (ROOT / "scripts" / "backfill_scalping_paper.py").read_text(encoding="utf-8")
    mut = src.replace("    want = account_return(strategy, ref_ledger) + gap\n", "    want = account_return(strategy, ref_ledger)\n")
    assert mut != src
    ns = {"__name__": "bp_mut"}
    exec(compile(mut, "bp_mut", "exec"), ns)
    ref = {"frictionPct": 0.54, "trades": [{"pnlPct": 0.46, "frictionPct": 0.54}]}
    db = {"frictionPct": 0.14, "trades": [{"pnlPct": 0.86, "frictionPct": 0.14}]}
    assert not ns["ledger_matches"]("crypto", ref, db)[0]                                        # 비용 차이를 안 맞추면 지난 기록이 불일치로 나온다(배포 실패)


if __name__ == "__main__":
    test_friction_change_keeps_old_records()
    test_friction_mutation_is_caught()
    test_account_return()
    test_global_reference()
    test_daytrading_reference()
    test_worker_safety()
    print("scalping paper backfill tests: PASS")
