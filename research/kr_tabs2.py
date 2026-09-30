"""① 시초가: 과매도+갭하락 → 시가 매수 → 종가   ② 데이트레이딩: 코스피 급락 다음날 대형주 → 시가 매수 → 종가
2,752종목 · 상폐 213 포함 · 2018-06~2026-09 · 비용: 거래세 0.20 + 수수료 0.03 + 동시호가 1.5틱×2
미래 차단: 신호는 전일 종가까지 + 당일 시가(시가에 체결하므로 시가 자체는 판단에 써도 된다)"""
import json, glob, numpy as np, random
from config import tick_size
random.seed(7)
import sys
SLIP=float(sys.argv[1]) if len(sys.argv)>1 else 1.5
def cost(px, mk): return 0.23 + 2*SLIP*tick_size(px, mk)/px*100

D={}   # date -> list of rows
for f in glob.glob('data/daily/*.json'):
    r=json.load(open(f)); o=r['ohlc']; mk=r['market']
    if len(o)<80: continue
    C=np.array([b['c'] for b in o],float)
    d=np.diff(C,prepend=C[0]); up=np.clip(d,0,None); dn=np.clip(-d,0,None)
    au=np.zeros(len(C)); ad=np.zeros(len(C))
    for i in range(1,len(C)):
        k=1/14 if i>14 else 1/i
        au[i]=au[i-1]*(1-k)+up[i]*k; ad[i]=ad[i-1]*(1-k)+dn[i]*k
    rsi=np.where(ad>0,100-100/(1+au/np.maximum(ad,1e-12)),100)
    for i in range(61,len(o)):
        p,c=o[i-1],o[i]
        if p['halt'] or c['halt'] or p['c']<1000 or c['o']<=0: continue
        turn=p['c']*p['v']/1e8
        avg60=np.mean([b['c']*b['v'] for b in o[i-61:i-1]])/1e8
        if turn<20: continue                                  # 전일 거래대금 20억 이상
        gap=(c['o']/p['c']-1)*100
        if gap<=-29 or gap>=29: continue                      # 상·하한가 시가 제외
        D.setdefault(c['date'],[]).append(dict(code=r['code'],mk=mk,rsi=rsi[i-1],gap=gap,turn=turn,
            px=c['o'], avg60=avg60, ret=(c['c']/c['o']-1)*100, cost=cost(c['o'],mk)))
dates=sorted(D)
# 코스피 대용: 유니버스 전체 동일가중 전일 등락 (KODEX200 일봉과 교차확인은 아래)
L=json.load(open('/tmp/claude-0/-home-user-jkquant/c28a5d7f-3934-585a-8930-9a274ca037dd/scratchpad/long.json'))['KODEX200']
kchg={}; 
for a,b in zip(L,L[1:]): kchg[b['date']]=(b['close']/a['close']-1)*100
kd=sorted(kchg); prevK={kd[i]:kchg[kd[i-1]] for i in range(1,len(kd))}   # 오늘 날짜 → 전일 지수 등락

def run(pick, label, n=3):
    out=[]
    for d in dates:
        c=pick(d, D[d])
        if not c: continue
        c=c[:n]
        out.append((d, np.mean([x['ret']-x['cost'] for x in c]), np.mean([x['ret'] for x in c]), len(c)))
    return out
def ctl(filt, n=3, seeds=20):
    res=[]
    for s in range(seeds):
        random.seed(100+s); out=[]
        for d in dates:
            u=filt(d, D[d])
            if not u: continue
            c=random.sample(u,min(n,len(u)))
            out.append(np.mean([x['ret']-x['cost'] for x in c]))
        res.append(np.mean(out))
    return np.mean(res), np.std(res)
def rep(out, label):
    if len(out)<20: print(f"  {label}: 표본부족 {len(out)}일"); return
    v=np.array([x[1] for x in out]); g=np.array([x[2] for x in out])
    t=v.mean()/(v.std(ddof=1)/np.sqrt(len(v)))
    h=len(v)//2; nxt=[x[1] for x in out if x[0]>='2025-03-04']
    yrs={}
    for x in out: yrs.setdefault(x[0][:4],[]).append(x[1])
    print(f"  {label}")
    print(f"    거래일 {len(v)} · 비용 전 {g.mean():+.3f}% · 비용 후 {v.mean():+.3f}%/일 · 승률 {(v>0).mean()*100:.0f}% · t={t:.2f}")
    print(f"    전반 {v[:h].mean():+.3f} · 후반 {v[h:].mean():+.3f} · NXT 이후 {np.mean(nxt) if nxt else float('nan'):+.3f} ({len(nxt)}일)")
    print(f"    연도별 " + " ".join(f"{y[2:]}:{np.mean(a):+.2f}" for y,a in sorted(yrs.items())))
    print(f"    2,000만원 고정 · 8년 누적 {v.sum()*2e7/100/1e4:+,.0f}만원")

print("① 시초가 탭 — 과매도(RSI<30) + 갭 −2% 이하 → 시가 매수 → 종가 (갭 깊은 순 3종목)\n")
f1=lambda d,u: sorted([x for x in u if x['rsi']<30 and x['gap']<=-2], key=lambda x:x['gap'])
o1=run(f1,'①'); rep(o1,'전략')
m,s=ctl(lambda d,u:[x for x in u if x['gap']<=-2]); print(f"  대조① 같은 날 갭 −2% 이하 무작위 3 (씨앗20): {m:+.3f}% ± {s:.3f}")
m,s=ctl(lambda d,u:u);                             print(f"  대조② 같은 날 아무 종목 무작위 3 (씨앗20):   {m:+.3f}% ± {s:.3f}")

print("\n② 데이트레이딩 탭 — 전일 지수 −2% 이하 → 60일 평균 거래대금 상위 20 대형주(1만원↑) 시가 매수 → 종가\n")
f2=lambda d,u: (sorted([x for x in u if x['px']>=10000], key=lambda x:-x['avg60'])[:20]) if prevK.get(d,0)<=-2 else []
o2=run(f2,'②',n=20); rep(o2,'전략')
f2b=lambda d,u: (sorted([x for x in u if x['px']>=10000], key=lambda x:-x['avg60'])[:20])
o2b=run(f2b,'②b',n=20); v=np.array([x[1] for x in o2b]); print(f"  대조 매일 같은 바스켓: {v.mean():+.3f}%/일 (t={v.mean()/(v.std(ddof=1)/np.sqrt(len(v))):.2f}, {len(v)}일)")
for th in (-1,-1.5,-3):
    o=run(lambda d,u,th=th:(sorted([x for x in u if x['px']>=10000],key=lambda x:-x['avg60'])[:20]) if prevK.get(d,0)<=th else [],'',n=20)
    v=np.array([x[1] for x in o]); print(f"  민감도 전일 지수 ≤{th}%: {len(v)}일 · {v.mean():+.3f}%/일 · t={v.mean()/(v.std(ddof=1)/np.sqrt(len(v))):.2f}")
