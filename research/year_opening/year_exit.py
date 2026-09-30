"""같은 244건 진입(운영 규칙 그대로)에서 청산만 바꾼다. 9:30 이후는 일봉으로 판정(보수적: 손절은 당일 저가로)."""
import json, numpy as np
T=json.load(open('year_opening_trades.json')); D=json.load(open('daily8y.json'))
TICK=[(2000,1),(5000,5),(20000,10),(50000,50),(200000,100),(500000,500),(1e12,1000)]
tick=lambda p: next(t for u,t in TICK if p<u)
def fric(p, etf): return (0.03 if etf else 0.23) + 2*2.5*tick(p)/p*100
ds=sorted(set(x['date'] for x in T)); mid=ds[len(ds)//2]
rows=[]
for x in T:
    o=D[x['code']]['ohlc']; i=next((k for k,b in enumerate(o) if b['date']==x['date']),None)
    if i is None or i+1>=len(o): continue
    d,n=o[i],o[i+1]; e=x['entry']; etf=('KODEX' in x['name'] or 'TIGER' in x['name'] or 'KBSTAR' in x['name'] or 'ACE ' in x['name'] or 'SOL ' in x['name'] or 'RISE' in x['name'])
    stopped = d['low'] <= e*0.99
    g={'09:30 (현행)': x['gross'],
       '당일 종가 · 손절 없음': (d['close']/e-1)*100,
       '당일 종가 · 손절 −1%': -1.0-0.3 if stopped else (d['close']/e-1)*100,
       '당일 종가 · 손절 −2%': -2.0-0.3 if d['low']<=e*0.98 else (d['close']/e-1)*100,
       '다음날 시가 (오버나잇)': (n['open']/e-1)*100,
       '다음날 종가 (1박)': (n['close']/e-1)*100}
    rows.append((x['date'],etf,e,g))
def rep(label, key, filt=lambda r:True):
    xs=[(dt,g[key]-fric(e,etf)) for dt,etf,e,g in rows if filt((dt,etf,e,g))]
    if len(xs)<5: return
    v=np.array([b for _,b in xs]); by={}
    for dt,b in xs: by.setdefault(dt,[]).append(b)
    dv=np.array([np.mean(a) for a in by.values()]); t=dv.mean()/(dv.std(ddof=1)/np.sqrt(len(dv)))
    h1=[b for dt,b in xs if dt<mid]; h2=[b for dt,b in xs if dt>=mid]
    gross=np.mean([g[key] for dt,etf,e,g in rows if filt((dt,etf,e,g))])
    ok='◀ 양쪽 +' if h1 and h2 and np.mean(h1)>0 and np.mean(h2)>0 else ''
    print(f"  {label:<24}{len(v):>5}{(v>0).mean()*100:>6.0f}%{gross:>+8.2f}{v.mean():>+8.2f}{t:>7.2f}   {np.mean(h1) if h1 else 0:>+7.2f}({len(h1)}) {np.mean(h2) if h2 else 0:>+7.2f}({len(h2)})  {ok}")
H=f"  {'청산 방식':<24}{'건수':>5}{'승률':>7}{'비용전':>8}{'비용후':>8}{'t(일)':>7}   {'앞절반':>10} {'뒷절반':>10}"
print("같은 진입 · 청산만 변경 — 전체\n"+H)
for k in rows[0][3]: rep(k,k)
print("\n국내 ETF만 (거래세 0 → 비용이 훨씬 낮다) — "+str(sum(1 for r in rows if r[1]))+"건\n"+H)
for k in rows[0][3]: rep(k,k,lambda r:r[1])
print("\n개별주만 — "+str(sum(1 for r in rows if not r[1]))+"건\n"+H)
for k in rows[0][3]: rep(k,k,lambda r:not r[1])
