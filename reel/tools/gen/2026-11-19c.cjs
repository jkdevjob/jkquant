// 11/19 18:00 — 내 연금 월 ○○만 원이면 65세 이상 중 상위 몇 % (국가데이터처 2024년 연금통계, 8/25 발표)
// 인스타 경제 계정 분석(REFERENCES 11/18): '월 ○○ 벌면 상위 몇 %' 꼴을 노후 돈으로
const { t, VOICE, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/issues/";
const ROWS = [["200만 원 이상", "상위 6.3%"], ["100만 원 이상", "상위 15.8%"], ["50만 원 이상", "상위 49.6%"], ["50만 원 미만", "하위 50.3%"], ["딱 가운데", "49만 7천 원"]];
const mk = (t1, t2, hi) => sheetCover({ skin: "rn", t1, t2, t1size: 80, t2size: 76, sub: "65세 이상 912만 명 · 2024년 · 국가데이터처",
  cols: [76, 560], head: ["한 달 연금(모두 합쳐)", "65세 이상 중"], y0: 600, size: 62, step: 106, rows: ROWS, hi,
  note: "기초·국민·직역·퇴직·개인연금 합계 · 평균 73만 7천 원", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 100만", page: mk("연금 월 100만 원 받으면", "65세 이상 상위 15.8%", 1) },
  { label: "B 몇 등", page: mk("내 연금, 65세 중 몇 등", "200만 넘으면 상위 6.3%", 0) },
  { label: "C 절반", page: mk("65세 연금 받는 사람 절반은", "한 달 50만 원도 안 돼요", 3) },
];
fs.writeFileSync(R + "2026-11-19c.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = VOICE([
  { id: "hook", text: "내 연금이 한 달 백만 원이면, 육십오 세 이상 중 상위 몇 퍼센트일까요?" },
  { id: "news", text: "국가데이터처 연금통계를 보면, 육십오 세 이상 구백십이만 명이 연금을 받고, 평균은 한 달 칠십삼만 칠천 원이에요.", gap: 0.3 },
  { id: "table", text: "이백만 원 이상이면 상위 육 점 삼 퍼센트, 백만 원 이상이면 상위 십오 점 팔 퍼센트예요." },
  { id: "half", text: "절반은 오십만 원도 안 돼요. 딱 가운데 사람이 사십구만 칠천 원이에요.", gap: 0.2 },
  { id: "check", text: "기초, 국민, 퇴직, 개인연금까지 모두 합친 금액이에요.", gap: 0.3 },
  { id: "cta", text: "여러분은 몇 번째 줄이세요? 팔로우하면 내 칸 표 계속 드려요.", gap: 0.35 },
]);
const X = [150, 600];
const Y = (i) => 585 + i * 110;
const rowAt = ["@table+0.1", "@table+3.0", "@half+1.2", "@half+0.2", "@half+3.0"];
const color = ["ink", "red", "ink", "blue", "gray"];
const body = [
  t("h1", "내 연금, 65세 이상 중 상위 몇 %", 128, 196, 60, "bold", "ink", 0, 0, { rot: -0.8 }),
  t("s1", "(국가데이터처 '2024년 연금통계' 8/25 · 뉴시스·머니투데이·매일경제·이데일리)", 140, 300, 26, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "65세 이상 912만 명 · 평균 월 73만 7천 원", 140, 365, 48, "bold", "ink", "@news+3.2", 0.8),
  t("hda", "한 달 연금(모두 합쳐)", X[0], 480, 40, "pen", "gray", "@table", 0.3),
  t("hdb", "65세 이상 중", X[1], 480, 40, "pen", "gray", "@table", 0.3),
  ...ROWS.flatMap((r, i) => [t(`r${i + 1}a`, r[0], X[0], Y(i), 62, "bold", i === 4 ? "gray" : color[i], rowAt[i], 0.4),
    t(`r${i + 1}b`, r[1], X[1], Y(i), 66, "bold", color[i], rowAt[i].replace(/\+([\d.]+)$/, (_, a) => "+" + (+a + 0.5).toFixed(1)), 0.4)]),
  { type: "circle", target: "r2b", at: "@table+4.2", dur: 0.5, color: "red", pad: 10, width: 6 },
  t("n0", "(구간별 비중: 200만↑ 6.3% · 100만~200만 9.5% · 50만~100만 33.8% · 25만~50만 46.7% · 25만↓ 3.6%)", 150, 1110, 22, "pen", "gray", "@half.end", 0.6),
  { type: "sticky", x: 150, y: 1160, w: 780, h: 250, rot: -2, at: "@check-0.2", items: [
    t("m1", "같은 통계에서", 46, 24, 46, "bold", "red", "@check", 0.5),
    t("m2", "남 95.7만 · 여 54.6만", 46, 96, 44, "bold", "ink", "@check+0.8", 0.5),
    t("m3", "집 있음 91.4만 · 없음 58.1만", 46, 164, 44, "bold", "blue", "@check+1.8", 0.6) ] },
  t("n9", "(평균 월 수급액 · 기초·국민·직역·퇴직·개인연금 등 11종 합계)", 150, 1450, 24, "pen", "gray", "@cta", 0.6),
  t("sig", "늦지 않았습니다. — 은퇴노트", 330, 1510, 56, "pen", "ink", "@cta", 0.8, { rot: -2 }),
  t("handle", "@retire.note", 600, 1580, 32, "sans", "gray", "@cta+0.6", 0.5, { fade: true }),
];
writeNote(R + "2026-11-19c.note.json", {
  duration: "auto", fps: 30, flip: 0.7, tape: { text: "내 칸 표 #5 · 상위 몇 %", color: "yellow" },
  out: "queue/issues/2026-11-19_pension-rank.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", stains: [{ x: 700, y: 1500, r: 170, opacity: 0.18, rot: -8 }], items: body }] });
console.log("ok cover", covers[pick].label);
