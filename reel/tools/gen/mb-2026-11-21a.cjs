// 매니악 브리핑 11/21 08:30 — '검은 금요일'(11/20 코스피 -5.21%, 양 시장 매도 사이드카) → 사이드카는 거래 정지가 아니다
// 많이 본 뉴스 상위를 코스피 급락이 휩쓸었음(노컷 1위·비즈워치 1위·파이낸셜 1위·아시아경제 2위·강원일보 2위 등). 종목 추천·매매 타이밍 없음.
const { t, writeNote, sheetCover, mascotEnd } = require("../note-helpers.cjs");
const fs = require("fs");
const R = "/home/user/jkquant/reel/queue/mb/issues/";
// 장치 규칙: 뉴시스 7/24 '금알못'(한국거래소 제도) · 사이드카 5%·1분·5분은 강원일보(연합) 11/20·비즈워치 11/20 도 같음
const ROWS = [["사이드카", "선물 5%", "프로그램 매도 5분"], ["서킷 1단계", "지수 8%", "모든 거래 20분"], ["서킷 2단계", "지수 15%", "다시 20분"],
  ["서킷 3단계", "지수 20%", "그날 장 끝"], ["어제 코스피", "-5.21%", "사이드카만"]];
const mk = (t1, t2) => sheetCover({ skin: "mb", t1, t2, t1size: 70, t2size: 66, sub: "한국거래소 · 전날 종가 대비 · 1분 지속",
  cols: [60, 320, 560], head: ["장치", "기준", "멈추는 것"], y0: 600, size: 48, step: 100, rows: ROWS, hi: 0,
  note: "사이드카는 하루 한 번 · 오후 2시 50분 뒤엔 안 켜짐", foot: "헷갈리면 저장해 두세요" });
