#!/usr/bin/env python3
"""텐배거(클로드) 분석 — 코스피·코스닥 30년(1995-05~) 전 종목(상장폐지 포함)으로
'10배 오른 종목의 특징'과 '언제·무엇을 사고 언제 팔았으면 가장 벌었나'를 계산해 화면용 JSON 을 만든다.

순서
  1) panel.py 가 만든 수정주가 패널(날짜×종목)과 industry.py 의 업종·지수를 읽는다.
  2) 텐배거 구간(저점→10배, 5년 안, 살 수 있었던 저점만)을 찾고 저점·경로·고점·고점 뒤를 잰다.
  3) 매달 말 '그때 살 수 있던 모든 종목'의 특징과 그 뒤 결과(5년 안 10배 · 1/3/5년 수익 · 상장폐지)를 표로 만든다
     → 특징별 10배 확률(기저율 대비 배율). 사후에 고른 종목만 보지 않는다(생존편향·선택편향 제거).
  4) 전진(walk-forward) 로지스틱 모형: 그해 첫 결정일 전에 결과가 확정된 과거 행만으로 매년 다시 학습한다.
  5) 매수 신호 × 매도 규칙을 거래 단위로, 최적 후보는 20종목 포트폴리오로 시험한다(비용·정수 주식·상장폐지 포함).
     규칙 고르기는 앞 시기(2003~2012)로만 하고, 뒤 시기(2013~)는 검증으로만 본다.
  6) 오늘(자료 마지막 날) 기준 모형 상위 종목 — 연구용.

쓰는 법
  python scripts/tenbagger_claude/panel.py --marcap <marcap/data> --out /scratch/panel.npz
  python scripts/tenbagger_claude/industry.py --out /scratch/aux.json
  python scripts/tenbagger_claude/analyze.py --panel /scratch/panel.npz --aux /scratch/aux.json \
         --out data/tenbagger/claude/analysis.json
"""
import argparse
import datetime as dt
import json
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import derive, cs_rank, forward_max, carry_dead, LIQ_MIN  # noqa: E402
from episodes import find_episodes  # noqa: E402
from model import fit_logit, predict, auc  # noqa: E402
from signals import RANK_FEATS, AGE_MIN, index_on, drawdown, buy_universe, frame_at, model_cols, score_day  # noqa: E402
import backtest as BT  # noqa: E402
from backtest import Rule, trade_list, portfolio, stats  # noqa: E402

VERSION = '1.0.0'
H5, H3, H1 = 1250, 750, 250
FEAT_KO = {'lcap': '시가총액', 'lraw': '주가 수준', 'lA20': '거래대금(20일)', 'dd3': '3년 고점 대비', 'ret20': '1개월 수익',
           'ret60': '3개월 수익', 'ret250': '1년 수익', 'pos52': '52주 고점 근접', 'low52': '52주 저점 대비', 'vol60': '변동성(60일)',
           'turn': '회전율', 'surge': '거래대금 급증', 'ma200p': '200일선 대비', 'ma200s': '200일선 기울기', 'age': '상장 기간',
           'kosdaq': '코스닥', 'kan': '관리·환기 종목', 'kddn': '코스피 낙폭', 'qddn': '코스닥 낙폭'}
T_SPLIT = '2013-01-01'           # 앞 시기(규칙 고르기) / 뒤 시기(검증)
PORT_START = '2003-01-02'        # 전진 모형 점수가 처음 생기는 해


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def r3(x, k=4):
    if x is None:
        return None
    try:
        if not np.isfinite(x):
            return None
    except TypeError:
        return x
    return round(float(x), k)


