// 11/19 12:00 — 은퇴 후 계약직·일용직도 1년 넘으면 퇴직금: 월 임금 × 근속 1·2·3년 표
// 걸이: 보건사회연구원 '중고령층 소득공백' 보고서(61~64년생 재취업자 61.3% 임시·일용직, 11/2 보도) + 퇴직금 뉴스가 많은 주
const { t, VOICE, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/issues/";
// 30일분 평균임금 = 월급 × 3 ÷ 92일 × 30 = 월급 × 0.978 → × 근속연수
const W = [150, 200, 250, 300];
const sev = (w, y) => Math.round((w * 3 / 92) * 30 * y);
const fmt = (n) => (n >= 1000 ? `${Math.floor(n / 1000)},${String(n % 1000).padStart(3, "0")}만` : `${n}만`);
const ROWS = W.map((w) => [`월 ${w}만`, fmt(sev(w, 1)), fmt(sev(w, 2)), fmt(sev(w, 3))]);
const mk = (t1, t2) => sheetCover({ skin: "rn", t1, t2, t1size: 78, t2size: 74, sub: "1년 이상 · 주 15시간 이상이면 고용 형태 무관",
  cols: [76, 340, 570, 800], head: ["월 임금", "1년", "2년", "3년"], y0: 600, size: 60, step: 108, rows: ROWS, hi: 1,
  note: "30일분 평균임금 × 근속 · 3개월 92일 기준 직접 계산 · 약", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 1년 넘으면", page: mk("은퇴 후 계약직도 1년 넘으면", `월 200만이면 퇴직금 약 ${fmt(sev(200, 1))}`) },
  { label: "B 한 달치", page: mk("일용직·계약직 퇴직금", "1년 채우면 월급 약 한 달치") },
  { label: "C 다시 일해도", page: mk("다시 일해도 퇴직금 나와요", `월 250만·3년이면 약 ${fmt(sev(250, 3))}`) },
];
fs.writeFileSync(R + "2026-11-19b.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = VOICE([
  { id: "hook", text: "은퇴 후 계약직이나 일용직으로 1년 일하면, 퇴직금이 나올까요?" },
  { id: "news", text: "육십일년생부터 육십사년생 중 정년 뒤 다시 일을 구한 분, 열에 여섯은 임시·일용직이었어요.", gap: 0.3 },
  { id: "rule", text: "그래도 1년 이상, 주 15시간 넘게 일했다면 고용 형태와 상관없이 퇴직금이 나와요.", gap: 0.3 },
  { id: "table", text: `월 이백만 원이면 1년에 약 백구십육만 원, 3년이면 오백팔십칠만 원이에요.` },
  { id: "check", text: "1년이 안 되거나, 4주 평균 주 15시간이 안 되면 받을 수 없어요.", gap: 0.3 },
  { id: "cta", text: "여러분은 몇 번째 줄이세요? 팔로우하면 내 칸 표 계속 드려요.", gap: 0.35 },
]);
const X = [150, 420, 620, 820];
const Y = (i) => 600 + i * 104;
const at = ["@table+0.6", "@table+0.1", "@table.end-0.2", "@table.end+0.2"];
const body = [
  t("h1", "은퇴 후 다시 일해도 퇴직금", 128, 196, 64, "bold", "ink", 0, 0, { rot: -0.8 }),
  t("s1", "(보건사회연구원 '중고령층 소득공백' 보고서 · 헤럴드경제·한겨레·세계일보 11/2)", 140, 300, 26, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "61~64년생 재취업자 61.3% 임시·일용직", 140, 362, 46, "bold", "ink", "@news+1.0", 0.8),
  t("s3", "1년 이상 + 주 15시간 이상 → 퇴직금", 140, 430, 46, "bold", "red", "@rule+0.3", 0.8),
  t("hda", "월 임금", X[0], 515, 38, "pen", "gray", "@table", 0.3),
  t("hdb", "1년", X[1], 515, 38, "pen", "gray", "@table", 0.3),
  t("hdc", "2년", X[2], 515, 38, "pen", "gray", "@table", 0.3),
  t("hdd", "3년", X[3], 515, 38, "pen", "gray", "@table", 0.3),
  ...ROWS.flatMap((r, i) => { const c = i === 1 ? "red" : "ink";
    return r.map((v, j) => t(`r${i + 1}${"abcd"[j]}`, v, X[j], Y(i), j ? 56 : 54, "bold", j === 0 ? c : (i === 1 ? "red" : "ink"),
      i === 1 ? ["@table+0.1", "@table+1.6", "@table+2.6", "@table+3.6"][j] : `${at[i]}`, 0.3)); }),
  { type: "circle", target: "r2b", at: "@table+2.0", dur: 0.5, color: "red", pad: 10, width: 6 },
  { type: "circle", target: "r2d", at: "@table+4.4", dur: 0.5, color: "red", pad: 10, width: 6 },
  t("n0", "(퇴직금 = 30일분 평균임금 × 근속연수 · 3개월 92일 기준 · 상여·연차수당 빼고 직접 계산)", 150, 1040, 22, "pen", "gray", "@table.end", 0.6),
  { type: "sticky", x: 150, y: 1090, w: 780, h: 250, rot: -2, at: "@check-0.2", items: [
    t("m1", "못 받는 경우", 46, 24, 48, "bold", "red", "@check", 0.5),
    t("m2", "① 계속 일한 기간 1년 미만", 46, 96, 44, "bold", "ink", "@check+0.6", 0.5),
    t("m3", "② 4주 평균 주 15시간 미만", 46, 164, 44, "bold", "blue", "@check+2.0", 0.6) ] },
  t("n9", "(근로자퇴직급여 보장법 · 이데일리·경향신문 · 정확한 금액은 고용노동부 퇴직금 계산기)", 150, 1385, 24, "pen", "gray", "@cta", 0.6),
  t("sig", "늦지 않았습니다. — 은퇴노트", 330, 1450, 56, "pen", "ink", "@cta", 0.8, { rot: -2 }),
  t("handle", "@retire.note", 600, 1520, 32, "sans", "gray", "@cta+0.6", 0.5, { fade: true }),
];
writeNote(R + "2026-11-19b.note.json", {
  duration: "auto", fps: 30, flip: 0.7, tape: { text: "내 칸 표 #6 · 퇴직금", color: "yellow" },
  out: "queue/issues/2026-11-19_rehire-severance.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", stains: [{ x: 700, y: 1500, r: 170, opacity: 0.18, rot: -8 }], items: body }] });
console.log("ok cover", covers[pick].label, JSON.stringify(ROWS));
