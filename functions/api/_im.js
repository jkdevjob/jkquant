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
/* index.html 의 isBuy·isSell·isAmtKind 와 같은 판정 — 출금·배당은 매매가 아니다 */
const isSell = (k) => k !== "출금" && k.includes("매도");
const isBuy = (k) => k === "출금" ? false : (k.includes("매수") && !k.includes("지정가매도") || k === "지정가매도+1회매수" || k === "지정가매도+절반매수" ? k !== "지정가매도" : k.includes("매수"));
/* 리버스는 규칙이 있는 분할에만 (index.html REV_DIVS 와 같은 목록) */
export const REV_DIVS = [20, 40];
const revSupported = (div) => REV_DIVS.includes(+div);
/* 리버스를 실제로 쓰는가 = 켬 + 규칙이 있는 분할 (index.html revEnabled 와 같은 조건 · 제8차 8-④).
   장부에 리버스 기록이 남아 있어도 규칙이 없는 분할이면 리버스로 보지 않는다. */
const revEnabled = (st) => !!st && st.reverse === true && revSupported(st.div);
/* 큰수 기본값 — 처음매수 LOC 가격에 사용. index.html·backtest.html 의 IM_BIG_DEFAULT 와 같은 값.
   예전엔 여기만 20 이었다: big 을 저장하지 않은 옛 세션은 앱 주문표(15%)와 서버 자동주문(20%)의
   처음매수 LOC 가격이 달랐다 (실데이터 1,499일 중 269일, 7차 점검 ⑥). */
export const IM_BIG_DEFAULT = 15;
export function imBigPct(st) { const v = st && st.big; return (v != null && isFinite(+v) && +v > 0) ? +v : IM_BIG_DEFAULT; }

/* 별% = base − (base×0.1×20/div)×T */
export function starPct(ticker, div, T, base) {
  const b = (base != null && base > 0) ? base : (ticker === "TQQQ" ? 15 : 20);
  return b - (b * 0.1 * 20 / div) * T;
}

/* ── 별지점 가격 — 호가(센트) 반올림 (제10차 감사 대응) ──
   원문 V4.0 일반모드 3-(3): '평단 × (1+별%) = 38.30 × (1+2.8%) = 39.37 $ (반올림)' — 이 값이 매수·매도를 가른다.
   매수점은 여기서 −0.01 (3-(5)), 매도점(쿼터매도 LOC)은 그대로. 반올림 없이 39.3724 로 두면 종가가 딱 39.37 인 날
   원문은 쿼터매도가 체결되는데 여기는 아무것도 안 된다. 리버스 별지점(직전 5거래일 평균)도 같은 규약으로 센트에 맞춘다.
   운영 주문표·모의·백테·서버·5년 플랜이 같은 글자로 쓴다. */
