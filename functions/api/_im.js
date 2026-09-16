// 무한매수법 — 오늘의 주문을 계산한다 (서버용 순수 함수)
//
// 왜 옮겼나: 주문 계산이 index.html 안에만 있어서, 앱을 열지 않으면 오늘 낼 주문이
// 무엇인지 아무도 몰랐다. 자동 주문을 하려면 서버가 같은 계산을 할 수 있어야 한다.
//
// 브라우저와 한 주도 어긋나면 안 된다. 회귀 [42]가 index.html의 함수를 그대로 꺼내
// 같은 입력을 먹이고 결과를 맞대 본다 — 어긋나면 배포가 막힌다.
//
// 지원 범위: 일반모드만. 리버스모드는 규칙이 배로 복잡해서 옮기지 않았다 —
// 그 상태의 세션은 자동 주문을 건너뛰고 이유를 남긴다(절반만 옮긴 엔진이
// 사람 없이 주문을 내는 것보다 안 내는 게 낫다).

/* ── 거래 종류별 T 변화 (index.html KIND_T와 같아야 한다) ── */
const KIND_T = {
  "1회매수": (t) => t + 1, "절반매수": (t) => t + 0.5,
  "쿼터매도": (t) => t * 0.75, "지정가매도": (t) => t * 0.25,
  "지정가매도+1회매수": (t) => t * 0.25 + 1, "지정가매도+절반매수": (t) => t * 0.25 + 0.5,
  "1회매수+지정가매도(애프터)": (t) => t * 0.25 + 1, "절반매수+지정가매도(애프터)": (t) => t * 0.25 + 0.5,
};
function reverseT(kind, t, div) {
  if (kind === "리버스매도") return div >= 40 ? t * 0.95 : t * 0.9;
  if (kind === "리버스매수") return t + (div - t) * 0.25;
  return t;
}
const isSell = (k) => k === "출금" ? false : (k.includes("매도") && !k.includes("+1회매수") && !k.includes("+절반매수") ? true : k.includes("매도"));
const isBuy = (k) => k === "출금" ? false : (k.includes("매수") && !k.includes("지정가매도") || k === "지정가매도+1회매수" || k === "지정가매도+절반매수" ? k !== "지정가매도" : k.includes("매수"));

/* 별% = base − (base×0.1×20/div)×T */
export function starPct(ticker, div, T, base) {
  const b = (base != null && base > 0) ? base : (ticker === "TQQQ" ? 15 : 20);
  return b - (b * 0.1 * 20 / div) * T;
}

/* 1회 매수금 = 잔금 ÷ (분할−T). 남은 회차가 1회 미만이면 소진. */
export function imBuy1(c) {
  const slot = (c.st.div || 20) - c.T;
  if (!(slot >= 1)) return { amt: 0, slot, spent: true };
  return { amt: c.bal / slot, slot, spent: false };
}

/* 거래이력에서 지금 상태를 낸다 — index.html computeInf의 순수판.
   화면용 rows/배지는 뺐다. 자동 주문에 필요한 건 평단·보유·T·잔금·리버스 여부뿐이다. */
