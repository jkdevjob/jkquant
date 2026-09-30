"""③ 비트코인 — 33절처럼 '수익이 언제 생기나'부터. 업비트 KRW-BTC 1시간봉.
비용: 업비트 수수료 0.05% × 2 + 슬리피지 0.01% × 2 = 왕복 0.12%"""
import json, numpy as np
from datetime import datetime
B=json.load(open('data/btc_1h.json'))
COST=0.12
t=[datetime.fromisoformat(b['t']) for b in B]; c=np.array([b['c'] for b in B]); o=np.array([b['o'] for b in B])
r=(c/o-1)*100                                            # 그 한 시간의 수익
print(f"업비트 KRW-BTC 1시간봉 {len(B):,}개 · {B[0]['t'][:10]} ~ {B[-1]['t'][:10]}\n")
print("A. 시간대(KST)별 평균 수익 — 한 시간 보유, 비용 전\n")
hr=np.array([x.hour for x in t]); rows=[]
for h in range(24):
    v=r[hr==h]; tt=v.mean()/(v.std(ddof=1)/np.sqrt(len(v))); rows.append((h,v.mean(),tt,len(v)))
for h,m,tt,n in rows: print(f"  {h:02d}시  {m:+.4f}%  t={tt:+.2f}  {'█'*int(max(0,m)*400)}{'░'*int(max(0,-m)*400)}")
yrs=sorted(set(x.year for x in t))
print("\nB. 가장 강한 연속 구간을 찾지 않고, 사전에 정한 두 구간만 본다 (미국장 22:30~06:00 / 아시아장 09~17시)")
def window(mask,label):
    days={}
    for i in np.where(mask)[0]:
        k=(t[i].date() if t[i].hour>=12 else t[i].date()); days.setdefault(k,[]).append(r[i])
    d=np.array([np.sum(v)-COST for v in days.values()]); g=np.array([np.sum(v) for v in days.values()])
    tt=d.mean()/(d.std(ddof=1)/np.sqrt(len(d)))
    print(f"  {label}: {len(d)}일 · 비용 전 {g.mean():+.3f}% · 비용 후 {d.mean():+.3f}%/일 · 승률 {(d>0).mean()*100:.0f}% · t={tt:.2f}")
us=(hr>=23)|(hr<6); asia=(hr>=9)&(hr<17)
window(us,'미국장 시간 보유 (23~06시)'); window(asia,'아시아장 시간 보유 (09~17시)')
print("\nC. 24시간 급락 반등 — 직전 24시간 −X% 이하면 다음 시간 시가 매수 → 24시간 보유")
for X in (3,5,8):
    ret=[]; i=24
    while i<len(c)-25:
        drop=(c[i-1]/c[i-25]-1)*100
        if drop<=-X:
            ret.append((c[i+23]/o[i]-1)*100-COST); i+=24
        else: i+=1
    ret=np.array(ret)
    if len(ret)>5:
        tt=ret.mean()/(ret.std(ddof=1)/np.sqrt(len(ret)))
        h=len(ret)//2
        print(f"  −{X}% 이하: {len(ret)}회 · 비용 후 {ret.mean():+.3f}%/회 · 승률 {(ret>0).mean()*100:.0f}% · t={tt:.2f} · 전반 {ret[:h].mean():+.2f} / 후반 {ret[h:].mean():+.2f}")
bh=(c[-1]/c[0]-1)*100
print(f"\n  참고: 같은 기간 단순보유 {bh:+.1f}%")