function imTickRound(p, cur){ const t=vrTick(p,cur); return +(Math.floor(p/t+0.5+1e-9)*t).toFixed(4); }
function imStarPx(avg, pct, cur){ return avg>0 ? imTickRound(avg*(1+pct/100), cur) : 0; }
function imBuyPx(star){ return star>0 ? +(star-0.01).toFixed(4) : 0; }
/* ── 무한매수법 V4.0 매수 주문 — 정식 (라오어 카페 V4.0 일반모드 원문 · 제10차 감사 대응으로 원문 표 세 개에 맞춤) ──
   앱 주문표 · 모의 · 서버 자동주문 · 백테 · 5년 플랜이 이 함수 하나로 매수 주문을 만든다 (같은 글자).
     처음 매수 : 전일 종가 +큰수%(원문 10~15%) 에 LOC — 수량 = 1회매수금 ÷ 그 주문가 (내림)
     전반전    : 별지점(−0.01) LOC — 수량 = 1회매수금 절반 ÷ 주문가 (내림)
                 평단 LOC       — 수량 = 1회매수금 ÷ 평단 (내림) − 별지점 수량
     후반전    : 별지점(−0.01) LOC — 수량 = 1회매수금 ÷ 주문가 (내림)
     아래로 LOC 매수 추가 : k번째 = 1회매수금 ÷ (본 주문 수량 + k) 에 1주씩 (호가 내림)
   원문 표 세 개가 그대로 나온다 (회귀 [119] SOURCE GOLDEN):
     처음   1회 617.89 · 큰수 51.44                     → 51.44×12 · 47.53×1 · 44.13×1
     전반전 1회 ≈539.2 · 별지점 78.12 · 평단 69.75      → 78.11×3 · 69.75×4 · 67.40×1 · 59.91×1
     후반전 1회 ≈568.5 · 별지점 59.55                   → 59.54×9 · 56.85×1 · 51.68×1 · 47.37×1
   평단 수량을 '절반 ÷ 평단' 으로 세면 3주가 나와 전반전 표의 4주와 다르다 (제10차 P1-2). 표에서 역산하면
   '평단에 닿으면 1회매수금만큼(1회매수금÷평단 주)을 들고 있게' 가 맞고, 그러면 추가 줄의 첫 가격
   1회매수금÷(수량+1) 이 늘 평단 아래로 나온다 — 원문의 '아래로' 와도 맞는다.
   LOC 는 종가에 체결되므로 종가가 낮을수록 같은 1회매수금으로 더 많은 주수를 산다.
   추가 줄은 같은 회차의 일부다 — T 는 본 주문만 센다 (dT 0).
   증권사는 주문가×수량을 매수가능금액에서 예약하고 넘으면 거부한다 — 잔금 안에서만 낸다 (7차 점검 ④).
   주문가가 전일 종가 +큰수% 를 넘으면 그 값(호가 내림)으로 낮춰 낸다 — 원문 '큰수 매수'(증권사 가격 제한 대응).
   줄 수(rows)는 원문에 없다('…' 로 이어질 뿐) — JKQuant 구현값 기본 3 (imRowsOf). 호가·수수료 포함 수량도 구현 세부다.
     o: {first, half, buy1, bal, firstPrice, starPrice, avg, cap, rows, fee, cur}
     반환: [{kind:'1회매수'|'절반매수'|'하방', name, price, q, dT, ladder, capped, orig}] */
export function imBuyOrders(o){
  const out=[], f1=1+(+o.fee||0);
  if(!(o.buy1>0)) return out;
  let res=Math.max(0,+o.bal||0);
  let lo=Infinity;
  const held=()=>out.reduce((a,x)=>a+x.q,0);
  const main=(name,p0,alloc,dT,kind,have)=>{
    const p=p0; if(!(p>0)) return; if(p<lo) lo=p;
    const q=Math.min(Math.floor(alloc/f1/p+1e-9)-(have||0), Math.floor(res/f1/p+1e-9));
    if(q>=1){ out.push({kind, name, price:p, q, dT, ladder:false}); res-=q*p*f1; }
  };
  if(o.first) main('처음매수', vrTickDn(o.firstPrice, o.cur), o.buy1, 1, '1회매수');
  else if(o.half){ main('별지점 매수', o.starPrice, o.buy1/2, 0.5, '절반매수');
                   main('평단 매수', o.avg, o.buy1, 0.5, '절반매수', held()); }
  else main('별지점 매수 (전액)', o.starPrice, o.buy1, 1, '1회매수');
  const Q=held(), n=Math.max(0,Math.floor(+o.rows||0));
  for(let k=1,m=0;m<n&&k<=n+Q+2;k++){
    const p=vrTickDn(o.buy1/(Q+k), o.cur);
    if(!(p>0)) break;
    if(p>=lo) continue;
    if(res<p*f1-1e-9) break;
    out.push({kind:'하방', name:'하방 '+k+' (÷'+(Q+k)+')', price:p, q:1, dT:0, ladder:true}); res-=p*f1; m++;
  }
  return out;
}
/* 아래로 LOC 추가 줄 수 — 설정값, 없으면 기본 3. 0 이면 끈다(변형). 예전 rowsOn(꺼짐 기본) 스위치는 쓰지 않는다. */
const IM_ROWS_DEFAULT=3;
export function imRowsOf(st){ const v=(st||{}).rows; return (v!=null&&isFinite(+v)) ? Math.max(0,Math.min(20,Math.floor(+v))) : IM_ROWS_DEFAULT; }
/* 호가 (index.html · backtest.html · plan.html 과 같은 글자) — 아래로 LOC 추가 줄의 가격을 호가 단위로 내린다 */
function vrTick(p, cur){ return cur==='krw' ? (p<2000?1:5) : (p<1?0.0001:0.01); }
function vrTickUp(p, cur){ const t=vrTick(p,cur); return +(Math.ceil(p/t-1e-9)*t).toFixed(4); }
function vrTickDn(p, cur){ const t=vrTick(p,cur); return +(Math.floor(p/t+1e-9)*t).toFixed(4); }

