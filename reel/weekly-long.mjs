#!/usr/bin/env node
// 주간 롱폼 — 그 주에 올린 쇼츠(같은 형식으로 렌더한 mp4)를 이어 붙여 3분이 넘는 일반 영상 한 편으로 만든다.
// 유튜브 광고 수익 조건의 '시청 시간'은 쇼츠가 아니라 일반 영상에서만 쌓이고, 일반 영상이 광고 단가도 높다.
//   node weekly-long.mjs --out queue/long/2026-11-08_pension-7.mp4 a.mp4 b.mp4 …
// 1) 같은 규격(make-note.mjs, 1080x1920 30fps h264+aac)이라 먼저 다시 인코딩 없이 붙이고
// 2) jsDelivr가 20MB 넘는 파일을 못 내주므로, 18.5MB 안에 들어가게 2패스로 다시 압축한다(필기 화면이라 화질 손실이 거의 없다).
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const LIMIT = 18.5e6, AUDIO_K = 64;
const args = process.argv.slice(2);
const oi = args.indexOf("--out");
if (oi < 0 || args.length < 3){ console.error("사용법: node weekly-long.mjs --out <출력.mp4> <영상1.mp4> <영상2.mp4> …"); process.exit(1); }
const out = path.resolve(args[oi + 1]);
const inputs = args.filter((_, i) => i !== oi && i !== oi + 1).map(f => path.resolve(f));
for (const f of inputs) if (!fs.existsSync(f)) { console.error("없는 파일:", f); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weeklylong_"));
const run = (a) => new Promise((ok, no) => {
  const p = spawn(ffmpeg.path, a, { stdio: ["ignore", "ignore", "pipe"], cwd: tmp });
  let err = ""; p.stderr.on("data", d => err += d);
  p.on("close", c => c === 0 ? ok(err) : no(new Error(err.slice(-1500))));
});

try {
  const list = path.join(tmp, "list.txt");
  fs.writeFileSync(list, inputs.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const joined = path.join(tmp, "joined.mp4");
  await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", joined]);
  const probe = await run(["-i", joined, "-f", "null", "-"]).catch(e => e.message);
  const m = [...String(probe).matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  const dur = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
  if (!dur) throw new Error("길이를 못 읽음");
  if (fs.statSync(joined).size <= LIMIT) fs.copyFileSync(joined, out);
  else {
    const vk = Math.floor(LIMIT * 8 / 1000 / dur) - AUDIO_K - 8;
    const v = ["-c:v", "libx264", "-preset", "medium", "-tune", "stillimage", "-b:v", vk + "k", "-passlogfile", "lp"];
    await run(["-y", "-i", joined, ...v, "-pass", "1", "-an", "-f", "mp4", "/dev/null"]);
    await run(["-y", "-i", joined, ...v, "-maxrate", vk * 2 + "k", "-bufsize", vk * 4 + "k", "-pass", "2", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", AUDIO_K + "k", "-ac", "1", "-movflags", "+faststart", out]);
  }
  const mm = Math.floor(dur / 60), ss = Math.round(dur % 60);
  console.log(`✔ ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${mm}:${String(ss).padStart(2, "0")})`);
  if (dur < 181) console.warn("⚠ 3분 이하 세로 영상은 유튜브가 쇼츠로 분류한다 — 영상을 더 붙일 것");
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }
