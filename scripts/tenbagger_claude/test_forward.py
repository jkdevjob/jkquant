#!/usr/bin/env python3
"""텐배거(클로드) 전향 시험 값 시험 — 손으로 만든 작은 시장(10종목 · 330거래일)으로 정답을 알고 확인한다.

  H 날짜: 등록 뒤 첫 종가(15:30 기준) · 월말(뒤늦게 알아도 '아니다'로만 틀림) · 18시 전 자료 컷
  I 후보 범위: 관리종목·펀드 이름·거래대금 부족·상장 60거래일 미만은 못 산다 · 상폐 전 꼬리는 미래 정보라 안 쓴다
  J 장부: 첫 매수는 첫 신호 다음 거래일 종가 · 과열 뒤 20% 하락은 다음 날 종가 매도 · 상장폐지는 마지막 가격 ·
          1년(시험은 60거래일) 보유 끝 · 자료가 끝났다고 팔지 않는다 · 매도 예정 표시
  K 기록: 이미 기록한 사건은 고치지 않는다 · 자료가 바뀌면 수정 감지만 남긴다 · 알림은 자료일마다 한 번
  L 자료 창: 30년 패널의 상장 기간을 잇는다 · 창 첫날 거래정지 종목의 행을 버리지 않는다
  M 잠금: 고정 모형·규칙이 바뀌면 멈춘다 · 무작위 열쇠는 종목으로만 정한다
변이 시험(mutation_test.py)이 이 파일로 틀린 전향 코드를 빨간불로 잡는지 확인한다.
"""
import copy
import datetime as dt
import json
import os
import shutil
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forward as F  # noqa: E402
from signals import RANK_FEATS  # noqa: E402

FAILS = []
COUNT = [0]
# 저장소 경로(고정 모형) — 변이 시험은 임시 폴더에서 돌므로 TB_APP 으로 알려 준다
APP = os.environ.get('TB_APP') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')


def ok(name, cond, detail=''):
    COUNT[0] += 1
    if cond:
        print('PASS', name)
    else:
        FAILS.append(name)
        print('FAIL', name, detail)


KST = F.KST
N_DAYS, K0, REF = 330, 260, 100
DATES = [d.strftime('%Y-%m-%d') for d in pd.bdate_range('2025-01-02', periods=N_DAYS)]
CODES = {'A': '000010', 'B': '000020', 'C': '000030', 'D': '000040', 'E': '000050', 'F': '000060', 'G': '000070',
         'H': '000080', 'I': '000090', 'J': '000100'}


def b_path():
    c = np.full(N_DAYS, 1000.0)
    up = [1300, 1690, 2197, 2856, 3000, 3000, 3000, 3000, 2700, 2300]      # 262~271: 과열(200일선 2배) → 최고 대비 −23%
    c[262:272] = up
    c[272:] = 2300
    return c


def market(revise=None, upto=N_DAYS, extra=False):
    """종목별 종가 경로 → marcap 모양 표. NaN = 그날 행 없음(상장 전·폐지 뒤)."""
    flat = np.full(N_DAYS, 1000.0)
    spec = {   # 이름, 종가, 시가총액(작을수록 모형 점수 높음), 소속부, 거래대금
        'A': ('가온', flat, 10e8, '', 2e8),
        'B': ('나래', b_path(), 20e8, '', 2e8),
        'C': ('다솜', np.where(np.arange(N_DAYS) <= 280, 1000.0, np.nan), 30e8, '', 2e8),    # 280일 뒤 상장폐지
        'D': ('라온', flat, 11e8, '관리종목(소속부없음)', 2e8),
        'E': ('마루스팩1호', flat, 12e8, '', 2e8),
        'F': ('바다', flat, 13e8, '', 5e7),                                                  # 거래대금 부족
        'G': ('사랑', np.where(np.arange(N_DAYS) >= 240, 1000.0, np.nan), 25e8, '', 2e8),     # 240일 신규 상장
        'H': ('아라', flat, 40e8, '', 2e8),
        'I': ('자람', flat, 50e8, '', 2e8),
        'J': ('차오', flat, 60e8, '', 2e8),                                                  # 창 첫 21일 거래정지
    }
    if extra:   # 코드 순서상 맨 앞에 끼어드는 관리종목 — 후보는 아니지만 자료 창의 종목 번호를 모두 한 칸씩 민다
        CODES['Z'] = '000000'
        spec = {'Z': ('가가', flat, 1e8, '관리종목(소속부없음)', 2e8), **spec}
    rows = []
    for k, (name, c, cap, dept, amt) in spec.items():
        c = c.copy()
        if revise and revise[0] == k:
            c[revise[1]] = revise[2]
        prev = None
        for i in range(upto):
            if not np.isfinite(c[i]):
                prev = None
                continue
            vol = 0 if (k == 'J' and i <= 20) else 1000
            chg = 0.0 if prev is None else c[i] - prev
            rows.append(dict(Date=pd.Timestamp(DATES[i]), Code=CODES[k], Name=name, Market='KOSDAQ', Dept=dept,
                             Open=c[i], High=c[i], Low=c[i], Close=c[i], Volume=vol, Amount=amt if vol else 0.0,
                             Changes=chg, Marcap=cap, Stocks=cap / 1000))
            prev = c[i]
    return pd.DataFrame(rows)


