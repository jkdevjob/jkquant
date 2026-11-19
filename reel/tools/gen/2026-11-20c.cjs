// 11/20 18:00 — 퇴사 후 건보료: 임의계속가입하면 3년은 직장 때 내 몫 그대로 (이달 은퇴 쇼츠 2위 '퇴사 후 건보료' 33만 회 주제, REFERENCES 11/19)
const { t, VOICE, writeNote, sheetCover, mascotEnd } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/issues/";
// 직장 때 본인 몫 = 월급 × 7.19% ÷ 2 = 월급 × 3.595% (장기요양 별도)
const W = [300, 400, 500, 600];
const won = (m) => { const v = Math.round(m * 10000 * 0.03595); const man = Math.floor(v / 10000), r = Math.round((v % 10000) / 10) * 10; return r ? `${man}만 ${r.toLocaleString()}원` : `${man}만 원`; };
const ROWS = W.map((w) => [`월 ${w}만`, won(w)]);
const mk = (t1, t2) => sheetCover({ skin: "rn", t1, t2, t1size: 68, t2size: 66, sub: "임의계속가입 · 퇴직 후 최대 36개월 · 7.19%",
  cols: [76, 440], head: ["퇴직 전 월급", "3년간 내는 건보료(월)"], y0: 600, size: 62, step: 106, rows: ROWS, hi: 1,
  note: "안 하면 지역가입자: 소득 + 집까지, 100% 내 돈 · 장기요양 별도", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 3년 그대로", page: mk("퇴사해도 3년은 건보료 그대로", "월급 400만이면 월 14.4만") },
  { label: "B 모르면", page: mk("퇴사 후 건보료, 신청하면 3년 유지", "안 하면 집까지 매겨요") },
  { label: "C 피하는 법", page: mk("퇴사 후 건보료 폭탄 피하는 법", "2개월 안에 임의계속가입") },
];
fs.writeFileSync(R + "2026-11-20c.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = VOICE([
  { id: "hook", text: "퇴사하면 월급은 0원인데, 건보료는 더 나올 수 있다는 거 아세요?" },
  { id: "news", text: "지역가입자가 되면 회사가 내 주던 절반이 사라지고, 집 같은 재산에도 보험료가 붙어요.", gap: 0.3 },
  { id: "rule", text: "이때 임의계속가입을 신청하면, 최대 3년 동안 직장 다닐 때 내 몫만 내면 돼요.", gap: 0.3 },
  { id: "table", text: "월급 사백만 원이었다면 한 달 약 십사만 사천 원, 육백만 원이면 약 이십일만 육천 원이에요." },
  { id: "check", text: "첫 지역 고지서 납부기한부터 2개월 안에 신청해야 하고, 지역 보험료가 더 쌀 땐 안 해도 돼요.", gap: 0.3 },
  { id: "cta", text: "여러분은 몇 번째 줄이세요? 팔로우하면 내 칸 표 계속 드려요.", gap: 0.35 },
]);
const X = [140, 520];
const Y = (i) => 580 + i * 92;
const at = ["@table+0.1", "@table+0.2", "@table.end-1.2", "@table.end-0.6"];
const body = [
  t("h1", "퇴사 후 건보료, 3년은 그대로", 128, 196, 62, "bold", "ink", 0, 0, { rot: -0.8 }),
  t("s1", "(국민건강보험공단 · 파이낸셜뉴스 2/21 · 서울경제 3/11 · 한국경제)", 140, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "직장은 회사와 반반 → 지역은 소득 + 집까지", 140, 360, 42, "bold", "red", "@news+1.0", 0.8),
  t("s3", "임의계속가입 = 최대 36개월 직장 때 내 몫", 140, 422, 42, "bold", "ink", "@rule+0.6", 0.8),
  t("hda", "퇴직 전 월급", X[0], 505, 34, "pen", "gray", "@table", 0.3),
  t("hdb", "3년간 내는 건보료(월)", X[1], 505, 34, "pen", "gray", "@table", 0.3),
  ...ROWS.flatMap((r, i) => { const c = i === 1 || i === 3 ? "red" : "ink";
    return [t(`r${i + 1}a`, r[0], X[0], Y(i), 52, "bold", c, at[i], 0.3), t(`r${i + 1}b`, r[1], X[1], Y(i), 56, "bold", c, `${at[i]}`.replace(/(\+|-)([\d.]+)$/, (m, s, a) => (s === "+" ? "+" + (+a + 0.5).toFixed(1) : "-" + Math.max(0, +a - 0.5).toFixed(1))), 0.4)];
  }),
  { type: "circle", target: "r2b", at: "@table+2.4", dur: 0.5, color: "red", pad: 10, width: 6 },
  t("n0", "(월급 × 7.19% ÷ 2 · 장기요양보험료 별도 · 직접 계산 — 파이낸셜뉴스 예시 '본인 14만 3,800원'과 같음)", 150, 950, 22, "pen", "gray", "@table.end", 0.6),
  { type: "sticky", x: 140, y: 1000, w: 620, h: 260, rot: -2, at: "@check-0.2", items: [
    t("m1", "꼭 할 것", 40, 22, 46, "bold", "red", "@check", 0.5),
    t("m2", "① 첫 고지서 기한 + 2개월 안", 40, 92, 40, "bold", "ink", "@check+0.6", 0.5),
    t("m3", "② 지역 보험료와 비교", 40, 156, 40, "bold", "blue", "@check+3.4", 0.6) ] },
  mascotEnd("@check+0.4", "저장!", 780, 1070, 190),
  t("n9", "(최초 지역 고지서 납부기한부터 2개월 안 신청 — 한국경제 · 파이낸셜뉴스)", 140, 1300, 24, "pen", "gray", "@cta", 0.6),
  t("sig", "늦지 않았습니다. — 은퇴노트", 140, 1360, 54, "pen", "ink", "@cta", 0.8, { rot: -2 }),
  t("handle", "@retire.note", 760, 1420, 30, "sans", "gray", "@cta+0.6", 0.5, { fade: true }),
];
writeNote(R + "2026-11-20c.note.json", {
  duration: "auto", fps: 30, flip: 0.7, tape: { text: "내 칸 표 #7 · 퇴사 후 건보료", color: "yellow" },
  band: { lines: ["퇴사해도 3년은 건보료 그대로", "신청 기한은 [2개월]"] },
  out: "queue/issues/2026-11-20_resign-health-premium.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", stains: [{ x: 700, y: 1500, r: 170, opacity: 0.18, rot: -8 }], items: body }] });
console.log("ok cover", covers[pick].label, JSON.stringify(ROWS));
