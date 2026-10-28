"""R19 1:2:6 분할 매매 백테스트 — RSI → MACD → 일목 구름 순서로 비중 1 · 2 · 6 (2026-10-28 사용자 "이 전략이랑 무매랑 백테스트 해봐").

출처(사용자가 보낸 영상 요약 캡처 — 90세 현역 트레이더 1:2:6 매매법):
  매수(증거가 하나씩 더해질 때마다 비중을 늘린다 · 물타기 금지)
    1단계 비중 1: RSI 가 30 아래로 내려갔다가 다시 30 위로 회복 — 매도세가 약해진 첫 증거(탐색전 · 소액).
    2단계 비중 2: MACD 골든크로스 — 상승 전환의 신호가 확인되면 추가.
    3단계 비중 6: 가격이 일목균형표 구름대를 돌파하고 지지받는 모습(구름이 천장 → 바닥)까지 확인되면,
                  세 신호(RSI · MACD · 일목)가 모두 같은 방향(상승 쪽)일 때 가장 큰 비중 6.
  매도(근거가 사라질 때마다 1 · 2 · 6 순서로 정리)
    1단계 비중 1 정리: MACD 데드크로스 — 상승세의 경고등.
    2단계 비중 2 정리: 이미 MACD 로 1을 판 상태에서 RSI 까지 약해짐(과열권 70 이상에서 고점 뒤 꺾임,
                       또는 상승 흐름을 유지하지 못하고 아래를 향함).
    3단계 비중 6 정리: 가격이 구름대 아래로 완전히 이탈 — 상승 구조가 깨짐, 남은 6 전부.
  손실 관리: 진입 전 계좌 전체의 2% 손실을 최대 허용치로 정하고 이 손실액으로 매수 규모를 계산.

사전 등록(결과 보기 전 · 튜닝 없음 — 표준 지표값 그대로):
- 지표: RSI(14, 와일더) · MACD(12, 26, 9) · 일목(전환 9 · 기준 26 · 선행스팬B 52 · 26일 앞으로 그림).
  그날 구름 = 26거래일 전에 계산된 선행스팬 A · B(그날 값을 안 쓴다). 구름 위 = max(A, B) · 구름 아래 = min(A, B).
- 신호는 전날 종가까지의 지표로 정하고 오늘 종가에 체결한다(저장소 규칙 — 룩어헤드 금지).
  손절만 미리 걸어 둔 예약주문이라 오늘 저가가 닿으면 min(시가, 손절가)에 체결한다.
- 사이클: 1단계 신호에서 시작, 보유가 0주가 되면 끝. 매수 단계는 한 사이클에 한 번씩 1 → 2 → 3 순서로만.
  한 번이라도 판 뒤에는(근거가 사라지기 시작) 그 사이클에서 더 사지 않는다.
- v3(영상 설명 그대로 — 기본)
  1단계: RSI[그제] ≤ 30 < RSI[어제].
  2단계: MACD 가 시그널을 아래에서 위로 넘음.
  3단계: 이틀 연속 종가가 구름 위(돌파 뒤 다시 구름 속으로 무너지지 않음 = 지지) 이고,
         같은 날 RSI > 50(상승 쪽) · MACD > 시그널(상승 쪽) — 세 신호가 같은 방향.
  매도 1: MACD 데드크로스 → 1단계 몫.
  매도 2: 매도 1 이 이미 있었고 RSI 가 꺾임 — 70 이상에서 70 아래로 또는 50 이상에서 50 아래로 → 2단계 몫.
  매도 3: 3단계를 산 뒤 종가가 구름 아래(완전히 이탈) → 남은 것 전부.
  손절: 1단계 때 정한 손절가(그 전 20거래일 최저가) → 전부.
- 비교용으로 앞선 해석을 남긴다.
  v1(처음 해석)은 RSI 70 하향 → 1 · MACD → 1+2 · 구름 → 전부 순서다.
  v2(첫 정정)는 MACD → 1 · RSI 70 하향 → 2 · 구름 → 6 순서다. 두 해석 모두 3단계에 세 신호 조건이 없고 판 뒤에도 더 산다.
- 비중: 사이클 예산 B 의 1/9 · 2/9 · 6/9. 정수 주수(원금 1만$ · 10만$ 두 버전 — CLAUDE.md 규칙).
  A(분할 원칙만): B = 그때 자산 전액.
  B(2% 손실 원칙까지): B = min(자산, 자산 × 2% ÷ 손절 폭). 손절 폭 = (어제 종가 − 손절가) ÷ 어제 종가.
- 비용은 무매 엔진(backtest.html 실전 비용 모델)과 같다.
  수수료는 매수 · 매도 각 0.25% 다. 종가 체결은 슬리피지 없음, 손절은 0.05%.
  양도세는 22% · 연 250만원 공제 · 환율 1,350원 · 해마다 정산 · 이월 없음이다.
- 시세: 배당까지 조정한 일봉(앱 시험 자료와 같은 기준 — 조정 종가 비율로 시 · 고 · 저를 맞춤).

재현: python3 scripts/research/r19_126_split.py <bars.json> [시작 끝 ...]
  bars.json = {"TQQQ": [[날짜, 시가, 고가, 저가, 종가], ...], "SOXL": [...]}
"""
import json
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
        t, k = mid(i, 9), mid(i, 26)
        if t is not None and k is not None:
            span_a[i] = (t + k) / 2
        span_b[i] = mid(i, 52)
    ok = lambda i: i >= 26 and span_a[i - 26] is not None and span_b[i - 26] is not None
    top = [max(span_a[i - 26], span_b[i - 26]) if ok(i) else None for i in range(len(c))]
    bot = [min(span_a[i - 26], span_b[i - 26]) if ok(i) else None for i in range(len(c))]
    for i in range(min(34, len(macd))):                          # MACD 는 26일 지수평균이 자리잡기 전(첫 34봉)엔 쓰지 않는다
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
        t = max(0.0, self.real * KRW - DEDUCT) * TAX / KRW
        self.cash -= t
        self.tax += t
        self.real = 0.0


