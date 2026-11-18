// 매니악 브리핑 11/19 08:30 — 오늘 수능: 영어 듣기 35분 비행기 130편이 멈추는 날 (2027학년도 수능)
const { t, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/mb/issues/";
const ROWS = [["지원자", "55만 1,864명"], ["N수생", "19만 6,473명"], ["시험장", "1,312곳"], ["비행기 멈춤", "13:05~13:40"], ["시간 옮긴 항공편", "130편"], ["증시 개장", "오전 10시"]];
const mk = (t1, t2, hi) => sheetCover({ skin: "mb", t1, t2, t1size: 76, t2size: 72, sub: "2027학년도 수능 · 교육부·국토부·한국거래소",
  cols: [76, 560], head: ["오늘 수능", "숫자"], y0: 590, size: 60, step: 100, rows: ROWS, hi,
  note: "영어 듣기평가 35분 동안 전국 공항 이착륙 중단", foot: "수험생 모두 응원합니다" });
const covers = [
  { label: "A 멈추는 것", page: mk("오늘 수능, 멈추는 것들", "비행기 130편 · 증시 1시간", 4) },
  { label: "B 35분", page: mk("수능 영어 듣기 35분 동안", "비행기 130편이 멈춰요", 4) },
  { label: "C 55만", page: mk("55만 명 수능 보는 날", "N수생 19.6만, 23년 만에 최대", 1) },
];
fs.writeFileSync(R + "2026-11-19a.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = { name: "ko-KR-SunHiNeural", rate: "+8%", lead: 0.35, gap: 0.28, tail: 1.6, lines: [
  { id: "hook", text: "오늘 수능 영어 듣기 시간엔 비행기도 멈춰요. 몇 편이나 멈출까요?" },
  { id: "news", text: "올해 수능 지원자는 오십오만 천팔백육십사 명, 시험장은 천삼백십이 곳이에요.", gap: 0.3 },
  { id: "table", text: "영어 듣기가 있는 오후 한 시 오 분부터 사십 분까지, 삼십오 분 동안 전국 공항 이착륙이 멈추고, 항공편 백삼십 편이 시간을 옮겼어요." },
  { id: "more", text: "증시도 한 시간 늦은 오전 열 시에 열려요.", gap: 0.2 },
  { id: "view", text: "N수생은 십구만 육천 명으로 이십삼 년 만에 가장 많아요.", gap: 0.3 },
  { id: "cta", text: "수험생 여러분 응원해요. 핫이슈를 숫자로, 팔로우하고 받아 보세요.", gap: 0.35 },
] };
const X = [120, 600];
const Y = (i) => 555 + i * 92;
const at = ["@news+0.3", "@view+0.2", "@news+2.6", "@table+0.4", "@table+5.6", "@more+0.2"];
const col = ["ink", "blue", "ink", "red", "red", "ink"];
const body = [
  t("h1", "수능 날 멈추는 것들", 110, 200, 64, "bold", "ink", 0, 0),
  t("s1", "(교육부·국토교통부·한국거래소 · 뉴시스·SBS·헤럴드경제·아이뉴스24 11/18)", 112, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "오전 8시 40분 ~ 오후 5시 45분 · 85개 시험지구", 112, 358, 42, "bold", "red", "@news+1.6", 0.8),
  t("hda", "오늘 수능", X[0], 470, 38, "pen", "gray", "@news", 0.3),
  t("hdb", "숫자", X[1], 470, 38, "pen", "gray", "@news", 0.3),
  ...ROWS.flatMap((r, i) => [t(`r${i + 1}a`, r[0], X[0], Y(i), 52, "bold", col[i] === "red" ? "red" : "ink", at[i], 0.3),
    t(`r${i + 1}b`, r[1], X[1], Y(i), 54, "bold", col[i], at[i].replace(/\+([\d.]+)$/, (_, a) => "+" + (+a + 0.4).toFixed(1)), 0.4)]),
  { type: "circle", target: "r5b", at: "@table+6.4", dur: 0.5, color: "red", pad: 8, width: 6 },
  t("n0", "(130편 = 국제선 81 + 국내선 49 · N수생 = 졸업생 17만 3,706 + 검정고시 2만 2,767)", 120, 1110, 24, "pen", "gray", "@view", 0.5),
  { type: "sticky", x: 110, y: 1150, w: 840, h: 200, rot: 0, at: "@view-0.2", items: [
    t("f1", "사실", 40, 26, 44, "bold", "red", "@view", 0.3),
    t("f2", "N수생 23년 만에 최대 · 재학생은 1만 6,506명 ↓", 170, 32, 34, "bold", "ink", "@view+0.3", 0.6),
    t("v1", "참고", 40, 116, 44, "bold", "red", "@view+1.6", 0.3),
    t("v2", "감독 인력 8,400여 명 추가 배치", 170, 122, 36, "bold", "blue", "@view+1.9", 0.6) ] },
  t("sig", "매니악 브리핑", 330, 1390, 54, "bold", "ink", "@cta", 0.6),
  t("handle", "@maniacbriefing", 360, 1445, 30, "sans", "gray", "@cta+0.5", 0.5, { fade: true }),
];
writeNote(R + "2026-11-19a.note.json", {
  skin: "brief", duration: "auto", fps: 30, flip: 0.6, tape: { text: "매니악 브리핑 #7", color: "yellow" },
  band: { lines: ["수능 영어 듣기 35분 동안", "비행기 [130편]이 멈춰요"] },
  out: "queue/mb/issues/2026-11-19_suneung-day.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", items: body }] });
console.log("ok cover", covers[pick].label);
