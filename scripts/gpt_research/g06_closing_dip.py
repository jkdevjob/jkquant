"""G6: preregistered existing dip_1 vs baseline, original ledger evidence only.

Input is the immutable source bundle from g05_closing_parity.py at a pinned online
scalping-data SHA. This script calls the shared production research metrics.
It neither discovers historical signals nor edits data or order settings.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from nightly_closing30_research import flatten
from closing30_metrics import coverage, daily_rows, summarize, walk_forward

PREREG = '3a43ec2e374d5e09356e5bef22f10f78d988175e'
SOURCE = '31c81e56c577f19db5d12164cb68ec542a014a01'


def run(bundle, out):
    audit = json.loads((bundle / 'g05-audit.json').read_text(encoding='utf-8'))
    if audit['sourceSha'] != SOURCE or not audit['passed']:
        raise ValueError('Pinned source and original engine parity must pass first')
    ledgers = [x for x in json.loads((bundle / 'ledgers.json').read_text(encoding='utf-8'))
               if x['date'] <= '2026-11-11']
    rows = [x for ledger in ledgers for x in flatten(ledger)]
    fee_diffs = []
    no_fee_mutations = slot_mutations = unsettled_mutations = 0
    for x in rows:
        if x['state'] != 'closed':
            continue
        gross = (x['exitPrice'] / x['entryPrice'] - 1) * 100
        if abs(gross - .23 - x['pnl']) > 1e-9:
            fee_diffs.append({k: x[k] for k in ['date', 'kind', 'variant', 'code', 'pnl']})
        no_fee_mutations += abs(gross - x['pnl']) > 1e-9
    results = {}
    for strategy, kind in [('closing30', 'day'), ('closing_bet', 'overnight')]:
        subsets = {name: [x for x in rows if x['kind'] == kind and x['variant'] == name]
                   for name in ['baseline', 'dip_1']}
        daily = {name: daily_rows(xs, ledgers, kind, name) for name, xs in subsets.items()}
        common = sorted(set(x['date'] for x in daily['baseline']) &
                        set(x['date'] for x in daily['dip_1']))
        paired_rows = {name: [x for x in xs if x['date'] in common] for name, xs in subsets.items()}
        paired_daily = {name: [x for x in ds if x['date'] in common] for name, ds in daily.items()}
        metrics = {}
        for name in subsets:
            xs, ds = paired_rows[name], paired_daily[name]
            metrics[name] = {'net': summarize(xs, ds), 'extraCost010pp': summarize(xs, ds, .10)}
            blocks = [ds[i * len(ds) // 3:(i + 1) * len(ds) // 3] for i in range(3)]
            metrics[name]['timeBlocks'] = [{'from': b[0]['date'] if b else None,
                'to': b[-1]['date'] if b else None, 'accountSumPct': sum(d['returnPct'] for d in b),
                'days': len(b)} for b in blocks]
            metrics[name]['positiveBlockFraction'] = sum(bool(b) and sum(d['returnPct'] for d in b) > 0
                                                        for b in blocks) / 3
            for d in ds:
                trades = [x for x in xs if x['date'] == d['date']]
                expected = sum(x['pnl'] for x in trades) / 3
                if abs(expected - d['returnPct']) > 1e-9:
                    raise AssertionError('three-slot independent accounting mismatch')
                if trades:
                    slot_mutations += abs(sum(x['pnl'] for x in trades) / len(trades) - expected) > 1e-9
            for d in ledgers:
                if coverage(d, kind) and any(x['date'] == d['date'] and x['state'] != 'closed'
                                           for x in subsets[name]):
                    assert d['date'] not in {v['date'] for v in daily[name]}
                    unsettled_mutations += 1
        wf = walk_forward(paired_rows['dip_1'], paired_rows['baseline'],
                          paired_daily['dip_1'], paired_daily['baseline'], 'dip_1')
        cand, base = metrics['dip_1']['net'], metrics['baseline']['net']
        stress = metrics['dip_1']['extraCost010pp']
        checks = {'commonTotalTrades30': cand['trades'] >= 30,
                  'positiveExpectancy': (cand['expectancyPct'] or 0) > 0,
                  'profitFactor110': (cand['profitFactor'] or 0) >= 1.10,
                  'mddMinus15': cand['mddPct'] is not None and cand['mddPct'] >= -15,
                  'worstMinus8': cand['worst'] is not None and cand['worst'] >= -8,
                  'positiveBlocks60pct': metrics['dip_1']['positiveBlockFraction'] >= .6,
                  'sameDatesDailyEdge': cand['dailyAvgPct'] is not None and cand['dailyAvgPct'] > base['dailyAvgPct'],
                  'walkForward': wf['passed'],
                  'costStress': (stress['expectancyPct'] or 0) > 0 and (stress['profitFactor'] or 0) >= 1.10,
                  'postRegistration20TradeDays20Trades': False,
                  'sevenDistinctLeadersAndScore60': False}
        results[strategy] = {'kind': kind, 'commonDates': common, 'metrics': metrics, 'walkForward': wf,
            'coverage': {name: {'recordedSignals': len(xs), 'closed': sum(x['state'] == 'closed' for x in xs),
                'unsettled': sum(x['state'] != 'closed' for x in xs),
                'completeAccountDays': len(daily[name]),
                'completeButNotCommonDates': [x['date'] for x in daily[name] if x['date'] not in common],
                'missingVersion': sum(not x.get('strategyVersion') for x in xs)} for name, xs in subsets.items()},
            'checks': checks, 'blockedReasons': [k for k, v in checks.items() if not v],
            'verdict': 'retain_current_main', 'newForwardDays': 0, 'newForwardTrades': 0}
    # The real comparison happens to fill all three slots on every common date.
    # Keep that failed mutation-sensitivity result and add a labelled unit probe
    # using one unchanged real closed trade plus two cash slots. This probe is
    # excluded from every market-performance table above.
    probe_row = next(x for x in rows if x['state'] == 'closed' and x['pnl'] != 0
                     and coverage(next(l for l in ledgers if l['date'] == x['date']), x['kind']))
    probe_ledger = next(l for l in ledgers if l['date'] == probe_row['date'])
    probe_daily = daily_rows([probe_row], [probe_ledger], probe_row['kind'], probe_row['variant'])
    assert len(probe_daily) == 1
    assert abs(probe_daily[0]['returnPct'] - probe_row['pnl'] / 3) <= 1e-9
    cash_probe_detected = abs(probe_daily[0]['returnPct'] - probe_row['pnl']) > 1e-9
    natural_slot_mutations = slot_mutations
    slot_mutations += cash_probe_detected
    hash_changes = [x['path'] for x in audit['sourceManifest']
                    if hashlib.sha256((bundle / 'sources' / Path(x['path']).name).read_bytes()).hexdigest() != x['sha256']]
    validation = {'sourceEngineParity': audit['passed'], 'feeDifferences': len(fee_diffs),
        'feeDifferenceExamples': fee_diffs[:5], 'originalHashChanges': len(hash_changes),
        'cashSlotUnitProbe': {'sourceDate': probe_row['date'], 'sourceCode': probe_row['code'],
            'unchangedTradeNetPct': probe_row['pnl'], 'observedReturnPct': probe_daily[0]['returnPct'],
            'cashSlots': 2, 'includedInPerformance': False, 'mutationDetected': cash_probe_detected},
        'naturalFullSlotMutationDifferences': natural_slot_mutations,
        'initialValidation': 'FAILED: the natural common dates all filled three slots, so the filled-slot denominator mutant survived; retained in the initial evidence file',
        'mutations': {'remove023Cost': no_fee_mutations, 'divideByFilledSlots': slot_mutations,
                      'unsettledAsZero': unsettled_mutations}}
    validation['passed'] = not fee_diffs and not hash_changes and all(validation['mutations'].values())
    report = {'research': 'G6', 'preregistration': PREREG, 'sourceSha': SOURCE,
        'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'lastSignalDate': '2026-11-11',
        'feesPct': .23, 'stressAdditionalPct': .10, 'fixedSlots': 3,
        'sourceLedgers': len(ledgers), 'sourceRows': len(rows), 'strategies': results, 'validation': validation,
        'limitation': 'Historical original-paper evidence; not independent post-registration performance. '
            'No synthesis of unobserved candidates or missing outcomes. Fewer than 25 complete common sessions '
            'cannot produce one 20/5 walk-forward fold. Retain both current mains.'}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'research': 'G6', 'validation': validation,
        'results': {k: {'commonDays': len(v['commonDates']), 'baseline': v['metrics']['baseline']['net'],
                       'candidate': v['metrics']['dip_1']['net'], 'blockedReasons': v['blockedReasons']}
                    for k, v in results.items()}}, ensure_ascii=False))
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--bundle', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    sys.exit(0 if run(a.bundle.resolve(), a.out.resolve())['validation']['passed'] else 1)