export function imCompute(st, hist) {
  let avg = 0, qty = 0, inv = 0, realized = 0, T = 0;
  let withdrawn = 0, saved = 0;
  const simple = (st.compound === false);
  let inReverseNow = false;
  for (const h of (hist || [])) {
    const Tbefore = T;
    const isRev = (h.kind === "리버스매도" || h.kind === "리버스매수");
    if (h.kind === "지정가매도" || h.kind === "쿼터매도" || h.kind === "리버스매도") {
      realized += (h.price - avg) * h.qty; qty -= h.qty; inv -= avg * h.qty;
    } else if (h.kind === "1회매수" || h.kind === "절반매수" || h.kind === "리버스매수") {
      const nq = qty + h.qty; avg = nq > 0 ? (avg * qty + h.price * h.qty) / nq : h.price; qty = nq; inv += h.price * h.qty;
    } else if (h.kind === "출금") {
      withdrawn += Math.max(0, +h.amt || 0);
    } else if (h.kind.startsWith("지정가매도+") || h.kind.includes("+지정가매도")) {
      const sp = +h.sellPrice || 0, sq = +h.sellQty || 0, bp = +h.buyPrice || 0, bq = +h.buyQty || 0;
      const sellFirst = h.kind.startsWith("지정가매도+");
      const doSell = () => { if (sq > 0) { realized += (sp - avg) * sq; qty -= sq; inv -= avg * sq; } };
      const doBuy = () => { if (bq > 0) { const nq = qty + bq; avg = nq > 0 ? (avg * qty + bp * bq) / nq : bp; qty = nq; inv += bp * bq; } };
      if (sellFirst) { doSell(); doBuy(); } else { doBuy(); doSell(); }
    }
    if (typeof h.tManual === "number" && !isNaN(h.tManual)) T = h.tManual;
    else if (isRev) T = reverseT(h.kind, T, st.div);
    else T = KIND_T[h.kind] ? KIND_T[h.kind](T) : T;
    inReverseNow = isRev;
    if (Tbefore < st.div && T >= st.div) { /* 리버스 스트릭 리셋 — 자동주문엔 영향 없음 */ }
    if (qty <= 1e-9 && isSell(h.kind) && !isBuy(h.kind)) {
      qty = 0; avg = 0; T = 0; inv = 0; inReverseNow = false;
      if (simple) {
        const cashNow = (+st.principal || 0) + realized - withdrawn - saved;
        if (cashNow > (+st.principal || 0)) saved += cashNow - (+st.principal || 0);
      }
    }
  }
  const reverseActive = (st.reverse === true) && (inReverseNow || (st.div - T < 1)) && qty > 0;
  const bal = (+st.principal || 0) + realized - inv - withdrawn - saved;
  return { avg, qty, inv, realized, T, bal, st, reverseActive, withdrawn, saved, simple };
}

/* ── 확정 종가 ──
   시세 API는 장중에도 오늘 봉을 내주는데 그 close 는 종가가 아니라 그 순간의 현재가다.
   자동 주문은 마감 20분 전에 도는데, 그때 오늘 봉을 쓰면 장중 현재가로 주문을 내게 된다.
   앱(simCutoff·settledBars)과 같은 규약으로 마감+정산지연이 지나야 오늘 봉을 인정한다.
   마감 '직후'도 아직 종가가 아니다 — 종가 단일가 체결이 일봉에 실리기까지 몇 분 걸린다. */
const MKT_CLOSE_MIN = { usd: 16 * 60, krw: 15 * 60 + 30 };
const SETTLE_LAG_MIN = 20;
export function exchNow(cur, now) {
  const tz = (cur === "krw") ? "Asia/Seoul" : "America/New_York";
  const P = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now || new Date());
  const g = (k) => (P.find((x) => x.type === k) || {}).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: (+g("hour")) * 60 + (+g("minute")) };
}
/* 주문은 마감 전에 들어가야 뜻이 있다. 마감 뒤에 낸 지정가는 그날 체결되지 않고
   다음 거래일로 넘어가 엉뚱한 가격에 걸리거나 거절된다.
   실측(2026-09-15): 깃허브 크론이 19:40/20:40 UTC 예정인데 22:25/23:08 에 돌았다 —
   1시간 46분·2시간 28분 늦어 둘 다 미국 마감(20:00 UTC) 뒤였다. 크론 지연은 우리가
   못 막으니, 늦게 도착한 실행이 마감 뒤에 주문을 내지 않도록 여기서 막는다.
   창은 '마감 1시간 전 ~ 마감'. 드라이런은 계산만 하므로 아무 때나 된다. */
