#!/usr/bin/env node
// 게시 안전 점검 — GitHub Actions 와 똑같이 '받아 오는 파일만' 있는 폴더에서 업로더를 돌려 본다.
// (11/20 사고: 업로더에 새 파일 import 를 붙였는데 Actions 는 업로더·큐만 받아 와서 08:30·09:00·12:00 게시가 모두 멈췄다.
//  내 컴퓨터 --dry 는 저장소 전체가 있어 통과했기 때문에 못 잡았다 → 이 도구는 Actions 의 sparse 목록 그대로 시험한다.)
//
//   node reel/tools/verify-publish.mjs [--ref HEAD]     실패하면 exit 1 (pre-push 훅이 부른다)
//
// 하는 일
//  1) tools/gen-publish-workflows.mjs 의 채널별 sparse 목록을 읽어, 그 커밋(--ref)의 그 파일만 임시 폴더에 꺼낸다(git sparse-checkout).
//  2) Actions '점검' 단계와 같은 명령(node publish-social.mjs --dry [--channel mb])을 돌린다.
//  3) 오늘부터 3일 동안의 게시 칸마다 그 시각으로 가정해(--date --now) 돌려, 무엇이 나갈지 표로 보이고
//     오류·점검 실패·커밋 안 된 영상·같은 칸 두 편을 잡는다.
//  그리고 이 저장소에 pre-push 훅(tools/githooks)을 켠다(git config core.hooksPath) — 컨테이너가 새로 받아도 이 도구를 한 번 돌리면 다시 켜진다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim();
const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const ref = execFileSync("git", ["rev-parse", arg("--ref") || "HEAD"], { cwd: root, encoding: "utf8" }).trim();

// pre-push 훅 켜기(이미 켜져 있으면 그대로)
try {
  const cur = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).stdout.trim();
  if (cur !== "reel/tools/githooks") execFileSync("git", ["config", "core.hooksPath", "reel/tools/githooks"], { cwd: root });
} catch { /* 훅 켜기 실패는 점검 결과와 무관 */ }