def curve_stats(curve, cap):
    """일별(또는 띄엄띄엄) 자산 기록 → MDD · 가장 긴 물속 기간(거래일 수) · 해마다 수익률."""
    pk, mdd, under, longest, start_v, yearly, last_y = 0.0, 0.0, 0, 0, cap, {}, None
    for d, v in curve:
        if v >= pk:
            pk, under = v, 0
        else:
            under += 1
            longest = max(longest, under)
        mdd = min(mdd, v / pk - 1)
        y = d[:4]
        if last_y is not None and y != last_y:
            start_v = yearly[last_y][1]
        yearly[y] = (start_v, v)
        last_y = y
    return mdd * 100, longest, {y: round((e / s - 1) * 100, 1) for y, (s, e) in yearly.items()}


def run(bars, start, end, cap, sizing="A", rules="v3"):
    o, h, l, c, rsi, macd, sig, top, bot = indicators(bars)
    dates = [b[0] for b in bars]
    idx = [i for i, d in enumerate(dates) if start <= d <= end and i >= 2]
    bk = Book(cap)
    stage, budget, stop, lots, above, sold1, sold_any = 0, 0.0, None, [0, 0, 0], 0, False, False
    curve, cyc, days_in, expo = [], [], 0, 0.0
    cnt = dict(stage2=0, stage3=0, stop=0, sell1=0, sell2=0, sell3=0)
    cur = None                                                   # 진행 중인 사이클(시작 자산 · 시작일)

    def close_cycle(i):
        nonlocal cur
        if cur:
            cyc.append(dict(pnl=(bk.cash - cur["eq"]) / cur["eq"] * 100, days=i - cur["i"], stage=cur["stage"]))
        cur = None

    for i in idx:
        y = dates[i][:4]
        if bk.year is not None and y != bk.year:
            bk.settle()
        bk.year = y
        a, p = i - 1, i - 2                                      # 어제 · 그제(신호는 어제까지)
        macd_up = macd[p] is not None and sig[p] is not None and macd[p] <= sig[p] and macd[a] > sig[a]
        macd_dead = macd[p] is not None and sig[p] is not None and macd[p] >= sig[p] and macd[a] < sig[a]
        rsi_x = lambda lvl: rsi[p] is not None and rsi[a] is not None and rsi[p] >= lvl > rsi[a]
        # 손절(예약주문) — 오늘 저가가 닿으면 시가/손절가 중 낮은 값
        if bk.sh > 0 and stop is not None and l[i] <= stop:
            bk.sell(min(o[i], stop) * (1 - SLIP_STOP), bk.sh)
            cnt["stop"] += 1
        elif bk.sh > 0:
            q = 0
            if rules == "v1":
                if rsi_x(70):
                    q += lots[0]; lots[0] = 0
                if macd_dead:
                    q += lots[0] + lots[1]; lots[0] = lots[1] = 0
            elif rules == "v2":
                if macd_dead and lots[0]:
                    q += lots[0]; lots[0] = 0
                if rsi_x(70) and lots[1]:
                    q += lots[1]; lots[1] = 0
            else:                                                # v3 — 영상 설명 그대로
                if macd_dead and lots[0]:
                    q += lots[0]; lots[0] = 0; sold1 = True; cnt["sell1"] += 1
                if sold1 and lots[1] and (rsi_x(70) or rsi_x(50)):
                    q += lots[1]; lots[1] = 0; cnt["sell2"] += 1
            if stage == 3 and bot[a] is not None and c[a] < bot[a]:
                q = bk.sh; lots = [0, 0, 0]; cnt["sell3"] += 1
            if q:
                bk.sell(c[i], q)
                sold_any = True
        if bk.sh == 0 and stage:
            close_cycle(i)
            stage, lots, sold1, sold_any = 0, [0, 0, 0], False, False
        above = above + 1 if (top[a] is not None and c[a] > top[a]) else 0
        can_buy = not (rules == "v3" and sold_any)
        if stage == 0 and bk.sh == 0 and rsi[p] is not None and rsi[a] is not None and rsi[p] <= 30 < rsi[a]:
            lo20 = min(l[max(0, a - 19):a + 1])
            dist = (c[a] - lo20) / c[a] if c[a] > lo20 else None
            eq = bk.cash
            budget = (min(eq, eq * 0.02 / dist) if dist else 0.0) if sizing == "B" else eq
            if budget > 0:
                q = bk.buy(c[i], int(budget * W[0] / c[i]))
                if q:
                    stop, lots, stage = lo20, [q, 0, 0], 1
                    cur = dict(eq=eq, i=i, stage=1)
        elif stage == 1 and can_buy and macd_up:
            lots[1] = bk.buy(c[i], int(budget * W[1] / c[i]))
            stage = 2; cur["stage"] = 2; cnt["stage2"] += 1
        elif stage == 2 and can_buy and above >= 2 and (rules != "v3" or (rsi[a] is not None and rsi[a] > 50 and macd[a] > sig[a])):
            lots[2] = bk.buy(c[i], int(budget * W[2] / c[i]))
            stage = 3; cur["stage"] = 3; cnt["stage3"] += 1
        v = bk.cash + bk.sh * c[i]
        if bk.sh > 0:
            days_in += 1
            expo += bk.sh * c[i] / v
        curve.append((dates[i], v))
    bk.settle()                                                  # 마지막 해 실현손익 정산(보유분 평가차익은 과세 안 함 — 무매 엔진과 같음)
    final = bk.cash + bk.sh * c[idx[-1]]
    curve[-1] = (curve[-1][0], final)
    mdd, longest, yearly = curve_stats(curve, cap)
    yrs = len(idx) / 252
    wins = [x["pnl"] for x in cyc if x["pnl"] > 0]
    losses = [x["pnl"] for x in cyc if x["pnl"] <= 0]
    return dict(final=round(final, 2), cagr=round(((final / cap) ** (1 / yrs) - 1) * 100, 2), mdd=round(mdd, 2), underwaterDays=longest,
                cycles=len(cyc) + (1 if cur else 0), closedCycles=len(cyc), winRate=round(len(wins) / len(cyc) * 100, 1) if cyc else None,
                avgWin=round(sum(wins) / len(wins), 2) if wins else None, avgLoss=round(sum(losses) / len(losses), 2) if losses else None,
                avgDays=round(sum(x["days"] for x in cyc) / len(cyc), 1) if cyc else None,
                inMarketPct=round(days_in / len(idx) * 100, 1), avgExposurePct=round(expo / len(idx) * 100, 1),
                fees=round(bk.fees, 2), tax=round(bk.tax, 2), yearly=yearly, **cnt)


