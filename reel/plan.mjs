#!/usr/bin/env node
// AI 기획 CLI — Claude가 "오늘 만들 릴스" 종목/앵글을 뽑아 reels.config.json 생성.
// 사용법:
//   export ANTHROPIC_API_KEY=sk-ant-...
//   node plan.mjs --count 5 --market KR --handle "@jkquant"
//   node plan.mjs --count 3 --market MIX --note "반도체 위주" --out my.config.json
// 그다음:  node make-reel.mjs --config reels.config.json
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { planReels } from "./lib/ai-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const n = argv[i + 1];
      if (n == null || n.startsWith("--")) a[k] = true;
      else { a[k] = n; i++; }
    }
  }
  return a;
}

const a = parseArgs(process.argv.slice(2));
const count = +a.count || 5;
const market = (a.market || "KR").toUpperCase();
const outPath = path.resolve(a.out || path.join(__dirname, "reels.config.json"));

console.log(`▶ Claude로 릴스 ${count}개 기획 중 (시장: ${market})…`);
const reels = await planReels({ count, market, note: a.note === true ? "" : a.note || "" });

// make-reel.mjs 가 읽는 config 형식으로 변환
const config = {
  reels: reels.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    amount: r.amount,
    interval: r.interval,
    start: r.start,
    hook: r.hook,
    handle: a.handle === true ? "" : a.handle || "",
    aiCopy: true, // 영상 생성 시 실제 숫자로 카피 재생성
    _angle: r.angle, // 메모(사람용)
  })),
};

fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
console.log(`\n✔ ${outPath} 저장 (${reels.length}개)\n`);
for (const r of reels) {
  console.log(`  • ${r.name} (${r.symbol}, ${r.market}) — ${r.angle}`);
  console.log(`    후킹: "${r.hook}"  |  ${r.interval} ${r.amount} from ${r.start}`);
}
console.log(`\n다음: node make-reel.mjs --config ${path.basename(outPath)}`);
