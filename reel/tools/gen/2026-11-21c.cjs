// 11/21 18:00 — 국민연금 연계 감액: 국민연금이 기준연금액의 150%(2026 월 52만 4,550원)를 넘으면 기초연금이 깎일 수 있다
// (REFERENCES 주제 후보 ①, 한국경제 10/26 남인순 의원·복지부 자료 · SBS Biz 8/23 국회예산정책처)
const { t, VOICE, writeNote, sheetCover, mascotEnd } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/issues/";
// 기준연금액 2026 = 349,700원(b06 출처: 경향신문·KDI) → 150% = 524,550원, 50% = 174,850원(직접 계산)
const ROWS = [["기준연금액", "월 34만 9,700원"], ["안 깎이는 선", "국민연금 52만 4,550원"], ["넘으면", "가입기간 따라 깎임"],
  ["최대 깎여도", "절반 17만 4,850원"], ["깎인 사람", "84만 2천 명(2025)"], ["평균 깎인 돈", "월 9만 6천 원"]];
const mk = (t1, t2) => sheetCover({ skin: "rn", t1, t2, t1size: 66, t2size: 66, sub: "2026년 · 혼자 받는 기준 · 보건복지부·한국경제·SBS Biz",
  cols: [76, 380], head: ["기초연금", "숫자"], y0: 600, size: 56, step: 100, rows: ROWS, hi: 1,
  note: "깎이는 금액은 가입기간 등에 따라 달라요 · 공단 1355", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 52만 넘으면", page: mk("국민연금 52만 넘으면 기초연금 깎여요", "깎인 사람 84만 명, 월 평균 9.6만") },
  { label: "B 깎이는 선", page: mk("기초연금 깎이는 국민연금 선", "월 52만 4,550원") },
  { label: "C 84만 명", page: mk("국민연금 받다가 기초연금 깎인 84만 명", "기준은 월 52만 4,550원") },
];
fs.writeFileSync(R + "2026-11-21c.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = VOICE([
  { id: "hook", text: "국민연금 꼬박꼬박 받는데, 기초연금이 깎일 수 있다는 거 아세요?" },
  { id: "news", text: "작년에만 팔십사만 명이 국민연금 때문에 기초연금이 깎였대요. 사 년 만에 두 배가 넘어요.", gap: 0.3 },
  { id: "rule", text: "선은 하나예요. 국민연금이 한 달 오십이만 사천오백오십 원을 넘으면, 깎일 수 있어요.", gap: 0.3 },
  { id: "table", text: "얼마나 깎이는지는 가입 기간에 따라 다른데, 아무리 깎여도 절반, 십칠만 원 넘게는 남아요." },
  { id: "avg", text: "실제로 깎인 분들은 한 달 평균 구만 육천 원 정도 덜 받았고요.", gap: 0.2 },
  { id: "view", text: "근데 깎인 분 열 명 중 여덟은 국민연금이 월 백만 원도 안 돼서, 불공평하다는 얘기도 계속 나와요.", gap: 0.3 },
  { id: "cta", text: "우리 부모님 국민연금은 오십이만 원 넘으세요? 댓글로 알려 주세요.", gap: 0.35 },
]);
// 국민연금 연계 감액 대상자(한국경제 10/26 — 남인순 의원·복지부 / SBS Biz 8/23 — 2021 38.9만 → 2025 84.2만 일치)
const TREND = [["2021년", "38만 9천 명", "14.7%"], ["2022년", "48만 2천 명", "16.6%"], ["2023년", "59만 1천 명", "18.6%"], ["2024년", "70만 4천 명", "20.5%"], ["2025년", "84만 2천 명", "22.6%"]];
const X = [140, 420, 790];
const Y = (i) => 640 + i * 84;
const at = ["@news+0.4", "@news+1.2", "@news+2.0", "@news+2.8", "@news+3.6"];
const body = [
  t("h1", "기초연금 깎이는 국민연금 선", 128, 196, 62, "bold", "ink", 0, 0, { rot: -0.8 }),
  t("s1", "(보건복지부 기준연금액 · 한국경제 10/26 · SBS Biz 8/23)", 140, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("hda", "해", X[0], 560, 34, "pen", "gray", "@news", 0.3),
  t("hdb", "깎인 사람", X[1], 560, 34, "pen", "gray", "@news", 0.3),
  t("hdc", "동시 수급자 중", X[2] - 60, 560, 34, "pen", "gray", "@news", 0.3),
  ...TREND.flatMap((r, i) => { const c = i === 4 ? "red" : "ink";
    return [t(`r${i + 1}a`, r[0], X[0], Y(i), 46, "bold", i === 4 ? "red" : "gray", at[i], 0.3), t(`r${i + 1}b`, r[1], X[1], Y(i), 50, "bold", c, at[i], 0.35), t(`r${i + 1}c`, r[2], X[2], Y(i), 46, "bold", c, at[i], 0.35)]; }),
  { type: "circle", target: "r5b", at: "@news.end-0.6", dur: 0.5, color: "red", pad: 8, width: 6 },
  t("k1", "국민연금 월 52만 4,550원 넘으면", 140, 1080, 50, "bold", "red", "@rule+1.0", 0.8),
  t("k2", "(기준연금액 34만 9,700원 × 1.5 · 직접 계산)", 150, 1146, 24, "pen", "gray", "@rule.end-0.5", 0.5),
  { type: "sticky", x: 140, y: 1190, w: 600, h: 190, rot: -2, at: "@table-0.2", items: [
    t("m1", "최대 깎여도 절반 남아요", 36, 22, 40, "bold", "ink", "@table+1.6", 0.5),
    t("m2", "평균 월 9만 6천 원 깎임", 36, 96, 40, "bold", "blue", "@avg+0.3", 0.5) ] },
  mascotEnd("@view+0.6", "저장!", 780, 1170, 190),
  t("n9", "(깎인 분 80%가 국민연금 월 100만 원 이하 — 한국경제)", 140, 1408, 24, "pen", "gray", "@view+0.4", 0.6),
  t("sig", "늦지 않았습니다. — 은퇴노트", 140, 1462, 52, "pen", "ink", "@cta", 0.8, { rot: -2 }),
  t("handle", "@retire.note", 760, 1525, 30, "sans", "gray", "@cta+0.6", 0.5, { fade: true }),
];
writeNote(R + "2026-11-21c.note.json", {
  duration: "auto", fps: 30, flip: 0.7, tape: { text: "내 칸 표 #8 · 기초연금 감액", color: "yellow" },
  out: "queue/issues/2026-11-21_basic-pension-cut-line.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", stains: [{ x: 720, y: 1520, r: 160, opacity: 0.16, rot: -8 }], items: body }] });
console.log("ok cover", covers[pick].label);
