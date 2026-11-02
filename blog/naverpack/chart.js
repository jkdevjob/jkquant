// 네이버 패키지용 가로 막대 도표를 PNG로 그린다.
// 사용: node chart.js <charts.json> <출력폴더>
// charts.json: [{"out":"01.png","title":"…","sub":"…","foot":"줄1<br>줄2",
//               "bars":[{"label":"…","sub":"…","value":-3.48,"text":"-3.48%","color":"#dc2626"}]}]
// value 에 음수가 있으면 0을 가운데 둔 양방향 막대로 그린다.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), {execSync} = require('child_process');

const FONT = '/root/.fonts/NotoSansKR.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf';
if (!fs.existsSync(FONT)) {
  fs.mkdirSync(path.dirname(FONT), {recursive: true});
  execSync(`curl -sS -L -o ${FONT} "${FONT_URL}"`);
}

const CSS = `@font-face{font-family:"NKR";src:url("file://${FONT}");font-weight:100 900;}
*{box-sizing:border-box;margin:0;padding:0}body{width:1000px;background:#fff;font-family:"NKR",sans-serif;color:#1f2933}
.wrap{padding:40px 52px 32px}h1{font-size:31px;font-weight:800;letter-spacing:-0.5px;line-height:1.3}.sub{font-size:18px;color:#52606d;margin-top:8px}
.foot{margin-top:20px;font-size:15px;color:#6b7280;line-height:1.6}`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = b => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="wrap">${b}</div></body></html>`;

function bars(rows) {
  const W = 560, neg = rows.some(r => r.value < 0);
  const max = Math.max(...rows.map(r => Math.abs(r.value)));
  const half = neg ? W / 2 - 50 : W - 110;   // 숫자 글자가 들어갈 자리를 남긴다
  const zero = neg ? W / 2 : 0;
  return rows.map(r => {
    const w = Math.abs(r.value) / max * half;
    const left = r.value < 0 ? zero - w : zero;
    // 막대가 길면 숫자를 막대 안쪽(흰 글씨)에, 짧으면 바깥에 쓴다 — 왼쪽 이름 칸과 겹치지 않게
    const inside = w > 170;
    const tl = r.value < 0
      ? (inside ? `left:${left + 14}px;color:#fff` : `right:${W - left + 10}px`)
      : (inside && neg ? `right:${W - left - w + 14}px;color:#fff` : `left:${left + w + 12}px`);
    return `<div style="display:flex;align-items:center;height:92px">
 <div style="width:250px;text-align:right;padding-right:20px"><div style="font-size:22px;font-weight:700">${esc(r.label)}</div><div style="font-size:15px;color:#6b7280">${esc(r.sub)}</div></div>
 <div style="position:relative;width:${W}px;height:52px">${neg ? `<div style="position:absolute;left:${zero}px;top:-14px;width:2px;height:80px;background:#9aa5b1"></div>` : ''}
  <div style="position:absolute;left:${left}px;top:0;height:52px;width:${w}px;background:${r.color || '#2563eb'};border-radius:6px"></div>
  <div style="position:absolute;${tl};top:8px;font-size:25px;font-weight:800;white-space:nowrap">${esc(r.text)}</div></div></div>`;
  }).join('');
}

const html = c => page(`<h1>${esc(c.title)}</h1><div class="sub">${esc(c.sub)}</div>
 <div style="margin-top:30px">${bars(c.bars)}</div>
 <div class="foot">${(c.foot || '').split('<br>').map(esc).join('<br>')}</div>`);

(async () => {
  const [spec, outDir] = process.argv.slice(2);
  const charts = JSON.parse(fs.readFileSync(spec, 'utf8'));
  fs.mkdirSync(outDir, {recursive: true});
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1000, height: 600}});
  for (const c of charts) {
    const f = path.resolve(outDir, c.out.replace(/\.png$/, '.html'));
    fs.writeFileSync(f, html(c));
    await p.goto('file://' + f);
    await p.waitForTimeout(900);
    const ok = await p.evaluate(() => document.fonts.check('20px NKR'));
    const h = Math.ceil(await p.evaluate(() => document.body.scrollHeight));
    await p.setViewportSize({width: 1000, height: h});
    await p.screenshot({path: path.resolve(outDir, c.out)});
    fs.unlinkSync(f);
    console.log(c.out, 'font', ok, 'h', h);
    if (!ok) process.exitCode = 1;
  }
  await b.close();
})();
