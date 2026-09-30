"""Require the F behavioral tests to reject regressions, without editing working files."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
mutants = [
    ('checkpoint time budget', 'opening_backfill.py', 'if DEADLINE is not None and time.monotonic() >= DEADLINE:', 'if False:'),
    ('market-hours guard', 'opening_backfill.py', 'if 830 <= hm <= 1540:', 'if False:'),
    ('turnover rank', 'opening_backfill.py', "(-r['amount'], r['code'])", "(-r['cap'], r['code'])"),
    ('overnight price', 'backtest_opening_rebreak.py', "float(next_open['price']) if valid else None", "t['entryPrice'] if valid else None"),
    ('pending not zero', 'backtest_opening_rebreak.py', "if valid else None\n    reason =", "if valid else 0.0\n    reason ="),
    ('design contamination', 'backtest_opening_rebreak.py', 'if name == "hold_to_next_open":', 'if False:'),
    ('wrong-day bars', 'opening_backfill.py', "b.get('t', '').startswith(prefix)", 'True'),
]
for label, filename, before, after in mutants:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for name in ('opening_backfill.py','collect_scalping_data.py','backtest_opening_rebreak.py','test_opening_backfill.py'):
            shutil.copy(ROOT/name, folder/name)
        path = folder/filename
        source = path.read_text(encoding='utf-8')
        assert before in source, label + ': target missing'
        path.write_text(source.replace(before, after, 1), encoding='utf-8')
        result = subprocess.run([sys.executable, str(folder/'test_opening_backfill.py')], capture_output=True, text=True, encoding='utf-8')
        assert result.returncode != 0 and 'FAILED (' in result.stderr, label + ': survived or invalid test\n' + result.stderr
        print('PASS killed:', label)
print('F mutations: ALL PASS')
