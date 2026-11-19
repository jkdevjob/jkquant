// 네이버 글용 '정리표' PNG를 그린다(비교·조건·일정·계산표). 사용: node table.js <tables.json> <출력폴더>
// tables.json: [{"out":"03.png","title":"…","sub":"단위·기준 시점","cols":["구분","지금","바뀌면"],
//               "rows":[["대상","65세 이상","…"],["금액","월 34만원","…"]],"hl":[1],"foot":"줄1<br>자료: 언론사"}]
// - hl: 강조할 행 번호(0부터, 노란 바탕). 첫 열은 굵게. 칸 글자는 짧게(한 칸 18자 안팎).
// - 표 속 숫자는 본문 글자로도 쓴다(검색로봇은 이미지 속 글자를 못 읽는다 · verify_pack --nums 로 확인).
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), {execSync} = require('child_process');
const FONT = process.env.NKR_FONT || '/root/.fonts/NotoSansKR.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf';
if (!fs.existsSync(FONT)) { fs.mkdirSync(path.dirname(FONT), {recursive: true}); execSync(`curl -sS -L -o "${FONT}" "${FONT_URL}"`); }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = `@font-face{font-family:"NKR";src:url("file://${FONT}");font-weight:100 900;}
*{box-sizing:border-box;margin:0;padding:0}body{width:1000px;background:#fff;font-family:"NKR",sans-serif;color:#1f2933}
.wrap{padding:40px 48px 32px}h1{font-size:31px;font-weight:800;letter-spacing:-0.5px;line-height:1.3}.sub{font-size:18px;color:#52606d;margin-top:8px}
table{width:100%;border-collapse:collapse;margin-top:26px;font-size:21px;line-height:1.4}
th{background:#262626;color:#fff;font-weight:700;padding:14px 16px;text-align:left}
td{padding:14px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top}td:first-child{font-weight:700;color:#111827;white-space:nowrap}
tr.hl td{background:#fef9c3}tr:nth-child(even):not(.hl) td{background:#f9fafb}
.foot{margin-top:20px;font-size:15px;color:#6b7280;line-height:1.6}`;
const html = c => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="wrap">
<h1>${esc(c.title)}</h1><div class="sub">${esc(c.sub)}</div>
<table><tr>${c.cols.map(x => `<th>${esc(x)}</th>`).join('')}</tr>
${c.rows.map((r, i) => `<tr class="${(c.hl || []).includes(i) ? 'hl' : ''}">${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>
<div class="foot">${(c.foot || '').split('<br>').map(esc).join('<br>')}</div></div></body></html>`;
(async () => {
  const [spec, outDir] = process.argv.slice(2);
  const list = JSON.parse(fs.readFileSync(spec, 'utf8'));
  fs.mkdirSync(outDir, {recursive: true});
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1000, height: 600}});
  for (const c of list) {
    if (c.rows.some(r => r.length !== c.cols.length)) { console.error(c.out, 'row length != cols'); process.exitCode = 1; continue; }
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
