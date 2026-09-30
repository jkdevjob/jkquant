// 운영 중인 시초가 규칙(_opening.js rebreakTrade)을 그대로 불러와 과거 1년(243거래일) 1분봉에 돌린다.
import fs from 'fs';
import { rebreakTrade, OPENING_BASE_PARAMS as P } from './opening_rule.mjs';
const D = JSON.parse(fs.readFileSync('daily8y.json'));
const K = JSON.parse(fs.readFileSync('long.json')).KODEX200;
const kPrev = {}; for (let i = 2; i < K.length; i++) kPrev[K[i].date] = (K[i-1].close / K[i-2].close - 1) * 100;
const TICK = [[2000,1],[5000,5],[20000,10],[50000,50],[200000,100],[500000,500],[1e12,1000]];
const tick = p => TICK.find(([u]) => p < u)[1];
const friction = p => 0.23 + 2 * 2.5 * tick(p) / p * 100;            // 운영 research 와 같은 방식
const out = [];
for (const line of fs.readFileSync('min.ndjson', 'utf8').split('\n')) {
  if (!line) continue;
  let r; try { r = JSON.parse(line); } catch (e) { continue; }
  if (!Array.isArray(r.b) || !r.b.length) continue;
  const [code, date] = r.k.split('|');
  const d = D[code]; if (!d) continue;
  const i = d.ohlc.findIndex(x => x.date === date); if (i < 1) continue;
  const meta = { open: d.ohlc[i].open, prevClose: d.ohlc[i-1].close };
  const turn = d.ohlc[i-1].close * d.ohlc[i-1].vol / 1e8;
  const rows = r.b.map(b => ({ t: `${date} ${b[0].slice(0,2)}:${b[0].slice(2)}`, close: b[4], high: b[2], low: b[3], vol: b[5] }));
  const tr = rebreakTrade(rows, meta, 930);
  if (!tr || tr.exitPrice == null) continue;
  const gross = (tr.exitPrice / tr.entryPrice - 1) * 100;
  const after = rows.filter(x => +x.t.slice(11,13)*100 + +x.t.slice(14,16) > tr.entryTime);
  const mfe = after.length ? Math.max(...after.map(x => x.high)) / tr.entryPrice * 100 - 100 : 0;
  const mae = after.length ? Math.min(...after.map(x => x.low)) / tr.entryPrice * 100 - 100 : 0;
  out.push({ date, code, name: d.name, gap: tr.gap, entryTime: tr.entryTime, entry: tr.entryPrice,
    pullback: tr.pullbackPct, volRatio: tr.volRatio, amountRatio: tr.amountRatio, reason: tr.reason,
    gross, fric: friction(tr.entryPrice), net: gross - friction(tr.entryPrice), mfe, mae,
    kPrev: kPrev[date] ?? null, turn, rise: (tr.firstHigh / meta.open - 1) * 100 });
}
fs.writeFileSync('year_opening_trades.json', JSON.stringify(out));
console.log(`운영 규칙 opening_rebreak_v1 · 과거 ${new Set(out.map(x=>x.date)).size}거래일에서 ${out.length}건`);
