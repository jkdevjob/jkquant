// 매니악 브리핑 11/18 20:30 — 연금복권 1·2등 동시 당첨 '21억', 매달 얼마 (매일신문 많이 본 1위·연합뉴스TV 4위 11/17)
const { t, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/mb/issues/";
const ROWS = [["1등 · 20년", "700만", "546만"], ["2등 · 10년", "100만", "78만"], ["5장 첫 10년", "1,100만", "858만"], ["11~20년", "700만", "546만"]];
const mk = (t1, t2, hi) => sheetCover({ skin: "mb", t1, t2, t1size: 76, t2size: 72, sub: "연금복권720+ · 세금 22% 뗀 실수령",
  cols: [76, 480, 740], head: ["당첨", "매달", "세후"], y0: 600, size: 58, step: 108, rows: ROWS, hi,
  note: "세전 21.6억 → 세후 약 16.8억 · 한 세트 확률 100만분의 1", foot: "숫자로 저장해 두세요" });
const covers = [
  { label: "A 매달", page: mk("연금복권 21억, 매달 얼마", "세후 첫 10년 월 858만", 2) },
  { label: "B 5장", page: mk("연금복권 1·2등 또 동시 당첨", "같은 번호 5장이면 21.6억", 2) },
  { label: "C 월급", page: mk("21억 당첨의 실제 월급", "첫 10년 858만 → 이후 546만", 2) },
];
fs.writeFileSync(R + "2026-11-18b.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = { name: "ko-KR-SunHiNeural", rate: "+8%", lead: 0.35, gap: 0.28, tail: 1.6, lines: [
  { id: "hook", text: "연금복권 1등 2등 동시 당첨 21억이 또 나왔어요. 매달 얼마일까요?" },
  { id: "why", text: "한 세트는 같은 번호 1조부터 5조, 다섯 장이라 다 맞으면 1등 하나, 2등 넷이에요.", gap: 0.3 },
  { id: "table", text: "1등은 매달 칠백만 원씩 이십 년, 세금 떼면 오백사십육만 원. 2등은 백만 원씩 십 년, 세후 칠십팔만 원이에요." },
  { id: "sum", text: "그래서 첫 십 년은 매달 팔백오십팔만 원, 그다음 십 년은 오백사십육만 원이에요.", gap: 0.2 },
  { id: "view", text: "세후로는 약 십육억 팔천. 한 세트가 다 맞을 확률은 백만 분의 일이에요.", gap: 0.3 },
  { id: "cta", text: "핫이슈를 숫자로, 팔로우하고 매일 받아 보세요.", gap: 0.35 },
] };
const X = [120, 480, 740];
const row = (i, at, c) => [t(`r${i}a`, ROWS[i - 1][0], X[0], 450 + i * 98, 50, "bold", c, at, 0.3), t(`r${i}b`, ROWS[i - 1][1], X[1], 450 + i * 98, 52, "bold", "gray", at.replace(/\+([\d.]+)$/, (_, a) => "+" + (+a + 0.4).toFixed(1)), 0.3),
  t(`r${i}c`, ROWS[i - 1][2], X[2], 450 + i * 98, 54, "bold", c, at.replace(/\+([\d.]+)$/, (_, a) => "+" + (+a + 0.9).toFixed(1)), 0.4)];
const body = [
  t("h1", "연금복권 21억, 매달 얼마", 110, 200, 62, "bold", "ink", 0, 0),
  t("s1", "(동행복권 당첨자 인터뷰 11/16 · 매일신문·연합뉴스TV 11/17)", 112, 300, 28, "pen", "gray", "@why+0.2", 0.7),
  t("s2", "한 세트 = 같은 번호 1~5조, 5장", 112, 358, 44, "bold", "red", "@why+1.2", 0.8),
  t("hda", "당첨", X[0], 465, 36, "pen", "gray", "@table", 0.3),
  t("hdb", "매달", X[1], 465, 36, "pen", "gray", "@table", 0.3),
  t("hdc", "세후", X[2], 465, 36, "pen", "gray", "@table", 0.3),
  ...row(1, "@table+0.1", "ink"), ...row(2, "@table+4.6", "ink"), ...row(3, "@sum+0.2", "red"), ...row(4, "@sum+3.0", "ink"),
  { type: "circle", target: "r3c", at: "@sum+2.2", dur: 0.5, color: "red", pad: 8, width: 6 },
  t("n0", "(700만×240개월 + 100만×120개월×4장 = 21.6억 · 직접 계산)", 120, 935, 24, "pen", "gray", "@sum.end", 0.5),
  { type: "sticky", x: 110, y: 990, w: 840, h: 300, rot: 0, at: "@view-0.2", items: [
    t("f1", "사실", 40, 26, 44, "bold", "red", "@view", 0.3),
    t("f2", "세전 21.6억 → 세후 약 16.8억", 170, 32, 38, "bold", "ink", "@view+0.3", 0.6),
    t("v1", "확률", 40, 116, 44, "bold", "red", "@view+2.2", 0.3),
    t("v2", "한 세트(5장) 100만분의 1", 170, 122, 38, "bold", "ink", "@view+2.5", 0.6),
    t("p1", "참고", 40, 206, 44, "bold", "red", "@view.end-0.6", 0.3),
    t("p2", "1장은 500만분의 1 (5조 × 6자리)", 170, 212, 36, "bold", "blue", "@view.end-0.3", 0.6) ] },
  t("sig", "매니악 브리핑", 330, 1360, 54, "bold", "ink", "@cta", 0.6),
  t("handle", "@maniacbriefing", 360, 1425, 30, "sans", "gray", "@cta+0.5", 0.5, { fade: true }),
];
writeNote(R + "2026-11-18b.note.json", {
  skin: "brief", duration: "auto", fps: 30, flip: 0.6, tape: { text: "매니악 브리핑 #6", color: "yellow" },
  band: { lines: ["연금복권 21억, 매달 얼마", "세후 첫 10년 [월 858만]"] },
  out: "queue/mb/issues/2026-11-18_pension-lottery.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", items: body }] });
console.log("ok cover", covers[pick].label);
