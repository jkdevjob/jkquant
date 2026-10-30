#!/usr/bin/env node
// 손글씨 노트 영상 생성 (9:16 mp4) — 스프링 노트에 펜으로 적어 나가는 느낌.
//   node make-note.mjs --config queue/issues/2026-10-30.note.json
//   node make-note.mjs --config ... --preview 2,6,10.7,16,23   (지정한 초의 장면 PNG만)
//   node make-note.mjs --config ... --frames /tmp/noteframes_xxx (찍어 둔 프레임 재사용, 소리·인코딩만)
// 스펙: { duration, fps?, flip?, out, pages:[{ start, stains?, items:[…] }] }
//   items: text{id,text,x,y,size,font:bold|reg|pen|sans,color:ink|red|gray|blue,at,dur,after,gap,rot,fade}
//          circle/underline/highlight{target,at,dur,color} · box{x,y,w,h,at,dur} · arrow{x1,y1,x2,y2,bend,at,dur}
//          sticky{x,y,w,h,rot,at,items:[text|highlight|underline|circle]}
// 소리: 글씨를 쓰는 동안 연필 사각거림, 페이지·스티커 소리, 아주 작은 방 소리(무음 방지).
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
function runFF(args){ return new Promise((res,rej)=>{ const p=spawn(FFMPEG,args,{stdio:["ignore","ignore","pipe"]}); let e=""; p.stderr.on("data",d=>e+=d); p.on("close",c=>c===0?res(e):rej(new Error("ffmpeg 실패:\n"+e.slice(-1500)))); }); }

// 쓰는 구간마다 소리를 켜는 식(앞뒤 0.05초로 부드럽게). aeval 안에서 샘플마다 계산한다.
// (설치된 ffmpeg 가 2018년판이라 clip()·tremolo 가 없거나 깨진다 → max/min 과 apulsator 로 대신)
function gateExpr(intervals, gain){
  if (!intervals.length) return "0";
  const r = (x) => `max(0,min(1,${x}))`;
  const terms = intervals.map(([a,b]) => `${r(`(t-${a.toFixed(2)})/0.05`)}*${r(`(${b.toFixed(2)}-t)/0.05`)}`);
  return `${gain}*min(1,${terms.join("+")})`;
}

async function main(){
  const a = parseArgs(process.argv.slice(2));
  if (!a.config){ console.error("사용법: node make-note.mjs --config <스펙.json> [--preview 2,6,10]"); process.exit(1); }
  const spec = JSON.parse(fs.readFileSync(path.resolve(a.config), "utf8"));
  const fps = +spec.fps || 30, duration = +spec.duration || 20;
  const outPath = path.resolve(spec.out || `out/note_${Date.now()}.mp4`);
  fs.mkdirSync(path.dirname(outPath), { recursive:true });

  const tpl = fs.readFileSync(path.join(__dirname, "note.html"), "utf8");
  const htmlPath = path.join(__dirname, `.note_${Date.now()}.html`);
  fs.writeFileSync(htmlPath, tpl.replace("<script>", `<script>window.__DATA__=${JSON.stringify(spec)};</script>\n<script>`));

  const launchOpts = { args:["--no-sandbox"] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport:{ width:1080, height:1920 }, deviceScaleFactor:1 });
  page.on("pageerror", e => console.error("페이지 오류:", e.message));
  await page.goto("file://" + htmlPath);
  await page.waitForFunction("window.__READY__ === true", null, { timeout: 30000 });

  try {
    if (a.preview){
      const times = String(a.preview === true ? "1,5,10,15,20" : a.preview).split(",").map(Number);
      for (const t of times){
        await page.evaluate(x => window.renderAt(x), t);
        const png = outPath.replace(/\.mp4$/, `_t${String(t).replace(".", "_")}.png`);
        await page.screenshot({ path: png });
        console.log("✔ 미리보기", png);
      }
      return;
    }

    const audio = await page.evaluate(() => window.__AUDIO__);
    const total = Math.round(duration * fps);
    // --frames <폴더>: 이미 찍어 둔 프레임을 다시 쓰고 소리·인코딩만 다시 한다
    const reuse = typeof a.frames === "string" && fs.existsSync(a.frames) && fs.readdirSync(a.frames).length >= total;
    const framesDir = reuse ? a.frames : fs.mkdtempSync(path.join(os.tmpdir(), "noteframes_"));
    if (!reuse){
      process.stdout.write(`▶ 노트 영상 프레임 ${total}장 (${framesDir}) `);
      for (let f = 0; f < total; f++){
        await page.evaluate(x => window.renderAt(x), f / fps);
        await page.screenshot({ path: path.join(framesDir, `f_${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
        if (f % 30 === 0) process.stdout.write("·");
      }
    } else console.log(`▶ 프레임 재사용: ${framesDir}`);

    // 소리: 연필(분홍 잡음의 고음만, 불규칙하게 떨림) + 종이 넘김·스티커(갈색 잡음 짧게) + 아주 작은 방 소리
    const pen = gateExpr(audio.writes, 2.6);
    const flip = gateExpr(audio.flips.map(t => [t, t + 0.32]), 2.2);
    const filter =
      `[1:a]highpass=f=1700,lowpass=f=7500,apulsator=hz=11:amount=0.55,apulsator=hz=3.3:amount=0.45,aeval='val(0)*(${pen})':c=same[pen];` +
      `[2:a]bandpass=f=900:width_type=h:w=1400,aeval='val(0)*(${flip})':c=same[flip];` +
      `[3:a]lowpass=f=500,volume=0.05[room];` +
      `[pen][flip][room]amix=inputs=3,volume=3,afade=t=in:d=0.3,afade=t=out:st=${(duration - 1).toFixed(2)}:d=1[aout]`;
    const args = ["-y", "-framerate", String(fps), "-i", path.join(framesDir, fs.existsSync(path.join(framesDir, "f_00000.jpg")) ? "f_%05d.jpg" : "f_%05d.png"),
      "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.35:sample_rate=44100:seed=7:d=${duration}`,
      "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.5:sample_rate=44100:seed=11:d=${duration}`,
      "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.3:sample_rate=44100:seed=13:d=${duration}`,
      "-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-r", String(fps),
      "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-t", String(duration), "-movflags", "+faststart", outPath];
    process.stdout.write("\n  ffmpeg… ");
    await runFF(args);
    if (!reuse) fs.rmSync(framesDir, { recursive:true, force:true });
    console.log(`✔ ${outPath} (${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);
  } finally {
    await browser.close();
    fs.rmSync(htmlPath, { force:true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
