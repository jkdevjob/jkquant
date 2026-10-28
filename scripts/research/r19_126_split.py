"""R19 1:2:6 분할 매매 백테스트 — RSI → MACD → 일목 구름 순서로 비중 1 · 2 · 6 (2026-10-28 사용자 "이 전략이랑 무매랑 백테스트 해봐").

출처(사용자 화면 캡처 · 영상 요약):
  1단계 RSI 가 30 이하에서 30 위로 회복 → 전체 비중의 1 매수(탐색전)
  2단계 MACD 가 시그널선을 상향 돌파(골든크로스) → 2 추가 매수
  3단계 일목균형표 구름대를 상향 돌파하고 지지받으면 → 6 매수
  매도도 같은 원칙 — 상승 추세의 근거가 사라질 때마다 1 · 2 · 6 순서로 단계별 매도
  손실 관리 — 진입 전 감당할 최대 손실(계좌의 2%)을 먼저 정하고 그 안에서 매수 금액을 정한다

사전 등록(결과 보기 전 · 튜닝 없음 — 표준 지표값 그대로):
- 지표: RSI(14, 와일더) · MACD(12, 26, 9) · 일목(전환 9 · 기준 26 · 선행스팬B 52 · 26일 앞으로 그림).
  그날 구름 = 26거래일 전에 계산된 선행스팬 A · B(그날 값을 안 쓴다).
- 신호는 전날 종가까지의 지표로 정하고 오늘 종가에 체결한다(저장소 규칙 — 룩어헤드 금지).
  손절만 미리 걸어 둔 예약주문이라 오늘 저가가 닿으면 min(시가, 손절가)에 체결한다.
- 사이클: 1단계 신호에서 시작, 보유가 0주가 되면 끝. 단계는 한 사이클에 한 번씩, 1 → 2 → 3 순서로만.
  1단계: RSI[어제−1] ≤ 30 이고 RSI[어제] > 30.
  2단계(1단계 뒤): MACD 가 시그널을 아래에서 위로 넘음.
  3단계(2단계 뒤): 이틀 연속 종가가 구름 위(구름 위 = max(선행A, 선행B)).
- 매도(사용자 정정 10/28 — "매도 판단의 지표 순서는 달라": 근거(MACD, RSI, 구름대 이탈)가 사라질 때마다 1 · 2 · 6):
  MACD 가 시그널 아래로(데드크로스) → 1단계 몫(1)을 판다.
  RSI 가 기준선 아래로 꺾임 → 2단계 몫(2)을 판다. 요약에 기준값이 없어 70 하향(기본)과 50 하향 둘 다 계산한다.
  3단계에 들어간 뒤 종가가 구름 아래(min(선행A, 선행B) 미만) → 남은 것(6) 전부 판다.
  처음 해석(RSI 70 하향 → 1 · MACD → 1+2)은 비교용으로 sell="v1" 에 남긴다.
  손절: 1단계 때 정한 손절가(그 전 20거래일 최저가)에 닿으면 전부 판다.
- 비중: 사이클 예산 B 의 1/9 · 2/9 · 6/9. 정수 주수(원금 1만$ · 10만$ 두 버전 — CLAUDE.md 규칙).
  변형 A(분할 원칙만): B = 그때 자산 전액.
  변형 B(2% 손실 원칙까지): B = min(자산, 자산 × 2% ÷ 손절 폭). 손절 폭 = (어제 종가 − 손절가) ÷ 어제 종가.
- 비용은 무매 엔진(backtest.html 실전 비용 모델)과 같다.
  수수료는 매수 · 매도 각 0.25% 다. 종가 체결은 슬리피지 없음, 손절은 0.05%.
  양도세는 22% · 연 250만원 공제 · 환율 1,350원 · 해마다 정산 · 이월 없음이다.
- 시세: 배당까지 조정한 일봉(앱 시험 자료와 같은 기준 — 조정 종가 비율로 시 · 고 · 저를 맞춤).

재현: python3 scripts/research/r19_126_split.py <bars.json> [시작 끝 ...]
  bars.json = {"TQQQ": [[날짜, 시가, 고가, 저가, 종가], ...], "SOXL": [...]}
"""
import json
import math
import sys

FEE, SLIP_STOP, TAX, KRW, DEDUCT = 0.0025, 0.0005, 0.22, 1350.0, 250e4
W = (1 / 9, 2 / 9, 6 / 9)


