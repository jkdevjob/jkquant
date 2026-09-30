#!/usr/bin/env python3
"""Save the intraday Top100 universe snapshot used by the day-trading research.

The snapshot is taken around 10:00 KST and is immutable for that date.  Later
backtests may only use signals after the saved snapshot time, so end-of-day
turnover rankings are never used to decide an earlier entry.
"""
from __future__ import annotations
import json, os, urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE=os.environ.get("JKQ_BASE_URL","https://jkquant.pages.dev").rstrip("/")
LIMIT=int(os.environ.get("JKQ_UNIVERSE_LIMIT","100"))
KST=ZoneInfo("Asia/Seoul")

def get_json(path):
    req=urllib.request.Request(BASE+path,headers={"Accept":"application/json","User-Agent":"jkquant-daytrade-snapshot/1.0"})
    with urllib.request.urlopen(req,timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    now=datetime.now(KST)
    date=os.environ.get("JKQ_DATE",now.strftime("%Y-%m-%d"))
    out=Path("data")/"daytrading-universe"/date[:4]/f"{date}.json"
    if out.exists():
        print(f"{out} already exists; keep the first snapshot.")
        return 0

    j=get_json(f"/api/universe?limit={LIMIT}")
    rows=j.get("universe") or []
    if not rows:
        raise SystemExit("Universe is empty.")

    snap_hm=now.hour*100+now.minute
    payload={
        "schema":1,
        "date":date,
        "snapshotAt":now.isoformat(),
        "snapshotHm":snap_hm,
        "limit":LIMIT,
        "source":j.get("source") or "",
        "universe":[{
            "rank":i+1,
            "code":str(x.get("code") or ""),
            "name":x.get("name") or str(x.get("code") or ""),
            "market":x.get("market") or "",
            "amount":x.get("amount") or 0,
            "cap":x.get("cap") or 0,
            "chg":x.get("chg") or 0,
            "price":x.get("close") or 0,
        } for i,x in enumerate(rows) if x.get("code")]
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Wrote {out}: {len(payload['universe'])} symbols, snapshotHm={snap_hm}")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
