// 과거 1년 · 전일 거래대금 Top100 ∩ 갭 2~7% 후보 전체에 운영 규칙 + 그림자 변형 + 청산 변형 + 대조군
import fs from 'fs';
import { rebreakTrade } from './opening_rule.mjs';
const R = 'data/';
const { cand } = JSON.parse(fs.readFileSync(R + 'bf_candidates.json'));
const BARS = new Map();
for (const f of ['/tmp/claude-0/-home-user-jkquant/c28a5d7f-3934-585a-8930-9a274ca037dd/scratchpad/min.ndjson', R + 'min_bf.ndjson'])
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (r.b && r.b.length) BARS.set(r.k, r.b); } catch (e) {} }
const DAILY = {};
for (const f of fs.readdirSync(R + 'daily')) { const r = JSON.parse(fs.readFileSync(R + 'daily/' + f)); const m = {}; r.ohlc.forEach((b, i) => m[b.date] = i); DAILY[r.code] = { o: r.ohlc, m, name: r.name, mk: r.market }; }
const TICK = [[2000,1],[5000,5],[20000,10],[50000,50],[200000,100],[500000,500],[1e12,1000]];
const tick = p => TICK.find(([u]) => p < u)[1];
const fric = p => 0.23 + 2 * 2.5 * tick(p) / p * 100;
// 전일 거래대금 순위 (후보 안에서 top50 변형용)
const rankOf = {};
{ const byDay = {}; for (const [c, d] of cand) { const D = DAILY[c], i = D.m[d]; (byDay[d] ||= []).push([D.o[i-1].c * D.o[i-1].v, c]); }
  for (const d in byDay) byDay[d].sort((a, b) => b[0] - a[0]).forEach(([, c], k) => rankOf[c + '|' + d] = k + 1); }
const VARIANTS = {
  baseline: {}, today_combo_v1: { pbMax: .5, amountMult: 1.5, entryCutoff: 915 }, pb_max_0_5: { pbMax: .5 }, pb_max_0_7: { pbMax: .7 },
  amount_1_5: { amountMult: 1.5 }, amount_2_0: { amountMult: 2.0 }, entry_by_0915: { entryCutoff: 915 },
  gap_2_5: { gapMax: 5 }, gap_3_7: { gapMin: 3 }, stop_0_8: { stop: .8 }, tp_1_0: { takeProfit: 1.0 }, tp_2_0: { takeProfit: 2.0 },
};
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const out = [];
for (const [code, date, gap] of cand) {
  const b = BARS.get(code + '|' + date); if (!b) continue;
  const D = DAILY[code], i = D.m[date]; const next = D.o[i + 1];
  const meta = { open: D.o[i].o, prevClose: D.o[i-1].c };
  const rows = b.map(x => ({ t: `${date} ${x[0].slice(0,2)}:${x[0].slice(2)}`, close: x[4], high: x[2], low: x[3], vol: x[5] }));
  const base = { date, code, name: D.name, gap, rank: rankOf[code + '|' + date], nextOpen: next ? next.o : null, dayClose: D.o[i].c };
  for (const [v, ov] of Object.entries(VARIANTS)) {
    if (v === 'top50' && base.rank > 50) continue;
    const tr = rebreakTrade(rows, meta, 930, ov); if (!tr || tr.exitPrice == null) continue;
    const f = fric(tr.entryPrice);
    out.push({ ...base, v, entryTime: tr.entryTime, entry: tr.entryPrice, reason: tr.reason, pullback: tr.pullbackPct, amountRatio: tr.amountRatio,
      net930: (tr.exitPrice / tr.entryPrice - 1) * 100 - f,
      netClose: (base.dayClose / tr.entryPrice - 1) * 100 - f,
      netNextOpen: next ? (next.o / tr.entryPrice - 1) * 100 - f : null });
  }
  // 대조군: 같은 후보를 09:04~09:29 무작위 1분봉 종가에 매수 (신호 조건 없이), 같은 청산들
  const cands = rows.filter(r => { const hm = +r.t.slice(11,13)*100 + +r.t.slice(14,16); return hm >= 904 && hm <= 929; });
  if (cands.length) {
    const k = Math.floor(rnd() * cands.length), e = cands[k].close, f = fric(e);
    let ex = rows[rows.length - 1].close;
    for (const r of rows.slice(rows.indexOf(cands[k]) + 1)) { const x = (r.close / e - 1) * 100; if (x <= -1 || x >= 1.5) { ex = r.close; break; } }
    out.push({ ...base, v: 'CONTROL_random', entry: e, net930: (ex / e - 1) * 100 - f, netClose: (base.dayClose / e - 1) * 100 - f,
      netNextOpen: next ? (next.o / e - 1) * 100 - f : null });
  }
}
fs.writeFileSync(R + 'full_year_trades.json', JSON.stringify(out));
const have = cand.filter(([c, d]) => BARS.has(c + '|' + d)).length;
console.log(`후보 ${cand.length} 중 분봉 확보 ${have} · 기록 ${out.length}`);
