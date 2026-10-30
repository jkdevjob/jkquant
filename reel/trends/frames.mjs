#!/usr/bin/env node
// 오늘 리포트에서 "아직 안 본" 인기 쇼츠를 골라 장면 이미지를 받아 한 장으로 붙인다(기법 분석용).
//   node trends/frames.mjs [--date YYYY-MM-DD] [--n 6]
// 장면: 첫 장면(frame0) + 유튜브 자동 캡처 3장(영상의 약 1/4·2/4·3/4 지점, hq1~3).
// 결과: trends/frames/<날짜>/sheet.jpg(행 번호 = list.json 순서), list.json. 이미지는 커밋하지 않는다(.gitignore).
// 본 영상 id 는 trends/seen.json 에 쌓아서 다음 날엔 다른 영상을 본다.
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FF = path.join(__dirname, "..", "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg");
const FONT = path.join(__dirname, "..", "fonts", "Gaegu-Bold.ttf");
const argv = process.argv.slice(2);
const opt = (k, d) => argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d;
const date = opt("date", new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
const N = +opt("n", 6);

// 광고(운용사·증권사 상품 홍보)는 기법 참고에서 뺀다
const AD = /광고|KODEX|KoAct|TIGER|ACE |SOL |RISE |ETF|증권|자산운용|이벤트|EVENT/i;

const report = JSON.parse(fs.readFileSync(path.join(__dirname, `${date}.json`), "utf8"));
const seenPath = path.join(__dirname, "seen.json");
const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, "utf8")) : {};
const pool = [...report.topShortsWeek, ...report.topShortsMonth]
  .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
  .filter(v => !seen[v.id] && !AD.test(v.title));
const pick = pool.slice(0, N);
if (!pick.length){ console.log("새로 볼 인기 쇼츠가 없음"); process.exit(0); }

const dir = path.join(__dirname, "frames", date);
fs.mkdirSync(dir, { recursive: true });
const get = async (url, file) => {
  const r = await fetch(url);
  if (!r.ok) return false;
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return true;
};
const rows = [];
for (const [k, v] of pick.entries()){
  const files = [];
  for (const name of ["frame0", "hq1", "hq2", "hq3"]){
    const f = path.join(dir, `${k + 1}_${name}.jpg`);
    if (await get(`https://i.ytimg.com/vi/${v.id}/${name}.jpg`, f)) files.push(f);
  }
  if (files.length) rows.push({ no: k + 1, ...v, files });
}

// 한 행 = 첫 장면 + 자동 캡처 3장. hq 이미지는 4:3 안에 세로 화면이 들어 있어 가운데만 잘라 쓴다.
const rowFiles = [];
for (const r of rows){
  const out = path.join(dir, `row_${r.no}.jpg`);
  const inputs = r.files.flatMap(f => ["-i", f]);
  const parts = r.files.map((f, i) => (f.includes("frame0") ? `[${i}]scale=-2:480,setsar=1[v${i}]` : `[${i}]crop=ih*9/16:ih,scale=-2:480,setsar=1[v${i}]`));
  const label = fs.existsSync(FONT) ? `,drawtext=fontfile=${FONT}:text='${r.no}':x=14:y=10:fontsize=64:fontcolor=yellow:borderw=4:bordercolor=black` : "";
  const filter = `${parts.join(";")};${r.files.map((_, i) => `[v${i}]`).join("")}hstack=${r.files.length}${label}[o]`;
  const res = spawnSync(FF, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[o]", out]);
  if (res.status === 0) rowFiles.push(out);
}
// 행 폭이 다를 수 있어 같은 폭으로 맞춰 세로로 쌓는다
const sheet = path.join(dir, "sheet.jpg");
const vin = rowFiles.flatMap(f => ["-i", f]);
const pads = rowFiles.map((_, i) => `[${i}]pad=1100:480:0:0:black[p${i}]`).join(";");
spawnSync(FF, ["-y", "-loglevel", "error", ...vin, "-filter_complex", `${pads};${rowFiles.map((_, i) => `[p${i}]`).join("")}vstack=${rowFiles.length}[o]`, "-map", "[o]", sheet]);

fs.writeFileSync(path.join(dir, "list.json"), JSON.stringify(rows.map(({ files, ...r }) => r), null, 2) + "\n");
for (const r of rows) seen[r.id] = { date, title: r.title, views: r.views };
fs.writeFileSync(seenPath, JSON.stringify(seen, null, 2) + "\n");
console.log(`✔ ${path.relative(path.join(__dirname, ".."), sheet)} (${rows.length}편)`);
rows.forEach(r => console.log(`${r.no}. ${r.views?.toLocaleString()}회 · ${r.title} · ${r.url}`));
