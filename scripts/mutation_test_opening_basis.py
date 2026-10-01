"""Behavioral mutants for annotated-price replay; isolated temporary files only."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).parent
mutations = [
    ('mixed intraday open', "day_open = float(basis_reference['adjusted']['stck_oprc'])", "day_open = float(row['open'])"),
    ('favorable cost bound', "result.update(totalPct=bounds['totalCostPctMax']", "result.update(totalPct=bounds['totalCostPctMin']"),
    ('mixed overnight price', "price=float(ref['adjusted']['stck_oprc'])", "price=float(ref['original']['stck_oprc'])"),
]
with tempfile.TemporaryDirectory(prefix='opening-basis-mutations-') as directory:
    target = Path(directory)
    for name in ('backtest_opening_rebreak.py', 'opening_basis_cost.py', 'test_opening_basis_cost.py',
                 'test_opening_backfill.py', 'opening_backfill.py'):
        shutil.copy2(root/name, target/name)
    engine = target/'backtest_opening_rebreak.py'
    original = engine.read_text(encoding='utf8')
    def run():
        return subprocess.run([sys.executable, '-B', 'test_opening_basis_cost.py'], cwd=target,
                              capture_output=True, text=True, env={**os.environ, 'PYTHONUTF8':'1'})
    baseline = run()
    assert baseline.returncode == 0, baseline.stderr
    for label, old, new in mutations:
        assert old in original, label
        engine.write_text(original.replace(old,new,1),encoding='utf8')
        result = run()
        assert result.returncode != 0 and 'FAIL:' in result.stderr, (label,result.stderr)
        print('mutation killed:',label)
