#!/usr/bin/env node
// 텍스트 카드 영상 생성 (9:16 mp4) — SPCL의 L(친밀감)·C(신뢰) 축용.
//   node make-card.mjs --config cards.config.json
// 카드 스펙: { theme:"navy"|"cream", kicker, lines:[...], slogan, handle, duration, out }
//   lines 안에서 **강조** 표시, "~작은줄" 앞의 ~는 작은 글씨.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import { chromium } from "playwright";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = ffmpeg.path;

function parseArgs(argv){ const a={}; for(let i=0;i<argv.length;i++){ if(argv[i].startsWith("--")){ const k=argv[i].slice(2),n=argv[i+1]; if(n==null||n.startsWith("--"))a[k]=true; else{a[k]=n;i++;} } } return a; }
function runFF(args){ return new Promise((res,rej)=>{ const p=spawn(FFMPEG,args,{stdio:["ignore","ignore","pipe"]}); let e=""; p.stderr.on("data",d=>e+=d); p.on("close",c=>c===0?res():rej(new Error("ffmpeg 실패:\n"+e.slice(-1200)))); }); }

async function makeCard(browser, spec){
  const fps = +spec.fps || 30;
  const durationSec = +spec.duration || 12;
  const DATA = {
    theme: spec.theme || "navy",
    kicker: spec.kicker || "은퇴노트",
    lines: spec.lines || [],
    slogan: spec.slogan || "늦지 않았습니다",
    handle: spec.handle || "@retire.note",
  };
  const tpl = fs.readFileSync(path.join(__dirname, "card.html"), "utf8");
  const injected = tpl.replace("<script>", `<script>window.__DATA__=${JSON.stringify(DATA)};</script>\n<script>`);
  const htmlPath = path.join(__dirname, `.card_${Date.now()}.html`);
  fs.writeFileSync(htmlPath, injected);

  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "cardframes_"));
  const total = Math.round(durationSec * fps);
  const page = await browser.newPage({ viewport:{width:1080,height:1920}, deviceScaleFactor:1 });
  await page.goto("file://" + htmlPath);
  await page.waitForFunction("window.__READY__ === true", null, { timeout: 20000 });
  process.stdout.write(`\n▶ 카드 "${DATA.kicker}" 프레임 ${total}장 `);
  for (let f=0; f<total; f++){
    await page.evaluate((t)=>window.renderAt(t), f/fps);
    await page.screenshot({ path: path.join(framesDir, `f_${String(f).padStart(5,"0")}.png`) });
    if (f%30===0) process.stdout.write("·");
  }
  await page.close();

  const outPath = path.resolve(spec.out || `out/card_${Date.now()}.mp4`);
  fs.mkdirSync(path.dirname(outPath), { recursive:true });
  const args = ["-y","-framerate",String(fps),"-i",path.join(framesDir,"f_%05d.png"),
    "-f","lavfi","-i","anullsrc=r=44100:cl=stereo",
    "-map","0:v:0","-map","1:a:0","-c:v","libx264","-pix_fmt","yuv420p","-preset","medium",
    "-r",String(fps),"-c:a","aac","-b:a","128k","-t",String(durationSec),"-shortest",
    "-af","afade=t=out:st="+(durationSec-1)+":d=1","-movflags","+faststart", outPath];
  process.stdout.write(`\n  ffmpeg… `);
  await runFF(args);
  fs.rmSync(framesDir,{recursive:true,force:true});
  fs.rmSync(htmlPath,{force:true});
  console.log(`✔ ${outPath} (${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);
}

async function main(){
  const a = parseArgs(process.argv.slice(2));
  let specs;
  if (a.config){ const cfg=JSON.parse(fs.readFileSync(path.resolve(a.config),"utf8")); specs=Array.isArray(cfg)?cfg:cfg.cards||[cfg]; }
  else { console.error("사용법: node make-card.mjs --config cards.config.json"); process.exit(1); }
  const launchOpts = { args:["--no-sandbox"] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launchOpts);
  for (const s of specs) await makeCard(browser, s);
  await browser.close();
  console.log(`\n완료: ${specs.length}편`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