export const ORDER_WINDOW_MIN = 60;
export function orderWindow(cur, now) {
  const n = exchNow(cur, now);
  const close = MKT_CLOSE_MIN[cur === "krw" ? "krw" : "usd"];
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { ok: n.min >= close - ORDER_WINDOW_MIN && n.min <= close,
           now: hhmm(n.min), from: hhmm(close - ORDER_WINDOW_MIN), to: hhmm(close) };
}
export function simCutoff(cur, now) {
  const n = exchNow(cur, now);
  if (n.min >= MKT_CLOSE_MIN[cur === "krw" ? "krw" : "usd"] + SETTLE_LAG_MIN) return n.date;
  const y = new Date(n.date + "T00:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}
/* 종가가 확정된 마지막 봉 {date, close}. 없으면 null. */
export function settledLast(rows, cur, now) {
  const cut = simCutoff(cur, now);
  const r = (rows || []).filter((x) => x.date <= cut);
  return r.length ? r[r.length - 1] : null;
}
/* 그 종가가 며칠 묵었나 — 기준일(cutoff)에서 며칠 전 것인지.
   시세사가 봉을 늦게 올리는 일이 실제로 있다(야후가 9/14 봉을 마감 4시간 뒤에 올렸다).
   사람이 보고 있으면 이상한 걸 알아채지만 자동 주문은 그대로 내버린다.
   3일 연휴까지는 정상이므로 그보다 더 묵었을 때만 막는다. */
export const STALE_MAX_DAYS = 4;
export function staleDays(closeDate, cur, now) {
  if (!closeDate) return Infinity;
  const cut = simCutoff(cur, now);
  return Math.round((Date.parse(cut + "T00:00:00Z") - Date.parse(closeDate + "T00:00:00Z")) / 864e5);
}

/* 익절 동적 조절 — 직전 20거래일 상승률이 +8%를 넘으면 오늘 익절%를 올린다 */
const IM_MOM_LEN = 20, IM_MOM_TH = 8, IM_MOM_CAP = 30;
export function imMomOf(days) {
  if (!days || days.length < IM_MOM_LEN + 1) return null;
  const n = days.length, a = days[n - 1] && days[n - 1].close, b = days[n - 1 - IM_MOM_LEN] && days[n - 1 - IM_MOM_LEN].close;
  return (a > 0 && b > 0) ? (a / b - 1) * 100 : null;
}
export function imTgtOf(base, mom) { return (mom != null && mom > IM_MOM_TH) ? Math.min(base * 2, IM_MOM_CAP) : base; }

/* 오늘 낼 주문. index.html renderOrder의 일반모드와 같은 순서·같은 값으로 낸다.
   close = 확정 종가(전일 종가). days = 종가 이력(익절 조절용, 없으면 조절 안 함). */
export function imOrders({ st, hist, close, days }) {
  const c = imCompute(st, hist);
  const out = [];
  if (c.reverseActive) return { orders: out, skip: "리버스모드 — 자동 주문 미지원", c };
  if (!(close > 0)) return { orders: out, skip: "확정 종가 없음", c };

  const B1 = imBuy1(c), buy1 = B1.amt;
  const pct = starPct(st.ticker, st.div, c.T, st.target);
  const star = c.avg > 0 ? c.avg * (1 + pct / 100) : close;
  const buyPt = star - 0.01;
  const bigPct = (st.big != null && isFinite(+st.big)) ? +st.big : 20;
  const limit = close * (1 + bigPct / 100);
  const half = c.T < st.div / 2;
  const rows = st.rowsOn ? Math.max(0, st.rows || 0) : 0, gap = st.gap || 2.5, rq = st.rowqty || 1;

  // 매수 — 수량은 늘 '종가'로 나눈다. LOC는 종가에 체결되므로 주문가로 나누면 배정액만큼 못 산다.
  const push = (side, kind, tag, price, qty) => { if (qty >= 1 && price > 0) out.push({ side, kind, tag, price, qty }); };
  const brow = (kind, price, alloc) => push("buy", kind, "LOC", price, close > 0 ? Math.floor(alloc / close) : 0);
  const cap = (p) => (limit > 0 && p > limit) ? limit : p;

  if (B1.spent) {
    // 원금 소진 — 새 회차 없음. 아래 매도만 낸다.
  } else if (c.avg <= 0) {
    brow("처음매수", close * (1 + bigPct / 100), buy1);
    for (let i = 1; i <= rows; i++) { const p = close * (1 - gap * i / 100); if (p > 0) push("buy", `하방 ${i}`, "LOC", p, rq); }
  } else if (half) {
    brow("별지점 매수", cap(buyPt), buy1 / 2);
    brow("평단 매수", cap(c.avg), buy1 / 2);
    for (let i = 1; i <= rows; i++) { const p = buyPt * (1 - gap * i / 100); if (p > 0) push("buy", `하방 ${i}`, "LOC", cap(p), rq); }
  } else {
    brow("별지점 매수 (전액)", cap(buyPt), buy1);
    for (let i = 1; i <= rows; i++) { const p = buyPt * (1 - gap * i / 100); if (p > 0) push("buy", `하방 ${i}`, "LOC", cap(p), rq); }
  }

  // 매도
  if (c.qty > 0) {
    let effTarget = st.target;
    if (st.tgtDyn === true) { const m = imMomOf(days); if (m != null) effTarget = imTgtOf(st.target, m); }
    const qSell = Math.floor(c.qty / 4);
    if (qSell > 0) push("sell", "쿼터매도 (¼·별지점)", "LOC", star, qSell);
    push("sell", "지정가매도 (나머지)", "지정가", c.avg * (1 + effTarget / 100), c.qty - qSell);
  }
  return { orders: out, skip: null, c };
}