// 1) 채널 설정(sparse·게시 칸)을 생성기에서 읽는다 — workflow 와 늘 같게
const gen = fs.readFileSync(path.join(root, "reel/tools/gen-publish-workflows.mjs"), "utf8");
const blocks = [...gen.matchAll(/file: "([^"]+)"[\s\S]*?sparse: (\[[^\]]*\])[\s\S]*?chArg: "([^"]*)"[\s\S]*?day: (\[\[[\s\S]*?\]\]),/g)];
if (blocks.length < 2) { console.error("✖ 생성기에서 채널 설정을 못 읽음(gen-publish-workflows.mjs 형식이 바뀜) — 이 도구를 고칠 것"); process.exit(1); }
const LATE = +(gen.match(/const LATE_MIN = (\d+)/) || [0, 150])[1];
const channels = blocks.map((m) => ({
  wf: m[1], sparse: JSON.parse(m[2]), chArg: m[3].trim(),
  slots: JSON.parse(m[4]).filter((s) => s[1]).map((s) => s[0]),
  name: m[3].includes("mb") ? "매니악" : "은퇴노트",
}));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-publish-"));
const worktrees = [];
let bad = 0;
const fail = (msg) => { bad++; console.log("  ✖ " + msg); };
const kstNow = new Date(Date.now() + 9 * 3600e3);
const today = kstNow.toISOString().slice(0, 10), nowHM = kstNow.toISOString().slice(11, 16);
const addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const plusMin = (hm, m) => { const t = +hm.slice(0, 2) * 60 + +hm.slice(3) + m; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

try {
  for (const c of channels) {
    console.log(`\n■ ${c.name} (${c.wf}) — 커밋 ${ref.slice(0, 7)}, Actions 처럼 받는 파일: ${c.sparse.join(", ")}`);
    const dir = path.join(tmp, c.name === "매니악" ? "mb" : "rn");
    // 저장소가 얕은 복제라 clone 은 느리다(25초+) → 같은 저장소의 빈 worktree 에 sparse 경로만 꺼낸다(1초 안)
    execFileSync("git", ["-C", root, "worktree", "add", "-q", "--no-checkout", "--detach", dir, ref]);
    worktrees.push(dir);
    for (const sp of c.sparse) spawnSync("git", ["-C", dir, "checkout", ref, "--", sp], { stdio: "ignore" }); // 그 커밋에 없는 경로는 건너뜀(Actions 도 같음)
    const reel = path.join(dir, "reel");
    // 큐에 걸린 영상·카드 이미지는 그 커밋에서 꺼내 둔다(Actions 는 푸시된 커밋에서 내려받는데, 푸시 전에는 GitHub 에 아직 없어서)
    for (const q of c.chArg.includes("mb") ? ["queue/mb/queue.json"] : ["queue/queue.json"]) {
      for (const it of JSON.parse(fs.readFileSync(path.join(reel, q), "utf8")).items || []) {
        if (((it.plan_at || "").slice(0, 10) || it.date || "") < today) continue; // 지난 편은 꺼내지 않음(느려짐)
        for (const f of [it.file, ...(it.images || [])].filter(Boolean)) {
          const dst = path.join(reel, f);
          if (fs.existsSync(dst)) continue;
          const r = spawnSync("git", ["-C", root, "show", `${ref}:reel/${f}`], { maxBuffer: 1 << 30 });
          if (r.status === 0) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, r.stdout); }
        }
      }
    }
    // 업로더가 불러오는 로컬 파일이 Actions 에도 있는지(정적 import · 동적 import 모두)
    const src = fs.readFileSync(path.join(reel, "publish-social.mjs"), "utf8");
    for (const m of src.matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const dep = path.join(reel, m[1]);
      const line = src.split("\n").find((l) => l.includes(m[1])) || "";
      const dyn = /import\(/.test(line) && /\btry\b/.test(line) && /\bcatch\b/.test(line); // 한 줄 try { await import() } catch {} 꼴만 인정
      if (!fs.existsSync(dep) && !dyn) fail(`업로더가 '${m[1]}' 을 불러오는데 Actions 에는 그 파일이 없음 — 생성기 sparse 에 넣거나 동적 import 로`);
      else if (!fs.existsSync(dep)) console.log(`  · '${m[1]}' 은 Actions 에 없지만 try 안 동적 import 라 건너뜀`);
    }
    // 2) Actions '점검' 단계와 같은 명령
    const run = (extra) => spawnSync(process.execPath, ["publish-social.mjs", "--dry", ...(c.chArg ? c.chArg.split(" ") : []), ...extra],
      { cwd: reel, encoding: "utf8", env: { ...process.env, IG_ACCESS_TOKEN: "", MB_IG_ACCESS_TOKEN: "", YT_REFRESH_TOKEN: "" }, timeout: 120000 });
    const base = run([]);
    const baseOut = (base.stdout + base.stderr).replace(/^\(node:\d+\).*\n|^\(Use `node --trace.*\n/gm, "");
    if (base.status !== 0) fail(`'점검' 단계가 실패(exit ${base.status}) — Actions 에서도 이렇게 멈춤:\n${baseOut.split("\n").slice(0, 12).map((l) => "      " + l).join("\n")}`);
    else console.log("  ✔ '점검' 단계 통과");
    // 3) 앞으로 3일 게시 칸
    const seen = new Map();
    for (let d = 0; d < 3; d++) for (const hm of c.slots) {
      const date = addDay(today, d);
      if (d === 0 && plusMin(hm, LATE) < nowHM) continue; // 이미 지난 칸
      const r = run(["--date", date, "--now", plusMin(hm, 1)]);
      const out = (r.stdout + r.stderr);
      const lines = out.split("\n").filter((l) => /^(인스타|유튜브):/.test(l));
      const go = lines.filter((l) => l.includes("올릴 예정")).map((l) => l.match(/: (\S+?)\(/)?.[1]).filter(Boolean);
      const label = `${date.slice(5)} ${hm}`;
      if (r.status !== 0 && !/점검 실패|내려받기 실패|커밋되지 않아/.test(out)) fail(`${label} 칸 실행 오류(exit ${r.status}): ${out.split("\n").filter((l) => /Error|오류/.test(l)).slice(0, 3).join(" / ")}`);
      for (const l of lines) if (/점검 실패|내려받기 실패|커밋되지 않아/.test(l)) fail(`${label} ${l.replace(/^(인스타|유튜브): /, "").slice(0, 160)}`);
      const ig = [...new Set(lines.filter((l) => l.startsWith("인스타:") && l.includes("올릴 예정")).map((l) => l.match(/: (\S+?)\(/)?.[1]))];
      if (ig.length > 1) console.log(`  ⚠ ${label} 한 칸에 ${ig.length}편(${ig.join(", ")}) — 의도한 게 아니면 하나를 다른 칸으로`);
      for (const id of go) { if (seen.has(id) && seen.get(id) !== label) { /* 같은 편이 다음 칸에도 보이는 건 앞 칸에서 안 나갔다고 가정한 시험이라 정상 */ } else seen.set(id, label); }
      console.log(`  ${label}  ${ig.length ? ig.join(", ") : "— 비어 있음"}`);
    }
  }
} finally {
  for (const w of worktrees) spawnSync("git", ["-C", root, "worktree", "remove", "--force", w], { stdio: "ignore" });
  spawnSync("git", ["-C", root, "worktree", "prune"], { stdio: "ignore" });
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(bad ? `\n✖ 게시 안전 점검 실패 ${bad}건 — 고친 뒤 다시 돌릴 것` : "\n✔ 게시 안전 점검 통과(Actions 와 같은 조건)");
process.exit(bad ? 1 : 0);
