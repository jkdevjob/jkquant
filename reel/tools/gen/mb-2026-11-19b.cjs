// 매니악 브리핑 11/19 20:30 — 엔비디아는 하루에 얼마를 팔까: 3분기(8~10월) 매출 1,158억 달러 → 하루·1초 매출 (헤드라인 1위 관련 67건)
// 실존 인물 사생활 논란은 다루지 않는다(숫자만).
const { t, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/mb/issues/";
// 1,158억 달러 × 1,338원 = 154.9조 원 / 92일 = 1.684조 원 / 86,400초 = 1,949만 원
const ROWS = [["3분기 매출", "1,158억 달러"], ["원화로", "약 155조 원"], ["1년 전보다", "+103%"], ["하루 매출", "약 1.7조 원"], ["1초 매출", "약 2천만 원"], ["4분기 전망", "1,300억 달러"]];
const mk = (t1, t2, hi) => sheetCover({ skin: "mb", t1, t2, t1size: 76, t2size: 72, sub: "2026년 8~10월(92일) · 환율 1,338원 · 직접 계산",
  cols: [76, 560], head: ["엔비디아", "숫자"], y0: 590, size: 60, step: 100, rows: ROWS, hi,
  note: "매출 기준(이익 아님) · 데이터센터가 약 93%", foot: "숫자로 저장해 두세요" });
const covers = [
  { label: "A 하루", page: mk("엔비디아 하루 매출", "약 1.7조 원", 3) },
  { label: "B 1초", page: mk("엔비디아 1초 매출", "약 2천만 원", 4) },
  { label: "C 석 달", page: mk("AI 칩 석 달에 155조", "1년 새 두 배(+103%)", 2) },
];
fs.writeFileSync(R + "2026-11-19b.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = { name: "ko-KR-SunHiNeural", rate: "+8%", lead: 0.35, gap: 0.28, tail: 1.6, lines: [
  { id: "hook", text: "엔비디아는 1초에 얼마를 팔까요?" },
  { id: "news", text: "팔월부터 시월까지 석 달 매출은 천백오십팔억 달러, 우리 돈 약 백오십오조 원이에요.", gap: 0.3 },
  { id: "table", text: "1년 전보다 백삼 퍼센트 늘었고, 구십삼 퍼센트가 AI 데이터센터에서 나왔어요." },
  { id: "math", text: "구십이 일로 나누면 하루 약 일조 칠천억 원, 1초에 약 이천만 원어치를 판 셈이에요.", gap: 0.2 },
  { id: "view", text: "다음 석 달 매출 전망은 천삼백억 달러로 더 높게 잡았어요. 다만 중국 매출은 뺐어요.", gap: 0.3 },
  { id: "cta", text: "핫이슈를 숫자로, 팔로우하고 매일 받아 보세요.", gap: 0.35 },
] };
const X = [120, 600];
const Y = (i) => 555 + i * 92;
const at = ["@news+0.6", "@news+3.4", "@table+0.3", "@math+1.0", "@math+3.4", "@view+0.6"];
const col = ["ink", "gray", "ink", "red", "red", "blue"];
const body = [
  t("h1", "엔비디아는 1초에 얼마를 팔까", 110, 200, 62, "bold", "ink", 0, 0),
  t("s1", "(엔비디아 실적 발표 11/17 · 매일경제·파이낸셜뉴스·비즈워치·블로터)", 112, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "2027회계연도 3분기 = 2026년 8~10월", 112, 358, 42, "bold", "red", "@news+1.4", 0.8),
  t("hda", "엔비디아", X[0], 470, 38, "pen", "gray", "@news", 0.3),
  t("hdb", "숫자", X[1], 470, 38, "pen", "gray", "@news", 0.3),
  ...ROWS.flatMap((r, i) => [t(`r${i + 1}a`, r[0], X[0], Y(i), 52, "bold", col[i] === "red" ? "red" : "ink", at[i], 0.3),
    t(`r${i + 1}b`, r[1], X[1], Y(i), 54, "bold", col[i], at[i].replace(/\+([\d.]+)$/, (_, a) => "+" + (+a + 0.4).toFixed(1)), 0.4)]),
  { type: "circle", target: "r5b", at: "@math+4.2", dur: 0.5, color: "red", pad: 8, width: 6 },
  t("n0", "(155조 ÷ 92일 = 1.68조 · ÷ 86,400초 = 1,949만 원 · 매출 기준 · 직접 계산)", 120, 1110, 24, "pen", "gray", "@math.end", 0.5),
  { type: "sticky", x: 110, y: 1150, w: 840, h: 220, rot: 0, at: "@view-0.2", items: [
    t("f1", "사실", 40, 26, 44, "bold", "red", "@view", 0.3),
    t("f2", "데이터센터 1,076억 달러(+110%)", 170, 32, 38, "bold", "ink", "@view+0.3", 0.6),
    t("v1", "전망", 40, 122, 44, "bold", "red", "@view+2.4", 0.3),
    t("v2", "4분기 1,300억 달러 · 중국 매출 제외", 170, 128, 36, "bold", "blue", "@view+2.7", 0.6) ] },
  t("sig", "매니악 브리핑", 330, 1395, 54, "bold", "ink", "@cta", 0.6),
  t("handle", "@maniacbriefing", 360, 1455, 30, "sans", "gray", "@cta+0.5", 0.5, { fade: true }),
];
writeNote(R + "2026-11-19b.note.json", {
  skin: "brief", duration: "auto", fps: 30, flip: 0.6, tape: { text: "매니악 브리핑 #8", color: "yellow" },
  band: { lines: ["엔비디아 1초 매출", "약 [2천만 원] · 하루 [1.7조]"] },
  out: "queue/mb/issues/2026-11-19_nvidia-per-day.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", items: body }] });
console.log("ok cover", covers[pick].label);
