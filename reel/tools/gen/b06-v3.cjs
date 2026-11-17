// 예비 b06(11/19 09:00) 표지만 v3 로 교체 — 기초연금 2026 선정기준액·기준연금액 (본문·음성 그대로)
const { writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const F = "/home/user/jkquant/reel/queue/issues/b06.note.json";
const mk = (t1, t2, hi) => sheetCover({ skin: "rn", t1, t2, t1size: 80, t2size: 74, sub: "65세 이상 · 소득인정액(월) 기준 · 보건복지부",
  cols: [76, 420], head: ["구분", "2026년"], y0: 600, size: 60, step: 112, hi,
  rows: [["혼자 기준", "월 247만 이하"], ["부부 기준", "월 395만 2천 이하"], ["혼자 받는 돈", "최대 34만 9,700원"], ["부부 1인당", "27만 9,760원"]],
  note: "소득인정액 = 월 소득 + 집·예금을 소득으로 바꾼 금액", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 기준", page: mk("기초연금 2026 기준 한 장", "혼자 247만·부부 395만 이하", 0) },
  { label: "B 받는 돈", page: mk("기초연금 우리 집도 받을까", "혼자 월 최대 34만 9,700원", 2) },
];
fs.writeFileSync("/home/user/jkquant/reel/queue/issues/b06.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const d = JSON.parse(fs.readFileSync(F, "utf8"));
d.pages[0] = covers[pick].page;
writeNote(F, d);
console.log("ok b06 cover", covers[pick].label);
