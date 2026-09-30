"""과거 1년 시초가 후보 = (그날 상장 · 매매정지 아님) ∩ 전일 거래대금 Top100 ∩ 갭 2~7%. 상폐 종목 포함."""
import json, glob, collections
START, END = '2025-10-01', '2026-09-15'          # KIS 분봉 1년 한계 안쪽 · 보유 일봉 끝
day = collections.defaultdict(list)
for f in glob.glob('data/daily/*.json'):
    r = json.load(open(f)); o = r['ohlc']
    for i in range(1, len(o)):
        p, c = o[i-1], o[i]
        if not (START <= c['date'] <= END): continue
        if p['halt'] or c['halt'] or p['c'] <= 0 or c['o'] <= 0: continue
        day[c['date']].append((p['c']*p['v'], r['code'], (c['o']/p['c']-1)*100))
cand = []
for d, xs in sorted(day.items()):
    top = sorted(xs, reverse=True)[:100]
    cand += [(code, d, round(g, 3)) for _, code, g in top if 2 <= g <= 7]
have = set()
for l in open('/tmp/claude-0/-home-user-jkquant/c28a5d7f-3934-585a-8930-9a274ca037dd/scratchpad/min.ndjson'):
    try:
        r = json.loads(l)
        if r.get('b'): have.add(r['k'])
    except Exception: pass
need = [c for c in cand if f"{c[0]}|{c[1]}" not in have]
json.dump({'cand': cand, 'need': need}, open('data/bf_candidates.json', 'w'))
print(f"거래일 {len(day)} · 후보 {len(cand)}건 (하루 평균 {len(cand)/len(day):.1f}) · 이미 있음 {len(cand)-len(need)} · 새로 받을 것 {len(need)}")
print(f"예상 시간: 초당 2건이면 약 {len(need)/2/60:.0f}분")
