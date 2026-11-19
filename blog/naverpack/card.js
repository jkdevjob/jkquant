// 네이버 글용 '핵심 숫자 카드' PNG(가로 1000px). 글 중간중간 흐름을 끊어 주는 이미지 — 메르 글처럼 몇 줄마다 이미지 하나.
// 사용: node card.js <cards.json> <출력폴더>
// cards.json: [{"out":"02.png","kicker":"한 줄로 보면","big":"1158억 달러","label":"엔비디아 3분기 매출 · 1년 전보다 103%↑",
//              "notes":["데이터센터 매출 1076억 달러(전체의 약 93%)","4분기 전망 약 1300억 달러"],"theme":"black","foot":"자료: 언론사"}]
// - big 은 본문이 증명하는 숫자 하나(본문 글자에도 같은 숫자). notes 는 0~3줄, 한 줄 30자 안팎.
// - theme: black | green | red | purple | gray. (navy 금지 — 2026-11-20 사용자 "네이비 색 좀 쓰지마 별로야") 사진을 쓰지 않는다(초상권·저작권).
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), {execSync} = require('child_process');
const FONT = process.env.NKR_FONT || '/root/.fonts/NotoSansKR.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf';
if (!fs.existsSync(FONT)) { fs.mkdirSync(path.dirname(FONT), {recursive: true}); execSync(`curl -sS -L -o "${FONT}" "${FONT_URL}"`); }
const T = {black: ['#171717', '#facc15', '#d1d5db'], green: ['#065f46', '#fde047', '#d1fae5'],
  red: ['#991b1b', '#fde047', '#fee2e2'], purple: ['#4c1d95', '#fde047', '#ede9fe'], gray: ['#374151', '#fbbf24', '#e5e7eb']};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = c => { const [bg, ac, sub] = T[c.theme] || T.black; return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:"NKR";src:url("file://${FONT}");font-weight:100 900;}*{box-sizing:border-box;margin:0;padding:0}
body{width:1000px;background:${bg};font-family:"NKR",sans-serif;color:#fff}.wrap{padding:56px 64px 44px}
.k{font-size:24px;font-weight:700;color:${ac}}.big{font-size:84px;font-weight:900;letter-spacing:-2px;line-height:1.15;margin-top:14px}
.l{font-size:28px;font-weight:700;margin-top:12px;line-height:1.4}ul{margin-top:26px;list-style:none}
li{font-size:23px;color:${sub};line-height:1.55;padding-left:26px;position:relative}li:before{content:"";position:absolute;left:0;top:15px;width:12px;height:12px;border-radius:6px;background:${ac}}
.f{margin-top:28px;font-size:15px;color:${sub};opacity:.85}</style></head><body><div class="wrap">
<div class="k">${esc(c.kicker)}</div><div class="big">${esc(c.big)}</div><div class="l">${esc(c.label)}</div>
${(c.notes || []).length ? `<ul>${c.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<div class="f">${esc(c.foot || '')}</div></div></body></html>`; };
(async () => {
  const [spec, outDir] = process.argv.slice(2);
  const list = JSON.parse(fs.readFileSync(spec, 'utf8'));
  fs.mkdirSync(outDir, {recursive: true});
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1000, height: 560}});
  for (const c of list) {
    if (c.theme && !T[c.theme]) { console.error(c.out, 'unknown theme', c.theme, '(navy 는 쓰지 않는다)'); process.exitCode = 1; continue; }
    const f = path.resolve(outDir, c.out.replace(/\.png$/, '.html'));
    fs.writeFileSync(f, html(c));
    await p.goto('file://' + f);
    await p.waitForTimeout(900);
    const ok = await p.evaluate(() => document.fonts.check('20px NKR'));
    const over = await p.evaluate(() => document.body.scrollWidth > 1000);
    const h = Math.ceil(await p.evaluate(() => document.body.scrollHeight));
    await p.setViewportSize({width: 1000, height: h});
    await p.screenshot({path: path.resolve(outDir, c.out)});
    fs.unlinkSync(f);
    console.log(c.out, 'font', ok, 'h', h, 'overflow', over);
    if (!ok || over) process.exitCode = 1;
  }
  await b.close();
})();
