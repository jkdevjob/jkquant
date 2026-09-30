import json, numpy as np, sys
T = json.load(open('data/full_year_trades.json'))
ds = sorted(set(x['date'] for x in T)); mid = ds[len(ds)//2]
def stat(xs, key):
    xs = [x for x in xs if x.get(key) is not None]
    if len(xs) < 5: return None
    v = np.array([x[key] for x in xs]); by = {}
    for x in xs: by.setdefault(x['date'], []).append(x[key])
    dv = np.array([np.mean(a) for a in by.values()]); t = dv.mean() / (dv.std(ddof=1) / np.sqrt(len(dv))) if len(dv) > 2 else float('nan')
    h1 = [x[key] for x in xs if x['date'] < mid]; h2 = [x[key] for x in xs if x['date'] >= mid]
    return dict(n=len(v), days=len(dv), win=(v > 0).mean() * 100, avg=v.mean(), dayavg=dv.mean(), t=t, h1=np.mean(h1) if h1 else float('nan'), h2=np.mean(h2) if h2 else float('nan'))
def row(lab, s):
    if not s: print(f"  {lab:<30} 표본부족"); return
    both = '◀ 양쪽+' if s['h1'] > 0 and s['h2'] > 0 else ''
    print(f"  {lab:<30}{s['n']:>5}{s['days']:>5}{s['win']:>6.0f}%{s['avg']:>+8.2f}{s['dayavg']:>+8.2f}{s['t']:>7.2f}{s['h1']:>+8.2f}{s['h2']:>+8.2f}  {both}")
H = f"  {'':<30}{'건수':>5}{'일수':>5}{'승률':>7}{'건당':>8}{'날짜평균':>8}{'t(일)':>7}{'앞절반':>8}{'뒷절반':>8}"
print(f"과거 1년 · 전일 거래대금 Top100 ∩ 갭 2~7% · {ds[0]}~{ds[-1]} · {len(ds)}거래일 · 비용 = 세금 0.23 + 호가 2.5틱×2 · 절반 {mid}")
vs = sorted(set(x['v'] for x in T), key=lambda v: (v != 'baseline', v.startswith('CONTROL'), v))
for key, lab in [('net930', '09:30 청산 (현행 규칙)'), ('netClose', '당일 종가 청산'), ('netNextOpen', '다음날 시가 청산')]:
    print(f"\n■ {lab}\n{H}")
    for v in vs: row(v, stat([x for x in T if x['v'] == v], key))
