// 11/18 12:00 — 개인연금(연금저축·IRP)에도 건보료 붙으면? (사용자 11/18 "요거 주제 괜찮은데")
const { T, t, VOICE, writeNote, sheetCover } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/issues/";
const mk = (t1, t2) => sheetCover({ skin: "rn", t1, t2, t1size: 88, t2size: 80, sub: "공적연금처럼 50% × 7.19% 가정 · 지역가입자",
  cols: [76, 330, 610], head: ["개인연금 월", "1년", "월 건보료 +"], y0: 600, size: 68, step: 108,
  rows: [["50만", "600만", "1.8만"], ["100만", "1,200만", "3.6만"], ["125만", "1,500만", "4.5만"], ["200만", "2,400만", "7.2만"]], hi: 1,
  note: "지금은 연 1,500만 이하 개인연금에 건보료 0원 · 대상·시기 미정", foot: "내 칸 찾아서 저장해 두세요" });
const covers = [
  { label: "A 붙으면", page: mk("개인연금에 건보료 붙으면", "월 100만 받으면 3.6만 더") },
  { label: "B 검토", page: mk("연금저축·IRP 건보료 검토", "월 100만이면 매달 3.6만") },
  { label: "C 0원→", page: mk("지금은 건보료 0원인 개인연금", "붙으면 월 100만에 3.6만") },
];
fs.writeFileSync(R + "2026-11-18b.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = VOICE([
  { id: "hook", text: "연금저축·아이알피 연금에도 건보료가 붙으면, 한 달에 얼마 더 낼까요?" },
  { id: "news", text: "건보공단이 지금은 빠진 분리과세 소득에도 건보료를 매기는 방안을 국감에 보고했어요. 시기는 미정이에요.", gap: 0.3 },
  { id: "rule", text: "국민연금 같은 공적연금은 절반만 소득으로 잡아 칠 점 일구 퍼센트를 매겨요.", gap: 0.3 },
  { id: "table", text: "같은 방식이면 월 백만 원 받는 분은 한 달 약 삼만 육천 원, 이백만 원이면 칠만 이천 원 늘어요." },
  { id: "check", text: "피부양자인 분은 연 소득 이천만 원 기준도 같이 보세요.", gap: 0.3 },
  { id: "cta", text: "몇 번째 줄이세요? 팔로우하면 내 칸 표 계속 드려요.", gap: 0.35 },
]);
const rows = [["50만", "600만", "1.8만"], ["100만", "1,200만", "3.6만", "red"], ["125만", "1,500만", "4.5만"], ["200만", "2,400만", "7.2만"]];
const body = [
  t("h1", "개인연금에도 건보료 붙으면", 128, 196, 66, "bold", "ink", 0, 0, { rot: -0.8 }),
  t("s1", "(건보공단 국감 자료 '분리과세 소득 부과 추진' · 서울신문·이데일리 11/4)", 140, 300, 28, "pen", "gray", "@news+0.3", 0.7),
  t("s2", "지금: 연 1,500만 이하 개인연금 → 건보료 0원", 140, 355, 40, "bold", "ink", "@news+3.0", 0.8),
  t("s3", "공적연금 → 50%만 소득 × 7.19%", 140, 415, 40, "bold", "red", "@rule+0.3", 0.6),
  t("hda", "개인연금 월", 150, 505, 38, "pen", "gray", "@table", 0.3),
  t("hdb", "1년", 450, 505, 38, "pen", "gray", "@table", 0.3),
  t("hdc", "월 건보료 +", 680, 505, 38, "pen", "gray", "@table", 0.3),
  ...rows.flatMap((r, i) => { const c = r[3] || "ink", y = 590 + i * 92, base = [0.2, 0.9, 3.0, 3.8][i];
    return [t(`r${i + 1}a`, r[0], 150, y, 58, "bold", c, `@table+${base.toFixed(1)}`, 0.3), t(`r${i + 1}b`, r[1], 450, y, 54, "bold", "gray", `@table+${(base + 0.3).toFixed(1)}`, 0.3), t(`r${i + 1}c`, r[2], 700, y, 58, "bold", c, `@table+${(base + 0.6).toFixed(1)}`, 0.4)]; }),
  { type: "circle", target: "r2c", at: "@table+2.2", dur: 0.5, color: "red", pad: 10, width: 6 },
  t("n0", "(가정: 국민연금처럼 50% 반영 · 2026 보험료율 7.19% · 장기요양보험료 별도 · 실제 방식은 미정)", 150, 980, 22, "pen", "gray", "@table.end", 0.6),
  { type: "sticky", x: 150, y: 1030, w: 760, h: 230, rot: -2, at: "@check-0.2", items: [
    t("m1", "지금 확인할 것", 46, 24, 48, "bold", "red", "@check", 0.5),
    t("m2", "① 피부양자: 연 소득 2천만 기준", 46, 96, 42, "bold", "ink", "@check+0.8", 0.5),
    t("m3", "② 국민연금 + 개인연금 합계", 46, 160, 42, "bold", "blue", "@check+2.2", 0.6) ] },
  t("n9", "(서울신문·이데일리 11/4 · 매일경제 11/7 · 연합뉴스 9/8 · 헤럴드경제 · 직접 계산)", 150, 1300, 24, "pen", "gray", "@cta", 0.6),
  t("sig", "늦지 않았습니다. — 은퇴노트", 330, 1360, 56, "pen", "ink", "@cta", 0.8, { rot: -2 }),
  t("handle", "@retire.note", 600, 1430, 32, "sans", "gray", "@cta+0.6", 0.5, { fade: true }),
];
writeNote(R + "2026-11-18b.note.json", {
  duration: "auto", fps: 30, flip: 0.7, tape: { text: "내 칸 표 #3 · 건보료", color: "yellow" },
  band: { lines: ["연금저축·IRP 건보료 검토", "월 100만 받는 분 [3.6만] 더"] },
  out: "queue/issues/2026-11-18_private-pension-health-premium.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", stains: [{ x: 700, y: 1500, r: 170, opacity: 0.18, rot: -8 }], items: body }] });
console.log("ok cover", covers[pick].label);
