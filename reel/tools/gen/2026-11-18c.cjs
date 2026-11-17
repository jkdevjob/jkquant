// 11/18 18:00 — 정년 60세 vs 국민연금 지급 나이: 출생연도별 소득 공백 (현대차그룹 노조 65세 정년 입법 촉구 11/17)
const { t, VOICE, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/issues/";
const ROWS = [["1957~60년생", "62세", "2년", "4,800만"], ["1961~64년생", "63세", "3년", "7,200만"], ["1965~68년생", "64세", "4년", "9,600만"], ["1969년생~", "65세", "5년", "1.2억"]];
const mk = (t1, t2) => sheetCover({ skin: "rn", t1, t2, t1size: 74, t2size: 68, sub: "법정 정년 60세 · 국민연금 지급 나이(국민연금법)",
  cols: [76, 410, 575, 735], head: ["출생연도", "연금", "공백", "월 200만"], y0: 600, size: 58, step: 108,
  rows: ROWS, hi: 3,
  note: "생활비 월 200만 원 가정 · 정년 65세 연장은 아직 입법 전", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 65세", page: mk("정년 60세, 국민연금은 65세", "69년생부터 5년 소득 공백") },
  { label: "B 1.2억", page: mk("60세 퇴직하면 연금까지", "69년생은 5년 · 1.2억 필요") },
  { label: "C 출생연도", page: mk("내 출생연도 국민연금 나이", "69년생부터 65세 · 공백 5년") },
];
fs.writeFileSync(R + "2026-11-18c.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = VOICE([
  { id: "hook", text: "정년은 육십 세인데, 내 국민연금은 몇 살부터 나올까요?" },
  { id: "news", text: "어제 현대차그룹 노조가 육십오 세 정년 입법을 요구했어요. 법은 아직 그대로예요.", gap: 0.3 },
  { id: "table", text: "육십일년생부터 육십사년생은 육십삼 세, 육십오년생부터 육십팔년생은 육십사 세, 육십구년생부터는 육십오 세에 받아요." },
  { id: "money", text: "한 달 이백만 원 쓰면, 오 년 공백에 일억 이천만 원이 필요해요.", gap: 0.2 },
  { id: "check", text: "여당 초안은 이천이십구년 육십일 세부터 단계적으로 늘리는 안인데, 아직 확정은 아니에요.", gap: 0.3 },
  { id: "cta", text: "몇 번째 줄이세요? 팔로우하면 내 칸 표 계속 드려요.", gap: 0.35 },
]);
const X = [140, 470, 630, 780];
const AT = [0.0, 0.3, 3.1, 6.2];
const body = [
  t("h1", "정년 60세, 국민연금은 몇 살부터", 128, 196, 62, "bold", "ink", 0, 0, { rot: -0.8 }),
  t("s1", "(현대차그룹 노조 국회 기자회견 11/17 · 파이낸셜뉴스·중앙일보)", 140, 300, 28, "pen", "gray", "@news+0.3", 0.7),
  t("s2", "법정 정년 60세 그대로 · 65세 입법 지연", 140, 360, 44, "bold", "red", "@news+2.6", 0.8),
  t("hda", "출생연도", X[0], 465, 36, "pen", "gray", "@table", 0.3),
  t("hdb", "연금", X[1], 465, 36, "pen", "gray", "@table", 0.3),
  t("hdc", "공백", X[2], 465, 36, "pen", "gray", "@table", 0.3),
  t("hdd", "월 200만이면", X[3], 465, 36, "pen", "gray", "@money", 0.3),
  ...ROWS.flatMap((r, i) => { const c = i === 3 ? "red" : "ink", y = 555 + i * 98;
    return [t(`r${i + 1}a`, r[0], X[0], y, 50, "bold", i === 0 ? "gray" : c, `@table+${AT[i].toFixed(1)}`, 0.4), t(`r${i + 1}b`, r[1], X[1], y, 56, "bold", c, `@table+${(AT[i] + 0.5).toFixed(1)}`, 0.3),
      t(`r${i + 1}c`, r[2], X[2], y, 56, "bold", c, "@table.end", 0.3), t(`r${i + 1}d`, r[3], X[3], y, 54, "bold", i === 3 ? "red" : "gray", `@money+${(0.4 + i * 0.5).toFixed(1)}`, 0.3)]; }),
  { type: "circle", target: "r4d", at: "@money+2.6", dur: 0.5, color: "red", pad: 10, width: 6 },
  t("n0", "(지급 나이: 국민연금법 · 매일경제·헤럴드경제·세계일보 11/2 · 생활비 월 200만 원 가정, 직접 계산)", 150, 955, 22, "pen", "gray", "@money.end", 0.6),
  { type: "sticky", x: 150, y: 1010, w: 780, h: 250, rot: -2, at: "@check-0.2", items: [
    t("m1", "아직 확정 아님", 46, 24, 48, "bold", "red", "@check", 0.5),
    t("m2", "여당 특위 초안: 2029년 61세", 46, 96, 42, "bold", "ink", "@check+0.8", 0.5),
    t("m3", "→ 2년마다 1살 → 2037년 65세", 46, 164, 42, "bold", "blue", "@check+2.6", 0.6) ] },
  t("n9", "(중앙일보·데일리안 11/17 · 국민연금 1355에서 내 나이 확인)", 150, 1295, 24, "pen", "gray", "@cta", 0.6),
  t("sig", "늦지 않았습니다. — 은퇴노트", 330, 1345, 56, "pen", "ink", "@cta", 0.8, { rot: -2 }),
  t("handle", "@retire.note", 600, 1415, 32, "sans", "gray", "@cta+0.6", 0.5, { fade: true }),
];
writeNote(R + "2026-11-18c.note.json", {
  duration: "auto", fps: 30, flip: 0.7, tape: { text: "내 칸 표 #4 · 소득 공백", color: "yellow" },
  band: { lines: ["정년 60세, 국민연금은 몇 살부터", "69년생부터 [5년] 소득 공백"] },
  out: "queue/issues/2026-11-18_retire-age-pension-gap.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", stains: [{ x: 700, y: 1500, r: 170, opacity: 0.18, rot: -8 }], items: body }] });
console.log("ok cover", covers[pick].label);
