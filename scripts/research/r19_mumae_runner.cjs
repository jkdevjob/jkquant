/* R19 무매 비교 — backtest.html 의 무한매수법 V4.0 엔진(runIM)을 헤드리스 브라우저에서 그대로 돌린다.
   (재구현하지 않는다 — 같은 걸 두 군데서 세지 않는다. 비용 · 세금 · 정수 주수 · 리버스 규칙이 화면과 같다.)
   시세는 r19_126_split.py 와 같은 bars.json(배당 조정 일봉)을 commitPriceBag 으로 앉힌다.
   설정: 20분할 · 익절 TQQQ 15% · SOXL 20%(공식) · 복리 · 비용 ON(앱 기본) · 리버스 끔(앱 기본)과 켬(공식 V4.0) 둘 다.
   사용: node scripts/research/r19_mumae_runner.cjs <bars.json> [시작 끝 ...] */
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const ROOT = path.resolve(__dirname, '..', '..');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const periods = process.argv.slice(3).length ? process.argv.slice(3) : ['2011-01-03', '2026-10-27', '2016-10-27', '2026-10-27', '2021-10-27', '2026-10-27'];

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const ext = path.extname(p);
  res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/backtest.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof runIM === 'function' && typeof commitPriceBag === 'function', null, { timeout: 60000 });
  const out = await page.evaluate(({ bars, periods }) => {
    for (const [t, rows] of Object.entries(bars)) {
      const bag = { adj: {}, trade: {}, div: {}, raw: {}, splits: {}, src: new Set(['fdr-adjusted']) };
      for (const [d, o, h, l, c] of rows) bag.adj[d] = [d, c, o, h, l];
      commitPriceBag(t, bag);
    }
    const res = {}, TGT = { TQQQ: 15, SOXL: 20 };
    for (const t of Object.keys(bars)) {
      const all = Object.keys(M[t]).sort();
      for (let k = 0; k < periods.length; k += 2) {
        const days = all.filter(d => d >= periods[k] && d <= periods[k + 1]);
        for (const cap of [10000, 100000]) {
          for (const rev of [false, true]) {
            imReverse = rev;
            const r = runIM(days, t, cap, 20, TGT[t], true);
            const yrs = days.length / 252;
            const yearly = {}; let prevEnd = cap, curY = null, lastV = cap;     // 해마다 수익률 — 엔진 기록(10거래일 간격 · 사이클 끝)의 그해 마지막 값 기준
            for (const [d, v] of (r.snap || [])) { const y = d.slice(0, 4); if (curY && y !== curY) { yearly[curY] = +((lastV / prevEnd - 1) * 100).toFixed(1); prevEnd = lastV; } curY = y; lastV = v; }
            if (curY) yearly[curY] = +((r.final / prevEnd - 1) * 100).toFixed(1);
            res[`${t}|${periods[k]}|${cap}|mumae${rev ? 'Rev' : ''}`] = {
              final: +r.final.toFixed(2), ret: +r.ret.toFixed(2), cagr: +((Math.pow(r.final / cap, 1 / yrs) - 1) * 100).toFixed(2),
              mdd: +r.mdd.toFixed(2), cycles: r.cycles, fees: +(r.fees || 0).toFixed(2), tax: +(r.tax || 0).toFixed(2), costOn: imCostOn, yearly };
          }
        }
      }
    }
    imReverse = false;
    return res;
  }, { bars, periods });
  console.log(JSON.stringify(out, null, 0));
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
