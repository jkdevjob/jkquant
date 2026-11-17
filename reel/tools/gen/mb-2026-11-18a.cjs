// 매니악 브리핑 11/18 08:30 — 코스피 9개월 만에 5천 아래 (11/17 종가 4,968.48, 고점 대비 -45.5%)
const { t, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/mb/issues/";
const ROWS = [["11/17 종가", "4,968"], ["하루 하락", "-2.59%"], ["6/22 최고(종가)", "9,115"], ["고점 대비", "-45.5%"], ["외국인 하루 순매도", "약 1.4조"], ["고점 되찾으려면", "+83.4%"]];
const mk = (t1, t2, hi) => sheetCover({ skin: "mb", t1, t2, t1size: 76, t2size: 72, sub: "한국거래소 · 11/17 종가 기준",
  cols: [76, 640], head: ["코스피", "숫자"], y0: 590, size: 60, step: 100, rows: ROWS, hi,
  note: "종가 5천 아래는 2/2(4,950) 이후 9개월 만", foot: "숫자로 저장해 두세요" });
const covers = [
  { label: "A 5천 아래", page: mk("코스피 9개월 만에 5천 아래", "고점 대비 -45.5%", 3) },
  { label: "B 83%", page: mk("코스피 고점 대비 -45.5%", "되찾으려면 83% 올라야", 5) },
  { label: "C 외국인", page: mk("외국인 하루 1.4조 팔았다", "코스피 9개월 만에 4,968", 4) },
];
fs.writeFileSync(R + "2026-11-18a.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = { name: "ko-KR-SunHiNeural", rate: "+8%", lead: 0.35, gap: 0.28, tail: 1.6, lines: [
  { id: "hook", text: "코스피가 아홉 달 만에 오천 아래로 내려왔어요. 고점에서 얼마나 빠진 걸까요?" },
  { id: "news", text: "어제 종가는 사천구백육십팔, 사 거래일 연속 하락이에요.", gap: 0.3 },
  { id: "table", text: "유월 이십이일 최고치 구천백십사와 비교하면 사십오 점 오 퍼센트 내렸어요. 외국인은 하루에만 약 일조 사천억 원을 팔았어요." },
  { id: "math", text: "이만큼 빠진 지수가 고점을 되찾으려면 팔십삼 퍼센트 올라야 해요.", gap: 0.2 },
  { id: "view", text: "배경은 미국 반도체주 급락과 대중국 AI 규제 강화예요. 앞으로는 반등과 추가 하락 전망이 엇갈려요.", gap: 0.3 },
  { id: "cta", text: "핫이슈를 숫자로, 팔로우하고 매일 받아 보세요.", gap: 0.35 },
] };
const body = [
  t("h1", "코스피, 고점에서 얼마나 빠졌나", 110, 200, 62, "bold", "ink", 0, 0),
  t("s1", "(한국거래소 · 파이낸셜뉴스·시사저널·한국경제TV 11/17)", 112, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "4거래일 연속 하락 · 9개월 만에 5천 아래", 112, 358, 42, "bold", "red", "@news+1.8", 0.8),
  t("hda", "코스피", 120, 470, 38, "pen", "gray", "@news", 0.3),
  t("hdb", "숫자", 640, 470, 38, "pen", "gray", "@news", 0.3),
  t("r1a", "11/17 종가", 120, 555, 52, "bold", "ink", "@news+0.3", 0.3), t("r1b", "4,968", 640, 555, 54, "bold", "ink", "@news+0.6", 0.4),
  t("r2a", "6/22 최고(종가)", 120, 650, 52, "bold", "ink", "@table+0.3", 0.3), t("r2b", "9,115", 640, 650, 54, "bold", "ink", "@table+1.6", 0.4),
  t("r3a", "고점 대비", 120, 745, 52, "bold", "red", "@table+3.0", 0.3), t("r3b", "-45.5%", 640, 745, 58, "bold", "red", "@table+3.4", 0.4),
  t("r4a", "외국인 하루 순매도", 120, 840, 52, "bold", "ink", "@table+5.4", 0.3), t("r4b", "약 1.4조", 640, 840, 54, "bold", "blue", "@table+6.2", 0.4),
  t("r5a", "고점 되찾으려면", 120, 935, 52, "bold", "ink", "@math+0.2", 0.3), t("r5b", "+83.4%", 640, 935, 58, "bold", "red", "@math+2.4", 0.4),
  { type: "circle", target: "r5b", at: "@math+2.9", dur: 0.5, color: "red", pad: 8, width: 6 },
  t("n0", "(9,115 ÷ 4,968 = 1.834 · 장중 최고 9,386 대비 -47% · 직접 계산)", 120, 1024, 26, "pen", "gray", "@math.end", 0.5),
  { type: "sticky", x: 110, y: 1072, w: 840, h: 290, rot: 0, at: "@view-0.2", items: [
    t("f1", "사실", 40, 26, 44, "bold", "red", "@view", 0.3),
    t("f2", "고점 대비 -45.5% · 외국인 매도", 170, 32, 38, "bold", "ink", "@view+0.3", 0.6),
    t("v1", "배경", 40, 116, 44, "bold", "red", "@view+0.8", 0.3),
    t("v2", "美 반도체지수 -5.28% · 대중 AI 규제", 170, 122, 36, "bold", "ink", "@view+1.1", 0.6),
    t("p1", "전망", 40, 206, 44, "bold", "red", "@view+4.0", 0.3),
    t("p2", "반등 vs 추가 하락, 엇갈림", 170, 212, 38, "bold", "blue", "@view+4.3", 0.6) ] },
  t("sig", "매니악 브리핑", 330, 1385, 54, "bold", "ink", "@cta", 0.6),
  t("handle", "@maniacbriefing", 360, 1445, 30, "sans", "gray", "@cta+0.5", 0.5, { fade: true }),
];
writeNote(R + "2026-11-18a.note.json", {
  skin: "brief", duration: "auto", fps: 30, flip: 0.6, tape: { text: "매니악 브리핑 #5", color: "yellow" },
  band: { lines: ["코스피 9개월 만에 5천 아래", "고점 대비 [-45.5%] · 되찾으려면 [+83%]"] },
  out: "queue/mb/issues/2026-11-18_kospi-under-5000.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", items: body }] });
console.log("ok cover", covers[pick].label);
