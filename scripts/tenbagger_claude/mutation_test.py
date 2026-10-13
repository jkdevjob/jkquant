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
FILES = ['panel.py', 'features.py', 'episodes.py', 'backtest.py', 'model.py', 'test_analysis.py']
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
]


def main():
    caught = 0
    for name, fn, old, new in MUTANTS:
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
            r = subprocess.run([sys.executable, '-I', os.path.join(d, 'test_analysis.py')], capture_output=True, text=True)
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
