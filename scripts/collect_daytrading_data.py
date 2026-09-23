#!/usr/bin/env python3
"""Collect full Korean-session minute bars for the saved day-trading universe.

Input:
  data/daytrading-universe/YYYY/YYYY-MM-DD.json
Output:
  data/daytrading/YYYY/YYYY-MM-DD.json.gz

KIS minute-history returns up to ~120 minutes ending at a requested clock time,
so four windows are merged and de-duplicated to cover 09:00~15:20 KST.
"""
from __future__ import annotations
import gzip, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE=os.environ.get("JKQ_BASE_URL","https://jkquant.pages.dev").rstrip("/")
KST=ZoneInfo("Asia/Seoul")
WINDOWS=("105900","125900","145900","152000")

def get_json(path,timeout=90):
    req=urllib.request.Request(BASE+path,headers={"Accept":"application/json","User-Agent":"jkquant-daytrade-collector/1.0"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def minhist(code,date_compact,hour):
    qs=urllib.parse.urlencode({"op":"minhist","code":code,"date":date_compact,"hour":hour})
    last=None
    for attempt in range(5):
        try:
            j=get_json("/api/kis?"+qs,timeout=90)
            if j.get("error"):
                last=RuntimeError(str(j.get("error")))
                if j.get("rateLimited"):
                    time.sleep(1.2+attempt*0.8)
                    continue
                raise last
            return j.get("bars") or [],None
        except Exception as e:
            last=e
            time.sleep(1.0+attempt*0.8)
    return [],str(last)

def collect_symbol(code,date_compact):
    by={}
    errs=[]
    for hour in WINDOWS:
        bars,err=minhist(code,date_compact,hour)
        if err:
            errs.append(f"{hour}: {err}")
        for b in bars:
            t=str(b.get("t") or "")
            if not t.startswith(date_compact):
                continue
            hhmmss=t[-6:]
            if not ("090000"<=hhmmss<="152000"):
                continue
            c=float(b.get("c") or 0)
            if c<=0:
                continue
            by[t]={
                "t":t,
                "o":float(b.get("o") or c),
                "h":float(b.get("h") or c),
                "l":float(b.get("l") or c),
                "c":c,
                "v":float(b.get("v") or 0),
            }
        # KIS VTS is typically 2 reads/sec; stay under it.
        time.sleep(0.62)
    return [by[k] for k in sorted(by)],"; ".join(errs) if errs else None

def main():
    now=datetime.now(KST)
    date=os.environ.get("JKQ_DATE",now.strftime("%Y-%m-%d"))
    compact=date.replace("-","")
    snap=Path("data")/"daytrading-universe"/date[:4]/f"{date}.json"
    if not snap.exists():
        print(f"No universe snapshot: {snap}; skip this date.")
        return 0

    src=json.loads(snap.read_text(encoding="utf-8"))
    universe=src.get("universe") or []
    if not universe:
        print("Snapshot universe is empty.")
        return 1

    out_rows=[]; errors=[]; success=0
    for i,u in enumerate(universe,1):
        code=str(u.get("code") or "")
        if not code:
            continue
        bars,err=collect_symbol(code,compact)
        if bars:
            success+=1
        if err:
            errors.append({"rank":u.get("rank") or i,"code":code,"error":err})
        out_rows.append({**u,"bars":bars})
        print(f"{i:03d}/{len(universe)} {code} bars={len(bars)}")
        time.sleep(0.12)

    if success==0:
        print(f"{date}: no full-day bars; holiday/no-session.")
        return 0

    required=max(1,int(len(universe)*0.90))
    if success<required:
        print(f"Only {success}/{len(universe)} symbols collected; require >= {required}.",file=sys.stderr)
        print(json.dumps(errors[:20],ensure_ascii=False,indent=2),file=sys.stderr)
        return 2

    payload={
        "schema":1,
        "date":date,
        "snapshotAt":src.get("snapshotAt"),
        "snapshotHm":int(src.get("snapshotHm") or 1000),
        "universeSource":src.get("source") or "",
        "universeLimit":src.get("limit") or len(universe),
        "collectedAt":datetime.now(KST).isoformat(),
        "successful":success,
        "errors":errors,
        "universe":out_rows,
    }
    out=Path("data")/"daytrading"/date[:4]/f"{date}.json.gz"
    out.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(out,"wt",encoding="utf-8",compresslevel=9) as gz:
        json.dump(payload,gz,ensure_ascii=False,separators=(",",":"))
    print(f"Wrote {out} ({out.stat().st_size:,} bytes), success {success}/{len(universe)}")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
