"""텐배거(클로드) 매매 규칙 시험 — 거래 단위·포트폴리오 단위.

체결 약속(룩어헤드 금지):
  매수  신호일 s 종가까지의 지표로 정하고, 다음 거래일 s+1 종가에 산다.
  매도  t 일 종가로 매도 조건이 확인되면 다음 거래일 t+1 종가에 판다(거래 없는 날은 다음 거래일).
  상장폐지  마지막 거래일(정리매매 마지막 가격)에 강제로 판다 — 사라진 종목도 손실로 남는다.
비용: 사고팔 때 수수료 0.015% + 미끄러짐 0.2%, 팔 때 거래세(연도별 법정 세율).
"""
import numpy as np

FEE = 0.00015
SLIP = 0.002


def sell_tax(year):
    if year <= 2018:
        return 0.003
    if year <= 2020:
        return 0.0025
    if year <= 2022:
        return 0.0023
    if year == 2023:
        return 0.002
    if year == 2024:
        return 0.0018
    if year == 2025:
        return 0.0015
    return 0.002


BUY_COST = FEE + SLIP


def sell_cost(year):
    return FEE + SLIP + sell_tax(year)


class Rule:
    """매도 규칙. trail: 최고 종가 대비 하락폭(0.3=30%) · hold: 최대 보유 거래일 ·
    ma: 200일선 아래로 닫히면 매도(한 번 200일선 위로 올라선 뒤부터 유효) ·
    hot/hot_trail: 200일선의 hot 배 이상 과열이 한 번이라도 나오면 그 뒤로는 hot_trail 로 조인다 ·
    target: 매수가의 이 배수에 도달하면 매도 · stop: 매수가 대비 손절폭."""

    def __init__(self, name, trail=None, hold=1250, ma=False, hot=None, hot_trail=None, target=None, stop=None):
        self.name, self.trail, self.hold, self.ma = name, trail, hold, ma
        self.hot, self.hot_trail, self.target, self.stop = hot, hot_trail, target, stop


def exit_index(c, ma200, traded, t0, last, rule):
    """t0 종가 매수 → 매도 체결일. c·ma200·traded 는 한 종목의 열(전체 날짜)."""
    end = min(last, t0 + rule.hold)
    w = c[t0:end + 1]
    if len(w) <= 1:
        return end
    cond = np.zeros(len(w), dtype=bool)
    runmax = np.maximum.accumulate(w)
    if rule.trail is not None:
        cond |= w <= runmax * (1 - rule.trail)
    if rule.stop is not None:
        cond |= w <= w[0] * (1 - rule.stop)
    if rule.target is not None:
        cond |= w >= w[0] * rule.target
    if rule.ma or rule.hot is not None:
        m = ma200[t0:end + 1]
        valid = ~np.isnan(m)
        if rule.ma:
            armed = np.maximum.accumulate(valid & (w > m))
            cond |= armed & valid & (w < m)
        if rule.hot is not None:
            hot = np.maximum.accumulate(valid & (w >= m * rule.hot))
            cond |= hot & (w <= runmax * (1 - rule.hot_trail))
    cond[0] = False
    k = np.flatnonzero(cond)
    if len(k) == 0:
        return end
    e = t0 + int(k[0]) + 1
    while e < last and not traded[e]:
        e += 1
    return min(e, last)


def trade_list(entries, C, MA, TR, last, rule, years):
    """entries: [(j, s)] 신호(종가 s). 같은 종목은 보유 중 신호를 무시한다. 반환: dict 배열."""
    out = {'j': [], 't0': [], 'e': [], 'r': [], 'mx': []}
    busy_until = {}
    for j, s in entries:
        t0 = s + 1
        if t0 > last[j] or t0 <= busy_until.get(j, -1):
            continue
        if not TR[t0, j] or np.isnan(C[t0, j]):
            continue
        e = exit_index(C[:, j], MA[:, j], TR[:, j], t0, last[j], rule)
        gross = C[e, j] / C[t0, j]
        net = gross * (1 - sell_cost(years[e])) / (1 + BUY_COST) - 1
        out['j'].append(j)
        out['t0'].append(t0)
        out['e'].append(e)
        out['r'].append(net)
        out['mx'].append(float(np.nanmax(C[t0:e + 1, j]) / C[t0, j]))
        busy_until[j] = e
    return {k: np.array(v) for k, v in out.items()}


def portfolio(sig_days, C, RAW, MA, TR, last, rule, years, slots=20, capital=1.4e7, max_new=None, start=0, stop=None):
    """일별 포트폴리오. sig_days: {s: [j,...]} 신호일별 후보(우선순위 순). 정수 주식 수.
    max_new: 한 신호일에 새로 사는 최대 종목 수(분할 매수). 반환: 날짜별 평가액 배열과 체결 기록."""
    T = C.shape[0]
    stop = T if stop is None else stop
    cash = capital
    pos = {}            # j -> [shares, t0, entry_adj, exit_day]
    eq = np.full(T, np.nan)
    trades = []
    for t in range(start, stop):
        # 1) 오늘 체결할 매도
        for j in [j for j, p in pos.items() if p[3] == t]:
            sh, t0, ca, _ = pos.pop(j)
            px = RAW[t0, j] * C[t, j] / ca
            cash += sh * px * (1 - sell_cost(years[t]))
            trades.append((j, t0, t, C[t, j] / ca - 1))
        # 2) 어제 신호 → 오늘 종가 매수
        cands = sig_days.get(t - 1)
        if cands and len(pos) < slots:
            value = cash + sum(p[0] * RAW[p[1], jj] * C[t, jj] / p[2] for jj, p in pos.items())
            per = value / slots
            bought = 0
            for j in cands:
                if len(pos) >= slots or (max_new is not None and bought >= max_new):
                    break
                if j in pos or t >= last[j] or not TR[t, j] or np.isnan(C[t, j]):
                    continue
                px = RAW[t, j]
                if not px > 0:
                    continue
                budget = min(per, cash)
                sh = int(budget // (px * (1 + BUY_COST)))
                if sh <= 0:
                    continue
                cash -= sh * px * (1 + BUY_COST)
                e = exit_index(C[:, j], MA[:, j], TR[:, j], t, last[j], rule)
                pos[j] = [sh, t, C[t, j], e if e > t else min(t + 1, last[j])]
                bought += 1
        eq[t] = cash + sum(p[0] * RAW[p[1], jj] * C[t, jj] / p[2] for jj, p in pos.items())
    return eq, trades


def stats(eq, dates_idx, years_per_day=250.0):
    e = eq[~np.isnan(eq)]
    if len(e) < 2:
        return {}
    n = len(e)
    cagr = (e[-1] / e[0]) ** (years_per_day / (n - 1)) - 1
    mdd = float((e / np.maximum.accumulate(e) - 1).min())
    r = e[1:] / e[:-1] - 1
    sharpe = float(r.mean() / r.std() * np.sqrt(years_per_day)) if r.std() > 0 else 0.0
    return {'cagr': float(cagr), 'mdd': mdd, 'mult': float(e[-1] / e[0]), 'sharpe': sharpe}