def toy_model(hold=60):
    cols = [c + '_r' for c in RANK_FEATS] + [c + '_r2' for c in RANK_FEATS] + ['kosdaq', 'kan', 'kddn', 'qddn']
    w = [0.0] * (len(cols) + 1)
    w[1 + cols.index('lcap_r')] = -4.0                 # 시가총액이 작을수록 점수가 높다(시험용)
    ages = {CODES[k]: 1000 for k in 'ABCDEFHIJ'}       # 기준일(REF)에 상장 1000거래일 — G 는 기준일 뒤 상장
    return dict(version='toy', trainedThrough=DATES[REF], auc={}, label='toy', cols=cols, mu=[0.0] * len(cols),
                sd=[1.0] * len(cols), w=w, universe=dict(liqMin=1e8, ageMin=60, excludeDept=[1, 2], rankWithin='inv'),
                rule=dict(name='시험', trail=None, hold=hold, ma=False, hot=2.0, hot_trail=0.2, target=None, stop=None),
                portfolio=dict(slots=3, fee=0.00015, slip=0.002), backtest={}, ageRef=dict(date=DATES[REF], ages=ages))


def at(day, hm='08:00'):
    return dt.datetime.fromisoformat(f'{DATES[day]}T{hm}:00+09:00')


def engine(upto, revise=None, state=None, model=None, extra=False):
    model = model or toy_model()
    ctx = F.build(market(revise, upto, extra), DATES[upto - 1], model, None)
    st = state if state is not None else F.new_state(at(K0), 'toy', 'toy')
    rep, st2, new, revs = F.run(ctx, model, 'toy', st, at(min(upto, N_DAYS - 1), '20:00'), dict(engineSha256='e'))
    return ctx, rep, st2, new, revs


F.SLOTS = 3
F.BOOKS = {'usd100k': 3.0e6, 'usd10k': 3.0e5}
F.MC_SEEDS = 4


