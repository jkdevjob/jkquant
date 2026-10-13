#!/usr/bin/env python3
"""텐배거(클로드) 전향 시험 — 30년 분석에서 고른 패턴을 '앞으로 새로 생기는 날'에만 모의로 사고판다. 실주문 없음.

무엇을 사나   고정 모형(forward-model-1.0.0.json) 점수 상위 20종목. 순위 기준·후보 범위는 30년 백테와 같다(signals.py).
언제 사나     등록 뒤 첫 종가로 첫 신호 → 그다음 거래일 종가에 매수. 그 뒤로는 백테와 같이 매달 마지막 거래일 종가 신호 →
              다음 거래일 종가에 빈 칸만 채운다.
언제 파나     백테에서 앞 시기(2003~2012)로 고른 규칙 '1년 · 과열(200일선 2배) 뒤 최고 종가 대비 20% 하락' —
              조건은 종가로 확인하고 다음 거래일 종가에 판다. 상장폐지는 마지막 거래일 가격으로 정리된다.
얼마나        원금 1만$(₩1,400만) · 10만$(₩1억4,000만) 두 장부 · 20칸 균등 · 정수 주식 · 수수료·미끄러짐·거래세.

원칙
  - 매매 계산은 30년 백테와 같은 코드(backtest.portfolio · exit_index · exit_cond, signals.score_day)를 그대로 쓴다.
  - 규칙·모형은 등록 전에 고정한다(sha256 잠금). 바꾸려면 새 버전 장부로 시작한다 — 옛 기록을 덮어쓰지 않는다.
  - 등록 전 날짜로 거슬러 사지 않는다. 신호는 그날 종가까지의 자료로만 정한다(룩어헤드 금지).
  - 상장폐지 전 30거래일 제외(백테)는 미래를 알아야 해서 쓰지 않는다 — 그날 알 수 있는 관리·환기 지정만 거른다.
  - 매일 처음부터 다시 계산하되 이미 기록한 사건(신호·매수·매도)은 고치지 않는다. 다시 계산한 값이 다르면
    '수정 감지'로 따로 남긴다. 실시간 체결이 아니라 장 마감 공식 종가로 다시 만든 모의 장부다.

자료: KRX 전종목시세(FinanceData/marcap) — 그날 upstream 커밋으로 고정해 받고 sha256 을 남긴다.
쓰는 법(Actions): python .app/scripts/tenbagger_claude/forward.py --app .app --out data/tenbagger-claude-forward \
                     --cache /tmp/tbc-inputs --note-out /tmp/tbc-note.json
로컬 확인:        ... --marcap-dir /path/to/marcap/data --now 2026-10-13T20:00:00+09:00
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.request
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import panel  # noqa: E402
from features import derive, LIQ_MIN  # noqa: E402
from signals import AGE_MIN, EXCLUDE_DEPT, buy_universe, drawdown, index_on, score_day  # noqa: E402
import backtest as BT  # noqa: E402
from backtest import Rule, exit_cond, portfolio, sell_cost  # noqa: E402

VERSION = '1.0.0'
MODEL_REL = 'data/tenbagger/claude/forward-model-1.0.0.json'
MODEL_SHA256 = '726527c7f490dca074a8402647ff34d7312541a6de99e19057c145c52a5e7564'
WINDOW_FROM = 2022          # 지표가 750거래일(3년 고점)까지 보므로 기준일(2026-10-08)보다 4년 앞에서 시작
BOOKS = {'usd100k': 1.4e8, 'usd10k': 1.4e7}
MAIN = 'usd100k'
SLOTS = 20
MC_SEEDS = 30               # 같은 규칙 · 무작위 순서 20종목 — 모형 순위가 운보다 나은지 본다
TOP_SHOW = 20
KST = ZoneInfo('Asia/Seoul')
CLOSE_HM = (15, 30)         # KRX 정규장 종가 시각
ENGINE_FILES = ['forward.py', 'backtest.py', 'signals.py', 'features.py', 'panel.py', 'model.py']
NOTE_MAX = 240
UA = 'jkquant-tenbagger-claude-forward/1.0'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def sha_file(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def engine_sha():
    h = hashlib.sha256()
    for f in ENGINE_FILES:
        h.update(f.encode() + b'\0' + pathlib.Path(HERE, f).read_bytes() + b'\0')
    return h.hexdigest()


def rules_doc(model_sha):
    """장부를 잠그는 규칙 묶음 — 하나라도 바뀌면 같은 장부를 이어 쓰지 않는다."""
    return dict(version=VERSION, modelSha256=model_sha, books=BOOKS, main=MAIN, slots=SLOTS, mcSeeds=MC_SEEDS,
                windowFrom=WINDOW_FROM, liqMin=LIQ_MIN, ageMin=AGE_MIN, excludeDept=list(EXCLUDE_DEPT),
                fee=BT.FEE, slip=BT.SLIP,
                kickoff='등록 시각 뒤 첫 종가(15:30 KST)가 첫 신호 · 다음 거래일 종가 매수',
                monthEnd='매달 마지막 거래일 종가 신호(자료 끝 날은 다음 평일이 다른 달이면 월말) · 다음 거래일 종가 매수',
                delistTail='쓰지 않음(미래 정보)')


def load_model(app):
    path = pathlib.Path(app, MODEL_REL)
    sha = sha_file(path)
    if sha != MODEL_SHA256:
        raise ValueError(f'고정 모형이 바뀌었다({sha[:12]}…) — 새 버전 장부로 시작해야 한다')
    m = json.loads(path.read_text(encoding='utf-8'))
    u = m['universe']
    if (u['liqMin'] != LIQ_MIN or u['ageMin'] != AGE_MIN or list(u['excludeDept']) != list(EXCLUDE_DEPT)
            or u['rankWithin'] != 'inv'):
        raise ValueError('후보 범위 상수가 고정 모형과 다르다')
    if m['portfolio']['fee'] != BT.FEE or m['portfolio']['slip'] != BT.SLIP or m['portfolio']['slots'] != SLOTS:
        raise ValueError('비용·칸 수가 고정 모형과 다르다')
    return m, sha


def rule_of(m):
    r = m['rule']
    return Rule(r['name'], trail=r['trail'], hold=r['hold'], ma=r['ma'], hot=r['hot'], hot_trail=r['hot_trail'],
                target=r['target'], stop=r['stop'])


# ── 자료 ─────────────────────────────────────────────────────────
def completed_cutoff(now):
    """18:00 KST 전이면 오늘 행을 쓰지 않는다(공개 자료가 덜 찼을 수 있다)."""
    k = now.astimezone(KST)
    day = k.date() if k.hour >= 18 else k.date() - dt.timedelta(days=1)
    return day.isoformat()


def fetch(url, timeout=90):
    h = {'User-Agent': UA}
    if url.startswith('https://api.github.com/') and os.environ.get('GITHUB_TOKEN'):
        h['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']      # Actions 공용 IP 의 호출 한도를 피한다
    req = urllib.request.Request(url, headers=h)
    last = None
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:     # 네트워크 일시 오류만 다시 — 끝내 실패하면 그대로 오류
            last = e
    raise RuntimeError(f'받기 실패 {url}: {last}')


def load_marcap(years, cache, local_dir=None):
    frames, inputs = [], []
    if local_dir:
        upstream = 'local'
        for y in years:
            p = pathlib.Path(local_dir, f'marcap-{y}.parquet')
            if not p.exists():
                continue
            frames.append(pd.read_parquet(p, columns=panel.COLS))
            inputs.append({'url': str(p), 'sha256': sha_file(p), 'bytes': p.stat().st_size})
    else:
        ref = json.loads(fetch('https://api.github.com/repos/FinanceData/marcap/git/ref/heads/master', 30))
        upstream = ref['object']['sha']
        if not re.fullmatch(r'[0-9a-f]{40}', upstream):
            raise ValueError('upstream 커밋 형식 오류')
        cache = pathlib.Path(cache)
        cache.mkdir(parents=True, exist_ok=True)
        for y in years:
            url = f'https://raw.githubusercontent.com/FinanceData/marcap/{upstream}/data/marcap-{y}.parquet'
            data = fetch(url)
            p = cache / f'marcap-{y}.parquet'
            p.write_bytes(data)
            frames.append(pd.read_parquet(p, columns=panel.COLS))
            inputs.append({'url': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    if not frames:
        raise ValueError('marcap 자료 없음')
    df = pd.concat(frames, ignore_index=True)
    df['Code'] = df['Code'].astype(str).str.zfill(6)
    return df, inputs, upstream


def market_index(local_aux=None):
    """코스피·코스닥 지수(네이버) — 모형의 시장 낙폭 특징과 비교용. 못 받으면 None(순위는 같고 점수 수준만 달라진다)."""
    try:
        if local_aux:
            return json.load(open(local_aux, encoding='utf-8'))['index']
        from industry import index_series
        return {s: index_series(s) for s in ('KOSPI', 'KOSDAQ')}
    except Exception as e:
        print('지수 받기 실패 —', e, flush=True)
        return None


# ── 패널 · 지표 ──────────────────────────────────────────────────
def apply_age_ref(D, P, ref):
    """최근 몇 년 자료로 만든 패널의 '상장 기간'을 30년 패널과 같게 잇는다.
    기준일(ref.date)에 상장돼 있던 종목은 그날의 30년 패널 상장 기간 + 그 뒤 거래일 수."""
    dates = P['dates']
    iR = int(np.searchsorted(dates, ref['date']))
    if iR >= len(dates) or dates[iR] != ref['date']:
        raise ValueError('상장 기간 기준일이 자료 창에 없다: ' + ref['date'])
    T = len(dates)
    steps = np.arange(T, dtype=np.float64) - iR
    n = 0
    for j, code in enumerate(P['codes']):
        a = ref['ages'].get(str(code))
        if a is None or not (D['first'][j] <= iR <= D['last'][j]):
            continue
        col = (a + steps).astype(np.float32)
        col[~D['alive'][:, j]] = np.nan
        D['age'][:, j] = col
        n += 1
    return n


def build(df, cutoff, model, index_rows):
    d = df[df['Date'] <= pd.Timestamp(cutoff)]
    sel = panel.select_universe(d)
    adj, cal = panel.chain_adjust(sel, keep_open_start=True)
    P = panel.to_wide(adj, cal)
    dates = P['dates']
    T, N = P['close'].shape
    D = derive(P, np.zeros(N, dtype=bool))          # 상장폐지 꼬리 가림 없음(그날엔 알 수 없다)
    aged = apply_age_ref(D, P, model['ageRef'])
    M0 = buy_universe(D)
    delisted = D['last'] < T - 1                    # 자료 끝 전에 사라진 종목 = 상장폐지(정리매매 마지막 가격으로 정리)
    last_fw = np.where(delisted, D['last'], T)      # 아직 상장 중이면 자료 끝 너머 — 자료가 끝났다고 팔지 않는다
    TR = (np.nan_to_num(P['vol']) > 0) & D['alive']
    years = np.array([int(x[:4]) for x in dates])
    if index_rows:
        K, Q = index_on(dates, index_rows['KOSPI']), index_on(dates, index_rows['KOSDAQ'])
        kdd, qdd = drawdown(K), drawdown(Q)
        idx_ok = bool(np.isfinite(K[-1]) and np.isfinite(Q[-1]))
    else:
        K = Q = kdd = qdd = np.full(T, np.nan)
        idx_ok = False
    return dict(P=P, D=D, M0=M0, dates=dates, T=T, N=N, delisted=delisted, last=last_fw, TR=TR, years=years,
                K=K, Q=Q, kdd=kdd, qdd=qdd, idx_ok=idx_ok, aged=aged,
                codes=P['codes'], names=P['names'], ids=P['ids'], first_dates=P['first'])


# ── 신호 날짜 ────────────────────────────────────────────────────
def kickoff_index(dates, registered_at):
    """등록 시각 뒤에 나온 첫 종가의 거래일. 없으면 None(아직 시작 전)."""
    k = registered_at.astimezone(KST)
    rd = k.date().isoformat()
    before_close = (k.hour, k.minute) < CLOSE_HM
    for i, d in enumerate(dates):
        if d > rd or (d == rd and before_close):
            return i
    return None


def expected_kickoff(registered_at):
    """첫 신호 예정일(평일 기준 — 휴장은 자료가 들어와야 안다)."""
    k = dt.datetime.fromisoformat(registered_at).astimezone(KST)
    d = k.date() if (k.hour, k.minute) < CLOSE_HM else k.date() + dt.timedelta(days=1)
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d.isoformat()


def month_end_flags(dates):
    """매달 마지막 거래일. 자료 끝 날은 다음 평일이 다른 달이면 월말로 본다(틀려도 '아니다'로만 틀린다 —
    연말 휴장처럼 남은 평일이 다 휴일이면 다음 달 첫 거래일 자료가 들어온 뒤 늦게 잡힌다)."""
    me = np.zeros(len(dates), dtype=bool)
    for i in range(len(dates) - 1):
        me[i] = dates[i][:7] != dates[i + 1][:7]
    if len(dates):
        d = dt.date.fromisoformat(dates[-1])
        n = d + dt.timedelta(days=1)
        while n.weekday() >= 5:
            n += dt.timedelta(days=1)
        me[-1] = n.month != d.month
    return me


def signal_days(dates, k0):
    if k0 is None:
        return []
    me = month_end_flags(dates)
    return sorted({k0} | {i for i in range(k0, len(dates)) if me[i]})


def mc_key(seed, code, first):
    """무작위 순서 열쇠 — 종목(코드·상장일)과 씨앗으로만 정한다(자료 창 순서가 바뀌어도 같은 값)."""
    return int(hashlib.sha256(f'{seed}:{code}:{first}'.encode()).hexdigest()[:13], 16)


# ── 장부 ─────────────────────────────────────────────────────────
def describe_book(ctx, rule, B, eq, k0):
    C, RAW, MA, dates, T = ctx['D']['C'], ctx['D']['raw'], ctx['D']['ma200'], ctx['dates'], ctx['T']
    codes, names, years = ctx['codes'], ctx['names'], ctx['years']
    buys = {(b['j'], b['t']): b for b in B['buys']}
    closed = []
    for x in B['sells']:
        j, t0, e = x['j'], x['t0'], x['t']
        b = buys[(j, t0)]
        w, m = C[t0:e + 1, j], MA[t0:e + 1, j]
        cond, hot = exit_cond(w, m, rule)
        k = np.flatnonzero(cond)
        if ctx['delisted'][j] and e == ctx['last'][j] and not (len(k) and t0 + k[0] + 1 <= e):
            reason, sig = 'delisted', None
        elif len(k) and t0 + k[0] + 1 <= e:
            reason, sig = 'hotTrail', dates[t0 + int(k[0])]
        else:
            reason, sig = 'time', dates[e - 1]
        cost = b['sh'] * b['px'] * (1 + BT.BUY_COST)
        net = (b['sh'] * x['px'] * (1 - sell_cost(years[e])) - cost) / cost
        closed.append(dict(code=str(codes[j]), name=str(names[j]), entryDate=dates[t0], entryPrice=round(b['px'], 2),
                           shares=int(b['sh']), exitDate=dates[e], exitPrice=round(x['px'], 2), netPct=round(net * 100, 2),
                           maxMult=round(float(np.nanmax(w) / w[0]), 3), hot=bool(hot[-1]) if len(hot) else False,
                           reason=reason, exitSignalDate=sig, sessions=int(e - t0)))
    hold = []
    for j, p in B['open'].items():
        t0 = p['t0']
        w, m = C[t0:T, j], MA[t0:T, j]
        cond, hot = exit_cond(w, m, rule)
        k = np.flatnonzero(cond)
        if len(k):
            pend, sig = 'hotTrail', dates[t0 + int(k[0])]
        elif t0 + rule.hold == T:
            pend, sig = 'time', dates[T - 1]
        else:
            pend, sig = None, None
        growth = float(w[-1] / w[0])
        value = p['sh'] * RAW[t0, j] * growth
        cost = p['sh'] * RAW[t0, j] * (1 + BT.BUY_COST)
        runmax = float(np.nanmax(w))
        hold.append(dict(code=str(codes[j]), name=str(names[j]), mkt='코스닥' if ctx['D']['mkt'][T - 1, j] == 2 else '코스피',
                         entryDate=dates[t0], entryPrice=round(float(RAW[t0, j]), 2), shares=int(p['sh']),
                         lastClose=round(float(RAW[T - 1, j]), 2), adjClose=round(float(RAW[t0, j] * growth), 2),
                         value=round(float(value)),
                         grossPct=round((growth - 1) * 100, 2),
                         netPct=round((value * (1 - sell_cost(years[T - 1])) - cost) / cost * 100, 2),
                         maxMult=round(runmax / float(w[0]), 3), fromHighPct=round((float(w[-1]) / runmax - 1) * 100, 2),
                         ma200x=round(float(w[-1] / m[-1]), 3) if np.isfinite(m[-1]) else None,
                         hot=bool(hot[-1]) if len(hot) else False, sessions=int(T - 1 - t0), holdMax=int(rule.hold),
                         traded=bool(ctx['TR'][T - 1, j]), pendingExit=pend, exitSignalDate=sig))
    hold.sort(key=lambda h: (h['entryDate'], h['code']))
    e = eq[k0:]
    curve = [[dates[k0 + i], round(float(v))] for i, v in enumerate(e)]
    mdd = float((e / np.maximum.accumulate(e) - 1).min()) if len(e) else 0.0
    wins = sum(1 for c in closed if c['netPct'] > 0)
    return dict(capital=float(eq[k0]), value=round(float(e[-1])), retPct=round((e[-1] / e[0] - 1) * 100, 2),
                mddPct=round(mdd * 100, 2), cash=round(B['cash']), holdings=hold, closed=closed,
                closedN=len(closed), wins=wins, curve=curve)


def book_events(book, ctx, B, desc):
    dates, codes, names = ctx['dates'], ctx['codes'], ctx['names']
    ev = []
    for b in B['buys']:
        j, t = b['j'], b['t']
        ev.append(dict(id=f'buy:{book}:{dates[t]}:{codes[j]}', type='buy', book=book, date=dates[t], code=str(codes[j]),
                       name=str(names[j]), shares=int(b['sh']), price=round(b['px'], 2), signalDate=dates[b['sig']]))
    for c in desc['closed']:
        ev.append(dict(id=f"sell:{book}:{c['exitDate']}:{c['code']}", type='sell', book=book, date=c['exitDate'],
                       code=c['code'], name=c['name'], shares=c['shares'], price=c['exitPrice'], netPct=c['netPct'],
                       reason=c['reason'], entryDate=c['entryDate'], exitSignalDate=c['exitSignalDate']))
        if c['exitSignalDate']:
            ev.append(dict(id=f"exitSignal:{book}:{c['exitSignalDate']}:{c['code']}", type='exitSignal', book=book,
                           date=c['exitSignalDate'], code=c['code'], name=c['name'], reason=c['reason']))
    for h in desc['holdings']:
        if h['pendingExit']:
            ev.append(dict(id=f"exitSignal:{book}:{h['exitSignalDate']}:{h['code']}", type='exitSignal', book=book,
                           date=h['exitSignalDate'], code=h['code'], name=h['name'], reason=h['pendingExit']))
    return ev


COMPARE = {'signal': ('picks',), 'buy': ('shares', 'price'), 'sell': ('shares', 'price', 'netPct', 'reason'),
           'exitSignal': ('reason',)}


def merge_events(state, events, now_iso, asof):
    """기록한 사건은 그대로 두고 새 사건만 덧붙인다. 다시 계산한 값이 다르거나 사라지면 수정 감지로만 남긴다."""
    known = {e['id']: e for e in state['events']}
    seen_rev = {r['rid'] for r in state['revisions']}
    new, revs = [], []
    for e in events:
        k = known.get(e['id'])
        if k is None:
            x = dict(e, firstSeenAt=now_iso, firstSeenAsOf=asof)
            state['events'].append(x)
            known[e['id']] = x
            new.append(x)
            continue
        for f in COMPARE[e['type']]:
            a, b = k.get(f), e.get(f)
            if f == 'picks':
                a, b = [p['code'] for p in (a or [])], [p['code'] for p in (b or [])]
            if a != b:
                rid = e['id'] + '|' + f + '|' + json.dumps(b, ensure_ascii=False, sort_keys=True)
                if rid not in seen_rev:
                    r = dict(rid=rid, id=e['id'], field=f, stored=a, recomputed=b, seenAt=now_iso, asOf=asof)
                    state['revisions'].append(r)
                    seen_rev.add(rid)
                    revs.append(r)
    ids = {e['id'] for e in events}
    for k in state['events']:
        if k['id'] not in ids:
            rid = k['id'] + '|missing'
            if rid not in seen_rev:
                r = dict(rid=rid, id=k['id'], field='missing', stored=True, recomputed=False, seenAt=now_iso, asOf=asof)
                state['revisions'].append(r)
                seen_rev.add(rid)
                revs.append(r)
    state['events'].sort(key=lambda e: (e['date'], e['type'] != 'signal', e['id']))
    return new, revs


# ── 알림 문장 ────────────────────────────────────────────────────
def md(d):
    return d[5:].replace('-', '/') if d else '—'


def spct(x):
    return '—' if x is None else ('+' if x >= 0 else '') + f'{x:.1f}%'


HEAD = '[클로드 연구 텐배거]'
STAGE_KO = {'buy': '🟢 매수', 'sell': '🔴 매도', 'both': '🟢🔴 매수·매도'}
REASON_KO = {'hotTrail': '과열 뒤 20% 하락', 'time': '1년 보유 끝', 'delisted': '상장폐지 정리'}
APP_LINK = 'jkquant.pages.dev/claude?tab=tenbagger'


def next_weekday(d):
    x = dt.date.fromisoformat(d) + dt.timedelta(days=1)
    while x.weekday() >= 5:
        x += dt.timedelta(days=1)
    return x.isoformat()


def trade_alert(rep, new_events, prior_ids):
    """실제 매수·매도 타이밍 알림만(사용자 요청 2026-10-13: 연구 메뉴 알림은 실제 매수·매도 때만 · '[클로드 연구 …]' 머리말).
    10만$ 장부 기준. 장 마감 자료가 다음 날 새벽에 들어오므로 '다음 거래일 종가 매수·매도 예정'을 그날 아침에 알린다.
    예고 없이 들어온 체결(상장폐지 · 자료가 늦어 신호와 체결이 한 번에 들어온 경우)은 체결로 한 번 알린다.
    등록 · 신호만 있고 살 칸 없음 · 주간 요약 · 후보는 알리지 않는다. 반환 dict(stage, body, text) 또는 None."""
    if rep['status'] != 'running':
        return None
    b = rep['books'][MAIN]
    held = {h['code']: h for h in b['holdings']}
    new_ids = {e['id'] for e in new_events}
    mine = [e for e in new_events if e.get('book') in (None, MAIN)]
    nxt = md(next_weekday(rep['asOf']))
    buy_l, sell_l, buy_t, sell_t = [], [], [], []
    sig = next((e for e in mine if e['type'] == 'signal' and e['date'] == rep['asOf']), None)
    if sig:
        free = SLOTS - len(b['holdings']) + sum(1 for h in b['holdings'] if h['pendingExit'])
        exp = [p for p in sig['picks'] if p['code'] not in held][:max(free, 0)]
        if exp:
            names = [p['name'] for p in exp]
            buy_l.append(f"{nxt} 종가 매수 예정 {len(exp)}종목: " + ', '.join(names[:6]) + (f" 외 {len(names) - 6}" if len(names) > 6 else ''))
            buy_t.append(f"다음 거래일({nxt}) 종가 매수 예정 {len(exp)}종목 — 칸당 원금의 1/{SLOTS}")
            buy_t += [f" {i + 1}. {p['name']} ({p['code']})" for i, p in enumerate(exp)]
    late_b = [e for e in mine if e['type'] == 'buy' and 'signal:' + e['signalDate'] not in prior_ids]
    if late_b:
        d0 = md(late_b[0]['date'])
        buy_l.append(f"{d0} 종가 매수 {len(late_b)}종목: " + ', '.join(e['name'] for e in late_b[:6]) + (f" 외 {len(late_b) - 6}" if len(late_b) > 6 else ''))
        buy_t.append(f"{d0} 종가 매수 {len(late_b)}종목(자료가 늦어 체결 뒤 알림)")
        buy_t += [f" · {e['name']} {e['shares']:,}주 @ {e['price']:,.0f}원" for e in late_b]
    pend = [h for h in b['holdings'] if h['pendingExit']
            and f"exitSignal:{MAIN}:{h['exitSignalDate']}:{h['code']}" in new_ids]
    if pend:
        sell_l.append(f"{nxt} 종가 매도 예정: " + ', '.join(f"{h['name']}({REASON_KO.get(h['pendingExit'], h['pendingExit'])} · 지금 {spct(h['netPct'])})" for h in pend))
        sell_t.append(f"다음 거래일({nxt}) 종가 매도 예정")
        sell_t += [f" · {h['name']} — {REASON_KO.get(h['pendingExit'], h['pendingExit'])} · 지금 {spct(h['netPct'])} · 최고 {h['maxMult']:.2f}배" for h in pend]
    late_s = [e for e in mine if e['type'] == 'sell'
              and f"exitSignal:{MAIN}:{e.get('exitSignalDate')}:{e['code']}" not in prior_ids]
    if late_s:
        sell_l.append(', '.join(f"{md(e['date'])} 종가 매도 {e['name']} {spct(e['netPct'])}({REASON_KO.get(e['reason'], e['reason'])})" for e in late_s))
        sell_t += [f"{md(e['date'])} 종가 매도 · {e['name']} {spct(e['netPct'])} — {REASON_KO.get(e['reason'], e['reason'])}" for e in late_s]
    stage = 'both' if buy_l and sell_l else 'buy' if buy_l else 'sell' if sell_l else None
    if not stage:
        return None
    body = ' · '.join(buy_l + sell_l) + ' · 10만$ 장부 · 모의(실주문 없음)'
    body = body if len(body) <= NOTE_MAX else body[:NOTE_MAX - 1] + '…'
    text = '\n'.join([f"{HEAD} {STAGE_KO[stage]}"] + buy_t + sell_t +
                     [f"10만$ 장부 {spct(b['retPct'])} · 보유 {len(b['holdings'])}/{SLOTS} · 모의 매매(실주문 없음)", '자세히: ' + APP_LINK])
    return dict(stage=stage, body=body, text=text[:1500])


# ── 한 번 실행 ────────────────────────────────────────────────────
def new_state(now, model_sha, rules_sha):
    return dict(schemaVersion=1, strategyVersion=VERSION, modelSha256=model_sha, rulesSha256=rules_sha,
                registeredAt=now.astimezone(dt.timezone.utc).isoformat(timespec='seconds'),
                registeredDate=now.astimezone(KST).date().isoformat(), events=[], revisions=[], runs=[], notes={},
                lastAsOf=None)


def check_state(state, model_sha, rules_sha):
    if state.get('strategyVersion') != VERSION or state.get('modelSha256') != model_sha or state.get('rulesSha256') != rules_sha:
        raise ValueError('잠근 규칙·모형이 바뀌었다 — 같은 장부를 이어 쓰지 않는다(새 버전으로 시작)')


def run(ctx, model, model_sha, state, now, source):
    """ctx(자료) · state(지난 기록) → (report, state, new_events, revisions). state 는 복사본을 고친다."""
    state = copy.deepcopy(state)
    dates, T, D, codes, names = ctx['dates'], ctx['T'], ctx['D'], ctx['codes'], ctx['names']
    asof = dates[-1]
    if state['lastAsOf'] and asof < state['lastAsOf']:
        raise ValueError('자료 날짜가 뒤로 갔다: ' + asof + ' < ' + state['lastAsOf'])
    now_iso = now.astimezone(dt.timezone.utc).isoformat(timespec='seconds')
    rule = rule_of(model)
    k0 = kickoff_index(dates, dt.datetime.fromisoformat(state['registeredAt']))
    sig = signal_days(dates, k0)
    lists = {s: score_day(D, s, ctx['M0'], model, ctx['kdd'], ctx['qdd'], codes) for s in sig}
    now_rank = lists.get(T - 1)
    if now_rank is None:
        now_rank = score_day(D, T - 1, ctx['M0'], model, ctx['kdd'], ctx['qdd'], codes)

    def pick_rows(X, n):
        out = []
        for i, r in enumerate(X.head(n).itertuples()):
            j = int(r.j)
            out.append(dict(rank=i + 1, code=str(codes[j]), name=str(names[j]), score=round(float(r.score), 4)))
        return out

    events = [dict(id=f'signal:{dates[s]}', type='signal', date=dates[s], universe=int(len(lists[s])),
                   kickoff=bool(s == k0), picks=pick_rows(lists[s], TOP_SHOW + 5)) for s in sig]
    books, desc = {}, {}
    eq_main = None
    if k0 is not None:
        sig_days = {s: lists[s]['j'].astype(int).tolist() for s in sig}
        for name, cap in BOOKS.items():
            B = {}
            eq, _ = portfolio(sig_days, D['C'], D['raw'], D['ma200'], ctx['TR'], ctx['last'], rule, ctx['years'],
                              slots=SLOTS, capital=cap, start=k0, book=B)
            desc[name] = describe_book(ctx, rule, B, eq, k0)
            events += book_events(name, ctx, B, desc[name])
            books[name] = B
            if name == MAIN:
                eq_main = eq
    prior_ids = {e['id'] for e in state['events']}
    new, revs = merge_events(state, events, now_iso, asof)

    # 같은 규칙 · 무작위 순서(종목 열쇠 고정) — 운으로 얼마나 나오나
    rnd = dict(seeds=MC_SEEDS, p10=None, p50=None, p90=None, beat=None, curve=[])
    if k0 is not None and T - 1 > k0:
        finals, curves = [], []
        first = ctx['first_dates']
        for seed in range(MC_SEEDS):
            keys = {}
            sd = {}
            for s in sig:
                js = lists[s]['j'].astype(int).to_numpy()
                kk = np.array([keys.setdefault(j, mc_key(seed, codes[j], first[j])) for j in js])
                sd[s] = [int(j) for j in js[np.argsort(kk, kind='stable')]]
            eq, _ = portfolio(sd, D['C'], D['raw'], D['ma200'], ctx['TR'], ctx['last'], rule, ctx['years'],
                              slots=SLOTS, capital=BOOKS[MAIN], start=k0)
            curves.append(eq[k0:] / BOOKS[MAIN])
            finals.append(eq[-1] / BOOKS[MAIN] - 1)
        Cv = np.vstack(curves)
        q = np.percentile(Cv, [10, 50, 90], axis=0)
        rnd.update(p10=round(float(np.percentile(finals, 10)) * 100, 2), p50=round(float(np.median(finals)) * 100, 2),
                   p90=round(float(np.percentile(finals, 90)) * 100, 2),
                   beat=round(float(np.mean(np.array(finals) < eq_main[-1] / BOOKS[MAIN] - 1)), 3),
                   curve=[[dates[k0 + i], round(float(q[0, i]), 4), round(float(q[1, i]), 4), round(float(q[2, i]), 4)]
                          for i in range(Cv.shape[1])])

    market = dict(ok=ctx['idx_ok'], curve=[])
    if k0 is not None and ctx['idx_ok']:
        K, Q = ctx['K'], ctx['Q']
        market.update(KOSPI=round((K[-1] / K[k0] - 1) * 100, 2), KOSDAQ=round((Q[-1] / Q[k0] - 1) * 100, 2),
                      curve=[[dates[i], round(float(K[i] / K[k0]), 4), round(float(Q[i] / Q[k0]), 4)] for i in range(k0, T)])

    held = set(h['code'] for h in desc[MAIN]['holdings']) if k0 is not None else set()
    cand = []
    for i, r in enumerate(now_rank.head(TOP_SHOW).itertuples()):
        j = int(r.j)
        cand.append(dict(rank=i + 1, code=str(codes[j]), name=str(names[j]), mkt='코스닥' if r.mkt == 2 else '코스피',
                         score=round(float(r.score), 4), cap=round(float(r.cap) / 1e8), price=round(float(r.raw)),
                         A20=round(float(r.A20) / 1e8, 1), ret60=round(float(r.ret60) * 100, 1),
                         dd3=round(float(r.dd3) * 100, 1), ma200p=round(float(r.ma200p), 3), held=str(codes[j]) in held))
    me = month_end_flags(dates)
    status = 'waiting_kickoff' if k0 is None else 'running'
    bt = model['backtest']
    rep = dict(ok=True, schemaVersion=1, strategyVersion=VERSION, status=status,
               generatedAt=now.astimezone(KST).isoformat(timespec='seconds'), asOf=asof,
               registeredAt=state['registeredAt'], registeredDate=state['registeredDate'],
               kickoff=dates[k0] if k0 is not None else None, expectedKickoff=expected_kickoff(state['registeredAt']), firstBuy=dates[k0 + 1] if k0 is not None and k0 + 1 < T else None,
               lastIsMonthEnd=bool(me[-1]), lastIsSignal=bool(sig and sig[-1] == T - 1),
               freeSlots=SLOTS - len(desc[MAIN]['holdings']) if k0 is not None else SLOTS,
               model=dict(version=model['version'], sha256=model_sha, trainedThrough=model['trainedThrough'],
                          auc=model['auc'], label=model['label'], rule=model['rule'], backtest=bt),
               source=source, universe=dict(asOf=asof, n=int(len(now_rank)), indexOk=ctx['idx_ok'],
                                            kdd=_r(ctx['kdd'][-1], 3), qdd=_r(ctx['qdd'][-1], 3)),
               books=desc, random=rnd, market=market, candidates=cand,
               signals=[e for e in state['events'] if e['type'] == 'signal'],
               events=state['events'], revisions=state['revisions'], runs=state['runs'][-30:],
               notes=['고정 모형·규칙으로 등록 뒤 날짜만 모의 매매합니다. 실주문·수익 보장 없음.',
                      '체결은 장 마감 공식 종가(KRX) 기준 · 수수료 0.015% · 미끄러짐 0.2% · 매도 거래세(연도별).',
                      '백테는 상장폐지 전 30거래일을 사지 않았지만(미래 정보) 전향 시험은 그날 알 수 있는 관리·환기 지정만 거릅니다.',
                      '점수는 3년 안 3배 추정 확률(30년 학습). 순위만 매수에 쓰므로 지수 자료가 없어도 고르는 종목은 같습니다.'])
    rep['alert'] = trade_alert(rep, new, prior_ids)
    return rep, state, new, revs


def _r(x, k):
    return None if x is None or not np.isfinite(x) else round(float(x), k)


def finish(out, state, rep, state2, new, revs, now, stale):
    """기록 쓰기 — 바뀐 것이 있을 때만(새 자료일 · 새 사건 · 수정 감지 · 첫 등록 · 엔진 변경).
    알림은 실제 매수·매도가 있는 자료일에만, 자료일마다 한 번 만든다(다시 돌려도 같은 문장 → 웹 알림 서버가 한 번만 보낸다).
    반환 (changed, 이 자료일의 알림 또는 None, 이번 실행에서 처음 만든 알림인지 — 텔레그램은 처음 만들 때만 보낸다)."""
    out = pathlib.Path(out)
    statepath = out / f'state-{VERSION}.json'
    existed = statepath.exists()
    asof = rep['asOf']
    advanced = state['lastAsOf'] != asof
    engine_moved = bool(state['runs']) and state['runs'][-1].get('engineSha256') != rep['source'].get('engineSha256')
    changed = bool(advanced or new or revs or not existed or engine_moved)
    if not changed:
        return False, state['notes'].get(asof), False
    state2['runs'].append(dict(at=rep['generatedAt'], asOf=asof, upstream=rep['source'].get('upstreamCommit'),
                               combinedSha256=rep['source'].get('combinedSha256'),
                               engineSha256=rep['source'].get('engineSha256'), newEvents=len(new), revisions=len(revs)))
    rep['runs'] = state2['runs'][-30:]
    fresh = False
    al = rep.get('alert')
    if al and asof not in state2['notes'] and stale <= 10:
        state2['notes'][asof] = dict(date=now.astimezone(KST).date().isoformat(), **al)
        fresh = True
    state2['lastAsOf'] = asof
    out.mkdir(parents=True, exist_ok=True)
    statepath.write_text(json.dumps(state2, ensure_ascii=False, indent=1, allow_nan=False), encoding='utf-8')
    body = json.dumps(rep, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    (out / 'latest.json').write_text(body, encoding='utf-8')
    snap = out / 'snapshots' / f'{VERSION}-{asof}.json'
    snap.parent.mkdir(exist_ok=True)
    if not snap.exists():
        snap.write_text(body, encoding='utf-8')
    return True, state2['notes'].get(asof), fresh


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', default=os.path.join(HERE, '..', '..'), help='저장소(main) 경로 — 고정 모형을 읽는다')
    ap.add_argument('--out', default='data/tenbagger-claude-forward')
    ap.add_argument('--cache', default='/tmp/tbc-inputs')
    ap.add_argument('--marcap-dir', help='로컬 marcap/data (개발용 — upstream 대신)')
    ap.add_argument('--aux', help='로컬 지수 자료(aux.json, 개발용)')
    ap.add_argument('--now', help='개발용 현재 시각(ISO)')
    ap.add_argument('--note-out', help='보낼 연구 알림(JSON)을 쓸 곳 — 보낼 것이 없으면 만들지 않는다')
    a = ap.parse_args()
    now = dt.datetime.fromisoformat(a.now) if a.now else dt.datetime.now(dt.timezone.utc)
    model, model_sha = load_model(a.app)
    rules_sha = digest(rules_doc(model_sha))
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    statepath = out / f'state-{VERSION}.json'
    state = json.loads(statepath.read_text(encoding='utf-8')) if statepath.exists() else new_state(now, model_sha, rules_sha)
    check_state(state, model_sha, rules_sha)
    cutoff = completed_cutoff(now)
    df, inputs, upstream = load_marcap(range(WINDOW_FROM, int(cutoff[:4]) + 1), a.cache, a.marcap_dir)
    idx = market_index(a.aux)
    ctx = build(df, cutoff, model, idx)
    source = dict(provider='KRX 전종목시세 via FinanceData/marcap', upstreamCommit=upstream, inputs=inputs,
                  combinedSha256=digest(inputs), engineSha256=engine_sha(), cutoff=cutoff, asOf=ctx['dates'][-1],
                  window=[ctx['dates'][0], ctx['dates'][-1]], agedFromRef=ctx['aged'],
                  index='네이버 코스피·코스닥 지수' if ctx['idx_ok'] else '없음(점수 수준만 참고, 순위 같음)')
    stale = (now.astimezone(KST).date() - dt.date.fromisoformat(ctx['dates'][-1])).days
    rep, state2, new, revs = run(ctx, model, model_sha, state, now, source)
    rep['source']['staleDays'] = stale
    changed, note, fresh = finish(out, state, rep, state2, new, revs, now, stale)
    asof = rep['asOf']
    if a.note_out and note:
        # 웹 알림(research-note)은 매번 보내도 서버가 같은 문장을 한 번만 보낸다 · 텔레그램(telegram)은 fresh 일 때만(workflow)
        pathlib.Path(a.note_out).write_text(json.dumps(dict(study='tenbagger_claude', date=note['date'], stage=note['stage'],
                                                            discovery=False, body=note['body'], telegram=note['text'],
                                                            fresh=fresh), ensure_ascii=False), encoding='utf-8')
    print(json.dumps(dict(asOf=asof, status=rep['status'], kickoff=rep['kickoff'], changed=changed, new=len(new),
                          revisions=len(revs), note=note['body'] if note else None, fresh=fresh,
                          value=rep['books'].get(MAIN, {}).get('value')), ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