/* 1회 매수금 = 잔금 ÷ (분할−T). 남은 회차가 1회 미만이면 소진. */
export function imBuy1(c) {
  const slot = (c.st.div || 20) - c.T;
  if (!(slot >= 1)) return { amt: 0, slot, spent: true };
  return { amt: c.bal / slot, slot, spent: false };
}

/* 거래이력에서 지금 상태를 낸다 — index.html computeInf 의 순수판.
   화면용 rows/배지는 뺐다. 자동 주문에 필요한 건 평단·보유·T·잔금·리버스 상태뿐이다.
   computeInf 와 한 줄씩 같은 규칙이어야 한다 (7차 점검 ⑤) — 예전 판이 4·5차 감사 이전
   규칙에 멈춰 있어서 이렇게 갈렸다:
     · 사이클 종료를 '매도 전용 기록으로 0주' 로만 봤다 — 복합거래로 0주가 돼도 안 끝났다 (5차 ④)
     · 배당 기록을 몰랐다 — 앱보다 잔금·1회매수금이 작게 나왔다 (N1)
     · 리버스 여부를 '마지막 기록이 리버스인가' 로 봤다 — 리버스 중 출금·배당 한 줄만
       적어도 일반모드로 보고 일반 주문을 냈다. 상태를 바꾸는 이벤트만 상태를 바꾼다 (4차 ③)
   회귀가 실데이터 수천 건 이력과 손으로 만든 경계 사례로 두 함수를 맞대 본다. */
/* ── 무매 사이클 종료 판정 한 곳 (제14차 D15) ──
   원문: 지정가매도가 체결된 뒤 주가가 크게 떨어져 같은 날 LOC 매수까지 되면 사이클 종료가 아니고 그대로 이어 간다
   (새 T = 기존 T×0.25 + 1 · 절반매수면 + 0.5). 보유 1~3주는 쿼터가 0주라 익절이 전량을 팔아 장중에 잠깐 0주가 된다.
   종료는 하루 주문을 모두 처리한 뒤 '그날 매도가 있었고 최종 보유가 0주' 일 때뿐이다.
   백테(runIM·runIM50) · 앱 장부(computeInf — 운영·모의) · 서버(imCompute) · 5년 플랜(calcInfState)이 같은 글자로 쓴다. */
function imCycleEnds(soldToday, qtyAtDayEnd){ return !!soldToday && !(qtyAtDayEnd>1e-9); }
/* 장부는 하루를 여러 줄로 적는다(익절 한 줄 · 매수 한 줄). hist[i] 뒤에 같은 날짜의 매매 줄이 더 있으면 그날 주문은 아직 다 처리되지 않았다. */
function imDayOpenAfter(hist, i){ const d=hist[i]&&hist[i].date; if(!d) return false; for(let j=i+1;j<hist.length&&hist[j]&&hist[j].date===d;j++){ if(/매수|매도/.test(String(hist[j].kind||''))) return true; } return false; }

