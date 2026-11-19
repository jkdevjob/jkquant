// 노트 설정 만들기 도우미 — 루틴이 편마다 쓰는 짧은 생성 스크립트에서 require("../../tools/note-helpers.cjs") 처럼 불러 쓴다.
// 노트 설정 만들기 도우미(11/14~): 표지 v2 3안 + 띠 + 내 칸 표 본문
const fs = require("fs");
const RED = "#d7261e", YEL = "#ffe14d", INK = "#16130f";
const T = (id, text, x, y, size, extra = {}) => ({ type: "text", id, text, x, y, size, font: "heavy", color: INK, at: 0, dur: 0, rot: 0, ...extra });
const t = (id, text, x, y, size, font, color, at, dur, extra = {}) => ({ type: "text", id, text, x, y, size, font, color, at, dur, ...extra });
const VOICE = (lines) => ({ name: "ko-KR-HyunsuMultilingualNeural", rate: "+10%", lead: 0.35, gap: 0.28, tail: 1.6, lines });
const cover = (items) => ({ cover: true, start: 0, stains: [{ x: 720, y: 1480, r: 170, opacity: 0.14, rot: -6 }], items });
// rows: [[a,b,c,color]], cols x, start y, step
function table(rows, { cols = [150, 430, 720], y0 = 590, step = 80, at0 = "@table", size = 54, delay = 0.45 } = {}) {
  const out = [];
  rows.forEach((r, i) => {
    const color = r[3] || "ink";
    r.slice(0, 3).forEach((v, j) => {
      if (v == null) return;
      out.push(t(`r${i + 1}${"abc"[j]}`, v, cols[j], y0 + i * step, size, "bold", color, `${at0}+${(0.5 + i * delay + j * 0.3).toFixed(1)}`, 0.4));
    });
  });
  return out;
}
function writeNote(file, spec) { fs.writeFileSync(file, JSON.stringify(spec, null, 1) + "\n"); }
// 끝 장면 마스코트(말풍선): 본문 마지막 페이지에 넣는다 — 서명·핸들과 겹치지 않게 x·y 를 조정
const mascotEnd = (at, say, x = 760, y = 1190, size = 230, brand) => ({ type: "mascot", brand, x, y, size, at, dur: 0.45, say });
module.exports = { RED, YEL, INK, T, t, VOICE, cover, table, writeNote, mascotEnd };

// ── 표지 v3(11/17 사용자 "물음표 ?? 넣지마" + 인기 쇼츠 썸네일 48장 분석): 위 두 줄 제목 + 정리표 전체를 처음부터 다 보여 줌(답을 가리지 않음) ──
// o = { skin:"rn"|"mb", t1, t2, t2color?, sub?, cols:[x..], head:[..], rows:[[..]], hi: 강조 줄 번호, note?, foot?, size? }
function sheetCover(o) {
  const MB = o.skin === "mb";
  const INKc = MB ? "#15171c" : "#16130f", ACC = MB ? "#ff4d1f" : "#d7261e", HEADBG = MB ? "#15171c" : "#16130f", HEADFG = "#ffffff"; // 매니악 v2(11/19): 흰 보드 + 검정·주황
  const HIBG = MB ? "#ffd60a" : "#ffe14d", HIFG = "#16130f", GRAY = MB ? "#7a7f8a" : "#5d554c";
  const size = o.size || 62, step = o.step || Math.round(size * 1.55), y0 = o.y0 || 520;
  const items = [
    T("t1", o.t1, 70, 190, o.t1size || 84, { color: INKc }),
    T("t2", o.t2, 70, 300, o.t2size || 92, { color: o.t2color || ACC }),
  ];
  if (o.sub) items.push(T("sub", o.sub, 76, 418, 40, { color: GRAY, font: "sans", weight: 700 }));
  o.head.forEach((h, j) => items.push(T(`hd${j}`, h, o.cols[j] - 8, y0 - 6, 38, { color: HEADFG, box: HEADBG, font: "sans", weight: 800, pad: "0.12em 0.35em 0.06em" })));
  o.rows.forEach((r, i) => r.forEach((v, j) => {
    const hi = i === o.hi;
    items.push(T(`c${i}${j}`, v, o.cols[j], y0 + 70 + i * step, j === 0 ? size * 0.9 : size, { color: hi ? HIFG : (j === 0 ? GRAY : INKc), ...(hi ? { box: HIBG } : {}) }));
  }));
  const yEnd = y0 + 70 + o.rows.length * step;
  if (o.note) items.push(T("note", o.note, 76, yEnd + 10, 32, { color: GRAY, font: "sans", weight: 700 }));
  if (o.foot) items.push(T("foot", o.foot, 76, yEnd + 70, 50, { color: ACC, font: "pen" }));
  // (11/19 사용자 "마스코트도 만들어서 넣어") 표지 오른쪽 아래에 채널 마스코트 — o.mascot === false 면 뺀다
  if (o.mascot !== false) items.push({ type: "mascot", brand: MB ? "mb" : "rn", x: o.mascotX ?? 730, y: o.mascotY ?? yEnd + 60, size: o.mascotSize ?? 250, at: 0, dur: 0, say: o.mascotSay });
  return { cover: true, start: 0, items };
}
module.exports.sheetCover = sheetCover;