def rsi_series(c, n=14):
    out = [None] * len(c)
    if len(c) <= n:
        return out
    g = sum(max(c[i] - c[i - 1], 0) for i in range(1, n + 1)) / n
    lo = sum(max(c[i - 1] - c[i], 0) for i in range(1, n + 1)) / n
    out[n] = 100 - 100 / (1 + g / lo) if lo > 0 else 100.0
    for i in range(n + 1, len(c)):
        d = c[i] - c[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        lo = (lo * (n - 1) + max(-d, 0)) / n
        out[i] = 100 - 100 / (1 + g / lo) if lo > 0 else 100.0
    return out


def ema(xs, n):
    out, k, e = [], 2 / (n + 1), None
    for x in xs:
        e = x if e is None else e + k * (x - e)
        out.append(e)
    return out


def indicators(bars):
    o, h, l, c = ([b[k] for b in bars] for k in (1, 2, 3, 4))
    rsi = rsi_series(c)
    macd = [a - b for a, b in zip(ema(c, 12), ema(c, 26))]
    sig = ema(macd, 9)
    mid = lambda i, n: (max(h[i - n + 1:i + 1]) + min(l[i - n + 1:i + 1])) / 2 if i >= n - 1 else None
    span_a, span_b = [None] * len(c), [None] * len(c)
    for i in range(len(c)):
        t, k, b52 = mid(i, 9), mid(i, 26), mid(i, 52)
        if t is not None and k is not None:
            span_a[i] = (t + k) / 2
        span_b[i] = b52
    top = [max(span_a[i - 26], span_b[i - 26]) if i >= 26 and span_a[i - 26] is not None and span_b[i - 26] is not None else None for i in range(len(c))]
    bot = [min(span_a[i - 26], span_b[i - 26]) if i >= 26 and span_a[i - 26] is not None and span_b[i - 26] is not None else None for i in range(len(c))]
    # MACD 는 26일 지수평균이 자리잡기 전(첫 34봉)엔 쓰지 않는다
    for i in range(min(34, len(macd))):
        macd[i] = sig[i] = None
    return o, h, l, c, rsi, macd, sig, top, bot


class Book:
    """현금 · 주수 · 세무 원가(매수 수수료 포함) · 해마다 실현손익 → 양도세."""

    def __init__(self, cap):
        self.cash, self.sh, self.basis, self.real, self.year, self.fees, self.tax = cap, 0, 0.0, 0.0, None, 0.0, 0.0

    def buy(self, px, q):
        q = min(q, int(self.cash / (px * (1 + FEE))))
        if q <= 0:
            return 0
        amt = px * q
        self.cash -= amt * (1 + FEE)
        self.fees += amt * FEE
        self.basis += amt * (1 + FEE)
        self.sh += q
        return q

    def sell(self, px, q):
        q = min(q, self.sh)
        if q <= 0:
            return 0
        amt = px * q
        cost = self.basis * q / self.sh
        self.cash += amt * (1 - FEE)
        self.fees += amt * FEE
        self.real += amt * (1 - FEE) - cost
        self.basis -= cost
        self.sh -= q
        return q

    def settle(self):
        gain_krw = self.real * KRW - DEDUCT
        t = max(0.0, gain_krw) * TAX / KRW
        self.cash -= t
        self.tax += t
        self.real = 0.0


def run(bars, start, end, cap, variant="A", sell="v2", rsi_exit=70):
    o, h, l, c, rsi, macd, sig, top, bot = indicators(bars)
    dates = [b[0] for b in bars]
    idx = [i for i, d in enumerate(dates) if start <= d <= end and i >= 2]
    bk = Book(cap)
    stage, budget, stop, lots, above = 0, 0.0, None, [0, 0, 0], 0
    eq_curve, cycles, days_in = [], 0, 0
    cnt = dict(stage2=0, stage3=0, stop=0, rsi70=0, macdDead=0, cloudBreak=0)
    for i in idx:
        y = dates[i][:4]
        if bk.year is not None and y != bk.year:
            bk.settle()
        bk.year = y
        a, p = i - 1, i - 2                                  # 어제 · 그제(신호는 어제까지)
        cross_up = lambda s, lvl: s[p] is not None and s[a] is not None and s[p] <= lvl < s[a]
        # 손절(예약주문) — 오늘 저가가 닿으면 시가/손절가 중 낮은 값
        if bk.sh > 0 and stop is not None and l[i] <= stop:
            bk.sell(min(o[i], stop) * (1 - SLIP_STOP), bk.sh)
            lots, stage = [0, 0, 0], 0
            cnt["stop"] += 1
        if bk.sh > 0:
            sells = 0
            rsi_down = rsi[p] is not None and rsi[a] is not None and rsi[p] >= rsi_exit > rsi[a]
            macd_dead = macd[p] is not None and macd[a] is not None and sig[p] is not None and macd[p] >= sig[p] and macd[a] < sig[a]
            if sell == "v1":                                 # 처음 해석: RSI → 1 · MACD → 1+2
                if rsi_down:
                    sells += lots[0]; lots[0] = 0
                    cnt["rsi70"] += 1
                if macd_dead:
                    sells += lots[0] + lots[1]; lots[0] = lots[1] = 0
                    cnt["macdDead"] += 1
            else:                                            # 사용자 정정(10/28): MACD → 1 · RSI → 2 · 구름 → 6
                if macd_dead and lots[0]:
                    sells += lots[0]; lots[0] = 0
                    cnt["macdDead"] += 1
                if rsi_down and lots[1]:
                    sells += lots[1]; lots[1] = 0
                    cnt["rsi70"] += 1
            if stage == 3 and bot[a] is not None and c[a] < bot[a]:
                sells = bk.sh; lots = [0, 0, 0]
                cnt["cloudBreak"] += 1
            if sells:
                bk.sell(c[i], sells)
            if bk.sh == 0:
                stage = 0
        above = above + 1 if (top[a] is not None and c[a] > top[a]) else 0
        # 단계 매수
        if stage == 0 and bk.sh == 0 and cross_up(rsi, 30):
            lo20 = min(l[max(0, a - 19):a + 1])
            dist = (c[a] - lo20) / c[a] if c[a] > lo20 else None
            eq = bk.cash
            if variant == "B":
                budget = min(eq, eq * 0.02 / dist) if dist else 0.0
            else:
                budget = eq
            if budget > 0:
                stop = lo20
                q = bk.buy(c[i], int(budget * W[0] / c[i]))
                if q:
                    lots, stage, cycles = [q, 0, 0], 1, cycles + 1
        elif stage == 1 and macd[p] is not None and sig[p] is not None and macd[p] <= sig[p] and macd[a] > sig[a]:
            lots[1] = bk.buy(c[i], int(budget * W[1] / c[i]))
            stage = 2
            cnt["stage2"] += 1
        elif stage == 2 and above >= 2:
            lots[2] = bk.buy(c[i], int(budget * W[2] / c[i]))
            stage = 3
            cnt["stage3"] += 1
        if bk.sh > 0:
            days_in += 1
        eq_curve.append((dates[i], bk.cash + bk.sh * c[i]))
    bk.settle()                                              # 마지막 해 실현손익 정산(보유분 평가차익은 과세 안 함 — 무매 엔진과 같음)
    final = bk.cash + bk.sh * c[idx[-1]]
    pk, mdd = 0.0, 0.0
    for _, v in eq_curve:
        pk = max(pk, v)
        mdd = min(mdd, v / pk - 1)
    yrs = len(idx) / 252
    return dict(final=round(final, 2), ret=round((final / cap - 1) * 100, 2), cagr=round(((final / cap) ** (1 / yrs) - 1) * 100, 2),
                mdd=round(mdd * 100, 2), cycles=cycles, inMarketPct=round(days_in / len(idx) * 100, 1), fees=round(bk.fees, 2), tax=round(bk.tax, 2), **cnt)


def hold(bars, start, end, cap):
    d = [b for b in bars if start <= b[0] <= end]
    q = int(cap / (d[0][4] * (1 + FEE)))
    cash = cap - q * d[0][4] * (1 + FEE)
    pk, mdd = 0.0, 0.0
    for b in d:
        v = cash + q * b[4]
        pk = max(pk, v)
        mdd = min(mdd, v / pk - 1)
    fin = cash + q * d[-1][4]
    yrs = len(d) / 252
    return dict(final=round(fin, 2), cagr=round(((fin / cap) ** (1 / yrs) - 1) * 100, 2), mdd=round(mdd * 100, 2))


if __name__ == "__main__":
    bars = json.load(open(sys.argv[1]))
    periods = sys.argv[2:] or ["2011-01-03", "2026-10-27", "2016-10-27", "2026-10-27", "2021-10-27", "2026-10-27"]
    res = {}
    for t, b in bars.items():
        for k in range(0, len(periods), 2):
            s, e = periods[k], periods[k + 1]
            for cap in (10000, 100000):
                for v in ("A", "B"):
                    res[f"{t}|{s}|{cap}|126{v}"] = run(b, s, e, cap, v)                       # 정정 매도 순서 · RSI 70 하향
                    res[f"{t}|{s}|{cap}|126{v}r50"] = run(b, s, e, cap, v, rsi_exit=50)       # 정정 매도 순서 · RSI 50 하향
                    res[f"{t}|{s}|{cap}|126{v}old"] = run(b, s, e, cap, v, sell="v1")          # 처음 해석(비교용)
                res[f"{t}|{s}|{cap}|hold"] = hold(b, s, e, cap)
    print(json.dumps(res, ensure_ascii=False, indent=0))