export function imCompute(st, hist, days) {
  let avg = 0, qty = 0, inv = 0, realized = 0, T = 0;
  let withdrawn = 0, saved = 0, divTotal = 0;
  const simple = (st.compound === false);
  let revState = "NORMAL", revFrom = "";   // revFrom — 1일차로 들어온 기록의 날짜 (앱 computeInf 와 같다 · 제12차 ②)
  const revEnter = (d) => {
    if (revEnabled(st) && revState === "NORMAL" && qty > 1e-9 && (st.div - T) < 1) { revState = "DAY1"; revFrom = d || ""; }
  };
  const H = hist || [];
  /* 익절 자동(실험 · imAutoTP) — 사이클 첫 매수일로 그 사이클 익절%를 정한다. 앱 computeInf 와 같은 자리·같은 식.
     days = 확정 종가 이력 [{date, close}] (autotrade 가 익절 자동 세션이면 전체 기간을 받아 넘긴다). */
  const auto = (st.autoTp === true), ab = (auto && days && days.length) ? days : null;
  const tpAt = (d) => (auto && ab && d) ? imAutoTP(ab, d) : null;
  let cycStart = "", cycTp = null;
  let day = null, daySold = false;   // 그날 매도가 있었나 — 사이클 종료는 그날 마지막 매매 줄에서만 (앱 computeInf 와 같다 · 제14차 D15)
  for (let hi = 0; hi < H.length; hi++) {
    const h = H[hi];
    if (h.date !== day) { day = h.date; daySold = false; }
    const flat0 = !(qty > 1e-9) && T === 0;   // 이 줄 전에 사이클이 비어 있었나 — 여기서 사면 새 사이클 첫 매수
    const kind = String(h.kind || "");
    const isRev = (kind === "리버스매도" || kind === "리버스매수");
    if (kind === "지정가매도" || kind === "쿼터매도" || kind === "리버스매도") {
      realized += (h.price - avg) * h.qty; qty -= h.qty; inv -= avg * h.qty;
    } else if (kind === "1회매수" || kind === "절반매수" || kind === "리버스매수") {
      const nq = qty + h.qty; avg = nq > 0 ? (avg * qty + h.price * h.qty) / nq : h.price; qty = nq; inv += h.price * h.qty;
    } else if (kind === "출금") {
      withdrawn += Math.max(0, +h.amt || 0);
    } else if (kind === "배당") {
      divTotal += Math.max(0, +h.amt || 0);
    } else if (kind.startsWith("지정가매도+") || kind.includes("+지정가매도")) {
      const sp = +h.sellPrice || 0, sq = +h.sellQty || 0, bp = +h.buyPrice || 0, bq = +h.buyQty || 0;
      const sellFirst = kind.startsWith("지정가매도+");
      const doSell = () => { if (sq > 0) { realized += (sp - avg) * sq; qty -= sq; inv -= avg * sq; } };
      const doBuy = () => { if (bq > 0) { const nq = qty + bq; avg = nq > 0 ? (avg * qty + bp * bq) / nq : bp; qty = nq; inv += bp * bq; } };
      if (sellFirst) { doSell(); doBuy(); } else { doBuy(); doSell(); }
    }
    if (typeof h.tManual === "number" && !isNaN(h.tManual)) T = h.tManual;
    else if (isRev) T = reverseT(kind, T, st.div);
    else T = KIND_T[kind] ? KIND_T[kind](T) : T;
    // 상태를 바꾸는 이벤트만 상태를 바꾼다 (출금·배당은 그대로)
    if (isRev) revState = "REVERSE";
    else if (kind === "리버스복귀") revState = "NORMAL";
    else if (isBuy(kind) || isSell(kind)) revState = "NORMAL";
    // 사이클 종료 — 그날 매도가 있었고 그날 기록을 다 처리한 뒤 0주인가 (복합거래는 sellQty 로 말한다 ·
    // 같은 날 익절 뒤 LOC 매수를 두 줄로 적어도 사이클이 이어진다 — 제14차 D15)
    const soldQty = (h.sellQty != null) ? (+h.sellQty || 0) : (isSell(kind) ? (+h.qty || 0) : 0);
    if (soldQty > 0) daySold = true;
    if (qty <= 1e-9) { qty = 0; avg = 0; inv = 0; }
    if (flat0 && qty > 1e-9) { cycStart = h.date || ""; cycTp = tpAt(cycStart); }
    if (imCycleEnds(daySold, qty) && !imDayOpenAfter(H, hi)) {
      T = 0; revState = "NORMAL"; daySold = false; cycStart = ""; cycTp = null;
      if (simple) {
        const P0 = +st.principal || 0;
        const cashNow = P0 + realized + divTotal - withdrawn - saved;
        if (cashNow > P0) saved += cashNow - P0;
      }
    }
    revEnter(h.date);
  }
  revEnter();
  const reverseActive = revEnabled(st) && revState !== "NORMAL" && qty > 0;
  const reverseDay1 = reverseActive && revState === "DAY1";
  const bal = (+st.principal || 0) + realized + divTotal - inv - withdrawn - saved;
  const tpAuto = auto ? ((qty > 1e-9 && cycStart) ? cycTp : tpAt("9999-12-31")) : null;
  const tp = tpAuto ? tpAuto.tp : st.target;
  return { avg, qty, inv, realized, T, bal, st, revState, reverseActive, reverseDay1, revFrom, withdrawn, saved, divTotal, simple, tp, tpAuto, cycStart };
}