# ── H 날짜 ───────────────────────────────────────────────────────
def t_dates():
    d = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
    reg = lambda s: dt.datetime.fromisoformat(s)
    ok('H1 등록 10/13 20:00 KST → 첫 신호는 다음 거래일(10/14) 종가', F.kickoff_index(d, reg('2026-10-13T20:00:00+09:00')) == 2)
    ok('H2 등록 10/13 08:00 KST(장 마감 전) → 그날(10/13) 종가가 첫 신호', F.kickoff_index(d, reg('2026-10-13T08:00:00+09:00')) == 1)
    ok('H3 등록 15:30 정각 = 종가가 이미 났다 → 다음 거래일', F.kickoff_index(d, reg('2026-10-13T15:30:00+09:00')) == 2)
    ok('H4 UTC 로 적힌 등록 시각도 한국 시각으로 본다(10/13 11:30Z = 20:30 KST)',
       F.kickoff_index(d, reg('2026-10-13T11:30:00+00:00')) == 2)
    ok('H5 등록 뒤 자료가 아직 없으면 시작 전(None)', F.kickoff_index(d, reg('2026-10-15T16:00:00+09:00')) is None)
    me = F.month_end_flags(['2026-10-28', '2026-10-29', '2026-10-30'])
    ok('H6 자료 끝 10/30(금): 다음 평일 11/2 가 다른 달 → 월말 신호', list(me) == [False, False, True], me)
    me = F.month_end_flags(['2026-09-29', '2026-09-30', '2026-10-01'])
    ok('H7 지난 날은 다음 거래일이 다른 달이면 월말(9/30) · 자료 끝 10/1 은 아님', list(me) == [False, True, False], me)
    me = F.month_end_flags(['2026-12-29', '2026-12-30'])
    ok('H8 12/30(수) 다음 평일 12/31 은 같은 달 → 그날엔 월말 아님(연말 휴장은 1월 자료가 와야 늦게 잡힌다)', list(me) == [False, False], me)
    me = F.month_end_flags(['2026-12-29', '2026-12-30', '2027-01-04'])
    ok('H9 1월 첫 거래일 자료가 들어오면 12/30 을 월말로 늦게 잡는다', list(me) == [False, True, False], me)
    sd = F.signal_days(['2026-10-12', '2026-10-13', '2026-10-30', '2026-11-02', '2026-11-30', '2026-12-01'], 1)
    ok('H10 신호일 = 첫 신호 + 그 뒤 월말만(첫 신호 전 월말·월초는 아님)', sd == [1, 2, 4], sd)
    ok('H11 18:00 KST 전 실행은 오늘 행을 안 쓴다 · 뒤면 쓴다',
       F.completed_cutoff(reg('2026-10-13T17:59:00+09:00')) == '2026-10-12'
       and F.completed_cutoff(reg('2026-10-13T18:00:00+09:00')) == '2026-10-13')
    ok('H12 첫 신호 예정일: 금요일 저녁 등록 → 월요일', F.expected_kickoff('2026-10-16T12:00:00+00:00') == '2026-10-19')


