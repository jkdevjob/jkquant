#!/usr/bin/env python3
"""Backfill same-day close outcomes for the D-1 opening selloff shadow.

Research/data only. It reads archived shadow signals and fills their close/PnL
after the Korean session has ended. It never sends broker orders.
"""
from __future__ import annotations
import json, os, urllib.parse, urllib.request
from pathlib import Path

BASE=os.environ.get("JKQ_BASE_URL","https://jkquant.pages.dev").rstrip("/")
ROOT=Path("data/opening-history")
VARIANT="opening_selloff_v1"
EVAL_START="2026-10-01"

def get_json(path, timeout=45):
    req=urllib.request.Request(BASE+path,headers={"Accept":"application/json","User-Agent":"jkquant-opening-shadow-backfill/1.0"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def close_for(code,date):
    qs=urllib.parse.urlencode({"symbol":code,"range":"1y","intraday":"0","div":"0"})
    j=get_json("/api/quote?"+qs)
    for x in j.get("ohlc") or []:
        if str(x.get("date") or "")==date and float(x.get("close") or 0)>0:
            return float(x["close"])
    return None

def fill_trade(t,close_px):
    entry=float(t.get("entryPrice") or 0)
    if not (entry>0 and close_px and close_px>0):
        return False
    friction=t.get("friction") or {}
    fee=friction.get("totalPct")
    if fee is None:
        fee=(t.get("evidence") or {}).get("frictionPct")
    if fee is None:
        return False
    gross=(close_px/entry-1.0)*100.0
    t["exitTime"]=1530
    t["exitPrice"]=close_px
    t["reason"]="same_day_close"
    t["grossPnlPct"]=gross
    t["frictionPct"]=float(fee)
    t["pnl"]=gross-float(fee)
    t["evaluationEligible"]=True
    return True

def main():
    if not ROOT.exists():
        print("opening-history missing; nothing to backfill")
        return 0
    changed=0
    quote_cache={}
    for path in sorted(ROOT.glob("*.json")):
        j=json.loads(path.read_text(encoding="utf-8"))
        date=str(j.get("date") or path.stem)
        if date<EVAL_START:
            continue
        target=next((v for v in j.get("shadowVariants") or [] if v.get("name")==VARIANT),None)
        if not target:
            continue
        touched=False
        for t in target.get("trades") or []:
            if t.get("pnl") is not None:
                continue
            code=str(t.get("code") or "")
            if not code:
                continue
            key=(code,date)
            if key not in quote_cache:
                try: quote_cache[key]=close_for(code,date)
                except Exception as e:
                    print(f"{date} {code} quote failed: {e}")
                    quote_cache[key]=None
            if fill_trade(t,quote_cache[key]):
                touched=True
        if touched:
            by={(str(t.get("code") or ""),int(t.get("entryTime") or 0)):t for t in target.get("trades") or []}
            for rec in j.get("signalRecords") or []:
                if str(rec.get("variant") or "")!=VARIANT:
                    continue
                sig=rec.get("signal") or {}
                key=(str(rec.get("code") or sig.get("code") or ""),int(sig.get("entryTime") or 0))
                if key in by:
                    rec["outcome"]=by[key]
            path.write_text(json.dumps(j,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
            changed+=1
    print(json.dumps({"variant":VARIANT,"evaluationStart":EVAL_START,"filesChanged":changed,"quotes":len(quote_cache)},ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
