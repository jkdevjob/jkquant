#!/usr/bin/env node
// 카드뉴스(인스타 캐러셀) 이미지 만들기 — 1080×1350 JPEG 여러 장.
//   node make-cards.mjs --config queue/cards/<id>.cards.json
// 설정: { brand:"rn"|"mb", tape, source, disclaimer?, handle?, out_dir:"queue/cards/<id>", slides:[...] }
//   slide.type: "cover"{t1,t2,sub,cards:[{label,big,cap,color:"red"|"blue"}],swipe} · "table"{title,sub,head,rows,hi:[k],note,box:{t,p},dimFirst}
//               "list"{title,sub,items:[{b,t}]} · "cta"{title,lines,box}
//   글자 안 [..] = 노랑 밑줄(매니악은 호박색), {..} = 빨강.
// 인스타 '저장'용 한 장 정리(11/19 사용자 "요고 참고해서 만들라고" — 인스타 경제 카드뉴스 계정 분석, REFERENCES 11/19).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cfgPath = argv[argv.indexOf("--config") + 1];
if (!cfgPath || !argv.includes("--config")) { console.error("사용법: node make-cards.mjs --config <설정.json>"); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(path.resolve(cfgPath), "utf8"));
const outDir = path.join(__dirname, spec.out_dir);
fs.mkdirSync(outDir, { recursive: true });

const tpl = fs.readFileSync(path.join(__dirname, "cards.html"), "utf8");
const htmlPath = path.join(__dirname, `.cards_${process.pid}.html`);
fs.writeFileSync(htmlPath, tpl.replace("<script>", `<script>window.__DATA__=${JSON.stringify(spec)};</script>\n<script>`));
const launchOpts = { args: ["--no-sandbox"] };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOpts);
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("페이지 오류:", e.message));
  await page.goto("file://" + htmlPath);
  await page.waitForFunction("window.__READY__ === true", null, { timeout: 20000 });
  // 넘친 글자 점검: 카드 안 요소가 카드 밖으로 나가면 알려 준다
  const over = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s, i) => {
    const r = s.getBoundingClientRect(), body = s.querySelector(".body") || s.querySelector(".hero-txt"), foot = s.querySelector(".foot").getBoundingClientRect();
    const bad = [...body.querySelectorAll("*")].filter((e) => { const b = e.getBoundingClientRect(); return b.right > r.right - 20 || b.bottom > foot.top - 4; }).map((e) => (e.textContent || "").trim().slice(0, 24));
    return bad.length ? `${i + 1}장: ${[...new Set(bad)].slice(0, 3).join(" / ")}` : null;
  }).filter(Boolean));
  if (over.length) console.warn("  ⚠ 넘침: " + over.join(" · "));
  const files = [];
  for (let i = 0; i < spec.slides.length; i++) {
    const f = path.join(outDir, `${String(i + 1).padStart(2, "0")}.jpg`);
    await page.locator(`#s${i}`).screenshot({ path: f, type: "jpeg", quality: 92 });
    files.push(path.relative(__dirname, f));
  }
  console.log("✔ " + files.join(", "));
} finally {
  await browser.close();
  fs.rmSync(htmlPath, { force: true });
}