def qs(s, ps=(10, 25, 50, 75, 90), k=3):
    s = pd.Series(s, dtype=float).dropna()
    return [r3(np.percentile(s, p), k) for p in ps] if len(s) else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', required=True)
    ap.add_argument('--aux', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--seeds', type=int, default=30)
    ap.add_argument('--model-out', help='전향 시험용 고정 모형(JSON) — 가중치·순위 기준·매매 규칙·백테 기준값')
    a = ap.parse_args()
    t_all = time.time()
    P = dict(np.load(a.panel))
    aux = json.load(open(a.aux, encoding='utf-8'))
    dates = P['dates']
    T, N = P['close'].shape
    end = dates[-1]
    delisted = P['last'] != end
    names, codes, ids = P['names'], P['codes'], P['ids']
    years = np.array([int(d[:4]) for d in dates])
    D = derive(P, delisted)
    C = D['C']
    TR = (np.nan_to_num(P['vol']) > 0) & D['alive']
    last = D['last']
    MA = D['ma200']
    KOSPI = index_on(dates, aux['index']['KOSPI'])
    KOSDAQ = index_on(dates, aux['index']['KOSDAQ'])
    kdd, qdd = drawdown(KOSPI), drawdown(KOSDAQ)
    M0 = buy_universe(D)
    log('패널', T, N, '파생 끝')

    # 종목 이름(그때 이름) — name_hist: id\t시작일\t이름
    nh = {}
    for line in P['name_hist']:
        i, d0, nm = line.split('\t')
        nh.setdefault(i, []).append((d0, nm))

    def name_then(j, t):
        h = nh.get(ids[j], [])
        nm = names[j]
        for d0, n in h:
            if d0 <= dates[t]:
                nm = n
        return nm

    ind = aux.get('industry', {})

    # ── 2) 텐배거 구간 ─────────────────────────────────────────
    eps = []
    for j in range(N):
        a0, b0 = D['first'][j], last[j]
        if b0 - a0 < 60:
            continue
        c = C[a0:b0 + 1, j]
        if np.isnan(c).any():
            c = pd.Series(c).ffill().bfill().values
        cb = D['inv'][a0:b0 + 1, j]
        cs = TR[a0:b0 + 1, j] & ~D['tail'][a0:b0 + 1, j]
        for (t0, t10, tp, te) in find_episodes(c, W=H5, can_buy=cb, can_sell=cs):
            eps.append((j, a0 + t0, a0 + t10, a0 + tp, a0 + te))
    log('텐배거 구간', len(eps))

    def pct_at(Mx, t, j):
        row = Mx[t]
        m = D['inv'][t] & ~np.isnan(row)
        return float((row[m] < Mx[t, j]).mean()) if m.any() else np.nan

    E = []
    for (j, g0, g10, gp, ge) in eps:
        c = C[:, j]
        c0 = c[g0]
        path = c[g0:gp + 1] / c0

        def hit(k):
            w = np.flatnonzero(path >= k)
            return int(w[0]) if len(w) else None
        seg = c[g0:g10 + 1]
        mdd10 = float((seg / np.maximum.accumulate(seg) - 1).min())
        a1, a2 = min(gp + H1, T - 1), min(gp + 500, T - 1)
        ma_pk = MA[gp, j]
        E.append(dict(
            j=j, g0=g0, g10=g10, gp=gp, code=codes[j], name=names[j], name0=name_then(j, g0),
            mkt='코스닥' if D['mkt'][g0, j] == 2 else '코스피', t0=dates[g0], t10=dates[g10], tp=dates[gp],
            peak=c[gp] / c0, d10=g10 - g0, dpk=gp - g0, cap0=D['cap'][g0, j] / 1e8, capP=pct_at(D['cap'], g0, j),
            raw0=D['raw'][g0, j], A20_0=D['A20'][g0, j] / 1e8, dd3_0=c0 / D['hi750'][g0, j] - 1, ret250_0=D['ret250'][g0, j],
            vol60_0=D['vol60'][g0, j], age0=D['age'][g0, j] / 250, t2=hit(2), t3=hit(3), t5=hit(5), mdd10=mdd10,
            cap_pk=D['cap'][gp, j] / 1e8, ma200_pk=c[gp] / ma_pk if ma_pk == ma_pk else np.nan,
            ret60_pk=D['ret60'][gp, j], surge_pk=D['A20'][gp, j] / D['A250'][gp, j],
            after1=c[a1] / c[gp] - 1 if c[a1] == c[a1] else np.nan,
            low2=np.nanmin(c[gp:a2 + 1]) / c[gp] - 1, alive=not delisted[j], qdd0=qdd[g0], kdd0=kdd[g0],
            industry=ind.get(codes[j], '') if not delisted[j] else ''))
    E = pd.DataFrame(E)
    log('구간 특징 끝')

    # ── 3) 월말 코호트 ────────────────────────────────────────
    FM = {H: forward_max(C, H) for H in (H1, H3, H5)}
    CD = carry_dead(C)
    dtx = pd.to_datetime(dates)
    ym = dtx.year * 100 + dtx.month
    ME = np.zeros(T, bool)
    ME[np.flatnonzero(np.r_[ym[1:] != ym[:-1], True])] = True
    ME[-1] = False
    mes = np.flatnonzero(ME & (dtx >= '1996-07-01'))
    rows = []
    for s in mes:
        js = np.flatnonzero(D['inv'][s])
        b = s + 1
        c0 = C[b, js]
        ok = ~np.isnan(c0)
        js, c0 = js[ok], c0[ok]
        X = frame_at(s, D, js, {'kdd': kdd, 'qdd': qdd})
        for H in (H1, H3, H5):
            X[f'fm{H}'] = FM[H][b, js] / c0
            X[f'done{H}'] = b + H <= T - 1
            X[f'r{H}'] = CD[min(b + H, T - 1), js] / c0 - 1
            X[f'dead{H}'] = delisted[js] & (last[js] < b + H)
        rows.append(X)
    X = pd.concat(rows, ignore_index=True)
    X['date'] = dates[X['s'].values]
    X['year'] = X['date'].str[:4].astype(int)
    X['y10_5'] = (X['fm1250'] >= 10).astype(float)
    X['y10_3'] = (X['fm750'] >= 10).astype(float)
    X['y3_3'] = (X['fm750'] >= 3).astype(float)
    X['y2_1'] = (X['fm250'] >= 2).astype(float)
    log('코호트', len(X))
    Z = X[X['done1250']]
    base = float(Z['y10_5'].mean())

    def grp(df, by):
        g = df.groupby(by, observed=True).agg(n=('y10_5', 'size'), p10=('y10_5', 'mean'), p3=('y10_3', 'mean'),
                                              r5=('r1250', 'median'), dead=('dead1250', 'mean'))
        g['lift'] = g['p10'] / base
        return g

    def bins_table(col, edges, labels, df=Z):
        b = pd.cut(df[col], edges, labels=labels, right=False)
        g = grp(df, b)
        return [dict(bin=str(k), n=int(v.n), p10=r3(v.p10), p3=r3(v.p3), r5=r3(v.r5), dead=r3(v.dead), lift=r3(v.lift, 2))
                for k, v in g.iterrows()]

    def q_table(col, df=Z, q=5):
        r = df.groupby('s')[col].rank(pct=True)
        b = np.ceil(r * q).clip(1, q)
        g = grp(df, b)
        return [dict(bin=f'Q{int(k)}', n=int(v.n), p10=r3(v.p10), r5=r3(v.r5), dead=r3(v.dead), lift=r3(v.lift, 2))
                for k, v in g.iterrows()]

    Zc = Z.assign(capeok=Z['cap'] / 1e8)
    feature_bins = {
        'cap': bins_table('capeok', [0, 100, 300, 1000, 3000, 10000, 1e12],
                          ['100억 미만', '100~300억', '300~1천억', '1천~3천억', '3천억~1조', '1조 이상'], Zc),
        'price': bins_table('raw', [0, 1000, 2000, 5000, 10000, 30000, 100000, 1e12],
                            ['1천원 미만', '1~2천원', '2~5천원', '5천~1만원', '1~3만원', '3~10만원', '10만원 이상']),
        'dd3': bins_table('dd3', [-1, -.8, -.6, -.4, -.2, -.05, 10],
                          ['−80% 이하', '−60~−80%', '−40~−60%', '−20~−40%', '−5~−20%', '고점 부근']),
        'ret250': bins_table('ret250', [-1, -.5, -.25, 0, .5, 1, 2, 1e9],
                             ['−50% 이하', '−25~−50%', '0~−25%', '0~+50%', '+50~100%', '+100~200%', '+200% 이상']),
        'low52': bins_table('low52', [1, 1.2, 1.5, 2, 3, 5, 1e9],
                            ['저점~1.2배', '1.2~1.5배', '1.5~2배', '2~3배', '3~5배', '5배 이상']),
        'qdd': bins_table('qdd', [-1, -.6, -.5, -.4, -.3, -.2, -.1, .01],
                          ['−60% 이하', '−50~−60%', '−40~−50%', '−30~−40%', '−20~−30%', '−10~−20%', '−10% 이내']),
        'kdd': bins_table('kdd', [-1, -.5, -.4, -.3, -.2, -.1, .01],
                          ['−50% 이하', '−40~−50%', '−30~−40%', '−20~−30%', '−10~−20%', '−10% 이내']),
    }
    quint = {c: q_table(c) for c in ('cap', 'raw', 'A20', 'ret60', 'ret250', 'pos52', 'dd3', 'vol60', 'turn', 'surge', 'age')}
    mk = grp(Z, Z['mkt'].map({1: '코스피', 2: '코스닥'}))
    market_tbl = [dict(bin=k, n=int(v.n), p10=r3(v.p10), r5=r3(v.r5), dead=r3(v.dead), lift=r3(v.lift, 2)) for k, v in mk.iterrows()]
    by_year = Z.groupby('year').agg(n=('y10_5', 'size'), p10=('y10_5', 'mean'), r5=('r1250', 'median'), dead=('dead1250', 'mean'))
    monthly = Z.groupby('date').agg(p10=('y10_5', 'mean'), n=('y10_5', 'size'), qdd=('qdd', 'first'), kdd=('kdd', 'first'))

    # 폭락 국면 사건 연구 — 코스닥 1년 고점 대비 −40% 또는 코스피 −30% 가 120거래일 만에 처음 나온 날
    CR = (qdd <= -0.40) | (kdd <= -0.30)
    starts, lastcr = [], -999
    for t in np.flatnonzero(CR):
        if t - lastcr > 120:
            starts.append(t)
        lastcr = t
    F_sc = M0 & (cs_rank(D['cap'], M0) <= 0.3) & (D['raw'] <= 5000) & (C / D['hi750'] <= 0.5)
    crash = []
    g0s = E['g0'].values
    for t in starts:
        b = t + 1
        row = dict(start=dates[t], qdd=r3(qdd[t], 3), kdd=r3(kdd[t], 3), done=bool(b + H5 <= T - 1),
                   troughs=int(((g0s >= t - 20) & (g0s <= t + 120)).sum()))
        for nm, mask in (('all', M0[t]), ('sc', F_sc[t])):
            js = np.flatnonzero(mask)
            c0 = C[b, js] if b < T else np.array([])
            ok = ~np.isnan(c0)
            js, c0 = js[ok], c0[ok]
            if not len(js):
                continue
            fm = FM[H5][b, js] / c0
            rr3 = CD[min(b + H3, T - 1), js] / c0 - 1
            rr5 = CD[min(b + H5, T - 1), js] / c0 - 1
            row[nm] = dict(n=int(len(js)), p10=r3((fm >= 10).mean()), p5=r3((fm >= 5).mean()), r3=r3(np.median(rr3)),
                           r5=r3(np.median(rr5)), dead=r3((delisted[js] & (last[js] < b + H5)).mean()))
        crash.append(row)
    log('기저율·국면 끝')

    # ── 4) 전진 모형 ──────────────────────────────────────────
    cols = model_cols(X)
    X['lab_end'] = X['s'] + 1 + H3
    X['score'] = np.nan
    fits = []
    for Y in range(2000, int(end[:4]) + 1):
        m = (X['date'] >= f'{Y}-01-01') & (X['date'] < f'{Y + 1}-01-01')
        if not m.any():
            continue
        first_s = X.loc[m, 's'].min()
        tr = X[X['lab_end'] <= first_s]
        if len(tr) < 20000 or tr['y3_3'].sum() < 200:
            continue
        mu, sd = tr[cols].mean(), tr[cols].std().replace(0, 1)
        w = fit_logit(((tr[cols] - mu) / sd).values, tr['y3_3'].values, l2=5.0)
        X.loc[m, 'score'] = predict(w, ((X.loc[m, cols] - mu) / sd).values)
        fits.append(Y)
    S = X[X['score'].notna()]
    Zs = S[S['done1250']].copy()
    Zs['dec'] = Zs.groupby('s')['score'].rank(pct=True)
    Zs['b'] = np.ceil(Zs['dec'] * 10).clip(1, 10)
    dec = Zs.groupby('b').agg(n=('y10_5', 'size'), p10=('y10_5', 'mean'), p3=('y3_3', 'mean'), r1=('r250', 'median'),
                              r3=('r750', 'median'), r5=('r1250', 'median'), dead=('dead1250', 'mean'))
    deciles = [dict(d=int(k), n=int(v.n), p10=r3(v.p10), p3=r3(v.p3), r1=r3(v.r1), r3=r3(v.r3), r5=r3(v.r5), dead=r3(v.dead))
               for k, v in dec.iterrows()]
    Z3 = S[S['done750']]
    model_auc = dict(y3_3=r3(auc(Z3['y3_3'].values, Z3['score'].values), 3),
                     y10_5=r3(auc(Zs['y10_5'].values, Zs['score'].values), 3))
    # 지금 쓰는 모형(오늘까지 결과가 확정된 행 전부) — 계수와 오늘 후보
    trn = X[X['lab_end'] <= T - 1]
    mu_now, sd_now = trn[cols].mean(), trn[cols].std().replace(0, 1)
    w_now = fit_logit(((trn[cols] - mu_now) / sd_now).values, trn['y3_3'].values, l2=5.0)
    coef = sorted([dict(f=c, ko=FEAT_KO.get(c.replace('_r2', '').replace('_r', ''), c),
                        kind='곡선' if c.endswith('_r2') else '방향', w=r3(w_now[1 + i], 3)) for i, c in enumerate(cols)],
                  key=lambda x: -abs(x['w']))
    log('모형 끝 · 학습 연도', fits[0], '~', fits[-1], 'AUC', model_auc)

    # 상위 20 종목의 모습(매달) — 사람이 읽는 패턴
    S2 = S.copy()
    S2['rk'] = S2.groupby('s')['score'].rank(ascending=False)
    top20 = S2[S2['rk'] <= 20]
    prof_keys = [('cap', 1e8, '시가총액(억)'), ('raw', 1, '주가(원)'), ('A20', 1e8, '거래대금 20일(억)'), ('ret20', 1, '1개월 수익'),
                 ('ret60', 1, '3개월 수익'), ('ret250', 1, '1년 수익'), ('dd3', 1, '3년 고점 대비'), ('vol60', 1, '변동성(연)'),
                 ('ma200p', 1, '200일선 대비'), ('age', 250, '상장 기간(년)')]
    top_profile = [dict(k=k, ko=ko, top=r3(top20[k].median() / u, 3), all=r3(S[k].median() / u, 3)) for k, u, ko in prof_keys]

    # ── 5) 매매 규칙 — 거래 단위 ─────────────────────────────
    capP = cs_rank(D['cap'], M0)
    dd3m = C / D['hi750']
    mindd = pd.DataFrame(dd3m).rolling(250, min_periods=60).min().to_numpy()
    surge = D['A20'] / D['A250']
    MEm = ME[:, None]
    signals = {
        '아무 종목(매달)': M0 & MEm,
        '폭락 국면(매달)': M0 & MEm & CR[:, None],
        '폭락+소형·저가·급락': M0 & MEm & CR[:, None] & (capP <= 0.3) & (D['raw'] <= 5000) & (dd3m <= 0.5),
        '소형·저가·급락(매달)': M0 & MEm & (capP <= 0.3) & (D['raw'] <= 5000) & (dd3m <= 0.5),
        '바닥 뒤 52주 신고가': M0 & (mindd <= 0.35) & (C >= D['hi250'] * 0.9999) & (surge >= 1.5),
        '거래 폭발 추격': M0 & (surge >= 3) & (D['ret60'] >= 0.5) & (C > MA) & (capP <= 0.5) & (dd3m <= 0.7),
    }
    exit_rules = [Rule('1년 보유', hold=H1), Rule('5년 보유', hold=H5), Rule('추적 30%', trail=0.3, hold=H5),
                  Rule('추적 50%', trail=0.5, hold=H5), Rule('200일선 이탈', ma=True, hold=H5),
                  Rule('과열 뒤 20% 하락', hot=2.0, hot_trail=0.2, hold=H5), Rule('10배 익절(최대 5년)', target=10, hold=H5)]
    trade_tbl = []
    for sn, M in signals.items():
        ev = np.argwhere(M[:-1])
        ev = ev[np.lexsort((ev[:, 0], ev[:, 1]))]
        entries = [(int(j), int(s)) for s, j in ev]
        for R in exit_rules:
            tl = trade_list(entries, C, MA, TR, last, R, years)
            r = tl['r']
            if not len(r):
                continue
            trade_tbl.append(dict(sig=sn, rule=R.name, n=int(len(r)), mean=r3(r.mean()), med=r3(np.median(r)),
                                  win=r3((r > 0).mean()), x3=r3((r >= 2).mean()), x10=r3((r >= 9).mean()),
                                  hold=r3(((tl['e'] - tl['t0']) / 250).mean(), 2)))
    log('거래 단위 끝', len(trade_tbl))

    # ── 6) 포트폴리오 ─────────────────────────────────────────
    def seg(eq, d0, d1):
        i = np.flatnonzero((dates >= d0) & (dates < d1))
        e = eq[i]
        e = e[~np.isnan(e)]
        if len(e) < 2:
            return None, None
        return r3((e[-1] / e[0]) ** (250 / (len(e) - 1)) - 1), r3(float((e / np.maximum.accumulate(e) - 1).min()))

    start = int(np.flatnonzero(dates >= PORT_START)[0])
    sd_model = {}
    for s, g in S.groupby('s'):
        g = g[M0[s, g['j'].values]].sort_values('score', ascending=False)
        sd_model[int(s)] = g['j'].astype(int).tolist()
    grid = [Rule('1년 보유', hold=H1), Rule('2년 보유', hold=500), Rule('3년+10배 익절', hold=H3, target=10),
            Rule('5년+10배 익절', hold=H5, target=10), Rule('추적 35%', trail=0.35, hold=H5), Rule('추적 50%', trail=0.5, hold=H5),
            Rule('과열(2.0배) 뒤 20% 하락', hot=2.0, hot_trail=0.2, hold=H5),
            Rule('과열(2.5배) 뒤 20% 하락', hot=2.5, hot_trail=0.2, hold=H5),
            Rule('1년 · 과열(2.0배) 뒤 20% 하락', hot=2.0, hot_trail=0.2, hold=H1),
            Rule('2년 · 과열(2.0배) 뒤 20% 하락', hot=2.0, hot_trail=0.2, hold=500)]
    port = []
    curves = {}
    for R in grid:
        eq, trd = portfolio(sd_model, C, D['raw'], MA, TR, last, R, years, slots=20, capital=1.4e8, start=start)
        st = stats(eq, None)
        rr = np.array([x[3] for x in trd]) if trd else np.array([0.0])
        is_c, is_m = seg(eq, PORT_START, T_SPLIT)
        os_c, os_m = seg(eq, T_SPLIT, '2100-01-01')
        port.append(dict(rule=R.name, cagr=r3(st['cagr']), mdd=r3(st['mdd']), mult=r3(st['mult'], 1), is_cagr=is_c, is_mdd=is_m,
                         oos_cagr=os_c, oos_mdd=os_m, trades=len(trd), win=r3((rr > 0).mean()), med=r3(np.median(rr)),
                         tb=int((rr >= 9).sum())))
        curves[R.name] = (eq, trd)
    best = max(port, key=lambda x: x['is_cagr'] or -9)          # 앞 시기 성적으로만 고른다
    bestR = [R for R in grid if R.name == best['rule']][0]
    log('포트폴리오 규칙 선택(앞 시기):', best['rule'], best['is_cagr'], '→ 뒤 시기', best['oos_cagr'])
    eq_best, trd_best = curves[best['rule']]

    robust = []

    def rob(label, sd=sd_model, slots=20, cap=1.4e8, st0=start, slip=None):
        old = (BT.SLIP, BT.BUY_COST)
        if slip is not None:
            BT.SLIP = slip
            BT.BUY_COST = BT.FEE + slip
        try:
            eq, trd = portfolio(sd, C, D['raw'], MA, TR, last, bestR, years, slots=slots, capital=cap, start=st0)
        finally:
            BT.SLIP, BT.BUY_COST = old
        st = stats(eq, None)
        robust.append(dict(label=label, cagr=r3(st['cagr']), mdd=r3(st['mdd']), oos=seg(eq, T_SPLIT, '2100-01-01')[0], trades=len(trd)))
        return eq
    rob('1만$ 환산(₩1,400만) · 20종목', cap=1.4e7)
    rob('10만$ 환산(₩1억4,000만) · 20종목')
    for sl in (10, 30, 40):
        rob(f'{sl}종목', slots=sl)
    rob('2순위(21~40위)로만', sd={k: v[20:] for k, v in sd_model.items()})
    rob('3순위(41~60위)로만', sd={k: v[40:] for k, v in sd_model.items()})
    rob('미끄러짐 0.5%/회', slip=0.005)
    rob('미끄러짐 1.0%/회', slip=0.01)
    for y0 in ('2008-01-02', '2013-01-02', '2018-01-02'):
        rob(f'{y0[:4]}년 시작', st0=int(np.flatnonzero(dates >= y0)[0]))
    log('강건성 끝')

    rr = np.array([x[3] for x in trd_best])
    hold_d = np.array([x[2] - x[1] for x in trd_best])
    lr = np.log1p(rr)
    top10_share = float(np.sort(lr)[::-1][:10].sum() / lr[lr > 0].sum()) if (lr > 0).any() else None
    best_trades = dict(n=int(len(rr)), win=r3((rr > 0).mean()), mean=r3(rr.mean()), med=r3(np.median(rr)), x2=r3((rr >= 1).mean()),
                       x3=r3((rr >= 2).mean()), loss50=r3((rr <= -0.5).mean()), hold=r3(hold_d.mean(), 0), top10_share=r3(top10_share, 3))
    caught = 0
    tb_after = E[E['g0'] >= start]
    for _, e in tb_after.iterrows():
        if any(x[0] == e['j'] and e['g0'] <= x[1] <= e['g10'] for x in trd_best):
            caught += 1
    best_trades['tb_caught'] = caught
    best_trades['tb_total'] = int(len(tb_after))
    eb = pd.Series(eq_best, index=dtx).dropna()
    yearly = [dict(y=int(i.year), r=r3(v)) for i, v in eb.resample('YE').last().pct_change().dropna().items()]
    mon = eb.resample('ME').last()
    kos = pd.Series(KOSPI, index=dtx).reindex(mon.index, method='ffill')
    kq = pd.Series(KOSDAQ, index=dtx).reindex(mon.index, method='ffill')
    curve = [dict(d=i.strftime('%Y-%m'), v=r3(v / mon.iloc[0], 4), k=r3(kos[i] / kos.iloc[0], 4), q=r3(kq[i] / kq.iloc[0], 4))
             for i, v in mon.items()]
    bench, bench97 = {}, {}
    st97 = int(np.flatnonzero(dates >= '1997-01-02')[0])
    for nm, ser in (('KOSPI', KOSPI), ('KOSDAQ', KOSDAQ)):
        e = np.full(T, np.nan)
        e[start:] = ser[start:]
        st = stats(e, None)
        bench[nm] = dict(cagr=r3(st['cagr']), mdd=r3(st['mdd']), is_cagr=seg(e, PORT_START, T_SPLIT)[0], oos_cagr=seg(e, T_SPLIT, '2100-01-01')[0])
        e97 = np.full(T, np.nan)
        e97[st97:] = ser[st97:]
        st = stats(e97, None)
        bench97[nm] = dict(cagr=r3(st['cagr']), mdd=r3(st['mdd']))      # 몬테카를로(1997~)와 같은 기간

    # 단순 규칙 몬테카를로(무작위 순서) — 같은 규칙이라도 20종목만 들고 가면 운이 크다
    mc = []
    filt = {'전체': M0, '소형 30%': M0 & (capP <= 0.3), '저가 5천원 이하': M0 & (D['raw'] <= 5000),
            '3년 고점 −50% 이하': M0 & (dd3m <= 0.5), '소형·저가·급락': M0 & (capP <= 0.3) & (D['raw'] <= 5000) & (dd3m <= 0.5)}
    mc_rules = [Rule('5년+10배 익절', hold=H5, target=10), Rule('과열(2.5배) 뒤 20% 하락', hot=2.5, hot_trail=0.2, hold=H5),
                Rule('추적 50%', trail=0.5, hold=H5)]
    mes97 = mes[dates[mes] >= '1997-01-01']
    crash_m = np.array([(qdd[s] <= -0.30) or (kdd[s] <= -0.25) for s in mes97])
    for fn, FMk in filt.items():
        for timing in ('상시', '폭락 국면만'):
            days = mes97 if timing == '상시' else mes97[crash_m]
            for R in mc_rules:
                cg, md = [], []
                for seed in range(a.seeds):
                    key = np.random.default_rng(seed).random(N)
                    sdays = {}
                    for s in days:
                        js = np.flatnonzero(FMk[s])
                        if len(js):
                            sdays[int(s)] = [int(j) for j in js[np.argsort(key[js])]]
                    eq, _ = portfolio(sdays, C, D['raw'], MA, TR, last, R, years, slots=20, capital=1.4e8, start=st97)
                    st = stats(eq, None)
                    cg.append(st['cagr'])
                    md.append(st['mdd'])
                mc.append(dict(filter=fn, timing=timing, rule=R.name, cagr=r3(np.median(cg)), p10=r3(np.percentile(cg, 10)),
                               p90=r3(np.percentile(cg, 90)), mdd=r3(np.median(md))))
    log('몬테카를로 끝')

    # ── 7) 오늘 기준 ──────────────────────────────────────────
    # 백테(월말 코호트)와 같은 순위 기준 — '살 수 있는 종목 전체' 안 백분위 → 매수 후보 범위만 점수 순(전향 시험과 같은 함수)
    sT = T - 1
    model_now = dict(cols=list(cols), mu=[float(x) for x in mu_now[cols].values], sd=[float(x) for x in sd_now[cols].values],
                     w=[float(x) for x in w_now])
    XT = score_day(D, sT, M0, model_now, kdd, qdd, codes)
    jsT = XT['j'].to_numpy()
    hist_top = dec.loc[10] if 10 in dec.index else None
    cand = []
    for _, r in XT.head(30).iterrows():
        j = int(r['j'])
        cand.append(dict(code=codes[j], name=names[j], mkt='코스닥' if r['mkt'] == 2 else '코스피', score=r3(r['score'], 3),
                         cap=r3(r['cap'] / 1e8, 0), price=r3(r['raw'], 0), A20=r3(r['A20'] / 1e8, 1), ret60=r3(r['ret60'], 3),
                         dd3=r3(r['dd3'], 3), ma200p=r3(r['ma200p'], 3), industry=ind.get(codes[j], '')))
    current = dict(asOf=end, qdd=r3(qdd[sT], 3), kdd=r3(kdd[sT], 3), crash=bool(CR[sT]), universe=int(len(jsT)),
                   topDecile=dict(p3=r3(hist_top.p3), r1=r3(hist_top.r1), r3=r3(hist_top.r3), dead=r3(hist_top.dead)) if hist_top is not None else None,
                   candidates=cand)

    # ── 텐배거 표 · 요약 ───────────────────────────────────────
    E['y0'] = E['t0'].str[:4].astype(int)
    by_trough_year = E.groupby('y0').size()
    tm = E.groupby(E['t0'].str[:7]).size().sort_values(ascending=False).head(12)
    prof = {k: qs(E[k]) for k in ('cap0', 'capP', 'raw0', 'A20_0', 'dd3_0', 'ret250_0', 'vol60_0', 'age0', 't2', 't3', 't5',
                                  'd10', 'mdd10', 'peak', 'dpk', 'cap_pk', 'ma200_pk', 'ret60_pk', 'surge_pk', 'after1', 'low2')}
    ind_counts = E[E['industry'] != ''].groupby('industry').size().sort_values(ascending=False)
    eras = [('1996~2001 (IMF·닷컴)', 1995, 2001), ('2002~2007 (조선·중국)', 2002, 2007), ('2008~2012 (금융위기 뒤)', 2008, 2012),
            ('2013~2019', 2013, 2019), ('2020~2026 (코로나 뒤)', 2020, 2026)]
    era_tbl = []
    for nm, y0, y1 in eras:
        sub = E[(E['y0'] >= y0) & (E['y0'] <= y1)]
        top = sub.sort_values('peak', ascending=False).head(6)
        ic = sub[sub['industry'] != ''].groupby('industry').size().sort_values(ascending=False).head(4)
        era_tbl.append(dict(era=nm, n=int(len(sub)), med_peak=r3(sub['peak'].median(), 1) if len(sub) else None,
                            top=[dict(name=r_.name0, now=r_['name'], peak=r3(r_.peak, 1)) for _, r_ in top.iterrows()],
                            industries=[dict(name=k, n=int(v)) for k, v in ic.items()]))
    tb_list = []
    for _, e in E.sort_values('peak', ascending=False).iterrows():
        tb_list.append([e['code'], e['name0'], e['name'], e['mkt'], e['t0'], e['t10'], e['tp'], r3(e['peak'], 1),
                        int(e['d10']), int(e['dpk']), r3(e['cap0'], 0), r3(e['raw0'], 0), r3(e['dd3_0'], 3), e['industry'],
                        bool(e['alive'])])

    best_port = [p for p in port if p['rule'] == best['rule']][0]
    sm = robust[0]
    rb = {r_['label']: r_ for r_ in robust}
    out = dict(
        meta=dict(version=VERSION, generatedAt=dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M KST'),
                  dataFrom=dates[0], dataTo=end, source='KRX 전종목시세(FinanceData/marcap) · 네이버 업종·지수',
                  instruments=int(N), delisted=int(delisted.sum()), listed=int((~delisted).sum()), tradingDays=int(T),
                  cohortRows=int(len(X)), cohortMonths=int(len(mes)), episodes=int(len(E)), episodeStocks=int(E['j'].nunique()),
                  liqMin=LIQ_MIN, dataFix=[int(x) for x in P.get('fix_counts', [0, 0])], modelYears=[fits[0], fits[-1]],
                  split=T_SPLIT, portStart=PORT_START),
        base=dict(p10_5=r3(base), p10_3=r3(X[X['done750']]['y10_3'].mean()), p2_1=r3(X[X['done250']]['y2_1'].mean()),
                  p3_3=r3(X[X['done750']]['y3_3'].mean()),
                  dead5=r3(Z['dead1250'].mean()), r5med=r3(Z['r1250'].median()), r5mean=r3(Z['r1250'].mean()), n=int(len(Z))),
        byYear=[dict(y=int(k), n=int(v.n), p10=r3(v.p10), r5=r3(v.r5), dead=r3(v.dead)) for k, v in by_year.iterrows()],
        monthly=[dict(d=k[:7], p=r3(v.p10), q=r3(v.qdd, 3), k=r3(v.kdd, 3)) for k, v in monthly.iterrows()],
        featureBins=feature_bins, quintiles=quint, market=market_tbl, crash=crash,
        episodes=dict(byYear=[dict(y=int(k), n=int(v)) for k, v in by_trough_year.items()],
                      topMonths=[dict(m=k, n=int(v)) for k, v in tm.items()], profile=prof,
                      kosdaq=int((E['mkt'] == '코스닥').sum()), kospi=int((E['mkt'] == '코스피').sum()),
                      alive=int(E['alive'].sum()), industries=[dict(name=k, n=int(v)) for k, v in ind_counts.head(15).items()],
                      eras=era_tbl,
                      cols=['code', 'name0', 'name', 'mkt', 't0', 't10', 'tp', 'peak', 'd10', 'dpk', 'cap0', 'raw0', 'dd3', 'industry', 'alive'],
                      list=tb_list),
        model=dict(auc=model_auc, deciles=deciles, coef=coef[:14], topProfile=top_profile, label='3년 안 3배'),
        trades=trade_tbl, portfolio=dict(grid=port, best=best_port, robust=robust, trades=best_trades, yearly=yearly, curve=curve,
                                         bench=bench, bench97=bench97, mc=mc, slots=20, mcSeeds=a.seeds),
        current=current)
    # 요약 문장에 쓰는 숫자(화면이 다시 계산하지 않는다)
    qbins = {b['bin']: b for b in feature_bins['qdd']}
    out['headline'] = dict(base=out['base'], bestRule=best['rule'], best=best_port, small=sm, bench=bench,
                           crash5060=qbins.get('−50~−60%'), episodes=len(E), stocks=int(E['j'].nunique()),
                           prof=dict(cap=prof['cap0'][2], price=prof['raw0'][2], dd3=prof['dd3_0'][2], ret250=prof['ret250_0'][2],
                                     t2=prof['t2'][2], d10=prof['d10'][2], mdd10=prof['mdd10'][2], peak=prof['peak'][2],
                                     ma200=prof['ma200_pk'][2], ret60=prof['ret60_pk'][2], surge=prof['surge_pk'][2],
                                     after1=prof['after1'][2]),
                           robustCost=rb.get('미끄러짐 1.0%/회'), robust2=rb.get('2순위(21~40위)로만'))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if a.model_out:
        # 전향 시험이 그대로 쓰는 고정 모형 — 한 번 만든 뒤엔 바꾸지 않는다(바꾸면 새 버전 장부로 시작).
        # ageRef: 마지막 날 상장 종목의 '상장 뒤 거래일 수' — 최근 몇 년 자료만 받는 전향 시험이 상장 기간을 30년 패널과 같게 잇는다.
        alive_end = np.flatnonzero(P['last'] == end)
        ages = {str(codes[j]): int(D['age'][T - 1, j]) for j in alive_end}
        R_ = bestR
        model_file = dict(
            version='tb-claude-model-1.0.0', analysisVersion=VERSION, trainedThrough=end, label='y3_3 — 750거래일 안 종가 3배',
            l2=5.0, rows=int(len(trn)), positives=int(trn['y3_3'].sum()), auc=model_auc,
            cols=model_now['cols'], mu=model_now['mu'], sd=model_now['sd'], w=model_now['w'],
            rankFeats=RANK_FEATS, universe=dict(liqMin=LIQ_MIN, ageMin=AGE_MIN, excludeDept=[1, 2], rankWithin='inv',
                                                delistTailMasked=False),
            rule=dict(name=R_.name, trail=R_.trail, hold=R_.hold, ma=R_.ma, hot=R_.hot, hot_trail=R_.hot_trail,
                      target=R_.target, stop=R_.stop),
            portfolio=dict(slots=20, capitals=dict(usd10k=1.4e7, usd100k=1.4e8), fee=BT.FEE, slip=BT.SLIP,
                           signal='매달 마지막 거래일 종가 점수 → 다음 거래일 종가 매수(빈 칸만)'),
            backtest=dict(rule=best_port['rule'], cagr=best_port['cagr'], mdd=best_port['mdd'], is_cagr=best_port['is_cagr'],
                          oos_cagr=best_port['oos_cagr'], oos_mdd=best_port['oos_mdd'], trades=best_port['trades'],
                          win=best_port['win'], med=best_port['med'], split=T_SPLIT, portStart=PORT_START,
                          small=rb.get('1만$ 환산(₩1,400만) · 20종목'), large=rb.get('10만$ 환산(₩1억4,000만) · 20종목'),
                          topDecile=current['topDecile'], baseP3=out['base']['p3_3'], bench=bench),
            ageRef=dict(date=end, ages=ages))
        with open(a.model_out, 'w', encoding='utf-8') as f:
            json.dump(model_file, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        log('고정 모형', a.model_out, os.path.getsize(a.model_out) // 1024, 'KB')
    log('저장', a.out, os.path.getsize(a.out) // 1024, 'KB · 전체', round(time.time() - t_all), '초')


if __name__ == '__main__':
    main()
