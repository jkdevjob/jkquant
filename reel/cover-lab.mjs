#!/usr/bin/env node
// 표지(썸네일) 여러 안을 휴대폰 그리드 크기로 나란히 놓고 비교한다 — ISSUE_GUIDE 3-1.
//   node cover-lab.mjs --config queue/issues/X.note.json --variants queue/issues/X.covers.json [--out lab.png]
// variants 파일 = [{ "label": "A 질문형", "page": { cover 페이지(pages[0]와 같은 형식) } }, …]
// 결과: 위 줄 = 릴스 커버(가운데 3:4) 240x320, 아래 줄 = 프로필 그리드 실제 크기에 가까운 120x160.
// 작은 줄에서도 2초 안에 읽히는 안을 고른다.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const a = process.argv.slice(2), arg = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const cfgPath = arg("--config"), varPath = arg("--variants");
if (!cfgPath || !varPath){ console.error("사용법: node cover-lab.mjs --config <노트.json> --variants <표지안.json> [--out <png>]"); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const variants = JSON.parse(fs.readFileSync(varPath, "utf8"));
const out = path.resolve(arg("--out") || varPath.replace(/\.json$/, "") + "_lab.png");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coverlab_"));
const here = path.dirname(new URL(import.meta.url).pathname);

const pngs = [];
variants.forEach((v, i) => {
  const page = { ...v.page, start: 0 };
  // 표지 안의 시각은 숫자만 쓴다(목소리 없이 그림) — "@줄id" 는 0.5초로 바꾼다
  page.items = (page.items || []).map(it => ({ ...it, at: typeof it.at === "number" ? it.at : 0.5 }));
  const c = { ...cfg, voice: undefined, duration: 2.2, pages: [page], tape: v.tape || cfg.tape, out: path.join(tmp, `v${i}.mp4`) };
  const cp = path.join(tmp, `v${i}.note.json`);
  fs.writeFileSync(cp, JSON.stringify(c));
  const r = spawnSync(process.execPath, [path.join(here, "make-note.mjs"), "--config", cp, "--preview", "2"], { encoding: "utf8" });
  const png = path.join(tmp, `v${i}_t2.png`);
  if (!fs.existsSync(png)){ console.error(`✖ ${v.label}: 미리보기 실패\n${(r.stderr || "").slice(-600)}`); process.exit(1); }
  pngs.push(png);
  console.log(`${i + 1}. ${v.label}`);
});
// 가운데 3:4(1080x1440, 위 240px부터)만 잘라 두 크기로 붙인다
const inputs = pngs.flatMap(p => ["-i", p]);
const n = pngs.length;
let f = "";
for (let i = 0; i < n; i++) f += `[${i}:v]crop=1080:1440:0:240,split[c${i}a][c${i}b];[c${i}a]scale=240:320[b${i}];[c${i}b]scale=120:160,pad=240:160:0:0:color=0x202020[s${i}];`;
f += `${[...Array(n).keys()].map(i => `[b${i}]`).join("")}hstack=inputs=${n}[top];${[...Array(n).keys()].map(i => `[s${i}]`).join("")}hstack=inputs=${n}[bot];[top][bot]vstack=inputs=2`;
const r = spawnSync(ffmpeg.path, ["-y", ...inputs, "-filter_complex", n > 1 ? f : f.replace(/hstack=inputs=1/g, "null"), "-frames:v", "1", out], { encoding: "utf8" });
if (r.status !== 0){ console.error(r.stderr.slice(-1200)); process.exit(1); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log("✔", path.relative(process.cwd(), out), "(왼쪽부터 1번)");
