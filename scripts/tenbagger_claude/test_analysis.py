#!/usr/bin/env python3
"""텐배거(클로드) 계산 값 시험 — 손으로 만든 작은 가격열로 정답을 알고 확인한다.

  A 수정주가 하루 수익률(daily_return): 정상 · 분할(기준가 수정) · 감자 기준가 미수정(시가총액 연속) · '1원' 자리표시 · 정리매매 폭락
  B 펀드·스팩 이름 거르기(FUND_RE): 펀드는 빼고 회사는 남긴다
  C 텐배거 구간(find_episodes): 저점·10배 날·고점·끝 · 못 사는 날은 저점이 될 수 없다 · 5년 창 밖은 아니다 · 고점 뒤 새 구간
  D 매도 시점(exit_index): 조건은 종가로 확인 → 다음 날 체결 · 거래 없는 날은 미룸 · 상장폐지 날 강제 · 과열 조임 · 10배 익절
  E 포트폴리오(portfolio): 신호 다음 날 종가에 산다(같은 날 사면 룩어헤드) · 정수 주식 · 비용
  F 앞날 최고가(forward_max) · 지표의 미래 자료 금지(roll)
  G 모형: AUC 정답값 · 로지스틱 회귀가 알려진 방향을 찾는다
변이 시험(scripts/tenbagger_claude/mutation_test.py)이 이 파일로 옛 코드·틀린 코드를 빨간불로 잡는지 확인한다.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import panel  # noqa: E402
import features  # noqa: E402
from episodes import find_episodes  # noqa: E402
import backtest as BT  # noqa: E402
from model import fit_logit, predict, auc  # noqa: E402

FAILS = []
COUNT = [0]


def ok(name, cond, detail=''):
    COUNT[0] += 1
    if cond:
        print('PASS', name)
    else:
        FAILS.append(name)
        print('FAIL', name, detail)


def close(a, b, tol=1e-9):
    return abs(a - b) <= tol


# ── A 수정주가 ───────────────────────────────────────────────
def t_daily_return():
    f = lambda *a: [float(x) for x in a]
    close_, chg, prev, st, pst = (np.array(f(*x)) for x in (
        (110, 51900, 9900, 67000, 25, 300, 2440),          # 종가
        (10, -1100, 9575, 66999, -990, -900, 1618),        # 전일대비
        (100, 2650000, 325, 1, 1015, 1200, 822),           # 전일 종가
        (100, 5000, 142772, 100000, 1000, 500, 6468087),   # 상장주식수
        (100, 100, 4283174, 100000, 1000, 500, 6468087)))  # 전일 상장주식수
    tail = np.array([False, False, False, True, True, False, False])
    r, kind = panel.daily_return(close_, chg, prev, st, pst, tail)
    ok('A1 정상일: 기준가 100 → 110 = +10%', close(r[0], 0.10) and kind[0] == 0, (r[0], kind[0]))
    ok('A2 액면분할일: 기준가(53,000) 대비 −2.08% — 전일 종가(265만) 대비 −98% 가 아니다',
       close(r[1], 51900 / 53000 - 1) and kind[1] == 0, (r[1], kind[1]))
    exp = 9900 * 142772 / (325 * 4283174) - 1
    ok('A3 감자 재상장인데 기준가 미수정(325→9,900, 주식 30분의 1) → 시가총액 연속 +1.5%',
       close(r[2], exp, 1e-12) and kind[2] == 1 and abs(r[2]) < 0.02, (r[2], kind[2]))
    ok('A4 정리매매 구간이라도 \'1원\' 자리표시 → 67,000원 급등은 0 으로 고친다', r[3] == 0.0 and kind[3] == 2, (r[3], kind[3]))
    ok('A5 정리매매 폭락(1,015 → 25원)은 실제 손실로 둔다', close(r[4], 25 / 1015 - 1) and kind[4] == 0, (r[4], kind[4]))
    ok('A6 정리매매 밖의 −75% (주식 수 그대로) → 자료 문제로 0', r[5] == 0.0 and kind[5] == 2, (r[5], kind[5]))
    ok('A7 거래 재개 +197% (주식 수 그대로) → 0 (규정상 하루 최대 +160%)', r[6] == 0.0 and kind[6] == 2, (r[6], kind[6]))
    r2, k2 = panel.daily_return(np.array([130.0]), np.array([30.0]), np.array([100.0]), np.array([1.0]), np.array([1.0]), np.array([False]))
    ok('A8 상한가 +30% 는 그대로', close(r2[0], 0.30) and k2[0] == 0)


# ── B 이름 거르기 ────────────────────────────────────────────
def t_fund_names():
    import re
    R = re.compile(panel.FUND_RE)
    funds = ['KTB전환형1', '미래하이3', '베트남개발1', '실크자산 1', '굿라이프10', '동북아10호', '맥쿼리인프라', '한국ANKOR유전',
             '대우증권스팩', '교보메리츠', '세이우량채2', '리얼티1', '하이골드12호']
    firms = ['삼성전자', '메리츠증권', '세양선박', '영진인프라', '미래에셋벤처투자', 'KTB투자증권', '예스24', '카페24', 'E1',
             'SNG21', '마이크로프랜드', 'HD현대인프라코어', '에코프로']
    bad_f = [n for n in funds if not R.search(n)]
    bad_c = [n for n in firms if R.search(n)]
    ok('B1 펀드·스팩·리츠 이름은 걸러진다', not bad_f, bad_f)
    ok('B2 회사 이름은 남는다(메리츠증권·세양선박·예스24…)', not bad_c, bad_c)


# ── C 텐배거 구간 ────────────────────────────────────────────
def t_episodes():
    c = np.array([100, 60, 30, 10, 12, 20, 40, 70, 100, 130, 150, 120, 100, 74, 80], float)
    eps = find_episodes(c, W=1250)
    ok('C1 저점 10(3번째 날) → 10배(100) 첫날 8 → 고점 150(10) → 고점 −50% 이하 74(13)에서 끝',
       eps == [(3, 8, 10, 13)], eps)
    buy = np.ones(len(c), bool)
    buy[3] = False                      # 저점 날은 거래대금이 모자라 못 샀다
    eps2 = find_episodes(c, W=1250, can_buy=buy)
    ok('C2 못 사는 날(10원)은 저점이 될 수 없다 — 살 수 있던 다음 저점 12 → 120 이상 첫날(130, 9)이 10배 날',
       eps2 == [(4, 9, 10, 13)], eps2)
    eps3 = find_episodes(c, W=4)        # 저점에서 10배까지 5거래일 → 창(4일) 밖
    ok('C3 10배까지 걸린 날이 창(W)보다 길면 구간이 아니다', eps3 == [], eps3)
    sell = np.ones(len(c), bool)
    sell[8] = False                     # 10배 첫날은 거래가 없었다
    eps4 = find_episodes(c, W=1250, can_sell=sell)
    ok('C4 10배 날은 팔 수 있던 날이어야 한다 — 다음 거래일(9)로', eps4 == [(3, 9, 10, 13)], eps4)
    c5 = np.r_[c, [50, 30, 15, 20, 60, 150, 200, 90]]
    eps5 = find_episodes(c5, W=1250)
    ok('C5 고점 뒤 다시 바닥(15)을 다지고 10배(150)가 되면 새 구간', len(eps5) == 2 and eps5[1][0] == 17 and eps5[1][1] == 20, eps5)


# ── D 매도 시점 ─────────────────────────────────────────────
def t_exit():
    n = 30
    tr = np.ones(n, bool)
    ma = np.full(n, np.nan)
    c = np.array([10, 11, 12, 15, 20, 18, 13.9, 13, 12, 12] + [12] * 20, float)
    R = BT.Rule('trail30', trail=0.3, hold=250)
    e = BT.exit_index(c, ma, tr, 0, n - 1, R)
    ok('D1 추적 30%: 고점 20 → 13.9(−30.5%) 확인일 6 → 다음 날 7 에 판다(같은 날 팔면 미래 종가를 본 것)', e == 7, e)
    tr2 = tr.copy()
    tr2[7] = tr2[8] = False
    e2 = BT.exit_index(c, ma, tr2, 0, n - 1, R)
    ok('D2 매도일에 거래가 없으면 다음 거래일(9)로 미룬다', e2 == 9, e2)
    e3 = BT.exit_index(c, ma, tr, 0, 5, R)
    ok('D3 상장폐지 마지막 날(5)이 먼저 오면 그날 강제 매도', e3 == 5, e3)
    R4 = BT.Rule('hold', hold=12)
    ok('D4 조건이 없으면 보유 기한(12거래일)에 판다', BT.exit_index(c, ma, tr, 0, n - 1, R4) == 12)
    c5 = np.array([10, 12, 25, 30, 26, 23.9, 22, 22] + [22] * 22, float)
    ma5 = np.full(n, 11.0)
    R5 = BT.Rule('hot', hot=2.0, hot_trail=0.2, hold=250)
    e5 = BT.exit_index(c5, ma5, tr, 0, n - 1, R5)
    ok('D5 과열(200일선 2배) 뒤 고점 30 → 23.9(−20.3%) 확인일 5 → 6 에 판다', e5 == 6, e5)
    c6 = np.array([10, 12, 18, 21, 16] + [16] * 25, float)
    R6 = BT.Rule('hot', hot=2.0, hot_trail=0.2, hold=250)
    ok('D6 과열(200일선 2배)이 없으면 고점 대비 −24%(21→16)라도 팔지 않는다',
       BT.exit_index(c6, np.full(n, 15.0), tr, 0, n - 1, R6) == n - 1)
    c7 = np.array([1, 2, 5, 9.9, 10.2, 12] + [12] * 24, float)
    R7 = BT.Rule('t10', target=10, hold=250)
    ok('D7 10배 익절: 10배(10.2) 확인일 4 → 5 에 판다', BT.exit_index(c7, ma, tr, 0, n - 1, R7) == 5)
    c8 = np.array([10, 9, 8, 12, 13, 11.9, 11] + [11] * 23, float)
    m8 = np.full(n, 11.0)
    R8 = BT.Rule('ma', ma=True, hold=250)
    ok('D8 200일선 이탈은 한 번 위로 올라선 뒤부터 — 8·9 는 무시, 11.9 지나 11(<11 아님)… 11 미만 없음 → 보유 기한',
       BT.exit_index(c8, m8, tr, 0, n - 1, R8) == n - 1)
    c9 = np.array([10, 9, 8, 12, 13, 10.5, 10] + [10] * 23, float)
    ok('D9 위로 올라선(12) 뒤 10.5 < 11 확인일 5 → 6 에 판다', BT.exit_index(c9, m8, tr, 0, n - 1, R8) == 6)


# ── E 포트폴리오 ─────────────────────────────────────────────
def t_portfolio():
    T, N = 12, 2
    C = np.tile(np.arange(1, T + 1, dtype=float)[:, None] * 100, (1, N))
    RAW = C.copy()
    MA = np.full((T, N), np.nan)
    TR = np.ones((T, N), bool)
    last = np.array([T - 1, T - 1])
    years = np.full(T, 2026)
    R = BT.Rule('h3', hold=3)
    eq, tr = BT.portfolio({2: [0]}, C, RAW, MA, TR, last, R, years, slots=1, capital=10000.0)
    ok('E1 신호일 2 → 다음 날 3 종가에 산다(같은 날 사면 그날 종가를 보고 산 것)', tr and tr[0][1] == 3, tr)
    ok('E2 보유 3거래일 → 6 에 판다', tr and tr[0][2] == 6, tr)
    sh = int(10000 // (400 * (1 + BT.BUY_COST)))
    cash = 10000 - sh * 400 * (1 + BT.BUY_COST) + sh * 700 * (1 - BT.sell_cost(2026))
    ok('E3 정수 주식 · 살 때 비용 · 팔 때 비용·세금 반영', close(eq[6], cash, 1e-6), (eq[6], cash))
    TR2 = TR.copy()
    TR2[3, 0] = False
    eq2, tr2 = BT.portfolio({2: [0, 1]}, C, RAW, MA, TR2, last, R, years, slots=1, capital=10000.0)
    ok('E4 1순위가 그날 거래가 없으면 다음 후보(1)를 산다', tr2 and tr2[0][0] == 1, tr2)
    eq3, tr3 = BT.portfolio({2: [0, 1]}, C, RAW, MA, TR, last, R, years, slots=2, capital=10000.0, max_new=1)
    ok('E5 한 신호일에 새로 사는 수(max_new=1) 제한', len([x for x in tr3 if x[1] == 3]) == 1, tr3)


# ── F 지표 · 앞날 최고가 ─────────────────────────────────────
def t_features():
    C = np.array([[1.0], [3.0], [2.0], [5.0], [4.0]])
    fm = features.forward_max(C, 2)
    ok('F1 앞날 최고가 FM[t]=max(C[t+1..t+2]) — 그날 종가는 넣지 않는다', list(fm[:, 0][:4]) == [3.0, 5.0, 5.0, 4.0], fm[:, 0])
    M = np.arange(10, dtype=float)[:, None]
    m3 = features.roll(M, 3, 'max')
    ok('F2 3일 최고(roll)는 그날까지의 값만 본다(미래 없음): t=5 → 5', m3[5, 0] == 5.0 and np.isnan(m3[1, 0]), m3[:, 0])
    alive = np.array([[False], [True], [True], [True], [False]])
    ff = features.ffill_life(np.array([[np.nan], [2.0], [np.nan], [4.0], [np.nan]]), alive)
    ok('F3 상장 기간 안의 빈 날만 채운다(상장 전·폐지 뒤는 비움)', np.isnan(ff[0, 0]) and ff[2, 0] == 2.0 and np.isnan(ff[4, 0]), ff[:, 0])


# ── G 모형 ───────────────────────────────────────────────────
def t_model():
    ok('G1 AUC — 완벽한 순서 = 1', auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]) == 1.0)
    ok('G2 AUC — 거꾸로 = 0', auc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]) == 0.0)
    ok('G3 AUC — 모두 같은 점수 = 0.5(동점은 평균 순위)', auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]) == 0.5)
    rng = np.random.default_rng(7)
    X = rng.normal(size=(4000, 2))
    p = 1 / (1 + np.exp(-(-2 + 1.5 * X[:, 0] - 1.0 * X[:, 1])))
    y = (rng.random(4000) < p).astype(float)
    w = fit_logit(X, y, l2=1.0)
    ok('G4 로지스틱 회귀가 알려진 계수(−2, +1.5, −1.0)를 찾는다(±0.25)',
       abs(w[0] + 2) < 0.25 and abs(w[1] - 1.5) < 0.25 and abs(w[2] + 1.0) < 0.25, w)
    ok('G5 예측 확률은 0~1', float(predict(w, X).min()) > 0 and float(predict(w, X).max()) < 1)


if __name__ == '__main__':
    for fn in (t_daily_return, t_fund_names, t_episodes, t_exit, t_portfolio, t_features, t_model):
        fn()
    print(f'\n텐배거 계산 값 시험: {COUNT[0] - len(FAILS)} PASS / {len(FAILS)} FAIL')
    sys.exit(1 if FAILS else 0)
