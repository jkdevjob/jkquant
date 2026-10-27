#!/usr/bin/env python3
"""Build the tiny precomputed payload used by the Today cumulative scalping chart.

Reads only completed research trade CSVs already stored on the scalping-data branch.
No network calls and no broker/order path.
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

OUT = Path("data/scalping-trend/latest.json")
SOURCES = {
    "opening": (Path("data/opening-history/baseline-trades.csv"), "pnl", "mean"),
    "daytrading": (Path("data/daytrading-research/baseline-trades.csv"), "pnl", "slots3"),
    "crypto": (Path("data/crypto-research/baseline-trades.csv"), "pnlPct", "mean"),
    "soxl": (Path("data/soxl-research/baseline-trades.csv"), "pnlPct", "mean"),
}

def read_daily(path: Path, pnl_col: str, mode: str):
    by = defaultdict(list)
    if path.exists():
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                date = str(row.get("date") or "").strip()
                try:
                    pnl = float(row.get(pnl_col))
                except (TypeError, ValueError):
                    continue
                if date:
                    by[date].append(pnl)

    eq = 1.0
    out = []
    for date in sorted(by):
        pnls = by[date]
        total = sum(pnls)
        ret = total / 3.0 if mode == "slots3" else total / len(pnls)
        eq *= 1.0 + ret / 100.0
        out.append({
            "date": date,
            "returnPct": round(ret, 8),
            "cumulativePct": round((eq - 1.0) * 100.0, 8),
            "trades": len(pnls),
        })
    return out

def read_closing(kind):
    from nightly_closing30_research import flatten
    daily=[];eq=1.0
    for path in sorted(Path('data/closing30').glob('20??-??-??.json')):
        day=json.loads(path.read_text(encoding='utf-8'));target=1506 if kind=='day' else 1522
        scans=[x for x in day.get('scans',[]) if x.get('targetHm')==target]
        if not scans or any(x.get('partial') or x.get('failed') or x.get('quoteErrors') for x in scans):continue
        main=day.get('closingMains',{}).get(kind,'baseline')
        rows=[x for x in flatten(day) if x['kind']==kind and x['variant']==main]
        if any(x['state']!='closed' for x in rows):continue
        ret=sum(x['pnl'] for x in rows)/3;eq*=1+ret/100
        daily.append({'date':day['date'],'returnPct':ret,'cumulativePct':(eq-1)*100,'trades':len(rows),'mainVariant':main,'source':'closing30-durable-paper-ledger'})
    return daily

def main():
    strategies = {}
    latest = ""
    for name, (path, pnl_col, mode) in SOURCES.items():
        daily = read_daily(path, pnl_col, mode)
        if daily:
            latest = max(latest, daily[-1]["date"])
        strategies[name] = {"source": str(path).replace("\\", "/"), "daily": daily}

    for name,kind in [('closing30','day'),('closing_bet','overnight')]:
        daily=read_closing(kind)
        strategies[name]={'source':'data/closing30 immutable paper ledgers','daily':daily}
        if daily:latest=max(latest,daily[-1]['date'])
    payload = {
        "schema": 1,
        "latestCompletedDate": latest or None,
        "rule": (
            "Precomputed completed-session daily account returns for the Today cumulative trend. "
            "Opening/crypto/SOXL use same-day mean trade return; "
            "daytrading uses three equal capital slots (sum pnl / 3)."
        ),
        "strategies": strategies,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", OUT, {k: len(v["daily"]) for k, v in strategies.items()})

if __name__ == "__main__":
    main()
