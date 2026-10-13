// 무매·5년 플랜 매일 연구 — RESEARCH_LOG.md 의 '일일 기록' 맨 끝 항목을 웹 알림 요약으로 만든다.
// GitHub Actions(research-notify.yml)가 research/daily 에 기록이 올라올 때 이걸 실행해 푸시 서버 /research-note 로 보낸다.
import fs from "node:fs";

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// md: 연구 기록 전체 · 돌려주는 것 {date, body, discovery} 또는 null(일일 기록 없음)
export function latestResearchEntry(md) {
  const text = String(md || "");
  const at = text.indexOf("## 일일 기록");
  if (at < 0) return null;
  const sec = text.slice(at).split(/\n(?=## (?!#))/)[0];                 // 다음 '## ' 절 전까지
  const parts = sec.split(/\n(?=### )/).slice(1);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const head = last.split("\n")[0], m = /^### (\d{4}-\d{2}-\d{2})/.exec(head);
  if (!m) return null;
  const raw = last.split("\n").slice(1).map(l => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  // 판정(★ 발견 · 발견 · 보류 · 탈락)이 든 줄을 먼저 — 알림 본문이 잘려도 결론은 보이게. 같은 등급 안에선 원래 순서.
  const rank = l => /★\s*발견|\*\*발견\*\*/.test(l) ? 0 : /발견|보류/.test(l) ? 1 : /탈락/.test(l) ? 2 : 3;
  const lines = raw.map((l, i) => [rank(l), i, l]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  const discovery = /★\s*발견/.test(last);
  const body = clip(lines.join(" · ").replace(/\*\*/g, "").replace(/`/g, ""), 240);
  return body ? { date: m[1], body, discovery } : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = latestResearchEntry(fs.readFileSync(process.argv[2], "utf8"));
  if (!e) { console.error("일일 기록 없음"); process.exit(2); }
  process.stdout.write(JSON.stringify(e));
}
