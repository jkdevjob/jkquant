// 무매·5년 플랜 매일 연구 웹알림 — 연구 기록 → 요약 → 푸시 서버(/research-note) → 'research' 주제 구독 기기에만
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { latestResearchEntry } from "../scripts/research-notify.mjs";
import { PresaleAlertStore } from "../worker/presale-alert/src/index.js";

const LOG = `# 기록
## 다음에 시험할 것
1. 무엇
## 일일 기록

### 2026-10-12 (수동 · 첫 연구)
- 하네스 구축.
- 결론: 개선 없음.

### 2026-10-13
- 익절 자동 noWeak 변형: 1만$ 31.0/50.1 · 10만$ 30.2/58.0 — **보류**
- 합성: 변화 없음 \`grid1.js\`
`;

test("요약: 일일 기록 맨 끝 항목 · 날짜 · 줄을 잇고 꾸밈표 제거 · 발견 표시", () => {
  const e = latestResearchEntry(LOG);
  assert.equal(e.date, "2026-10-13");
  assert.equal(e.body, "익절 자동 noWeak 변형: 1만$ 31.0/50.1 · 10만$ 30.2/58.0 — 보류 · 합성: 변화 없음 grid1.js");
  const v = latestResearchEntry("## 일일 기록\n### 2026-10-16\n- 시험: 긴 설명\n- ① **탈락**: A\n- **보류**: B\n- 주의: C\n");
  assert.equal(v.body, "보류: B · ① 탈락: A · 시험: 긴 설명 · 주의: C", "판정 줄 먼저(보류 → 탈락), 나머지는 원래 순서");
  assert.equal(e.discovery, false);
  const f = latestResearchEntry(LOG + "\n### 2026-10-14\n- ★ 발견 잔금 SGOV 주1회: 1만$ 29.3/54.2\n");
  assert.deepEqual([f.date, f.discovery], ["2026-10-14", true]);
  assert.equal(latestResearchEntry("# 기록\n## 일일 기록\n"), null, "항목이 없으면 보내지 않는다");
  assert.equal(latestResearchEntry("없음"), null);
  const long = latestResearchEntry("## 일일 기록\n### 2026-10-15\n- " + "가".repeat(400));
  assert.equal(long.body.length, 240, "알림 본문은 240자로 자른다");
  const after = latestResearchEntry(LOG + "\n## 부록\n### 2026-12-31\n- 부록은 일일 기록이 아니다\n");
  assert.equal(after.date, "2026-10-13", "다음 절(## )의 ### 는 일일 기록이 아니다");
});

function store(env = {}) {
  const values = new Map();
  const storage = {
    get: async k => values.get(k), put: async (k, v) => { values.set(k, v); }, delete: async k => values.delete(k),
    list: async ({ prefix } = {}) => new Map([...values].filter(([k]) => !prefix || k.startsWith(prefix)))
  };
  const app = new PresaleAlertStore({ storage }, env), pushed = [];
  app.pushOne = async (endpoint, topic) => { pushed.push([endpoint, topic]); return { ok: true, status: 201 }; };
  return { app, values, pushed };
}
const req = (body, key) => new Request("https://w.example/research-note", {
  method: "POST", headers: Object.assign({ "content-type": "application/json", origin: "https://jkquant.pages.dev" }, key ? { "x-monitor-key": key } : {}), body: JSON.stringify(body) });

test("푸시 서버: 감시키 없으면 거부 · research 구독 기기에만 · 같은 요약은 한 번만 · 발견이면 ★ 제목", async () => {
  const { app, values, pushed } = store({ MONITOR_KEY: "k1" });
  values.set("sub:a", { endpoint: "https://push.example/a", topics: ["research", "ipo"] });
  values.set("sub:b", { endpoint: "https://push.example/b", topics: ["ipo"] });
  const note = { date: "2026-10-13", body: "익절 자동 noWeak 변형 — 보류", discovery: false };
  assert.equal((await app.fetch(req(note))).status, 401, "감시키 없음");
  assert.equal((await app.fetch(req(note, "wrong"))).status, 401, "틀린 감시키");
  const r = await (await app.fetch(req(note, "k1"))).json();
  assert.equal(r.ok, true); assert.deepEqual(pushed, [["https://push.example/a", "research"]], "research 구독 기기에만");
  const a = values.get("latest:research");
  assert.equal(a.title, "🔬 무매·5년 플랜 연구 10/13"); assert.equal(a.body, note.body); assert.equal(a.type, "research");
  assert.match(a.url, /research\/daily\/research\/im_plan\/RESEARCH_LOG\.md$/);
  const again = await (await app.fetch(req(note, "k1"))).json();
  assert.equal(again.skipped, true); assert.equal(pushed.length, 1, "같은 날 같은 요약은 다시 안 보낸다");
  await app.fetch(req({ date: "2026-10-14", body: "잔금 SGOV 주1회 — 발견", discovery: true }, "k1"));
  assert.equal(values.get("latest:research").title, "★ 무매·5년 플랜 연구 10/14 — 발견"); assert.equal(pushed.length, 2);
  assert.equal((await app.fetch(req({ date: "10/14", body: "x" }, "k1"))).status, 400, "날짜 형식");
  assert.equal((await app.fetch(req({ date: "2026-10-14", body: "" }, "k1"))).status, 400, "빈 요약");
});

test("주제 목록이 세 곳(푸시 서버 · 서비스워커 · 설정 화면)에서 같다 — 한 곳만 빠지면 알림이 안 뜬다", () => {
  const w = fs.readFileSync(new URL("../worker/presale-alert/src/index.js", import.meta.url), "utf8");
  const sw = fs.readFileSync(new URL("../jk-sw.js", import.meta.url), "utf8");
  const st = fs.readFileSync(new URL("../settings-notifications.js", import.meta.url), "utf8");
  assert.match(w, /const VALID_TOPICS=new Set\(\[[^\]]*"research"/);
  assert.match(sw, /const VALID_TOPICS=new Set\(\[[^\]]*"research"/);
  assert.match(st, /\{topic:"research",href:"\/plan"/);
  const yml = fs.readFileSync(new URL("../.github/workflows/research-notify.yml", import.meta.url), "utf8");
  assert.match(yml, /branches: \[research\/daily\]/); assert.match(yml, /\/research-note/); assert.match(yml, /secrets\.AUTOTRADE_KEY/);
});
