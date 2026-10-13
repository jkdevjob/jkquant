#!/usr/bin/env python3
"""텐배거(클로드) 변이 시험 — 계산 코드를 일부러 틀리게 바꾼 사본으로 값 시험(test_analysis.py)을 돌려
반드시 FAIL 이 나는지 본다. 하나라도 통과하면(=시험이 그 잘못을 못 잡으면) 이 시험이 실패한다.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['panel.py', 'features.py', 'episodes.py', 'backtest.py', 'model.py', 'signals.py', 'forward.py', 'industry.py',
         'test_analysis.py', 'test_forward.py']
FW = 'test_forward.py'     # 전향 시험 변이는 전향 값 시험으로 잡는다
MUTANTS = [
    ('매도를 조건 확인한 그날 종가에 체결(미래 종가 사용)', 'backtest.py',
     'e = t0 + int(k[0]) + 1', 'e = t0 + int(k[0])'),
    ('매수를 신호 당일 종가에 체결(미래 종가 사용)', 'backtest.py',
     'cands = sig_days.get(t - 1)', 'cands = sig_days.get(t)'),
    ('정리매매 안의 \'1원\' 자리표시 급등을 보정하지 않음(옛 코드)', 'panel.py',
     'imp = ((r > 1.6) | ((r < -0.66) & ~in_tail)) & np.isfinite(prev_close)',
     'imp = ((r > 1.6) | (r < -0.66)) & ~in_tail & np.isfinite(prev_close)'),
    ('감자·병합 기준가 미수정을 시가총액 연속으로 고치지 않음', 'panel.py',
     "kind = np.where(imp & cap_ok, 1, np.where(imp, 2, 0))", "kind = np.where(imp, 2, 0)"),
    ('못 사는 날(거래대금 부족)도 저점으로 씀', 'episodes.py',
     'cb = c.astype(np.float64) if can_buy is None else np.where(can_buy, c, np.inf)', 'cb = c.astype(np.float64)'),
    ('앞날 최고가에 그날 종가를 넣음', 'features.py',
     'out[:-1] = R[1:]', 'out[:] = R'),
    ('1999~2008 뮤추얼펀드 이름을 거르지 않음', 'panel.py',
     "r'^(?:KTB|미래|마이다스|", "r'^(?:XXXX|"),
    ('과열 조임이 과열 전에도 걸림', 'backtest.py',
     'cond |= hot & (w <= runmax * (1 - rule.hot_trail))', 'cond |= (w <= runmax * (1 - rule.hot_trail))'),
    # ── 전향 시험(forward.py) ──
    ('등록 날 장 마감 뒤에 등록해도 그날 종가를 첫 신호로 씀(거슬러 사기)', 'forward.py',
     'if d > rd or (d == rd and before_close):', 'if d >= rd:', FW),
    ('자료 끝 날을 월말로 보지 않음(월말 신호가 하루 늦어 매수일 지난 뒤 등록)', 'forward.py',
     'me[-1] = n.month != d.month', 'me[-1] = False', FW),
    ('자료가 끝났다고 상장 중인 종목을 강제로 팖', 'forward.py',
     "last_fw = np.where(delisted, D['last'], T)", "last_fw = D['last']", FW),
    ('이미 기록한 사건을 다시 계산한 값으로 덮어씀', 'forward.py',
     "            a, b = k.get(f), e.get(f)\n", "            a, b = k.get(f), e.get(f)\n            k[f] = b\n", FW),
    ('상장폐지 전 30거래일 가림(미래 정보)을 실시간 후보에 씀', 'forward.py',
     "D = derive(P, np.zeros(N, dtype=bool))", "D = derive(P, P['last'] != P['dates'][-1])", FW),
    ('상장 기간 이음을 거꾸로(기준일 뒤로 갈수록 줄어듦)', 'forward.py',
     'steps = np.arange(T, dtype=np.float64) - iR', 'steps = iR - np.arange(T, dtype=np.float64)', FW),
    ('창 첫날 거래정지 종목의 행을 버림(30년 패널과 다른 3년 고점)', 'forward.py',
     'adj, cal = panel.chain_adjust(sel, keep_open_start=True)', 'adj, cal = panel.chain_adjust(sel)', FW),
    ('같은 자료일이라도 다시 계산하면 알림을 새로 만듦(웹 알림·텔레그램 중복)', 'forward.py',
     "if al and asof not in state2['notes'] and stale <= 10:", "if al and stale <= 10:", FW),
    ('같은 자료일 재실행에도 텔레그램을 다시 보냄', 'forward.py',
     "return False, state['notes'].get(asof), False", "return False, state['notes'].get(asof), True", FW),
    ('매수 예정 명단에 이미 보유한 종목을 넣음', 'forward.py',
     "exp = [p for p in sig['picks'] if p['code'] not in held][:max(free, 0)]", "exp = [p for p in sig['picks']][:max(free, 0)]", FW),
    ('예고한 매수를 체결일에 또 알림(매수·매도 때 한 번만 어김)', 'forward.py',
     "late_b = [e for e in mine if e['type'] == 'buy' and 'signal:' + e['signalDate'] not in prior_ids]",
     "late_b = [e for e in mine if e['type'] == 'buy']", FW),
    ('무작위 비교 열쇠를 자료 창 종목 번호로 정함', 'forward.py',
     'mc_key(seed, codes[j], first[j])', 'mc_key(seed, str(j), first[j])', FW),
]


def main():
    caught = 0
    for name, fn, old, new, *test in MUTANTS:
        test = test[0] if test else 'test_analysis.py'
        d = tempfile.mkdtemp(prefix='tbmut-')
        try:
            for f in FILES:
                shutil.copy(os.path.join(HERE, f), os.path.join(d, f))
            p = os.path.join(d, fn)
            src = open(p, encoding='utf-8').read()
            if old not in src:
                print('ERROR 변이 대상 문자열 없음:', name)
                sys.exit(2)
            open(p, 'w', encoding='utf-8').write(src.replace(old, new, 1))
            r = subprocess.run([sys.executable, '-I', os.path.join(d, test)], capture_output=True, text=True,
                               env=dict(os.environ, TB_APP=os.path.join(HERE, '..', '..')))
            fails = [ln for ln in r.stdout.splitlines() if ln.startswith('FAIL')]
            if r.returncode != 0 and fails:
                caught += 1
                print('차단', name, '←', fails[0][5:60])
            else:
                print('놓침', name)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    print(f'\n텐배거 변이 시험: {caught}/{len(MUTANTS)} 차단')
    sys.exit(0 if caught == len(MUTANTS) else 1)


if __name__ == '__main__':
    main()
