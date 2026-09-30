#!/usr/bin/env python3
"""Backfill archived opening-signal rows whose post-entry 30-minute OHLC path is incomplete.

Uses the prior research output only to identify date/code pairs. The immutable signal rule
is not changed; only the archived KIS 1-minute OHLC window is extended to 10:00 so outcome
labels can be recomputed. Existing strategyVersion/params are untouched.
"""
from __future__ import annotations

import gzip
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from collect_scalping_data import minute_history

KST=ZoneInfo("Asia/Seoul")
OUTCOME=Path("data/opening-research/signal-outcomes.json")
DATA=Path("data/scalping")


def hm(t):
    s=str(t or "")
    if len(s)>=6 and s[-6:].isdigit():
        return int(s[-6:-2])
    return -1


def main():
    if not OUTCOME.exists():
        print("No prior signal-outcomes.json; nothing to backfill.")
        return 0
    j=json.loads(OUTCOME.read_text(encoding="utf-8"))
    pairs=[]
    seen=set()
    for x in j.get("records") or []:
        if x.get("outcomeWindowComplete"):
            continue
        date=str(x.get("date") or "")
        code=str(x.get("code") or "")
        entry=int(x.get("entryTime") or 0)
        if not date or not code or entry<900 or entry>930:
            continue
        key=(date,code)
        if key not in seen:
            seen.add(key);pairs.append(key)
    limit=max(1,int(os.environ.get("JKQ_BACKFILL_MAX","60")))
    pairs=pairs[:limit]
    changed_files=set()
    refreshed=0
    failed=[]

    by_date={}
    for date,code in pairs:
        by_date.setdefault(date,[]).append(code)

    for date,codes in sorted(by_date.items()):
        p=DATA/date[:4]/f"{date}.json.gz"
        if not p.exists():
            failed.append({"date":date,"error":"archive_missing"});continue
        with gzip.open(p,"rt",encoding="utf-8") as f:
            day=json.load(f)
        rows={str(x.get("code") or ""):x for x in day.get("universe") or []}
        file_changed=False
        for code in codes:
            row=rows.get(code)
            if not row:
                failed.append({"date":date,"code":code,"error":"code_missing"});continue
            max_hm=max([hm(x.get("t")) for x in row.get("bars") or []] or [-1])
            if max_hm>=1000:
                continue
            bars,err=minute_history(code,date.replace("-",""))
            if err or not bars:
                failed.append({"date":date,"code":code,"error":str(err or "no_bars")});continue
            row["bars"]=bars
            row["pathBackfilledAt"]=datetime.now(KST).isoformat()
            refreshed+=1;file_changed=True
        if file_changed:
            day["schema"]=max(4,int(day.get("schema") or 0))
            day["minuteWindow"]={"fromHm":900,"toHm":1000,"source":"KIS 1m OHLC"}
            day["pathBackfilledAt"]=datetime.now(KST).isoformat()
            with gzip.open(p,"wt",encoding="utf-8",compresslevel=9) as f:
                json.dump(day,f,ensure_ascii=False,separators=(",",":"))
            changed_files.add(str(p))

    print(json.dumps({
        "candidatePairs":len(pairs),
        "refreshedRows":refreshed,
        "changedFiles":sorted(changed_files),
        "failures":failed[:20],
    },ensure_ascii=False,indent=2))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
