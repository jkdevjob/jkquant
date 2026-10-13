#!/usr/bin/env python3
"""Ensure value tests reject economically material research regressions."""
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).parent
source = (ROOT/'analyze_tenbagger.py').read_text()
mutations = [
    ('신호 당일 시가 매수', 'b = int(i + 1)', 'b = int(i)'),
    ('신호 당일 매도', 'earliest = b + int(hits[0]) + 1', 'earliest = b + int(hits[0])'),
    ('갭 손절 무시', 'float(o[sell_i]), exit_reason', 'float(o[b]) * .88, exit_reason'),
    ('신고가에 현재 종가 혼입', 'c.rolling(252).max().shift(1)', 'c.rolling(252).max()'),
    ('미래 이동평균 혼입', 'd.ma200.shift(20)', 'd.ma200.shift(-20)'),
    ('미청산 수익 확정', "float(c[s]), '관측 종료 / 미청산 평가', False", "float(c[s]), '관측 종료 / 미청산 평가', True"),
    ('매도 뒤 종가 낙폭 혼입', 'held_closes = c[b:s] if completed', 'held_closes = c[b:s+1] if completed'),
    ('수수료 미반영', 'return sell * (1 - cost) / (buy * (1 + cost))', 'return sell / buy'),
]


def run(text):
    with tempfile.TemporaryDirectory(prefix='tenbagger-mutation-') as directory:
        p=pathlib.Path(directory)
        (p/'analyze_tenbagger.py').write_text(text)
        (p/'test_tenbagger.py').write_text((ROOT/'test_tenbagger.py').read_text())
        return subprocess.run([sys.executable,str(p/'test_tenbagger.py')],capture_output=True,text=True)


control=run(source)
if control.returncode:
    print(control.stdout+control.stderr);raise SystemExit('대조군 실패')
for name,old,new in mutations:
    if old not in source:raise SystemExit('변이 대상 없음: '+name)
    result=run(source.replace(old,new,1))
    if result.returncode==0 or 'FAIL:' not in result.stderr:
        print(result.stdout+result.stderr);raise SystemExit('값 검사로 차단하지 못함: '+name)
    print('PASS mutation '+name)
print(f'ALL PASS {len(mutations)} mutations + original control')
