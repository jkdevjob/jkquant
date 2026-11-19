// AI 티 점검 — 캡션·대본에서 'AI가 쓴 글' 느낌을 주는 버릇을 찾아 알려 준다(막지는 않음).
// (11/20 사용자 "최대한 AI 느낌 덜나게 만들어")
//   node tools/ai-tells.mjs [--channel mb] [--from 2026-11-20]   큐 캡션 점검(그날 이후 항목)
//   node tools/ai-tells.mjs --note queue/issues/X.note.json       대본(voice.lines) 점검
// publish-social.mjs --dry 도 항목마다 이 점검을 돌려 '⚠ AI 티' 로 보여 준다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  [/[—–]/, "긴 줄표(—) — 쉼표나 문장 끊기로"],
  [/\[(사실|해석|전망|숙제|핵심|요약|결론|포인트)\]/, "[사실]·[해석] 같은 이름표 — 그냥 말로 이어서"],
  [/핵심은|정리하면|정리해 보면|결론적으로|요약하면|한마디로/, "'핵심은/정리하면' 같은 정리 말투"],
  [/살펴보(겠|ㄹ게|자)|알아보(겠|ㄹ게|자|ㄹ까)|짚어 ?보/, "'알아보겠습니다/살펴볼게요' 진행자 말투"],
  [/주목할 만|눈여겨볼|시사하는|의미가 있|의미를 가집|의미 있는 기록/, "기사·보고서 말투(주목할 만/시사하는)"],
  [/셈이에요|셈입니다|꼽혀요|꼽힙니다|것으로 나타났|것으로 보여요|것으로 집계|에 달해요|에 달합니다|에 이릅니다/, "기사 말투(~인 셈·~로 꼽혀요·~에 달해요)"],
  [/뿐만 아니라|또한,|한편,|아울러|더불어/, "글말 이음말(또한·한편·아울러)"],
  [/다양한|효과적으로|체계적으로|종합적으로|전반적으로/, "두루뭉술한 꾸밈말(다양한·효과적으로)"],
  [/팔로우하고 매일 받아 보세요|핫이슈를 숫자로,/, "매번 같은 끝맺음 — 그날 내용에 맞게 바꾸기"],
  [/(점 [일이삼사오육칠팔구] ?퍼센트)/, "대본의 소수점 퍼센트 — 말로는 '열에 넷'·'40% 넘게'처럼 반올림"],
];

export function aiTells(text, { voice = false } = {}) {
  if (!text) return [];
  const out = [];
  for (const [re, why] of RULES) { const m = text.match(re); if (m) out.push(`${why} ("${m[0]}")`); }
  const dots = (text.match(/·/g) || []).length;
  const body = text.split(/\n출처|\n#/)[0];
  const bodyDots = (body.match(/·/g) || []).length;
  if (!voice && bodyDots > 4) out.push(`본문 가운뎃점(·) ${bodyDots}개 — 목록 대신 문장으로(출처 줄은 괜찮음)`);
  if (!voice && /^\s*[①②③④⑤•\-*]\s/m.test(body) && bodyDots + (body.match(/^\s*[①②③④⑤•\-*]\s/gm) || []).length > 6) out.push("본문이 목록·불릿 위주 — 문단 2~4개 말로");
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emoji > 3) out.push(`이모지 ${emoji}개 — 3개 이하`);
  const you = (text.match(/여러분/g) || []).length;
  if (you > 2) out.push(`'여러분' ${you}번 — 한두 번만`);
  void dots;
  return out;
}

export function noteTells(notePath) {
  const n = JSON.parse(fs.readFileSync(notePath, "utf8"));
  const lines = (n.voice && n.voice.lines) || [];
  const out = [];
  for (const l of lines) for (const w of aiTells(l.text, { voice: true })) out.push(`${l.id}: ${w}`);
  const long = lines.filter((l) => [...l.text].length > 70).map((l) => l.id);
  if (long.length) out.push(`긴 대사(70자 넘음): ${long.join(", ")} — 말할 땐 짧게 끊기`);
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..");
  if (arg("--note")) {
    const w = noteTells(path.resolve(arg("--note")));
    console.log(w.length ? w.map((x) => "⚠ " + x).join("\n") : "✔ 대본 AI 티 없음");
  } else {
    const ch = arg("--channel");
    const qp = path.join(root, ch === "mb" ? "queue/mb/queue.json" : "queue/queue.json");
    const from = arg("--from") || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const items = JSON.parse(fs.readFileSync(qp, "utf8")).items.filter((i) => (i.date || "9999") >= from);
    for (const i of items) {
      const w = aiTells(i.caption);
      console.log(`${w.length ? "⚠" : "✔"} ${i.id}${i.date ? ` (${i.date} ${i.slot || ""})` : ""}${w.length ? "\n   - " + w.join("\n   - ") : ""}`);
    }
  }
}