const covers = [
  { label: "A 거래 정지 아니다", page: mk("사이드카는 거래 정지가 아니다", "프로그램 매도만 5분 멈춤") },
  { label: "B 5분 멈춘 것", page: mk("어제 코스피 5분 멈춘 건 이것", "프로그램 매도, 거래는 계속") },
  { label: "C 10개월 전으로", page: mk("코스피, 10개월 전으로 돌아갔다", "하루 -5.21%, 사이드카 두 번") },
];
fs.writeFileSync(R + "2026-11-21a.covers.json", JSON.stringify(covers, null, 1) + "\n");
const pick = +(process.argv[2] ?? 0);
const voice = { name: "ko-KR-SunHiNeural", rate: "+8%", lead: 0.35, gap: 0.28, tail: 1.6, lines: [
  { id: "hook", text: "어제 코스피가 5분 멈췄다는데, 정확히 뭐가 멈춘 걸까요?" },
  { id: "news", text: "어제 코스피는 5% 넘게 빠져서 사천팔백육십구로 끝났어요. 1월 수준으로 돌아간 거예요.", gap: 0.3 },
  { id: "side", text: "오전 11시 54분에 사이드카가 켜졌는데요, 이건 거래 정지가 아니에요. 컴퓨터로 한꺼번에 던지는 프로그램 매도만 5분 멈춘 거예요.", gap: 0.3 },
  { id: "cb", text: "시장 전체가 멈추는 건 서킷브레이커예요. 지수가 8% 넘게 빠져야 켜지고, 그땐 모든 거래가 20분 멈춰요.", gap: 0.2 },
  { id: "num", text: "어제는 삼성전자가 7%, 하이닉스가 6% 가까이 빠졌고, 외국인이랑 기관이 2조 원 넘게 팔았어요.", gap: 0.3 },
  { id: "cta", text: "사이드카랑 서킷, 이제 안 헷갈리시죠? 저장해 두면 다음에 바로 보여요.", gap: 0.35 },
] };
// 11/20 숫자(노컷뉴스·비즈워치 일치: 코스피 4869.96 −5.21%·코스닥 645.68 −5.71%·삼성전자 −7.01%·SK하이닉스 −5.92%·외국인 −1.14조·기관 −0.95조·개인 +1.59조)
const DAY = [["코스피", "4,869.96", "−5.21%"], ["코스닥", "645.68", "−5.71%"], ["삼성전자", "18만 3,100원", "−7.01%"], ["SK하이닉스", "111만 3천원", "−5.92%"]];
const X = [120, 430, 740];
const Y = (i) => 560 + i * 86;
const body = [
  t("h1", "어제 코스피, 뭐가 멈췄나", 110, 200, 64, "bold", "ink", 0, 0),
  t("s1", "(한국거래소 · 노컷뉴스·비즈워치·강원일보 11/20 · 뉴시스)", 112, 300, 28, "pen", "gray", "@news+0.2", 0.7),
  t("s2", "11월 20일 종가 · 1월 수준으로", 112, 358, 40, "bold", "red", "@news+0.8", 0.8),
  t("hda", "어제", X[0], 470, 36, "pen", "gray", "@news", 0.3),
  t("hdb", "종가", X[1], 470, 36, "pen", "gray", "@news", 0.3),
  t("hdc", "하루", X[2], 470, 36, "pen", "gray", "@news", 0.3),
  ...DAY.flatMap((r, i) => { const a = i < 2 ? `@news+${(0.6 + i * 1.2).toFixed(1)}` : `@num+${(0.2 + (i - 2) * 1.4).toFixed(1)}`;
    return [t(`r${i + 1}a`, r[0], X[0], Y(i), 46, "bold", "gray", a, 0.3), t(`r${i + 1}b`, r[1], X[1], Y(i), 50, "bold", "ink", a, 0.35), t(`r${i + 1}c`, r[2], X[2], Y(i), 50, "bold", "red", a, 0.35)]; }),
  { type: "circle", target: "r1c", at: "@news+2.6", dur: 0.5, color: "red", pad: 8, width: 6 },
  { type: "sticky", x: 110, y: 930, w: 700, h: 300, rot: 0, at: "@side-0.2", items: [
    t("f1", "사이드카", 40, 26, 46, "bold", "red", "@side+1.6", 0.3),
    t("f2", "프로그램 매도만 5분 · 거래는 계속", 40, 92, 38, "bold", "ink", "@side+4.0", 0.6),
    t("v1", "서킷브레이커", 40, 162, 46, "bold", "blue", "@cb", 0.3),
    t("v2", "지수 8%부터 · 모든 거래 20분", 40, 226, 38, "bold", "ink", "@cb+2.2", 0.6) ] },
  t("n1", "(11:54 코스피 · 13:28 코스닥 매도 사이드카 — 양 시장 동시 발동은 10거래일 만)", 120, 1262, 24, "pen", "gray", "@side+1.0", 0.6),
  t("n2", "외국인 −1.14조 · 기관 −0.95조 · 개인 +1.59조", 120, 1312, 34, "bold", "blue", "@num+3.2", 0.6),
  mascotEnd("@cta", "저장!", 825, 1010, 160),
  t("sig", "매니악 브리핑", 330, 1395, 54, "bold", "ink", "@cta", 0.6),
  t("handle", "@maniacbriefing", 360, 1455, 30, "sans", "gray", "@cta+0.5", 0.5, { fade: true }),
];
writeNote(R + "2026-11-21a.note.json", {
  skin: "brief", duration: "auto", fps: 30, flip: 0.6, tape: { text: "매니악 브리핑 #10", color: "yellow" },
  band: { lines: ["코스피 5분 멈춘 건", "[프로그램 매도]만 · 거래는 계속"] },
  out: "queue/mb/issues/2026-11-21_sidecar-not-halt.mp4", voice,
  pages: [covers[pick].page, { start: "@hook.end+0.05", items: body }] });
console.log("ok cover", covers[pick].label);
