"""텐배거 구간 찾기 — 종가만 쓴다(장중 고가 튐 제외).

정의(사후 판정):
  저점 T0 에서 W 거래일 안에 종가가 저점의 10배 이상이 된 날(T10)이 있으면 텐배거 구간이다.
  저점은 '살 수 있었던 날'(can_buy: 20일 평균 거래대금 1억 원 이상 · 거래됨 · 정리매매 아님)만 쓴다.
  10배 날은 '팔 수 있었던 날'(can_sell: 거래됨 · 정리매매 아님)이어야 한다.
  고점 TP 는 T10 이후 '고점에서 50% 넘게 떨어지는 날'이 오기 전까지의 최고 종가 날이다(상승 한 바퀴의 끝).
  같은 종목이라도 고점 뒤 다시 바닥을 다지고 10배가 되면 새 구간이다.
"""
import numpy as np

MULT = 10.0
END_DD = 0.5          # 고점 대비 이만큼 떨어지면 그 상승 구간은 끝


def rolling_argmin(c, W):
    """c[t-W..t] 구간 최소값의 위치(같으면 가장 최근). 단조 덱으로 O(n). inf 는 '못 쓰는 날'."""
    n = len(c)
    out = np.empty(n, dtype=np.int64)
    dq = []
    head = 0
    for t in range(n):
        v = c[t]
        while len(dq) > head and c[dq[-1]] >= v:
            dq.pop()
        dq.append(t)
        while dq[head] < t - W:
            head += 1
        out[t] = dq[head]
    return out


def find_episodes(c, W=1250, mult=MULT, end_dd=END_DD, can_buy=None, can_sell=None):
    """c: 한 종목의 수정 종가(상장 기간, 빈 날 없음).
    반환: [(t0, t10, tp, tend)] — tend 는 고점 대비 end_dd 하락이 처음 확인된 날(없으면 마지막 날)."""
    n = len(c)
    if n < 2:
        return []
    cb = c.astype(np.float64) if can_buy is None else np.where(can_buy, c, np.inf)
    sell = np.ones(n, bool) if can_sell is None else can_sell
    am = rolling_argmin(cb, W)
    eps = []
    t = 1
    floor = 0          # 다음 구간의 저점은 이 위치 이후여야 한다(앞 구간의 고점 뒤)
    while t < n:
        t0 = am[t]
        if t0 < floor:
            seg = cb[floor:t + 1]
            t0 = floor + int(np.flatnonzero(seg == seg.min())[-1])
        if t0 < t and np.isfinite(cb[t0]) and sell[t] and c[t] >= mult * cb[t0]:
            t10 = t
            m, tp, k = c[t10], t10, t10 + 1
            tend = n - 1
            while k < n:
                if c[k] > m:
                    m, tp = c[k], k
                elif c[k] <= m * (1 - end_dd):
                    tend = k
                    break
                k += 1
            eps.append((int(t0), int(t10), int(tp), int(tend)))
            floor = tp + 1
            t = max(tp + 1, t + 1)
            continue
        t += 1
    return eps