/* ── 확정 종가 ──
   시세 API는 장중에도 오늘 봉을 내주는데 그 close 는 종가가 아니라 그 순간의 현재가다.
   자동 주문은 마감 전 1시간 안에 도는데, 그때 오늘 봉을 쓰면 장중 현재가로 주문을 내게 된다.
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
/* ── 사이클 익절 자동 선택 (실험적 확장 — 원문 V4.0 아님 · 켤 때만) ──
   사이클 첫 매수일 '전날'까지 확정된 종가로 120거래일 수익률을 잰다 — 0 미만이면 그 사이클 익절 10%, 아니면 20%.
   정한 값은 그 사이클이 끝날 때까지 간다(별%base·복귀선도 같이 — 통합 규약). 첫 매수 전 아침엔 매일 다시 잰다.
   근거(SOXL 2010~ 실측): 120일 하락 구간에서 시작한 사이클은 10%가 이겼다 — 앞 절반으로 고른 규칙이 뒤 절반에서도 이겼다.
   bars 날짜 오름차순 [{date, close}] · date 사이클 첫 매수일(그날 봉은 안 본다 — 룩어헤드 금지). 자료가 모자라면 null.
   백테 runIM · 앱 장부(computeInf — 운영·모의) · 서버(imCompute) · 5년 플랜(calcInfState)이 같은 글자로 쓴다. */
const IM_AUTOTP={len:120, lo:10, hi:20};
export function imAutoTP(bars, date){
  let a=0, b=(bars||[]).length;
  while(a<b){ const m=(a+b)>>1; if(String(bars[m].date)<date) a=m+1; else b=m; }   // date 보다 앞선 봉 개수
  const j=a-1;
  if(j<IM_AUTOTP.len) return null;
  const x=+bars[j].close, y=+bars[j-IM_AUTOTP.len].close;
  if(!(x>0&&y>0)) return null;
  const r=(x/y-1)*100;
  return {tp:r<0?IM_AUTOTP.lo:IM_AUTOTP.hi, ret:r, asOf:String(bars[j].date)};
}

function exitMulOf(base){ return 1-((base!=null&&base>0)?base:20)/100; }
/* 리버스 종료가 확정됐는가 — 원문 리버스 6-(2): 리버스로 보낸 날의 확정 종가가 평단 대비 −15%(TQQQ)·−20%(SOXL) 위면
   그 다음부터 일반모드. 1일차도 예외가 아니다 (제12차 ②) — 1일차 MOC 를 치른 날 종가가 복귀선 위면 다음 주문부터
   일반모드다. 모의·백테도 1일차 주문 뒤 그날 종가로 판정한다.
   빼는 건 '리버스가 시작되기 전' 종가 하나다 — 장부가 아직 1일차(DAY1)이고 확정 종가 날짜(date)가 소진한 날(revFrom)을
   넘지 않으면 그건 일반모드 마지막 날 종가다. 1일차 매도가 0주(보유÷10 내림)라 장부에 리버스 거래가 안 남아도 날짜가
   넘어가면 1일차 종가로 본다. 날짜를 모르면 1일차 거래가 장부에 있는지로 대신 본다.
   운영 주문표·서버 자동주문·5년 플랜이 같은 글자로 쓴다 (제11차 7): 복귀 기록 버튼을 안 눌러도 다음 주문은 일반모드여야 한다. */
