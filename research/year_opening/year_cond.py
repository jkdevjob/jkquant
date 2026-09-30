import json, numpy as np
T=json.load(open('year_opening_trades.json'))
ds=sorted(set(x['date'] for x in T)); mid=ds[len(ds)//2]
def st(xs):
    if not xs: return None
    n=np.array([x['net'] for x in xs]); by={}
    for x in xs: by.setdefault(x['date'],[]).append(x['net'])
    dv=np.array([np.mean(v) for v in by.values()])
    t=dv.mean()/(dv.std(ddof=1)/np.sqrt(len(dv))) if len(dv)>2 else float('nan')
    return dict(n=len(n), win=(n>0).mean()*100, net=n.mean(), gross=np.mean([x['gross'] for x in xs]),
                mfe=np.mean([x['mfe'] for x in xs]), mae=np.mean([x['mae'] for x in xs]), t=t)
def line(lab,xs):
    a=st(xs); h1=st([x for x in xs if x['date']<mid]); h2=st([x for x in xs if x['date']>=mid])
    if not a: return
    f=lambda s:f"{s['net']:+.2f}({s['n']})" if s else "  —   "
    both = h1 and h2 and h1['net']>0 and h2['net']>0
    print(f"  {lab:<22}{a['n']:>5}{a['win']:>6.0f}%{a['gross']:>+8.2f}{a['net']:>+8.2f}{a['mfe']:>+7.2f}{a['mae']:>+7.2f}{a['t']:>7.2f}   {f(h1):>11} {f(h2):>11} {'◀ 양쪽 +' if both else ''}")
hdr=f"  {'조건':<22}{'건수':>5}{'승률':>7}{'비용전':>8}{'비용후':>8}{'MFE':>7}{'MAE':>7}{'t(일)':>7}   {'앞절반':>11} {'뒷절반':>11}"
print(f"운영 규칙 opening_rebreak_v1 · {ds[0]}~{ds[-1]} · {len(ds)}거래일 · 비용 = 세금 0.23 + 호가 2.5틱×2 · 절반 기준 {mid}\n")
print(hdr); line('전체',T)
print("\n  [청산 사유]"); 
for r in ('익절','손절','09:30 청산'): line(r,[x for x in T if x['reason']==r])
print("\n  [진입 시각]")
for lo,hi,l in [(0,910,'09:03~09:10'),(911,920,'09:11~09:20'),(921,930,'09:21~09:30')]: line(l,[x for x in T if lo<=x['entryTime']<=hi])
print("\n  [갭]")
for lo,hi in [(2,3),(3,4),(4,5),(5,7.01)]: line(f'{lo}~{hi:.0f}%',[x for x in T if lo<=x['gap']<hi])
print("\n  [눌림폭]")
for lo,hi in [(.3,.5),(.5,.7),(.7,1.01)]: line(f'{lo}~{hi:.1f}%',[x for x in T if lo<=x['pullback']<hi])
print("\n  [재돌파 거래대금 배수]")
q=np.quantile([x['amountRatio'] for x in T],[1/3,2/3])
for lo,hi,l in [(0,q[0],'하위 3분의1'),(q[0],q[1],'중간'),(q[1],1e9,'상위 3분의1')]: line(f'{l} ({lo:.1f}~{min(hi,99):.1f}배)',[x for x in T if lo<=x['amountRatio']<hi])
print("\n  [주가 — 호가 비용이 가격대마다 다르다]")
for lo,hi,l in [(0,10000,'1만원 미만'),(10000,50000,'1만~5만'),(50000,1e12,'5만원 이상')]:
    xs=[x for x in T if lo<=x['entry']<hi]; line(l+(f" 비용{np.mean([x['fric'] for x in xs]):.2f}%" if xs else ''),xs)
print("\n  [전일 코스피(KODEX200)]")
line('전일 하락',[x for x in T if x['kPrev'] is not None and x['kPrev']<0]); line('전일 상승',[x for x in T if x['kPrev'] is not None and x['kPrev']>=0])
