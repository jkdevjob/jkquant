#!/usr/bin/env python3
from backtest_crypto_orb import Params, trade_for_day, valid_day

DATE="2026-10-01"

def hm_text(minute):
    return f"{minute//60:02d}:{minute%60:02d}"

def make_day(signal_minute):
    bars=[]
    for i in range(288):
        minute=i*5
        t=hm_text(minute)
        o=c=99.0
        h=99.5
        l=98.5
        v=100.0
        if minute==0:
            o,c,h,l,v=95.0,95.0,100.0,94.0,100.0
        if minute==signal_minute-5:
            o,c,h,l,v=99.0,99.0,99.5,98.5,90.0
        if minute==signal_minute:
            o,c,h,l,v=99.0,101.0,101.2,98.8,150.0
        if minute==signal_minute+5:
            o,c,h,l,v=101.0,102.0,102.2,100.8,110.0
        bars.append({
            "tKst":f"{DATE}T{t}:00",
            "tUtc":f"2026-10-01T{t}:00",
            "o":o,"h":h,"l":l,"c":c,"v":v,
        })
    return {"sessionDateKst":DATE,"bars":bars}

p=Params("baseline")
assert p.entry_cutoff_min==21*60+55
day=make_day(21*60+55)
assert valid_day(day)==(True,"")
t=trade_for_day(day,p)
assert t is not None
assert t["strategyVersion"]=="btc_midnight_orb_v2"
assert t["signalTimeKst"]=="21:55"
assert t["entryTimeKst"]=="22:00"

late=trade_for_day(make_day(22*60),p)
assert late is None

bad={"sessionDateKst":DATE,"bars":day["bars"][1:]}
ok,reason=valid_day(bad)
assert not ok and reason in {"too_few_bars","missing_kst_0000"}

print("✓ BTC research 00:00 KST session / 22:00 entry boundary")