function imRevExitDue(c, close, target, date){ return !!(c && c.reverseActive && (!c.reverseDay1 || !!(date && c.revFrom && date>c.revFrom)) && close>0 && c.avg>0 && close>c.avg*exitMulOf(target)); }
/* 오늘 낼 주문. index.html renderOrder의 일반모드와 같은 순서·같은 값으로 낸다.
   close = 확정 종가(전일 종가). days = 종가 이력(익절 조절용, 없으면 조절 안 함). */
export function imOrders({ st, hist, close, days }) {
  let c = imCompute(st, hist, days);
  const out = [];
  /* 확정 종가가 복귀선 위면 이번 주문은 일반모드 — 장부 끝에 복귀 기록을 가상으로 얹어 다시 센다 (앱 renderOrder 와 같다 · 제11차 7).
     그래도 T > 분할−1 이면 새 리버스 1일차라 아래에서 건너뛴다(리버스 자동주문 미지원). */
  const closeDate = (days && days.length) ? String(days[days.length - 1].date || "") : "";   // days 의 마지막 봉 = 그 확정 종가
  if (imRevExitDue(c, close, c.tp, closeDate)) c = imCompute(st, [...(hist || []), { date: closeDate, kind: "리버스복귀", price: close, qty: 0, virtual: true }], days);
  if (c.reverseActive) return { orders: out, skip: "리버스모드 — 자동 주문 미지원", c };
  if (!(close > 0)) return { orders: out, skip: "확정 종가 없음", c };
  /* 익절 자동인데 판정 자료가 없으면 보유 중엔 주문하지 않는다 — 설정값으로 낸 익절·별지점 주문은 되돌릴 수 없다.
     비어 있을 때(첫 매수)는 익절%와 상관없는 큰수 LOC 하나라 그대로 낸다. 앱 주문표는 같은 상태에서 경고를 띄운다. */
  if (st.autoTp === true && !c.tpAuto && c.qty > 0) return { orders: out, skip: "익절 자동 — 판정 자료(사이클 시작 전날까지 120거래일 종가) 부족", c };

  const B1 = imBuy1(c), buy1 = B1.amt;
  const cur = /^(?:\d{6}|\d{4}[A-Z]\d)$/.test(String(st.ticker || "").toUpperCase()) ? "krw" : "usd";
  const pct = starPct(st.ticker, st.div, c.T, c.tp);   // 이번 사이클 익절% 기준 (익절 자동 · 실험 — 꺼져 있으면 설정값)
  const star = c.avg > 0 ? imStarPx(c.avg, pct, cur) : close;   // 별지점 센트 반올림 — 앱·모의·백테·플랜과 같다 (제10차)
  const buyPt = imBuyPx(star);
  const bigPct = imBigPct(st);
  const limit = close * (1 + bigPct / 100);
  const half = c.T < st.div / 2;

  // 매수 — 앱·모의·백테·플랜과 같은 정식 함수(imBuyOrders). 잔금 안에서만 (7차 점검 ④) · 아래로 LOC 추가.
  const push = (side, kind, tag, price, qty) => { if (qty >= 1 && price > 0) out.push({ side, kind, tag, price, qty }); };
  if (!B1.spent) {
    const first = !(c.avg > 0);
    for (const o of imBuyOrders({ first, half: !first && half, buy1, bal: c.bal, firstPrice: close * (1 + bigPct / 100),
                                  starPrice: buyPt, avg: c.avg, rows: imRowsOf(st), fee: 0, cur }))
      push("buy", o.name, "LOC", o.price, o.q);
  }

  // 매도
  if (c.qty > 0) {
    let effTarget = c.tp;
    if (st.tgtDyn === true) { const m = imMomOf(days); if (m != null) effTarget = imTgtOf(c.tp, m); }
    const qSell = Math.floor(c.qty / 4);
    if (qSell > 0) push("sell", "쿼터매도 (¼·별지점)", "LOC", star, qSell);
    push("sell", "지정가매도 (나머지)", "지정가", c.avg * (1 + effTarget / 100), c.qty - qSell);
  }
  return { orders: out, skip: null, c };
}