def hold(bars, start, end, cap):
    d = [b for b in bars if start <= b[0] <= end]
    q = int(cap / (d[0][4] * (1 + FEE)))
    cash = cap - q * d[0][4] * (1 + FEE)
    curve = [(b[0], cash + q * b[4]) for b in d]
    mdd, longest, yearly = curve_stats(curve, cap)
    fin = curve[-1][1]
    return dict(final=round(fin, 2), cagr=round(((fin / cap) ** (1 / (len(d) / 252)) - 1) * 100, 2), mdd=round(mdd, 2), underwaterDays=longest, yearly=yearly)


if __name__ == "__main__":
    bars = json.load(open(sys.argv[1]))
    periods = sys.argv[2:] or ["2011-01-03", "2026-10-27", "2016-10-27", "2026-10-27", "2021-10-27", "2026-10-27"]
    res = {}
    for t, b in bars.items():
        for k in range(0, len(periods), 2):
            s, e = periods[k], periods[k + 1]
            for cap in (10000, 100000):
                for sz in ("A", "B"):
                    res[f"{t}|{s}|{cap}|126{sz}"] = run(b, s, e, cap, sz, "v3")
                res[f"{t}|{s}|{cap}|126Av2"] = run(b, s, e, cap, "A", "v2")
                res[f"{t}|{s}|{cap}|126Av1"] = run(b, s, e, cap, "A", "v1")
                res[f"{t}|{s}|{cap}|hold"] = hold(b, s, e, cap)
    print(json.dumps(res, ensure_ascii=False))
