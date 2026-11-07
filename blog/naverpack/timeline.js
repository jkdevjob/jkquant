// 숫자가 적은 이슈용 '시간순 정리표' PNG. 사용: node timeline.js <timeline.json> <출력폴더>
// timeline.json: {"out":"01.png","title":"…","sub":"…","foot":"줄1<br>줄2",
//   "rows":[{"when":"10월 말","what":"뉴욕타임스 첫 보도","tag":"보도","note":"작은 글씨 설명"}]}
// tag 색: 확인(초록) · 보도(주황) · 해명(파랑) · 예정(회색). '보도'는 사실이 확인되지 않았다는 뜻을 표에 남긴다.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), {execSync} = require('child_process');
const FONT = process.env.NKR_FONT || '/root/.fonts/NotoSansKR.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf';
if (!fs.existsSync(FONT)) { fs.mkdirSync(path.dirname(FONT), {recursive: true}); execSync(`curl -sS -L -o "${FONT}" "${FONT_URL}"`); }
const TAG = {'확인': '#15803d', '보도': '#c2410c', '해명': '#1d4ed8', '예정': '#6b7280', '반박': '#7c3aed'};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
(async () => {
  const [spec, outDir] = process.argv.slice(2);
  const c = JSON.parse(fs.readFileSync(spec, 'utf8'));
  const rows = c.rows.map(r => `<div class="r"><div class="w">${esc(r.when)}</div><div class="dot" style="background:${TAG[r.tag] || '#374151'}"></div>
   <div class="x"><div class="t">${r.tag ? `<span class="g" style="background:${TAG[r.tag] || '#374151'}">${esc(r.tag)}</span>` : ''}${esc(r.what)}</div>${r.note ? `<div class="n">${esc(r.note)}</div>` : ''}</div></div>`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:"NKR";src:url("file://${FONT}");font-weight:100 900;}
*{box-sizing:border-box;margin:0;padding:0}body{width:1000px;background:#fff;font-family:"NKR",sans-serif;color:#1f2933}
.wrap{padding:40px 52px 32px}h1{font-size:31px;font-weight:800;letter-spacing:-0.5px;line-height:1.3}.sub{font-size:18px;color:#52606d;margin-top:8px}
.list{margin-top:26px;position:relative}.list:before{content:"";position:absolute;left:181px;top:10px;bottom:10px;width:3px;background:#e5e7eb}
.r{display:flex;align-items:flex-start;padding:12px 0}.w{width:160px;text-align:right;font-size:20px;font-weight:800;color:#374151;padding-top:2px}
.dot{width:18px;height:18px;border-radius:9px;margin:6px 14px 0 14px;flex:none;position:relative;z-index:1;border:3px solid #fff}
.x{flex:1}.t{font-size:22px;font-weight:700;line-height:1.4}.n{font-size:16px;color:#6b7280;margin-top:3px;line-height:1.45}
.g{display:inline-block;color:#fff;font-size:15px;font-weight:800;padding:2px 9px;border-radius:8px;margin-right:9px;vertical-align:2px}
.foot{margin-top:18px;font-size:15px;color:#6b7280;line-height:1.6}</style></head><body><div class="wrap">
<h1>${esc(c.title)}</h1><div class="sub">${esc(c.sub)}</div><div class="list">${rows}</div>
<div class="foot">${(c.foot || '').split('<br>').map(esc).join('<br>')}</div></div></body></html>`;
  fs.mkdirSync(outDir, {recursive: true});
  const f = path.resolve(outDir, c.out.replace(/\.png$/, '.html'));
  fs.writeFileSync(f, html);
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1000, height: 600}});
  await p.goto('file://' + f); await p.waitForTimeout(900);
  const ok = await p.evaluate(() => document.fonts.check('20px NKR'));
  const h = Math.ceil(await p.evaluate(() => document.body.scrollHeight));
  await p.setViewportSize({width: 1000, height: h});
  await p.screenshot({path: path.resolve(outDir, c.out)});
  await b.close(); fs.unlinkSync(f);
  console.log(`${c.out} font ${ok} h ${h}`);
})();
