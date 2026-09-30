"""④ SOXL — 반도체 지수(SOXX) 과매도 → SOXL 시가 매수 → 당일 종가. 비용 왕복 0.20%(SOXL_SCALPING.md 기준).
RSI 는 분할조정가(Adj Close)로 계산 — SOXL 은 분할 이력이 있어 원가격으로 RSI 를 내면 분할일에 가짜 폭락이 생긴다.
장중 수익은 같은 날 시가/종가 비율이라 분할과 무관."""
import warnings; warnings.filterwarnings('ignore')
import FinanceDataReader as fdr, numpy as np, pandas as pd
S=fdr.DataReader('SOXL','2010-01-01','2026-09-29'); X=fdr.DataReader('SOXX','2010-01-01','2026-09-29')
print(f"SOXL {len(S)}봉 · Close≠AdjClose 비율 {(abs(S.Close-S['Adj Close'])/S.Close>0.01).mean()*100:.0f}% (분할 조정 차이 확인)")
def rsi(s,n=14):
    d=s.diff(); u=d.clip(lower=0).ewm(alpha=1/n,adjust=False).mean(); l=(-d.clip(upper=0)).ewm(alpha=1/n,adjust=False).mean()
    return 100-100/(1+u/l)
X['rsi']=rsi(X['Adj Close']); S['rsi']=rsi(S['Adj Close'])
df=S[['Open','Close']].join(X[['rsi']].rename(columns={'rsi':'xr'})).join(S[['rsi']].rename(columns={'rsi':'sr'}))
df['xr_prev']=df.xr.shift(1); df['sr_prev']=df.sr.shift(1)
df['ret']=(df.Close/df.Open-1)*100; df=df.dropna()
COST=0.20
def rep(m,label):
    v=(df.ret[m]-COST).values
    if len(v)<15: print(f"  {label}: 표본부족 {len(v)}"); return
    t=v.mean()/(v.std(ddof=1)/np.sqrt(len(v))); h=len(v)//2
    yrs=df[m].groupby(df[m].index.year).ret.apply(lambda s:(s-COST).mean())
    print(f"  {label}: {len(v)}일 · 비용 전 {df.ret[m].mean():+.3f}% · 비용 후 {v.mean():+.3f}% · 승률 {(v>0).mean()*100:.0f}% · t={t:.2f} · 전반 {v[:h].mean():+.2f} / 후반 {v[h:].mean():+.2f}")
    return yrs
print("\n④ SOXL 탭 — 시가 매수 → 당일 종가\n")
rep(df.index==df.index,'대조: 매일')
for th in (30,35,40):
    y=rep(df.xr_prev<th,f'SOXX RSI<{th}')
y=rep(df.xr_prev<30,'SOXX RSI<30')
print("    연도별 "+" ".join(f"{str(k)[2:]}:{v:+.2f}" for k,v in y.items()))
print()
rep(df.sr_prev<30,'SOXL 자체 RSI<30')
print("\n  참고 — 31절 방식(과매도 → 5일 보유)을 SOXL에 그대로 대면:")
c=S['Adj Close'].values; o=S['Open'].values/ (S['Close']/S['Adj Close']).values
xr=X['rsi'].reindex(S.index).values
r5=[]; i=15
while i<len(c)-6:
    if xr[i-1]<30: r5.append((c[i+4]/o[i]-1)*100-COST); i+=5
    else: i+=1
r5=np.array(r5); t=r5.mean()/(r5.std(ddof=1)/np.sqrt(len(r5)))
print(f"  SOXX RSI<30 → 5일: {len(r5)}회 · 비용 후 {r5.mean():+.2f}%/회 · 승률 {(r5>0).mean()*100:.0f}% · t={t:.2f} · 최악 {r5.min():+.1f}%")
print("\n  잭나이프 — 연도 하나씩 빼기 (SOXX RSI<35, 당일)")
m=df.xr_prev<35; base=(df.ret[m]-COST)
for y in sorted(set(df[m].index.year)):
    v=base[base.index.year!=y].values; t=v.mean()/(v.std(ddof=1)/np.sqrt(len(v)))
    if abs(t-1.86)>0.4 or y in (2020,2022,2025): print(f"    {y}년 제외: {len(v)}일 · {v.mean():+.3f}% · t={t:.2f}")
v=base[~base.index.year.isin([2020,2022,2025])].values; t=v.mean()/(v.std(ddof=1)/np.sqrt(len(v)))
print(f"    2020·2022·2025 셋 다 제외: {len(v)}일 · {v.mean():+.3f}% · t={t:.2f}")