# ── I · J 후보 범위와 장부 ─────────────────────────────────────────
def t_book():
    ctx, rep, st, new, revs = engine(N_DAYS)
    b = rep['books']['usd100k']
    buys = [e for e in st['events'] if e['type'] == 'buy' and e['book'] == 'usd100k']
    first = sorted(e['code'] for e in buys if e['date'] == DATES[K0 + 1])
    ok('J1 첫 신호(260일) 다음 거래일 종가에 3칸 매수 · 그 전 매수 없음',
       len(first) == 3 and min(e['date'] for e in buys) == DATES[K0 + 1], (first, [e['date'] for e in buys][:4]))
    ok('I1 시가총액 작은 순 중 관리종목(D)·스팩 이름(E)·거래대금 부족(F)·상장 20일(G)은 빼고 A·B·C',
       first == [CODES['A'], CODES['B'], CODES['C']], first)
    ok('I2 상폐 전 30거래일(C, 280일 폐지)이라도 그날엔 몰랐으니 산다(백테의 꼬리 가림은 미래 정보)', CODES['C'] in first)
    sig = [e for e in st['events'] if e['type'] == 'signal']
    ok('I3 첫 신호 기록 = 등록 뒤 첫 종가(260일) · 첫 신호 표시', sig[0]['date'] == DATES[K0] and sig[0]['kickoff'], sig[:1])
    eb = next(e for e in buys if e['code'] == CODES['A'])
    exp_sh = int((3.0e6 / 3) // (1000 * (1 + F.BT.BUY_COST)))
    ok('J2 정수 주식 = 칸 예산 ÷ (가격×(1+비용)) 내림 · 체결가 = 그날 종가', eb['shares'] == exp_sh and eb['price'] == 1000.0,
       (eb, exp_sh))
    sells = {e['code']: e for e in st['events'] if e['type'] == 'sell' and e['book'] == 'usd100k'}
    sb = sells.get(CODES['B'])
    xs = [e for e in st['events'] if e['type'] == 'exitSignal' and e['book'] == 'usd100k' and e['code'] == CODES['B']]
    ok('J3 과열(200일선 2배) 뒤 최고 대비 −20% → 조건일(271) 다음 거래일(272) 종가 매도',
       sb is not None and sb['date'] == DATES[272] and sb['reason'] == 'hotTrail' and sb['price'] == 2300.0
       and xs and xs[0]['date'] == DATES[271], (sb, xs))
    exp_net = (2300 * (1 - F.sell_cost(int(DATES[272][:4]))) / (1000 * (1 + F.BT.BUY_COST)) - 1) * 100
    ok('J4 순수익 = 비용·거래세 뺀 값(B: 1000→2300)', sb is not None and abs(sb['netPct'] - round(exp_net, 2)) < 1e-9,
       (sb and sb['netPct'], exp_net))
    sc = sells.get(CODES['C'])
    ok('J5 상장폐지(C)는 마지막 거래일(280) 가격으로 강제 정리', sc is not None and sc['date'] == DATES[280]
       and sc['reason'] == 'delisted' and sc['price'] == 1000.0, sc)
    sa = sells.get(CODES['A'])
    ok('J6 보유 한도(시험 60거래일) → 261+60=321일 종가 매도 · 예고는 그 전날', sa is not None and sa['date'] == DATES[321]
       and sa['reason'] == 'time' and any(e['type'] == 'exitSignal' and e['code'] == CODES['A'] and e['date'] == DATES[320]
                                          and e['book'] == 'usd100k' for e in st['events']), sa)
    held = {h['code'] for h in b['holdings']}
    ok('J7 자료가 끝났다고 팔지 않는다 — 나중에 산 종목은 마지막 날 보유로 남는다',
       len(b['holdings']) >= 1 and all(h['code'] not in sells or sells[h['code']]['date'] < h['entryDate'] for h in b['holdings']),
       (held, list(sells)))
    me_after = [i for i in range(273, N_DAYS - 1) if DATES[i][:7] != DATES[i + 1][:7]][0]
    rebuy = sorted(e['code'] for e in buys if e['date'] == DATES[me_after + 1])
    free = 1 + (me_after > 280)                         # B 매도(272) + C 폐지(280)가 그 월말 전이면 두 칸
    order = ['B'] + (['G'] if me_after - 240 >= 60 else []) + ['H', 'I', 'J']
    exp = sorted(CODES[k] for k in order[:free])
    ok('J8 B 매도 뒤 첫 월말 신호 → 다음 거래일 빈 칸만 작은 시가총액 순으로(B 다시 1순위 · 60거래일 안 된 G 제외)',
       rebuy == exp and free == 2, (DATES[me_after], rebuy, exp))
    g_buy = [e for e in buys if e['code'] == CODES['G']]
    ok('I4 신규 상장 G 는 60거래일 지난 뒤 월말 신호에서만 산다',
       all(DATES.index(e['signalDate']) - 240 >= 60 for e in g_buy), [e['signalDate'] for e in g_buy])
    ok('J9 무작위 순서 비교·장부 둘(1만$·10만$) · 값이 숫자', rep['random']['p50'] is not None
       and set(rep['books']) == {'usd100k', 'usd10k'} and np.isfinite(rep['books']['usd10k']['retPct']))
    ok('I5 후보 표(지금 순위)는 매수 후보 범위만 · 보유 표시', all(c['code'] not in (CODES['D'], CODES['E'], CODES['F'])
                                                    for c in rep['candidates']) and any(c['held'] for c in rep['candidates']))
    return st


def t_pending():
    _, rep, _, _, _ = engine(272)       # 자료 끝 = 271일(조건 성립일)
    h = {x['code']: x for x in rep['books']['usd100k']['holdings']}
    ok('J10 조건이 자료 마지막 날 성립 → 보유 중 · 매도 예정(과열 조임) · 아직 매도 없음',
       CODES['B'] in h and h[CODES['B']]['pendingExit'] == 'hotTrail' and h[CODES['B']]['exitSignalDate'] == DATES[271]
       and h[CODES['B']]['hot'] and not any(e['type'] == 'sell' for e in rep['events']), h.get(CODES['B']))
    _, rep, _, _, _ = engine(321)       # 자료 끝 = 320일, A 는 321일이 보유 한도
    h = {x['code']: x for x in rep['books']['usd100k']['holdings']}
    ok('J11 보유 한도 전날 → 다음 거래일 종가 매도 예정(time)', h.get(CODES['A'], {}).get('pendingExit') == 'time', h.get(CODES['A']))
    _, rep, _, _, _ = engine(K0 + 1)    # 자료 끝 = 첫 신호일
    ok('J12 자료 끝이 첫 신호일 → 신호 표시 · 빈 칸 3 · 아직 매수 없음(다음 거래일 종가)',
       rep['lastIsSignal'] and rep['freeSlots'] == 3 and not rep['books']['usd100k']['holdings']
       and not any(e['type'] == 'buy' for e in rep['events']), (rep['lastIsSignal'], rep['freeSlots']))


# ── K 기록 ───────────────────────────────────────────────────────
def t_ledger():
    _, _, st1, new1, _ = engine(272)
    frozen = copy.deepcopy({e['id']: e for e in st1['events']})
    _, _, st2, new2, revs2 = engine(N_DAYS, state=st1)
    after = {e['id']: e for e in st2['events']}
    ok('K1 다음 실행은 새 사건만 덧붙이고 이미 기록한 사건(처음 본 시각 포함)은 그대로',
       all(after[i] == frozen[i] for i in frozen) and len(new2) > 0 and not revs2, (len(new2), revs2[:1]))
    bump = DATES.index(next(e['date'] for e in st1['events'] if e['type'] == 'buy'))
    _, _, st3, new3, revs3 = engine(N_DAYS, revise=('A', bump, 1010.0), state=st2)
    a_id = f"buy:usd100k:{DATES[bump]}:{CODES['A']}"
    fixed = {e['id']: e for e in st3['events']}
    ok('K2 지난 종가가 바뀌면 기록은 그대로 두고 수정 감지만 남긴다',
       fixed[a_id]['price'] == 1000.0 and any(r['id'] == a_id and r['field'] == 'price' and r['recomputed'] == 1010.0
                                              for r in revs3), revs3[:3])
    _, _, st4, _, revs4 = engine(N_DAYS, revise=('A', bump, 1010.0), state=st3)
    ok('K3 같은 수정은 한 번만 남긴다', not revs4 and len(st4['revisions']) == len(st3['revisions']))
    try:
        st_bad = copy.deepcopy(st2)
        st_bad['lastAsOf'] = '2099-01-01'
        engine(N_DAYS, state=st_bad)
        ok('K4 자료 날짜가 뒤로 가면 멈춘다', False)
    except ValueError:
        ok('K4 자료 날짜가 뒤로 가면 멈춘다', True)
    # 알림 — 실제 매수·매도 때만(사용자 요청 2026-10-13) · 머리말 [클로드 연구 텐배거] · 10만$ 장부 기준
    def step(upto, state):
        _, rep, st, nw, _ = engine(upto, state=state)
        return rep, st, nw
    mdd = lambda i: DATES[i][5:].replace('-', '/')
    st0 = F.new_state(at(K0), 'toy', 'toy')
    rep_w, st_w, _ = step(K0, st0)                      # 자료 끝 = 첫 신호 전날
    ok('K5 등록·시작 전에는 알림 없음(등록 알림·요약·후보는 보내지 않는다)', rep_w['status'] == 'waiting_kickoff' and rep_w['alert'] is None,
       rep_w['alert'])
    rep_k, st_k, _ = step(K0 + 1, st_w)                 # 자료 끝 = 첫 신호일
    al = rep_k['alert']
    ok('K6 첫 신호일 자료 → "[클로드 연구 텐배거] 🟢 매수" · 다음 거래일 종가 매수 예정 3종목(가온·나래·다솜)',
       al and al['stage'] == 'buy' and al['text'].startswith('[클로드 연구 텐배거] 🟢 매수\n')
       and f"{mdd(K0 + 1)} 종가 매수 예정 3종목: 가온, 나래, 다솜" in al['body'] and len(al['body']) <= F.NOTE_MAX
       and '실주문 없음' in al['body'] and len(al['text']) <= 1500, al)
    rep_f, st_f, nw_f = step(K0 + 2, st_k)              # 체결일
    ok('K7 예고한 매수의 체결일엔 다시 알리지 않는다(매수 기록은 남는다)',
       rep_f['alert'] is None and sum(1 for e in nw_f if e['type'] == 'buy') == 6, rep_f['alert'])
    rep_q, st_q, _ = step(K0 + 3, st_f)
    ok('K8 매수·매도 없는 날은 알림 없음', rep_q['alert'] is None, rep_q['alert'])
    rep_s, st_s, _ = step(272, st_q)                    # 자료 끝 = 271(나래 과열 조임 조건일)
    al = rep_s['alert']
    ok('K9 매도 조건일 자료 → "🔴 매도" · 다음 거래일 종가 매도 예정(나래 · 과열 뒤 20% 하락)',
       al and al['stage'] == 'sell' and f"{mdd(272)} 종가 매도 예정: 나래(과열 뒤 20% 하락" in al['body']
       and al['text'].startswith('[클로드 연구 텐배거] 🔴 매도\n'), al)
    rep_l, _, _ = step(K0 + 2, st_w)                    # 자료가 늦어 신호일·체결일이 한 번에
    al = rep_l['alert']
    ok('K10 자료가 늦어 신호·체결이 한 번에 들어오면 체결로 한 번 알림(예정 아님)',
       al and al['stage'] == 'buy' and f"{mdd(K0 + 1)} 종가 매수 3종목: 가온, 나래, 다솜" in al['body']
       and '자료가 늦어 체결 뒤 알림' in al['text'] and '예정' not in al['body'], al)
    rep_d, _, _ = step(282, st_s)                       # 다솜 280일 뒤 폐지 · 나래 매도는 이미 예고
    al = rep_d['alert'] or {}
    ok('K11 상장폐지 정리는 예고 없던 매도라 체결로 알림 · 예고했던 나래 매도는 다시 안 알림',
       '다솜' in al.get('body', '') and '상장폐지 정리' in al.get('body', '') and '나래 +' not in al.get('body', ''), al)
    me_after = [i for i in range(273, N_DAYS - 1) if DATES[i][:7] != DATES[i + 1][:7]][0]
    _, st_m, _ = step(me_after, st_s)
    rep_m, _, _ = step(me_after + 1, st_m)             # 자료 끝 = 월말 신호일
    al = rep_m['alert'] or {}
    ok('K12 월말 신호 → 빈 칸만 · 보유 종목(가온) 빼고 매수 예정(나래·아라)',
       f"{mdd(me_after + 1)} 종가 매수 예정 2종목: 나래, 아라" in al.get('body', '') and '가온' not in al.get('body', ''), al)
    # 자료일마다 한 번 · 같은 자료로 다시 돌리면 같은 알림 · 텔레그램은 처음 만들 때만(fresh)
    d = tempfile.mkdtemp(prefix='tbf-')
    try:
        ctx, rep, s1, nw, rv = engine(K0 + 1, state=st0)
        ch1, n1, f1 = F.finish(d, st0, rep, s1, nw, rv, at(K0, '20:00'), 1)
        saved = json.load(open(os.path.join(d, 'state-1.0.0.json'), encoding='utf-8'))
        ch2, n2, f2 = F.finish(d, saved, copy.deepcopy(rep), copy.deepcopy(saved), [], [], at(K0 + 1, '07:00'), 1)
        ok('K13 알림은 자료일마다 한 번 기록 · 같은 자료로 다시 돌리면 쓰지 않고 같은 알림(웹 알림 서버가 한 번만) · 텔레그램은 처음만',
           ch1 and f1 and n1 and n1['stage'] == 'buy' and not ch2 and n2 == n1 and not f2, (n1, n2, f1, f2))
        snap = os.path.join(d, 'snapshots', f'1.0.0-{DATES[K0]}.json')
        before = open(snap, encoding='utf-8').read()
        rep2 = copy.deepcopy(rep)
        rep2['generatedAt'] = 'changed'
        rep2['alert'] = dict(stage='sell', body='다른 문장', text='[클로드 연구 텐배거] 🔴 매도')
        _, n7, f7 = F.finish(d, saved, rep2, copy.deepcopy(saved), [{'type': 'buy', 'book': 'usd100k'}], [], at(K0 + 1, '07:00'), 1)
        ok('K14 같은 자료일을 다시 계산해 새 사건이 생겨도 사진·그날 알림은 처음 것 그대로 · 텔레그램 다시 안 보냄',
           open(snap, encoding='utf-8').read() == before and n7 == n1 and not f7, (n7, f7))
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ── L 자료 창 ────────────────────────────────────────────────────
def t_window():
    ctx = F.build(market(), DATES[-1], toy_model(), None)
    j = list(ctx['codes']).index(CODES['A'])
    ok('L1 기준일에 상장돼 있던 종목의 상장 기간 = 30년 패널 값(1000) + 그 뒤 거래일 수',
       ctx['D']['age'][REF, j] == 1000 and ctx['D']['age'][REF + 50, j] == 1050 and ctx['D']['age'][0, j] == 900,
       ctx['D']['age'][[0, REF, REF + 50], j])
    g = list(ctx['codes']).index(CODES['G'])
    ok('L2 기준일 뒤 상장 종목(G)은 창 안 상장일부터 센다', ctx['D']['age'][260, g] == 20, ctx['D']['age'][260, g])
    jj = list(ctx['codes']).index(CODES['J'])
    ok('L3 창 첫날부터 거래정지인 종목(J)도 행을 버리지 않는다(30년 패널과 같은 3년 고점·상장 기간)',
       ctx['D']['first'][jj] == 0, ctx['D']['first'][jj])
    ok('L4 아직 상장 중인 종목의 정리일은 자료 끝 너머(T) · 폐지 종목만 마지막 날',
       ctx['last'][j] == ctx['T'] and ctx['last'][list(ctx['codes']).index(CODES['C'])] == 280)


# ── M 잠금 · 무작위 열쇠 ──────────────────────────────────────────
def t_lock():
    d = tempfile.mkdtemp(prefix='tbf-app-')
    slots = F.SLOTS
    F.SLOTS = 20                                        # 실제 고정 모형은 20칸
    try:
        src = os.path.join(APP, F.MODEL_REL)
        dst = os.path.join(d, F.MODEL_REL)
        os.makedirs(os.path.dirname(dst))
        shutil.copy(src, dst)
        m, sha = F.load_model(d)
        ok('M1 고정 모형 sha256 이 코드에 적힌 값과 같다(저장소 그대로)', sha == F.MODEL_SHA256 and m['rule']['hold'] == 250)
        raw = open(dst, encoding='utf-8').read()
        open(dst, 'w', encoding='utf-8').write(raw.replace('"hot_trail":0.2', '"hot_trail":0.25'))
        try:
            F.load_model(d)
            ok('M2 모형·규칙 파일을 한 글자라도 바꾸면 멈춘다', False)
        except ValueError:
            ok('M2 모형·규칙 파일을 한 글자라도 바꾸면 멈춘다', True)
    finally:
        F.SLOTS = slots
        shutil.rmtree(d, ignore_errors=True)
    st = F.new_state(at(K0), 'a', 'r1')
    try:
        F.check_state(st, 'a', 'r2')
        ok('M3 규칙 묶음(칸 수·원금·비용 등)이 바뀌면 같은 장부를 잇지 않는다', False)
    except ValueError:
        ok('M3 규칙 묶음(칸 수·원금·비용 등)이 바뀌면 같은 장부를 잇지 않는다', True)
    _, r1, _, _, _ = engine(N_DAYS)
    _, r2, _, _, _ = engine(N_DAYS, extra=True)
    CODES.pop('Z', None)
    ok('M5 무작위 비교는 자료 창의 종목 번호가 밀려도 같다(열쇠가 종목 자체에 붙어 있음)',
       r1['random'] == r2['random'] and r1['books']['usd100k']['value'] == r2['books']['usd100k']['value'],
       (r1['random']['p50'], r2['random']['p50']))
    ok('M4 무작위 열쇠는 씨앗·코드·상장일로만 정한다(같은 값 · 씨앗마다 다름)',
       F.mc_key(3, '005930', '2022-01-03') == F.mc_key(3, '005930', '2022-01-03')
       and F.mc_key(3, '005930', '2022-01-03') != F.mc_key(4, '005930', '2022-01-03'))


def main():
    t_dates()
    st = t_book()
    t_pending()
    t_ledger()
    t_window()
    t_lock()
    del st
    print(f'\n텐배거 전향 시험 값 시험: {COUNT[0] - len(FAILS)} PASS / {len(FAILS)} FAIL')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
