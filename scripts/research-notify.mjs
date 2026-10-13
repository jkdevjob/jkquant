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
  const lines = last.split("\n").slice(1).map(l => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  const discovery = /★\s*발견/.test(last);
  const body = clip(lines.join(" · ").replace(/\*\*/g, "").replace(/`/g, ""), 240);
  return body ? { date: m[1], body, discovery } : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = latestResearchEntry(fs.readFileSync(process.argv[2], "utf8"));
  if (!e) { console.error("일일 기록 없음"); process.exit(2); }
  process.stdout.write(JSON.stringify(e));
}
