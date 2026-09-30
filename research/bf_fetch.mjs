// 과거 1년 시초가 후보 분봉 백필 — jkquant.pages.dev/api/kis?op=minhist (시세 조회만, 주문 없음)
// 안전장치: 한국시각 08:00~16:00 에는 멈춘다(실시간 감시와 KIS 호출 한도를 나눠 쓰지 않도록).
import fs from 'fs';
const { need } = JSON.parse(fs.readFileSync('data/bf_candidates.json'));
const OUT = 'data/min_bf.ndjson';
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).k) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kstHour = () => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date());
let ok = 0, empty = 0, mism = 0, fail = 0, i = 0;
const todo = need.filter(([c, d]) => !done.has(`${c}|${d}`));
console.log(`남은 ${todo.length}건`);
let stop = false;
async function one(code, date) {
  const h = kstHour(); if (h >= 8 && h < 16) { if (!stop) console.log(`장중 안전장치로 중단 (KST ${h}시)`); stop = true; return; }
  const url = `https://jkquant.pages.dev/api/kis?op=minhist&code=${code}&date=${date.replace(/-/g, '')}&hour=093000`;
  let j = null;
  for (let t = 0; t < 5; t++) {
    try { const r = await fetch(url); j = await r.json(); } catch (e) { j = { error: String(e) }; }
    if (j && !j.error) break;
    await sleep(j && j.rateLimited ? 1500 * (t + 1) : 800 * (t + 1));
  }
  i++;
  if (!j || j.error) { fail++; }
  else {
    const bars = (j.bars || []).filter(b => b.t.slice(0, 8) === date.replace(/-/g, '') && b.t.slice(8, 12) >= '0900' && b.t.slice(8, 12) <= '0930');
    if (!(j.bars || []).length) empty++;
    else if (!bars.length) mism++;                      // 휴장일 등 — 다른 날짜가 돌아옴
    else { fs.appendFileSync(OUT, JSON.stringify({ k: `${code}|${date}`, b: bars.map(b => [b.t.slice(8, 12), b.o, b.h, b.l, b.c, b.v]) }) + '\n'); ok++; }
  }
  if (i % 200 === 0) console.log(`  ${i}/${todo.length}  ok=${ok} empty=${empty} 날짜불일치=${mism} fail=${fail}`);
  await sleep(600);
}
const q = [...todo];                                   // 동시 3개 — KIS 초당 한도(약 2건) 안쪽
await Promise.all([0, 1, 2].map(async () => { while (q.length && !stop) { const [c, d] = q.shift(); await one(c, d); } }));
console.log(`완료 ok=${ok} empty=${empty} 날짜불일치=${mism} fail=${fail}`);
