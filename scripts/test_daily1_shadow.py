#!/usr/bin/env python3
import importlib.util
from pathlib import Path

SPEC=importlib.util.spec_from_file_location("d1",Path(__file__).with_name("daily1_shadow_lab.py"))
m=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(m)


def kbar(date,hm,o,h,l,c,v=100):
    return {"t":date.replace("-","")+f"{hm:04d}00","o":o,"h":h,"l":l,"c":c,"v":v}


def test_opening():
    date="2026-10-01"
    bars=[]
    vals={900:(10000,10020,9920,9950),901:(9950,9970,9880,9900),902:(9900,9930,9850,9880),
          903:(9880,9920,9870,9900),904:(9900,9940,9890,9920),905:(9920,9950,9900,9910),
          906:(9910,9960,9900,9940),907:(9940,10000,9930,9980),908:(9980,10120,9980,10100),
          909:(10110,10140,10100,10120),910:(10120,10320,10110,10300)}
    for h in range(900,1001):
        mm=h%100
        if mm>=60: continue
        if h in vals:o,hi,lo,c=vals[h]
        else:o=hi=lo=c=10300.0
        bars.append(kbar(date,h,o,hi,lo,c,300 if h==908 else 100))
    row={"rank":1,"code":"000001","name":"테스트","open":10000,"prevClose":10400,"bars":bars}
    t=m.opening_candidate({"date":date},row)
    assert t and t["signalTime"]==908,t
    assert t["entryTime"]==909,t
    assert t["pnlPct"]>1.0,t


def minute_bars(date,start=900,end=1520):
    out=[];h=9;mm=0
    while h*100+mm<=end:
        hm=h*100+mm
        out.append(kbar(date,hm,100,100.1,99.9,100,100))
        mm+=1
        if mm>=60:h+=1;mm=0
    return out


def test_daytrading():
    date="2026-10-01"
    bars=minute_bars(date)
    by={int(x["t"][-6:-2]):x for x in bars}
    # Build positive session then a VWAP dip/reclaim at 10:06.
    for h,c in [(1000,100.8),(1001,100.9),(1002,101.0),(1003,101.1),(1004,101.2),(1005,100.5),(1006,101.6),(1007,101.7)]:
        z=by[h];z.update(o=c,h=c+.1,l=c-.1,c=c,v=300 if h==1006 else 100)
    by[1008].update(o=101.8,h=103.6,l=101.7,c=103.3,v=100)
    bench=minute_bars(date)
    day={"date":date,"snapshotHm":955,"benchmarks":[{"code":"069500","bars":bench},{"code":"229200","bars":bench}]}
    row={"rank":1,"code":"000002","name":"RS테스트","bars":bars}
    t=m.day_candidate(day,row)
    assert t and t["signalTime"]==1006,t
    assert t["entryTime"]==1007,t
    assert t["relativeStrengthPctPoint"]>=1.0,t
    assert t["pnlPct"]>1.0,t


def t5(i,date="2026-10-01",o=100,h=100.2,l=99.8,c=100,v=100,zone="kst"):
    mins=i*5; hh=mins//60; mm=mins%60
    ts=f"{date}T{hh:02d}:{mm:02d}:00+09:00"
    return {"tKst":ts,"tUtc":ts,"o":o,"h":h,"l":l,"c":c,"v":v}


def test_crypto():
    a=[t5(i) for i in range(288)]
    # Signal bar 01:00 (i=12): prior 60m peak ~100.2, low 98.4 = flush; strong reclaim/volume.
    a[11].update(h=100.4,c=99.8)
    a[12].update(o=99.0,h=100.8,l=98.4,c=100.6,v=220)
    a[13].update(o=100.7,h=100.9,l=100.6,c=100.8,v=100)
    a[14].update(o=100.8,h=102.3,l=100.7,c=102.0,v=100)
    t=m.crypto_candidate({"date":"2026-10-01","bars":a})
    assert t and t["signalTime"]==100,t
    assert t["entryTime"]==105,t
    assert t["pnlPct"]>1.0,t


def et5(i,date="2026-10-01",c=100,v=100):
    total=9*60+30+i*5; hh=total//60; mm=total%60
    ts=f"{date}T{hh:02d}:{mm:02d}:00-04:00"
    return {"tEt":ts,"o":c,"h":c+.1,"l":c-.1,"c":c,"v":v}


def test_soxl():
    a=[et5(i) for i in range(78)]
    # First 30m +1.2%.
    for i in range(6):
        c=100+0.24*i
        a[i].update(o=c if i else 100,h=c+.1,l=c-.1,c=c)
    # 14:30..15:00 momentum and breakout. index 60=14:30, 66=15:00.
    for i in range(60,66):
        c=101.2+(i-60)*0.08
        a[i].update(o=c,h=c+.08,l=c-.08,c=c,v=100)
    a[66].update(o=101.65,h=102.15,l=101.6,c=102.1,v=180)
    a[67].update(o=102.2,h=102.4,l=102.1,c=102.3,v=100)
    a[68].update(o=102.3,h=104.5,l=102.2,c=104.2,v=100)
    t=m.soxl_candidate({"sessionDateEt":"2026-10-01","bars":a})
    assert t and t["signalTime"]==1500,t
    assert t["entryTime"]==1505,t
    assert t["pnlPct"]>1.0,t


def test_metrics():
    trades=[{"date":"2026-10-01","pnlPct":2.2},{"date":"2026-10-02","pnlPct":-0.5}]
    z=m.metrics(trades,["2026-10-01","2026-10-02","2026-10-03"],1)
    assert z["plus1Days"]==1,z
    assert z["tradeDays"]==2,z
    assert z["worstDayPct"]==-0.5,z


if __name__=="__main__":
    test_opening();test_daytrading();test_crypto();test_soxl();test_metrics()
    print("daily1 shadow strategies: PASS")
