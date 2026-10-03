#!/usr/bin/env python3
"""Backfill and audit JKQuant scalping paper ledgers.

Safety rules:
- Research history is imported only for completed historical sessions.
- Existing Durable Object ledgers are never overwritten.
- No broker/exchange order API is called.
- Missing-date backfill is followed by an integrity audit.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

RAW = "https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data"
WORKERS = {
    "daytrading": os.environ.get("DAYTRADING_WORKER_URL", "https://jkquant-daytrading-scheduler.mumae4.workers.dev").rstrip("/"),
    "crypto": os.environ.get("GLOBAL_INTRADAY_WORKER_URL", "https://jkquant-global-intraday-scheduler.mumae4.workers.dev").rstrip("/"),
    "soxl": os.environ.get("GLOBAL_INTRADAY_WORKER_URL", "https://jkquant-global-intraday-scheduler.mumae4.workers.dev").rstrip("/"),
}
TZ = {
    "daytrading": ZoneInfo("Asia/Seoul"),
    "crypto": ZoneInfo("Asia/Seoul"),
    "soxl": ZoneInfo("America/New_York"),
}
FRICTION = {"daytrading": 0.25, "crypto": 0.14, "soxl": 0.20}


def num(v, default=None):
    try:
        if v is None or str(v).strip() == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def intval(v, default=None):
    n = num(v, None)
    return int(n) if n is not None else default


def fetch_text(path):
    r = requests.get(f"{RAW}/{path}", timeout=40)
    r.raise_for_status()
    return r.text


def fetch_json(path):
    return json.loads(fetch_text(path))


def csv_rows(path):
    return list(csv.DictReader(io.StringIO(fetch_text(path))))


def local_today(strategy):
    return datetime.now(TZ[strategy]).date().isoformat()


def build_global_reference(strategy):
    folder = "crypto-research" if strategy == "crypto" else "soxl-research"
    rows = csv_rows(f"{folder}/baseline-decisions.csv")
    today = local_today(strategy)
    out = {}
    for row in rows:
        date = str(row.get("date") or "")
        if not date or date >= today:
            continue
        action = str(row.get("action") or "").lower()
        version = str(row.get("strategyVersion") or ("btc_midnight_orb_v2" if strategy == "crypto" else "soxl_orb_v1"))
        pnl = num(row.get("pnlPct"), 0.0) or 0.0
        trade = []
        if action == "trade":
            suffix = "Kst" if strategy == "crypto" else "Et"
            trade = [{
                "id": f"{strategy}:{date}:{row.get('signalTime'+suffix) or ''}",
                "strategyVersion": version,
                "mainVariant": "baseline",
                "status": "closed",
                "signalTime": row.get("signalTime" + suffix) or None,
                "entryTime": row.get("entryTime" + suffix) or None,
                "exitTime": row.get("exitTime" + suffix) or None,
                "entryPrice": num(row.get("entryPrice")),
                "exitPrice": num(row.get("exitPrice")),
                "reason": str(row.get("exitReason") or row.get("decisionReason") or ""),
                "grossPnlPct": None,
                "pnlPct": pnl,
                "frictionPct": FRICTION[strategy],
                "currency": "KRW" if strategy == "crypto" else "USD",
            }]
        out[date] = {
            "schema": 1,
            "strategy": strategy,
            "date": date,
            "timezone": "Asia/Seoul" if strategy == "crypto" else "America/New_York",
            "strategyVersion": version,
            "mainVariant": "baseline",
            "strategyParams": None,
            "mode": "historical-research-import-no-order",
            "updatedAt": None,
            "slots": 1,
            "frictionPct": FRICTION[strategy],
            "trades": trade,
            "decision": {
                "action": action or ("trade" if trade else "no_trade"),
                "reason": str(row.get("decisionReason") or ""),
                "source": f"{folder}/baseline-decisions.csv",
            },
            "summary": {
                "selected": len(trade),
                "pending": 0,
                "open": 0,
                "closed": len(trade),
                "accountReturnPct": pnl if trade else 0.0,
                "tradeSumPct": pnl if trade else 0.0,
            },
        }
    return out


def build_daytrading_reference():
    rows = csv_rows("daytrading-research/baseline-trades.csv")
    grouped = defaultdict(list)
    for row in rows:
        if row.get("date"):
            grouped[str(row["date"])].append(row)

    latest = fetch_json("daytrading-research/latest.json")
    baseline = next((x for x in latest.get("variants", []) if (x.get("params") or {}).get("name") == "baseline"), None)
    if not baseline:
        raise RuntimeError("daytrading baseline missing from latest.json")
    daily = (baseline.get("summary") or {}).get("daily") or []
    params = baseline.get("params") or {}
    today = local_today("daytrading")
    out = {}
    for day in daily:
        date = str(day.get("date") or "")
        if not date or date >= today:
            continue
        source_trades = grouped.get(date, [])
        trades = []
        for idx, row in enumerate(source_trades):
            trades.append({
                "id": f"daytrading:{date}:{row.get('code') or idx}:{row.get('signalTime') or ''}",
                "strategyVersion": str(row.get("strategyVersion") or "daytrading_vwap_breakout_v1"),
                "mainVariant": "baseline",
                "strategyParams": params,
                "status": "closed",
                "rank": intval(row.get("rank")),
                "code": str(row.get("code") or ""),
                "name": str(row.get("name") or row.get("code") or ""),
                "signalTime": row.get("signalTime") or None,
                "entryTime": row.get("entryTime") or None,
                "entryPrice": num(row.get("entryPrice")),
                "exitTime": row.get("exitTime") or None,
                "exitPrice": num(row.get("exitPrice")),
                "reason": str(row.get("reason") or ""),
                "pnl": num(row.get("pnl"), 0.0) or 0.0,
                "frictionPct": FRICTION["daytrading"],
                "currency": "KRW",
            })
        trade_sum = sum((num(x.get("pnl"), 0.0) or 0.0) for x in trades)
        ret = num(day.get("returnPct"), 0.0) or 0.0
        version = trades[0]["strategyVersion"] if trades else "daytrading_vwap_breakout_v1"
        out[date] = {
            "schema": 1,
            "strategy": "daytrading",
            "date": date,
            "timezone": "Asia/Seoul",
            "strategyVersion": version,
            "mainVariant": "baseline",
            "strategyParams": params,
            "mode": "historical-research-import-no-order",
            "updatedAt": None,
            "maxTrades": int(params.get("max_trades") or 3),
            "frictionPct": FRICTION["daytrading"],
            "trades": trades,
            "summary": {
                "selected": len(trades),
                "pending": 0,
                "open": 0,
                "closed": len(trades),
                "accountReturnPct": ret,
                "tradeSumPct": trade_sum,
            },
        }
    return out


def reference(strategy):
    return build_daytrading_reference() if strategy == "daytrading" else build_global_reference(strategy)


def qs(strategy):
    return "" if strategy == "daytrading" else f"?strategy={strategy}"


def get_dates(strategy, key):
    r = requests.get(WORKERS[strategy] + "/paper-dates" + qs(strategy), headers={"x-monitor-key": key}, timeout=40)
    r.raise_for_status()
    j = r.json()
    if not j.get("ok"):
        raise RuntimeError(j)
    return set(str(x) for x in (j.get("dates") or []))


def get_ledger(strategy, date, key):
    suffix = f"?date={date}" if strategy == "daytrading" else f"?strategy={strategy}&date={date}"
    r = requests.get(WORKERS[strategy] + "/paper" + suffix, headers={"x-monitor-key": key}, timeout=40)
    r.raise_for_status()
    j = r.json()
    if not j.get("ok"):
        raise RuntimeError(j)
    return j.get("ledger")


def import_ledger(strategy, ledger, key):
    payload = {"ledger": ledger}
    if strategy != "daytrading":
        payload["strategy"] = strategy
    r = requests.post(
        WORKERS[strategy] + "/paper-import",
        headers={"x-monitor-key": key, "content-type": "application/json"},
        json=payload,
        timeout=40,
    )
    data = r.json() if r.content else {}
    if not r.ok or not data.get("ok"):
        raise RuntimeError(f"{strategy} {ledger.get('date')} import failed: HTTP {r.status_code} {data}")
    return data


def account_return(strategy, ledger):
    summary = (ledger or {}).get("summary") or {}
    if num(summary.get("accountReturnPct")) is not None:
        return float(summary["accountReturnPct"])
    trades = (ledger or {}).get("trades") or []
    vals = [num(x.get("pnl") if strategy == "daytrading" else x.get("pnlPct")) for x in trades]
    vals = [x for x in vals if x is not None]
    if strategy == "daytrading":
        return sum(vals) / max(1, int((ledger or {}).get("maxTrades") or 3))
    return sum(vals)


def audit_strategy(strategy, key, do_backfill=False):
    ref = reference(strategy)
    db_dates = get_dates(strategy, key)
    ref_dates = set(ref)
    missing = sorted(ref_dates - db_dates)
    print(f"[AUDIT] {strategy}: reference={len(ref_dates)} db_dates={len(db_dates)} missing={len(missing)}")

    imported = 0
    kept = 0
    if do_backfill:
        for date in missing:
            result = import_ledger(strategy, ref[date], key)
            imported += 1 if result.get("imported") else 0
            kept += 1 if result.get("kept") else 0
            if (imported + kept) % 50 == 0:
                print(f"[BACKFILL] {strategy}: processed={imported+kept}/{len(missing)} imported={imported} kept={kept}")
            time.sleep(0.02)
        db_dates = get_dates(strategy, key)
        missing = sorted(ref_dates - db_dates)
        print(f"[BACKFILL] {strategy}: imported={imported} kept={kept} remaining_missing={len(missing)}")

    malformed = []
    imported_mismatch = []
    live_mismatch = []
    checked = 0
    for date in sorted(ref_dates & db_dates):
        ledger = get_ledger(strategy, date, key)
        if not ledger or not isinstance(ledger.get("trades"), list):
            malformed.append(date)
            continue
        checked += 1
        want = account_return(strategy, ref[date])
        got = account_return(strategy, ledger)
        trade_count_ok = len(ledger.get("trades") or []) == len(ref[date].get("trades") or [])
        ret_ok = abs(got - want) <= 1e-6
        if not (trade_count_ok and ret_ok):
            item = {
                "date": date,
                "wantReturn": want,
                "dbReturn": got,
                "wantTrades": len(ref[date].get("trades") or []),
                "dbTrades": len(ledger.get("trades") or []),
                "mode": ledger.get("mode"),
                "mainVariant": ledger.get("mainVariant"),
            }
            if ledger.get("mode") == "historical-research-import-no-order":
                imported_mismatch.append(item)
            else:
                # Pre-existing live paper can legitimately differ from end-of-day research reconstruction.
                live_mismatch.append(item)

    print(f"[VERIFY] {strategy}: checked={checked} malformed={len(malformed)} imported_mismatch={len(imported_mismatch)} live_mismatch={len(live_mismatch)}")
    if live_mismatch:
        print("[INFO] pre-existing live/research differences (not overwritten): " + json.dumps(live_mismatch[:10], ensure_ascii=False))
    if missing or malformed or imported_mismatch:
        raise RuntimeError(json.dumps({
            "strategy": strategy,
            "missing": missing[:20],
            "malformed": malformed[:20],
            "importedMismatch": imported_mismatch[:20],
        }, ensure_ascii=False))
    return {"strategy": strategy, "reference": len(ref_dates), "dbDates": len(db_dates), "imported": imported, "liveMismatch": len(live_mismatch)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--strategies", default="daytrading,crypto,soxl")
    p.add_argument("--backfill", action="store_true")
    args = p.parse_args()
    key = (os.environ.get("MONITOR_KEY") or os.environ.get("AUTOTRADE_KEY") or "").strip()
    if not key:
        raise SystemExit("MONITOR_KEY/AUTOTRADE_KEY missing")
    strategies = [x.strip().lower() for x in args.strategies.split(",") if x.strip()]
    bad = [x for x in strategies if x not in WORKERS]
    if bad:
        raise SystemExit("unsupported strategies: " + ",".join(bad))
    results = []
    for strategy in strategies:
        results.append(audit_strategy(strategy, key, args.backfill))
    print("[OK] scalping paper DB audit/backfill complete")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
