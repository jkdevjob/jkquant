// 예비 b07(11/21 09:00) 표지만 v3 로 교체 — 주택연금 월지급금(한국주택금융공사 2026.3.1 기준 예시표, 종신 정액형·일반주택). 본문·음성 그대로
const { writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const F = "/home/user/jkquant/reel/queue/issues/b07.note.json";
const ROWS = [["60세", "63만", "105만"], ["65세", "76만", "126만"], ["70세", "92만", "154만"], ["75세", "114만", "191만"], ["80세", "145만", "242만"]];
const mk = (t1, t2, hi) => sheetCover({ skin: "rn", t1, t2, t1size: 66, t2size: 68, sub: "주택금융공사 예시(2026.3.1) · 종신 정액형",
  cols: [76, 330, 600], head: ["가입 나이", "3억 집", "5억 집"], y0: 600, size: 62, step: 106, rows: ROWS, hi,
  note: "부부 중 나이 적은 분 기준 · 평생 · 그 집에 계속 살면서", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 연금 하나 더", page: mk("집 있으면 연금 하나 더 받는다", "5억 집, 70세면 월 154만", 2) },
  { label: "B 늦을수록", page: mk("주택연금, 늦게 들수록 더 받는다", "5억 집 80세면 월 242만", 4) },
  { label: "C 154만", page: mk("5억 집 하나로 매달 154만 원", "70세 가입, 평생 받는 돈", 2) },
];
fs.writeFileSync("/home/user/jkquant/reel/queue/issues/b07.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const d = JSON.parse(fs.readFileSync(F, "utf8"));
d.pages[0] = covers[pick].page;
writeNote(F, d);
console.log("ok b07 cover", covers[pick].label);
