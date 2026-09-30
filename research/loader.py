"""전 종목 일봉을 납작한 배열로 올린다. 시가→종가 단타 검증용 피처까지 여기서 만든다.
미래 차단: 모든 피처는 전일 종가까지의 정보로만 만든다."""
import json, glob, os, numpy as np
from config import tick_size, TAX, COMMISSION_ONEWAY, SLIPPAGE_TICKS

def load(min_bars=120):
    rows = []   # dict of arrays
    for f in glob.glob('data/daily/*.json'):
        r = json.load(open(f))
        o = r['ohlc']
        if len(o) < min_bars: continue
        mk = r['market']
        dates = [b['date'] for b in o]
        O = np.array([b['o'] for b in o], float); H = np.array([b['h'] for b in o], float)
        L = np.array([b['l'] for b in o], float); C = np.array([b['c'] for b in o], float)
        V = np.array([b['v'] for b in o], float); HL = np.array([b['halt'] for b in o], bool)
        n = len(o)
        # ── 전일 종가까지로 만드는 피처 ──────────────────────────────
        prevC = np.roll(C, 1); prevC[0] = np.nan
        prevV = np.roll(V, 1); prevV[0] = np.nan
        prevHalt = np.roll(HL, 1); prevHalt[0] = True
        turn = prevC * prevV                                   # 전일 거래대금 근사
        # 20일 평균거래량 (전일까지)
        cv = np.cumsum(np.insert(V, 0, 0))
        avgV = np.full(n, np.nan)
        if n > 21: avgV[21:] = (cv[21:-0 or None][:n-21] - cv[1:n-20]) / 20 if False else (cv[21:] - cv[1:n-20]) / 20
        # RSI(14) — 전일 종가까지
        d = np.diff(C, prepend=C[0]); up = np.clip(d, 0, None); dn = np.clip(-d, 0, None)
        au = np.zeros(n); ad = np.zeros(n)
        for i in range(1, n):
            k = 1/14 if i > 14 else 1/max(i,1)
            au[i] = au[i-1]*(1-k) + up[i]*k; ad[i] = ad[i-1]*(1-k) + dn[i]*k
        rsi = np.where(ad > 0, 100 - 100/(1 + au/np.maximum(ad,1e-12)), 100)
        rsi = np.roll(rsi, 1); rsi[0] = np.nan                 # 전일까지
        # 20일 실현변동성 (전일까지)
        ret = np.zeros(n); ret[1:] = C[1:]/C[:-1] - 1
        vol20 = np.full(n, np.nan)
        for i in range(21, n): vol20[i] = ret[i-20:i].std()*100
        prevChg = np.roll(ret, 1)*100; prevChg[0] = np.nan
        # ── 당일 결과 (진입/청산에만 사용) ──────────────────────────
        gap = (O - prevC)/prevC*100
        intr = (C - O)/O*100                                   # 시가→종가
        rows.append(dict(code=r['code'], name=r['name'], market=mk, delisted=r['delisted'],
            dates=dates, O=O, H=H, L=L, C=C, V=V, halt=HL, prevC=prevC, prevHalt=prevHalt,
            turn=turn, avgV=avgV, rsi=rsi, vol20=vol20, prevChg=prevChg, gap=gap, intr=intr))
    return rows

def cost_pct(price, market, slip_mult=1.0):
    """왕복 총비용 % — 세금 + 수수료 + 시가/종가 동시호가 슬리피지 1.5틱씩."""
    t = tick_size(price, market)
    slip = 2 * SLIPPAGE_TICKS['auction'] * slip_mult * t / price * 100
    return TAX.get(market, 0.20) + COMMISSION_ONEWAY*2 + slip
