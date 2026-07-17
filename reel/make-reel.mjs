#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  JK 퀀트 릴스 자동 생성 — 종목 적립식(DCA) 백테스트 → 세로 mp4
//
//  사용법:
//    node make-reel.mjs --symbol 035720 --name 카카오 --amount 10000 \
//         --interval daily --start 2021-07-01 --duration 16
//    node make-reel.mjs --config reels.config.json      (여러 편 일괄 생성)
//
//  결과: out/<심볼>_<날짜>.mp4  (1080x1920, 30fps, H.264+AAC)
// ════════════════════════════════════════════════════════════════════
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import pw from "playwright";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { fetchSeries, sliceByDate } from "./lib/data.mjs";
import { runDCA } from "./lib/dca.mjs";

const { chromium } = pw;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = ffmpeg.path;

// ── 인자 파싱 ──
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith("--")) a[key] = true;
      else { a[key] = next; i++; }
    } else if (!a.symbol) a.symbol = t;
  }
  return a;
}

const INTERVAL_LABEL = { daily: "매일", weekly: "매주", monthly: "매월" };

function ymd(d) { return d.replace(/-/g, ".").slice(0, 7); } // 2021-07-01 → 2021.07

function dateToUnix(d) { return Math.floor(new Date(d + "T00:00:00Z").getTime() / 1000); }

// 배열을 n개 이하로 균등 다운샘플
function downsample(arr, n = 140) {
  if (arr.length <= n) return arr.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

// ── 한 편의 릴스 생성 ──
async function makeOne(spec, browser) {
  const symbol = String(spec.symbol);
  const interval = spec.interval || "daily";
  const amount = +spec.amount || 10000;
  const durationSec = +spec.duration || 16;
  const fps = +spec.fps || 30;

  process.stdout.write(`\n▶ ${symbol} 데이터 수집…`);
  const fetchOpts = {};
  if (spec.start) {
    fetchOpts.period1 = dateToUnix(spec.start);
    fetchOpts.period2 = dateToUnix(spec.end || new Date().toISOString().slice(0, 10)) + 86400;
  } else {
    fetchOpts.range = spec.range || "5y";
  }
  const data = await fetchSeries(symbol, fetchOpts);
  let series = data.series;
  if (spec.start || spec.end) series = sliceByDate(series, spec.start, spec.end);
  if (series.length < 10) throw new Error(`${symbol}: 데이터가 너무 적습니다(${series.length}개)`);

  const dca = runDCA(series, { amount, interval });
  process.stdout.write(` ${dca.buys}회 매수 · 수익률 ${dca.returnPct.toFixed(1)}%`);

  const currency = data.currency || (/^\d{6}$/.test(symbol) ? "KRW" : "USD");
  const name = spec.name || data.longName || symbol;
  const intervalLabel = INTERVAL_LABEL[interval] || "정기";
  const amountLabel = currency === "KRW"
    ? (amount % 10000 === 0 ? `${amount / 10000}만원` : `${amount.toLocaleString()}원`)
    : `$${amount.toLocaleString()}`;

  const valueLine = downsample(dca.equity.map((e) => e.value));
  const investedLine = downsample(dca.equity.map((e) => e.invested));

  const DATA = {
    ticker: symbol,
    name,
    currency,
    amount,
    intervalLabel,
    startLabel: ymd(dca.startDate),
    endLabel: ymd(dca.endDate),
    invested: dca.invested,
    finalValue: dca.finalValue,
    profit: dca.profit,
    returnPct: dca.returnPct,
    priceLine: downsample(dca.prices.map((p) => p.close)),
    valueLine,
    investedLine,
    hook: spec.hook || `${name}에 ${intervalLabel} ${amountLabel}씩 샀다면?`,
    punch: spec.punch || (dca.profit >= 0
      ? `${(dca.finalValue / (dca.invested || 1)).toFixed(1)}배로 불었습니다`
      : `버틴 결과가 이렇습니다…`),
    handle: spec.handle || "",
    durationSec,
    accent: spec.accent || null,
  };

  // 템플릿 HTML에 데이터 주입 → reel/ 디렉토리에 임시 저장(폰트 상대경로 유지)
  const tpl = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");
  const injected = tpl.replace(
    "<script>",
    `<script>window.__DATA__=${JSON.stringify(DATA)};</script>\n<script>`
  );
  const renderId = `${symbol}_${Date.now()}`;
  const htmlPath = path.join(__dirname, `.render_${renderId}.html`);
  fs.writeFileSync(htmlPath, injected);

  // 프레임 캡처
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "reelframes_"));
  const totalFrames = Math.round(durationSec * fps);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto("file://" + htmlPath);
  await page.waitForFunction("window.__READY__ === true", null, { timeout: 20000 });
  process.stdout.write(`\n  프레임 캡처 ${totalFrames}장 `);
  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    await page.evaluate((tt) => window.renderAt(tt), t);
    await page.screenshot({ path: path.join(framesDir, `f_${String(f).padStart(5, "0")}.png`) });
    if (f % 30 === 0) process.stdout.write("·");
  }
  await page.close();

  // ── ffmpeg 인코딩 ──
  const outDir = path.join(__dirname, spec.outDir || "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = spec.out
    ? path.resolve(spec.out)
    : path.join(outDir, `${symbol}_${new Date().toISOString().slice(0, 10)}.mp4`);

  const args = ["-y", "-framerate", String(fps), "-i", path.join(framesDir, "f_%05d.png")];
  if (spec.music && fs.existsSync(spec.music)) {
    args.push("-i", spec.music);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  }
  args.push(
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-preset", "medium",
    "-r", String(fps),
    "-c:a", "aac", "-b:a", "128k",
    "-t", String(durationSec), "-shortest",
    "-af", "afade=t=out:st=" + (durationSec - 1) + ":d=1",
    "-movflags", "+faststart",
    outPath
  );
  process.stdout.write(`\n  ffmpeg 인코딩… `);
  await runFF(args);

  // 정리
  fs.rmSync(framesDir, { recursive: true, force: true });
  if (!spec.keepHtml) fs.rmSync(htmlPath, { force: true });

  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✔ ${outPath}  (${kb} KB)`);
  return { outPath, dca, DATA };
}

function runFF(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg 실패:\n" + err.slice(-1500)))));
  });
}

// ── 메인 ──
async function main() {
  const a = parseArgs(process.argv.slice(2));
  let specs;
  if (a.config) {
    const cfg = JSON.parse(fs.readFileSync(path.resolve(a.config), "utf8"));
    specs = Array.isArray(cfg) ? cfg : cfg.reels || [cfg];
  } else {
    if (!a.symbol) {
      console.error("사용법: node make-reel.mjs --symbol <종목> [--name 이름] [--amount 10000] [--interval daily|weekly|monthly] [--start YYYY-MM-DD] [--duration 16]\n또는:   node make-reel.mjs --config reels.config.json");
      process.exit(1);
    }
    specs = [a];
  }

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const spec of specs) {
      try { results.push(await makeOne(spec, browser)); }
      catch (e) { console.error(`\n✗ ${spec.symbol}: ${e.message}`); }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n완료: ${results.length}/${specs.length} 편 생성`);
}

main().catch((e) => { console.error(e); process.exit(1); });
