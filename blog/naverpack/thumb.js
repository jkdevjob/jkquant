// 네이버 글의 대표 이미지(썸네일)를 정사각형 PNG로 그린다. 글의 첫 이미지가 검색 결과 썸네일이 된다.
// 사용: node thumb.js <thumb.json> <출력폴더>
// thumb.json: {"out":"00.png","kicker":"어제 가장 많이 본 뉴스","lines":["젠슨 황 딸","방한 하루 전","돌연 취소"],
//              "hl":["돌연 취소"],"badge":"왜?","sub":"FT 보도로 본 쟁점 3가지","theme":"black"}
// - lines: 큰 글씨 2~3줄(줄마다 9자 안팎). hl: 노란 형광펜을 칠할 낱말(줄 안의 일부도 됨). badge: 오른쪽 위 동그라미(?/숫자).
// - theme: black | navy | red | green | purple. 사진을 쓰지 않는다(초상권·저작권). 글자는 본문이 증명하는 내용만.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), {execSync} = require('child_process');
const FONT = '/root/.fonts/NotoSansKR.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf';
const fontPath = process.env.NKR_FONT || FONT;
if (!fs.existsSync(fontPath)) { fs.mkdirSync(path.dirname(fontPath), {recursive: true}); execSync(`curl -sS -L -o "${fontPath}" "${FONT_URL}"`); }
const THEMES = {
  black: {bg: '#111827', fg: '#ffffff', accent: '#facc15', sub: '#d1d5db'},
  navy: {bg: '#0b2a5b', fg: '#ffffff', accent: '#fde047', sub: '#cbd5e1'},
  red: {bg: '#b91c1c', fg: '#ffffff', accent: '#fde047', sub: '#fee2e2'},
  green: {bg: '#065f46', fg: '#ffffff', accent: '#fde047', sub: '#d1fae5'},
  purple: {bg: '#4c1d95', fg: '#ffffff', accent: '#fde047', sub: '#ede9fe'},
};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mark = (line, hls, t) => {
  let h = esc(line);
  for (const w of hls || []) { const e = esc(w); if (e && h.includes(e)) h = h.replace(e, `<span style="background:${t.accent};color:#111827;padding:0 10px;border-radius:10px">${e}</span>`); }
  return h;
};
(async () => {
  const [spec, outDir] = process.argv.slice(2);
  const c = JSON.parse(fs.readFileSync(spec, 'utf8'));
  const t = THEMES[c.theme] || THEMES.black;
  const maxChars = Math.max(...c.lines.map(l => [...l].length));
  const fs1 = Math.min(150, Math.floor(820 / Math.max(maxChars, 4)));
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:"NKR";src:url("file://${fontPath}");font-weight:100 900;}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1000px;height:1000px;background:${t.bg};font-family:"NKR",sans-serif;color:${t.fg};overflow:hidden}
.k{position:absolute;left:80px;top:78px;font-size:38px;font-weight:800;background:${t.accent};color:#111827;padding:8px 22px;border-radius:14px}
.m{position:absolute;left:80px;right:80px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.l{font-size:${fs1}px;font-weight:900;line-height:1.22;letter-spacing:-3px;white-space:nowrap}
.s{position:absolute;left:80px;right:80px;bottom:120px;font-size:44px;font-weight:700;color:${t.sub};line-height:1.3}
.b{position:absolute;right:70px;top:60px;width:150px;height:150px;border-radius:75px;background:${t.fg};color:${t.bg};font-size:${[...(c.badge || '')].length > 2 ? 52 : 84}px;font-weight:900;display:flex;align-items:center;justify-content:center}
.brand{position:absolute;right:80px;bottom:50px;font-size:30px;font-weight:700;color:${t.sub};opacity:.8}
.bar{position:absolute;left:80px;bottom:200px;width:120px;height:10px;background:${t.accent};border-radius:5px}
</style></head><body>
${c.kicker ? `<div class="k">${esc(c.kicker)}</div>` : ''}${c.badge ? `<div class="b">${esc(c.badge)}</div>` : ''}
<div class="m">${c.lines.map(l => `<div class="l">${mark(l, c.hl, t)}</div>`).join('')}</div>
${c.sub ? `<div class="bar"></div><div class="s">${esc(c.sub)}</div>` : ''}<div class="brand">${esc(c.brand || '매니악 브리핑')}</div>
</body></html>`;
  fs.mkdirSync(outDir, {recursive: true});
  const f = path.resolve(outDir, (c.out || '00.png').replace(/\.png$/, '.html'));
  fs.writeFileSync(f, html);
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1000, height: 1000}});
  await p.goto('file://' + f); await p.waitForTimeout(900);
  const ok = await p.evaluate(() => document.fonts.check('40px NKR'));
  const over = await p.evaluate(() => [...document.querySelectorAll('.l')].some(e => e.scrollWidth > e.clientWidth + 2) || document.querySelector('.m').scrollHeight > 1000);
  await p.screenshot({path: path.resolve(outDir, c.out || '00.png')});
  await b.close(); fs.unlinkSync(f);
  console.log(`${c.out || '00.png'} font ${ok} overflow ${over} size ${fs1}px`);
  if (over) process.exitCode = 2;
})();
