"""텐배거(클로드) 공용 지표 — 패널(날짜×종목)에서 날마다 '그날 종가까지' 확정된 값만 만든다.

모든 지표는 t 일 종가까지의 자료로 정한다. 매수는 그다음 거래일 종가(t+1)로 한다 —
CLAUDE.md '룩어헤드 금지'(전일까지 확정 지표로 신호 → 당일 종가 체결)와 같다.
"""
import numpy as np
import pandas as pd

LIQ_MIN = 1e8          # 20일 평균 거래대금 1억 원 이상이어야 '살 수 있는 날'
DELIST_TAIL = 30       # 상장폐지 종목의 마지막 30거래일(정리매매 — 1990년대엔 30일까지 했다)은 사지 않는다


def ffill_life(M, alive):
    """상장 기간 안의 빈 날(거래정지 행 누락)만 앞값으로 채운다. 상장 전·폐지 후는 NaN."""
    F = pd.DataFrame(M).ffill().to_numpy(copy=True)
    F[~alive] = np.nan
    return F


def life_mask(C):
    ok = ~np.isnan(C)
    T, N = C.shape
    first = np.where(ok.any(0), ok.argmax(0), T)
    last = np.where(ok.any(0), T - 1 - ok[::-1].argmax(0), -1)
    t = np.arange(T)[:, None]
    return (t >= first[None, :]) & (t <= last[None, :]), first, last


def roll(M, w, fn, minp=None):
    R = getattr(pd.DataFrame(M).rolling(w, min_periods=minp or w), fn)()
    return R.values.astype(np.float32)


def derive(P, delisted):
    """P: panel.npz 배열, delisted: 종목별 상장폐지 여부(bool[N])."""
    C0 = P['close'].astype(np.float64)
    alive, first, last = life_mask(C0)
    C = ffill_life(C0, alive)
    T, N = C.shape
    vol = np.nan_to_num(P['vol'].astype(np.float64))
    amt = np.where(alive, np.nan_to_num(P['amt'].astype(np.float64)), np.nan)
    D = {'C': C, 'alive': alive, 'first': first, 'last': last}
    D['A20'] = roll(amt, 20, 'mean', 10)
    D['A250'] = roll(amt, 250, 'mean', 120)
    traded = (vol > 0) & alive
    tail = np.zeros_like(alive)
    for j in np.flatnonzero(delisted):
        if last[j] >= 0:
            tail[max(first[j], last[j] - DELIST_TAIL + 1):last[j] + 1, j] = True
    fund = P['fund'].astype(bool)
    D['fund'] = fund
    D['inv'] = alive & traded & ~tail & ~fund & (np.nan_to_num(D['A20']) >= LIQ_MIN)
    D['tail'] = tail
    D['cap'] = np.where(alive, P['cap'].astype(np.float64), np.nan)
    D['cap'] = pd.DataFrame(D['cap']).ffill().to_numpy(copy=True)
    D['cap'][~alive] = np.nan
    D['raw'] = ffill_life(P['raw'].astype(np.float64), alive)
    D['mkt'] = P['mkt']
    D['dept'] = P['dept']
    lc = np.log(C)
    r1 = np.diff(lc, axis=0, prepend=np.nan)
    D['vol60'] = roll(r1, 60, 'std', 40) * np.sqrt(250)
    D['hi250'] = roll(C, 250, 'max', 60)
    D['lo250'] = roll(C, 250, 'min', 60)
    D['hi750'] = roll(C, 750, 'max', 60)
    D['ma200'] = roll(C, 200, 'mean', 200)
    D['ma60'] = roll(C, 60, 'mean', 60)
    D['ma120'] = roll(C, 120, 'mean', 120)
    for k in (20, 60, 120, 250):
        S = np.full_like(C, np.nan)
        S[k:] = C[k:] / C[:-k] - 1
        D[f'ret{k}'] = S.astype(np.float32)
    D['age'] = (np.arange(T)[:, None] - first[None, :]).astype(np.float32)
    D['age'][~alive] = np.nan
    return D


def cs_rank(M, mask):
    """날마다 mask 안에서의 백분위(0~1). mask 밖은 NaN."""
    X = np.where(mask, M, np.nan)
    return pd.DataFrame(X).rank(axis=1, pct=True).values.astype(np.float32)


def forward_max(C, H):
    """FM[t] = max(C[t+1..t+H]) — 폐지 뒤 NaN 은 무시(남은 기간의 최고가)."""
    R = pd.DataFrame(C[::-1]).rolling(H, min_periods=1).max().to_numpy()[::-1]
    out = np.full_like(C, np.nan)
    out[:-1] = R[1:]
    return out


def carry_dead(C):
    """상장폐지 뒤에도 마지막 가격을 유지(보유했다면 그 가격으로 끝났다). 상장 전은 NaN 그대로."""
    return pd.DataFrame(C).ffill().to_numpy(copy=True)
