#!/usr/bin/env python3
import gzip, json, math, sys, tempfile, types
from datetime import datetime, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def load_mutated(rel,repls,name):
    src=(ROOT/rel).read_text(encoding="utf-8")
    for old,new in repls:
        if old not in src:
            raise AssertionError(f"mutation anchor missing: {old}")
        src=src.replace(old,new,1)
    mod=types.ModuleType(name)
    mod.__file__=str(ROOT/rel)
    sys.modules[name]=mod
    exec(compile(src,str(ROOT/rel),"exec"),mod.__dict__)
    return mod

def hour_bar(dt,o=100.0,c=100.0):
    return {"tKst":dt.isoformat(timespec="seconds"),"tUtc":(dt-timedelta(hours=9)).isoformat(timespec="seconds"),
            "o":o,"h":max(o,c),"l":min(o,c),"c":c,"v":1.0}

def btc_fixture(drop=94.0,entry=95.0,exit_px=99.75):
    start=datetime(2026,1,1)
    bars=[]
    for i in range(50):
        o=c=100.0
        if i==24:o=c=drop
        elif i==25:o=c=entry
        elif 25<i<48:o=c=entry
        elif i==48:o=c=exit_px
        bars.append(hour_bar(start+timedelta(hours=i),o,c))
    return [{"sessionDateUtc":"fixture","bars":bars}]

def btc_probe(mod):
    try:
        cfg=mod.SHADOW_STRATEGIES[0]
        yes=mod.btc_24h_drop_shadow(btc_fixture(),cfg)
        no=mod.btc_24h_drop_shadow(btc_fixture(drop=96.0),cfg)
        if len(yes["trades"])!=1 or len(no["trades"])!=0:return False
        t=yes["trades"][0]
        return (cfg.get("evaluationScope")=="all_available" and cfg.get("ordersAllowed") is False
                and math.isclose(t["drop24hPct"],-6.0,abs_tol=1e-9)
                and math.isclose(t["entryPrice"],95.0,abs_tol=1e-9)
                and math.isclose(t["grossPnlPct"],5.0,abs_tol=1e-9)
                and math.isclose(t["pnlPct"],4.88,abs_tol=1e-9))
    except Exception:
        return False

def write_gz(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(path,"wt",encoding="utf-8") as f:json.dump({"rows":rows},f)

def soxl_probe(mod):
    try:
        cfg=mod.SHADOW_STRATEGIES[0]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"soxl.json.gz"
            write_gz(p,[
                {"date":"2026-01-02","open":100.0,"high":105.0,"low":98.0,"close":104.0,"adjClose":104.0},
                {"date":"2026-01-03","open":104.0,"high":106.0,"low":103.0,"close":105.0,"adjClose":105.0},
            ])
            old=mod.SOXL_DAILY;mod.SOXL_DAILY=p
            try:r=mod.soxl_oversold_shadow(cfg,["2026-01-01","2026-01-02"],{"2026-01-01":20.0,"2026-01-02":37.0})
            finally:mod.SOXL_DAILY=old
        if len(r["trades"])!=1 or r["evaluationDays"]!=2:return False
        t=r["trades"][0]
        return (cfg.get("evaluationScope")=="all_available" and cfg.get("ordersAllowed") is False
                and t["date"]=="2026-01-02" and math.isclose(t["soxxPrevRsi14"],20.0,abs_tol=1e-12)
                and math.isclose(t["grossPnlPct"],4.0,abs_tol=1e-12)
                and math.isclose(t["pnlPct"],3.8,abs_tol=1e-12)
                and t["reason"]=="same_day_close" and t["evidence"]["overnightHold"] is False)
    except Exception:
        return False

btc0=load_mutated("scripts/backtest_crypto_orb.py",[],"btc_prod_probe")
sx0=load_mutated("scripts/backtest_soxl_intraday.py",[],"sx_prod_probe")
if not btc_probe(btc0) or not soxl_probe(sx0):
    print("✗ production D-3/D-4 value probe failed");raise SystemExit(1)

mutations=[
 ("D-3 all stored dates — old 2026-10-01 gate", "btc",
  [('entry_date = bars[i]["tKst"][:10]','entry_date = bars[i]["tKst"][:10]\n        if entry_date < "2026-10-01":\n            i += 1\n            continue')]),
 ("D-3 drop threshold must stay -5%", "btc",
  [('"drop24hPctMax": -5.0','"drop24hPctMax": -3.0')]),
 ("D-3 friction must stay 0.12%", "btc",
  [('"frictionPct": 0.12','"frictionPct": 0.00')]),
 ("D-3 entry must be next 1h open", "btc",
  [('entry = float(bars[i]["o"] or 0)','entry = float(bars[i - 1]["c"] or 0)')]),
 ("D-4 all stored dates — old 2026-10-01 gate", "soxl",
  [('date = str(row.get("date") or "")','date = str(row.get("date") or "")\n        if date < "2026-10-01":\n            continue')]),
 ("D-4 RSI threshold must stay <35", "soxl",
  [('"soxxPrevRsiMax": 35.0','"soxxPrevRsiMax": 40.0')]),
 ("D-4 friction must stay 0.20%", "soxl",
  [('"frictionPct": 0.20','"frictionPct": 0.00')]),
 ("D-4 must use prior SOXX day (no lookahead)", "soxl",
  [('i = bisect_left(dates, date) - 1','i = bisect_left(dates, date)')]),
 ("D-4 exit must be same-day close", "soxl",
  [('exit_px = float(row.get("close") or 0)','exit_px = float(row.get("open") or 0)')]),
]
fail=0
for idx,(label,kind,repls) in enumerate(mutations):
    mod=load_mutated("scripts/backtest_crypto_orb.py" if kind=="btc" else "scripts/backtest_soxl_intraday.py",
                     repls,f"mut_{kind}_{idx}")
    survived=btc_probe(mod) if kind=="btc" else soxl_probe(mod)
    if survived:
        print("✗ mutation survived:",label);fail+=1
    else:
        print("✓ mutation killed:",label)
print(f"{len(mutations)-fail}/{len(mutations)} PASS")
raise SystemExit(1 if fail else 0)
