// 매니악 브리핑 11/20 08:30 — 한국 수출 사상 첫 1조달러, 세계 4번째 (11/19 산업통상부 잠정 집계 · 연합/SBS Biz/디지털데일리/매경이코노미/세계일보 등 다수 1위권)
// 투자 권유·종목 언급 없음. 숫자만.
const { t, writeNote, sheetCover, mascotEnd } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/mb/issues/";
// 1조달러 클럽 달성 연도: 미국·독일 2006, 중국 2007(연합·디지털데일리 일치), 일본 최고 2011년 8,226억 달러(연합·디지털데일리 일치)
const CLUB = [["미국", "2006년"], ["독일", "2006년"], ["중국", "2007년"], ["한국", "2026년 · 19년 만"], ["일본", "아직 · 최고 8,226억"]];
const mk = (t1, t2) => sheetCover({ skin: "mb", t1, t2, t1size: 72, t2size: 70, sub: "산업통상부 11/19 잠정 집계 · 올해 누적",
  cols: [76, 380], head: ["1조달러 클럽", "연간 수출 1조 달러"], y0: 600, size: 60, step: 104, rows: CLUB, hi: 3,
  note: "인구 5천만 나라 · 미국·독일·중국 다음 네 번째", foot: "숫자로 저장해 두세요" });
const covers = [
  { label: "A 일본도 못 넘은", page: mk("일본도 못 넘은 벽 넘었다", "수출 1조달러, 세계 4번째") },
  { label: "B 딱 4나라", page: mk("수출 1조달러 클럽, 딱 4나라", "한국, 19년 만에 합류") },
  { label: "C 1만 배", page: mk("62년 만에 수출 1만 배", "1억 → 1조 달러") },
];
fs.writeFileSync(R + "2026-11-20a.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = { name: "ko-KR-SunHiNeural", rate: "+8%", lead: 0.35, gap: 0.28, tail: 1.6, lines: [
  { id: "hook", text: "일본도 한 번도 못 넘은 벽을, 한국이 넘었어요." },
  { id: "news", text: "올해 누적 수출이 1조 달러를 넘었어요. 미국, 독일, 중국에 이어 세계 네 번째, 19년 만이에요.", gap: 0.3 },
  { id: "table", text: "천구백육십사 년 1억 달러로 시작해, 칠십칠 년 백억, 구십오 년 천억, 이천십팔 년 육천억 달러를 넘었고," },
  { id: "jp", text: "작년 칠천구십삼억 달러에 이어, 올해 1조 달러예요. 일본 최고 기록은 이천십일 년 팔천이백억 달러대예요.", gap: 0.2 },
  { id: "chip", text: "일등공신은 반도체. 시월까지 수출의 사십이 점 칠 퍼센트를 차지했어요.", gap: 0.3 },
  { id: "view", text: "다만 반도체 쏠림, 그리고 내수로 잘 안 퍼지는 온기는 숙제로 꼽혀요.", gap: 0.2 },
  { id: "cta", text: "수출 호황, 체감되세요? 댓글로 알려 주세요. 핫이슈를 숫자로, 팔로우하고 매일 받아 보세요.", gap: 0.35 },
] };
// 한국 수출 이정표(SBS Biz: 1964 1억 · 1977 100억 · 1995 1천억 · 2018 6천억 / 연합·디지털데일리: 2025 7,093억)
const ROWS = [["1964년", "1억 달러"], ["1977년", "100억 달러"], ["1995년", "1천억 달러"], ["2018년", "6천억 달러"], ["2025년", "7,093억 달러"], ["2026년", "1조 달러"]];
const X = [120, 470];
const Y = (i) => 555 + i * 88;
const at = ["@table+0.2", "@table+2.2", "@table+3.4", "@table.end-1.6", "@jp+0.3", "@jp+2.4"];
const body = [
  t("h1", "수출 1조 달러, 세계 4번째", 110, 200, 64, "bold", "ink", 0, 0),
  t("s1", "(산업통상부 11/19 · 연합뉴스 · SBS Biz · 디지털데일리)", 112, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "11/19 오후 2시 9분, 올해 누적 1조 달러 (잠정)", 112, 358, 40, "bold", "red", "@news+0.8", 0.8),
  t("hda", "해", X[0], 470, 38, "pen", "gray", "@table", 0.3),
  t("hdb", "한국 연간 수출", X[1], 470, 38, "pen", "gray", "@table", 0.3),
  ...ROWS.flatMap((r, i) => { const c = i === 5 ? "red" : "ink";
    return [t(`r${i + 1}a`, r[0], X[0], Y(i), 50, "bold", i === 5 ? "red" : "gray", at[i], 0.3),
      t(`r${i + 1}b`, r[1], X[1], Y(i), 54, "bold", c, at[i].replace(/(\+|-)([\d.]+)$/, (m, s, a) => (s === "+" ? "+" + (+a + 0.4).toFixed(1) : "-" + Math.max(0, +a - 0.4).toFixed(1))), 0.4)]; }),
  { type: "circle", target: "r6b", at: "@jp+3.0", dur: 0.5, color: "red", pad: 8, width: 6 },
  t("jp1", "일본 최고 8,226억 달러(2011)", 120, 1090, 36, "bold", "blue", "@jp.end-2.2", 0.7),
  t("n0", "(62년 만에 1만 배 · SBS Biz)", 120, 1146, 24, "pen", "gray", "@jp.end", 0.5),
  { type: "sticky", x: 110, y: 1190, w: 640, h: 200, rot: -1, at: "@chip-0.2", items: [
    t("f1", "주역", 34, 24, 42, "bold", "red", "@chip", 0.3),
    t("f2", "반도체 42.7%", 150, 26, 40, "bold", "ink", "@chip+0.6", 0.5),
    t("f3", "(1~10월 3,968억 달러 · +193%)", 150, 76, 26, "pen", "gray", "@chip+1.6", 0.5),
    t("v1", "숙제", 34, 122, 42, "bold", "red", "@view", 0.3),
    t("v2", "반도체 쏠림 · 내수 온기", 150, 126, 36, "bold", "blue", "@view+0.6", 0.6) ] },
  mascotEnd("@view+0.4", "체감돼요?", 790, 1190, 200),
  t("sig", "매니악 브리핑", 330, 1430, 54, "bold", "ink", "@cta", 0.6),
  t("handle", "@maniacbriefing", 360, 1490, 30, "sans", "gray", "@cta+0.5", 0.5, { fade: true }),
];
writeNote(R + "2026-11-20a.note.json", {
  skin: "brief", duration: "auto", fps: 30, flip: 0.6, tape: { text: "매니악 브리핑 #9", color: "yellow" },
  band: { lines: ["일본도 못 넘은 벽", "수출 [1조 달러] · 세계 [4번째]"] },
  out: "queue/mb/issues/2026-11-20_export-1trillion.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", items: body }] });
console.log("ok cover", covers[pick].label);
