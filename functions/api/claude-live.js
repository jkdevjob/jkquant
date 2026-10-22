// Cloudflare Pages Function — GET /api/claude-live
// 단타(클로드) 탭별 "오늘 모의 매매이력" (장중 실시간). 읽기 전용 — 주문 경로 없음.
//  ① 시초가 · ② 데이트레이딩: opening-scheduler Worker 의 오늘 gapdown ledger(KIS 모의투자 주문·체결 원본)를
//     서버에서 감시키로 읽어 가격·시각·손익만 돌려준다(주문번호·수량·키는 내보내지 않는다).
//  ③ 코인 · ④ 미국: 전날 확정 판단(scalping-data claude-lab/*-decisions.csv)과 현재 시세로 오늘 손익을 계산한다.
// 확정 결과는 밤 workflow 의 모의투자 장부(claude-paper)가 따로 남긴다. 이 응답은 화면 표시용이다.

import { claudeAuthorized } from "./_claude_auth.js";
import { MAIN_DEFAULT, coinDaysNeeded, loadMainEvents, mainFor, openingCounts, openingPick } from "./_claude_main.js";
import { krxDay } from "./_krx_calendar.js";
const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const WORKER="https://jkquant-opening-scheduler.mumae4.workers.dev";
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
const KR_COST=0.23, ETF_COST=0.13, COIN_COST=0.14, US_COST=0.20;   // 왕복 비용 %(연구와 같은 값)
const COIN_STOP_SLIP=0.1, COIN_ENTRY_SLIP=0.05;                  // 손절폭·추세 평균·자금은 그날 ③ 메인 변수(_claude_main.js)

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
export function kstToday(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:+g("hour")*100+ +g("minute")};
}
const pct=(a,b)=>a>0&&b>0?(a/b-1)*100:null;

export async function ledger(env,date,path="/gapdown"){
  const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!key)return null;
  try{
    const r=await fetch(WORKER+path+"?date="+encodeURIComponent(date),{headers:{"x-monitor-key":key}});
    const j=await r.json().catch(()=>({}));
    return r.ok&&j.ok?j.ledger:null;
  }catch(e){return null;}
}
function stages(l){
  const m={};
  for(const e of (l&&Array.isArray(l.events)?l.events:[]))if(e&&e.stage)m[e.stage]=e.payload||{};
  return m;
}
export async function quote(origin,sym){
  try{
    const r=await fetch(origin+"/api/quote?symbol="+encodeURIComponent(sym)+"&range=5d",{headers:{Accept:"application/json"}});
    const j=await r.json();
    return r.ok&&j.price?j:null;
  }catch(e){return null;}
}
async function csvLast(path,n=2){
  try{
    const r=await fetch(RAW+path+"?t="+Date.now());
    if(!r.ok)return [];
    const lines=(await r.text()).trim().split("\n");
    const head=lines[0].split(",");
    return lines.slice(-n).map(l=>{const v=l.split(",");return Object.fromEntries(head.map((h,i)=>[h,v[i]]));});
  }catch(e){return [];}
}

// ── 정산 기준(2026-10-22 사용자: "모의계좌로 판단하지 말고 그냥 모의계좌에 주문한 건으로 정산해야지 · 지금은 모의계좌가 안 되니까") ──
// ①②⑤ 손익은 모의투자 체결 여부와 상관없이 '전략이 낸 주문'(그날 메인이 고른 종목 · 신호)을 공식 시가 · 종가로 정산한다
// (장 마감 전이면 지금 가격으로 평가). 비용은 밤 계산과 같은 식(① 0.23% + 1.5틱 × 2 · ② 0.03% + 2틱 · ⑤ 0.03% + 반 호가).
// 모의투자 체결 · 거절은 측정용으로 줄에 같이 적기만 한다(vts). 시세는 /api/quote(국내 = 네이버 일봉) 그날 봉.
export const SETTLE_BASIS="orders";
export function etfRuleCost(p){p=+p;return 0.03+2*(p>=2000?5:1)/p*100;}
export const barOn=(q,d)=>((q&&q.ohlc)||[]).find(x=>x.date===d)||null;
// 모의투자 측정용 한 줄 — 정산에는 쓰지 않는다
export function vtsNote(o,fill,skipped=""){
  if(!o||!o.vts)return skipped?"모의계좌 주문 안 함("+skipped+") — 시세로 정산":"";
  if(!o.vts.ok)return "모의계좌 주문 안 됨("+String(o.vts.msg||"").replace(/^매수 생략 — /,"").replace(/ · 계획.*$/,"")+") — 시세로 정산";
  return fill&&fill.qty>0?"모의계좌 체결 "+fill.qty+"주 · "+Math.round(+fill.avgPrice).toLocaleString("en-US")+"원":"모의계좌 주문 접수";
}
// ① 시초가: 08:59 장전 동시호가 매수 → 15:30 종가 매도 — 주문한 종목을 그날 공식 시가 → 종가로.
// bars: {종목: 그날 일봉 {open, close}} · hm: 지금 한국시각(HHMM). 시가 전이면 08:58 예상가(손익 없음), 장중이면 지금 가격으로 평가.
export function openingRows(st,prices,bars={},hm=2400){
  const pre=st.preopen||{},rec=st.reconcile||st.close||{};
  const pos=Object.fromEntries((rec.positions||[]).map(p=>[p.code,p]));
  const ord=Object.fromEntries((pre.orders||[]).filter(o=>o.side==="buy").map(o=>[o.code,o]));
  return (pre.picks||[]).map(p=>{
    const b=(bars||{})[p.code]||{},o=ord[p.code]||{},opened=hm>=900&&+b.open>0,closed=opened&&hm>=1531&&+b.close>0;
    const buy=opened?+b.open:(p.expectedPrice||null),sell=closed?+b.close:null,now=sell||prices[p.code]||null;
    const note=vtsNote(o,(pos[p.code]||{}).buy,pre.ordersSkipped);
    return {code:p.code,name:p.name||p.code,buyTime:"09:00 시가",buyPrice:buy,buyPriceKind:opened?"시가":"예상",
      sellTime:closed?"15:30 종가":null,sellPrice:sell,nowPrice:now,status:!opened?"매수 예정(09:00 시가)":closed?"청산":"보유중",
      pnlPct:opened&&now?pct(now,buy)-d1CostPct(buy):null,realized:closed,expectedGapPct:p.expectedGapPct,vts:note,note};
  });
}
// ② ETF: 전날 15:21 신호(종가 매수 주문) → 오늘 09:00 시가 매도 · 오늘 15:21 신호면 종가 매수(오버나잇) — 주문한 건을 공식 종가 → 다음 날 시가로.
// bars: {날짜: 233740 일봉} · hm: 지금 한국시각 · today: 오늘 날짜.
export function etfRows(todaySt,prevSt,prevDate,nowPrice,bars={},hm=2400,today=""){
  const rows=[],bar=d=>(bars||{})[d]||{};
  const buyPrev=prevSt&&prevSt.etf_buy;
  if(buyPrev&&buyPrev.signal){
    const bc=+bar(prevDate).close,bp=bc>0?bc:+((buyPrev.quote||{}).expectedPrice)||null,sp=hm>=900&&+bar(today).open>0?+bar(today).open:null;
    const note=vtsNote(buyPrev.order,((prevSt.etf_reconcile||{}).fills||{}).closeBuy,buyPrev.ordersSkipped);
    rows.push({code:"233740",name:"KODEX 코스닥150레버리지",buyTime:prevDate+" 15:30 종가",buyPrice:bp,buyPriceKind:bc>0?"종가":"예상",
      sellTime:"오늘 09:00 시가",sellPrice:sp,nowPrice:nowPrice,status:sp?"청산":"매도 예정(09:00 시가)",
      pnlPct:bp&&sp?pct(sp,bp)-etfRuleCost(bp):null,realized:!!sp,vts:note,note});
  }
  const buy=todaySt.etf_buy;
  if(buy){
    if(buy.signal){
      const bc=hm>=1531?+bar(today).close:0,bp=bc>0?bc:+((buy.quote||{}).expectedPrice)||null;
      const note=vtsNote(buy.order,((todaySt.etf_reconcile||{}).fills||{}).closeBuy,buy.ordersSkipped);
      rows.push({code:"233740",name:"KODEX 코스닥150레버리지",buyTime:"오늘 15:30 종가",buyPrice:bp,buyPriceKind:bc>0?"종가":"예상",
        sellTime:"다음 거래일 09:00 시가",sellPrice:null,nowPrice:nowPrice,status:"보유중(오버나잇)",
        pnlPct:null,realized:false,dropPct:buy.dropPct,vts:note,note});
    }else if(buy.decisionReason==="krx_holiday")rows.push({code:"233740",name:"KODEX 코스닥150레버리지",status:"매매 없음",note:"국내 휴장일"});
    else rows.push({code:"233740",name:"KODEX 코스닥150레버리지",status:"매매 없음",note:"15:21 예상 하락 "+(buy.dropPct==null?"—":buy.dropPct.toFixed(2)+"%")+" (기준 "+String((buy.rule&&buy.rule.dropMaxPct)??-3).replace("-","−")+"% 이하)"});
  }
  return rows;
}
// ⑤ 종가 30분: 오늘 15:00 판단 · 매수 → 15:30 종가 동시호가 매도(당일 청산). 비용은 밤 계산 close30_trades 와 같은 식 —
// 수수료 0.015%×2 + 15:00 매수 반 호가(종가 동시호가 매도는 호가 비용 없음). 모의투자 체결가에도 같은 값을 뺀다(② 와 같은 보수적 처리).
export function c30CostPct(px){px=+px;return px>0?0.03+((px>=2000?5:1)/2)/px*100:0.03;}
const C30_NAME="KODEX 코스닥150레버리지";
const sgn=v=>v==null||!isFinite(v)?"—":(v>=0?"+":"")+(+v).toFixed(2)+"%";
export function close30Rows(st,nowPrice,bar={},hm=2400){
  const buy=st.c30_buy;
  if(!buy)return [];
  if(buy.decisionReason==="krx_holiday")return [{code:"233740",name:C30_NAME,status:"매매 없음",note:"국내 휴장일"}];
  const th=String((buy.rule&&buy.rule.th)??0).replace("-","−");
  if(!buy.signal)return [{code:"233740",name:C30_NAME,status:"매매 없음",sofarPct:buy.sofarPct,
    note:buy.decisionReason==="price_missing"||String(buy.decisionReason||"").startsWith("quote_failed")?"15:00 가격을 못 받음 — "+String(buy.decisionReason||""):"15:00 전일 대비 "+sgn(buy.sofarPct)+" (기준 "+th+"% 미만 아님)"}];
  // 주문한 건(15:00 신호)을 15:00 판단 가격 → 공식 종가로(모의투자 체결과 상관없이)
  const bp=+((buy.quote||{}).price)||null,sp=hm>=1531&&+(bar||{}).close>0?+bar.close:null,ref=sp||nowPrice;
  const note=vtsNote(buy.order,((st.c30_reconcile||{}).fills||{}).buy,buy.ordersSkipped);
  return [{code:"233740",name:C30_NAME,buyTime:"오늘 15:00",buyPrice:bp,buyPriceKind:"15:00 가격",sellTime:"오늘 15:30 종가",sellPrice:sp,nowPrice,status:sp?"청산":"보유중",
    pnlPct:bp&&ref?pct(ref,bp)-c30CostPct(bp):null,realized:!!sp,sofarPct:buy.sofarPct,vts:note,note}];
}
// ③ 코인 하루 단타: 어제 확정 종가 > 20일 평균(어제 포함)인 날, 오늘 60분봉 고가가 어제 고가를 넘는 첫 봉에서 매수 → 다음 날 09:00 매도.
// 추세 판단 = 어제까지 확정된 20개 종가의 평균 < 어제 종가. candles: 업비트 일봉 최신순(0 = 진행 중인 오늘). claude_lab.coin_breakout 과 같은 규칙.
// p: 그날 ③ 메인 변수(ma · level prevhigh=최근 hiN일 고가(1=어제 고가) / vb=오늘 시가+k×어제 폭). 두 번째 인자가 숫자면 옛 호출(ma 만).
export function coinHoldToday(candles,p=MAIN_DEFAULT.crypto.params){
  if(typeof p==="number")p={...MAIN_DEFAULT.crypto.params,ma:p};
  const ma=p.ma,c=Array.isArray(candles)?candles:[];
  const done=c.slice(1,1+ma).map(x=>+x.trade_price);
  if(done.length<ma||done.some(x=>!(x>0)))return null;
  const avg=done.reduce((a,b)=>a+b,0)/ma,y=c[1],hn=p.level==="vb"?1:Math.max(1,+p.hiN||1);
  const highs=c.slice(1,1+hn).map(x=>+x.high_price);
  if(highs.length<hn||highs.some(x=>!(x>0)))return null;
  const level=p.level==="vb"?+c[0].opening_price+p.k*(+y.high_price-+y.low_price):Math.max(...highs);
  return {hold:done[0]>avg,prevClose:done[0],ma:avg,maDays:ma,level,levelKind:p.level,hiN:hn,basedOn:String(y.candle_date_time_kst||"").slice(0,10)};
}
// day: 그날(09:00 시작) 판단 + 그날 60분봉(오래된 순) → 매수 시각·가격·손절·손익. last: 지금 가격(진행 중) 또는 그날 마지막 봉 종가(확정).
// 밤 계산 coin_breakout 과 같은 규칙: 업비트 하루(09:00~)의 봉을 순서대로 보며, lastEntryHour 시(밤) 이후 봉에 오면 그날은 더 사지 않는다.
export function coinBreakoutDay(h,bars,last,p=MAIN_DEFAULT.crypto.params){
  if(!h)return null;
  const lv=h.levelKind==="vb"?"기준선(시가+"+p.k+"×어제 폭)":(h.hiN>1?"최근 "+h.hiN+"일 고가":"어제 고가"),stopPct=+p.stopPct;
  if(!h.hold)return {hold:false,action:"쉼",status:"쉼 — 어제 종가가 "+(h.maDays||p.ma)+"일 평균 아래",pnlPct:0,level:h.level};
  const hourOf=b=>+String(b.candle_date_time_kst||"").slice(11,13);
  let i=-1;
  for(let k=0;k<(bars||[]).length;k++){
    const hh=hourOf(bars[k]),kk=(hh-9+24)%24;
    if(p.lastEntryHour!=null&&hh>=p.lastEntryHour&&kk<15)break;               // 밤 돌파는 사지 않는다
    if(+bars[k].high_price>h.level){i=k;break;}
  }
  if(i<0)return {hold:false,action:"돌파 없음",status:"돌파 대기 — "+lv+" "+Math.round(h.level).toLocaleString("en-US")+" 넘으면 매수"+(p.lastEntryHour!=null?" ("+p.lastEntryHour+"시 전까지)":""),pnlPct:0,level:h.level};
  const b=bars[i],entry=Math.max(+b.opening_price,h.level)*(1+COIN_ENTRY_SLIP/100),stop=entry*(1-stopPct/100);
  const stopped=bars.slice(i).some(x=>+x.low_price<=stop);
  const hm=String(b.candle_date_time_kst||"").slice(11,16);
  return {hold:true,action:stopped?"손절":"돌파 매수",status:stopped?"손절 (−"+stopPct+"%)":"보유중 — "+hm+" 돌파 매수, 다음 09:00 매도",
    buyTime:hm,buyPrice:entry,stopPrice:stop,level:h.level,stopped,
    pnlPct:stopped?(-stopPct-COIN_STOP_SLIP-COIN_COST):(last?pct(last,entry)-COIN_COST:null)};
}
// 60분봉(최신순) 중 업비트 하루 day(YYYY-MM-DD, 09:00 시작)에 속하고 이미 시작한 봉(진행 중 봉 포함 — 실시간 돌파는 그 순간 일어난다)을 오래된 순으로
export function barsOfDay(hourly,day,nowMs=Date.now()){
  const s=Date.parse(day+"T09:00:00+09:00"),e=s+864e5;
  return (Array.isArray(hourly)?hourly:[]).filter(b=>{const t=Date.parse(String(b.candle_date_time_kst)+"+09:00");return t>=s&&t<e&&t<=nowMs;})
    .sort((a,b)=>String(a.candle_date_time_kst).localeCompare(String(b.candle_date_time_kst)));
}
// 탭별 오늘 요약 — 칸 수익률(칸 자금 기준) · 개별 매매 합계 · 거래 수 · 계좌 기여 · 오늘 왜 매매했는지/안 했는지 한 줄
export const ACCOUNT_WEIGHT={opening:0.3,daytrading:0.3,crypto:0.3,soxl:0.4,close30:0.3};
export const KR_TABS=["opening","daytrading","close30"];          // 국내 칸(30%)을 나눠 쓰는 탭
const GAP_REASON={krx_holiday:"국내 휴장일 — 시세 조회·주문 없음",no_expected_gap_down:"명단 종목 중 예상 갭 −2%~−29% 인 종목 없음",no_expected_prices:"08:56 예상체결가를 못 받음(점검)",
  watchlist_stale:"명단이 오래됨 — 밤 계산 점검",watchlist_invalid:"명단 파일 오류 — 점검",watchlist_not_before_today:"명단 기준일 오류 — 점검",watchlist_rule_missing:"명단 규칙 없음 — 점검"};
export function todaySummary(tab,t,hm){
  t=t||{};
  const rows=t.rows||[],v=rows.filter(r=>r.pnlPct!=null).map(r=>r.pnlPct),sum=v.reduce((a,b)=>a+b,0);
  let tabPct=0,trades=0,why="";
  if(tab==="opening"){
    // 그날 ① 메인: 통과 종목 수(minQ) 이상이면 매매일, 장부에는 깊은 갭 topK(gapMax 이하) 종목만. 주문은 깊은 3종목 그대로(나머지는 측정용).
    const P=(t.main&&t.main.params)||MAIN_DEFAULT.opening.params,isDef=!t.main||t.main.version===MAIN_DEFAULT.opening.version,lab=isDef?"v2 매매일":"메인 매매일";
    const d=t.decision,b=d&&d.breadth,counts=b?openingCounts(P,b.qualified):false;
    const keep=new Set(openingPick(P,rows)),use=counts?rows.filter(r=>keep.has(String(r.code))):rows;
    // 정산은 주문한 종목 전부(모의투자 체결과 상관없이 — 2026-10-22 사용자). 하루 마감 장부(_claude_day openingDay)와 같은 종목 · 같은 식.
    const uv=use.filter(r=>r.pnlPct!=null).map(r=>r.pnlPct),us=uv.reduce((a,x)=>a+x,0);
    const nv=use.filter(r=>/^모의계좌 주문 안/.test(r.vts||"")).length;trades=use.length;tabPct=uv.length?us/uv.length:0;
    if(rows.length&&b&&!counts){                     // 메인 기준 매매일이 아니면 측정용 주문 — 칸 수익률·계좌에 넣지 않는다(장부와 같게)
      const w=ACCOUNT_WEIGHT[tab];
      return {tabPct:0,sumPct:0,trades:0,accountPct:0,weight:w,noTrade:true,wins:0,losses:0,measurePct:tabPct,
        why:lab+" 아님(통과 "+b.qualified+"<"+P.minQ+") — 측정용 모의 매수 "+rows.length+"종목 "+(uv.length?(tabPct>=0?"+":"")+tabPct.toFixed(2)+"%":"")+" (칸 수익률에는 안 셈)"};
    }
    if(rows.length)why=(b&&counts?lab+"(통과 "+b.qualified+"종목) — ":"측정용 매수("+lab+" 아님"+(b?": 통과 "+b.qualified+"<"+P.minQ:"")+") — ")+"갭 깊은 "+rows.length+"종목 모의 매수"+
      (use.length<rows.length?" · 장부에는 "+use.length+"종목(메인: 깊은 "+P.topK+"종목"+(P.gapMax!=null?" · 갭 "+P.gapMax+"% 이하":"")+")":"")+(nv?" · 모의계좌 주문 안 됨 "+nv+"건(시세로 정산)":"");
    const done=use.filter(r=>r.pnlPct!=null);
    if(rows.length){const w=ACCOUNT_WEIGHT[tab];return {tabPct,sumPct:us,trades,accountPct:tabPct*w,weight:w,noTrade:trades===0,why,
      wins:done.filter(r=>r.pnlPct>0).length,losses:done.filter(r=>r.pnlPct<=0).length};}
    else if(!d)why=hm<859?"08:58 판단 전":"오늘 판단 기록 없음(휴장일이 아니면 점검)";
    else why=GAP_REASON[d.reason]||("매매 없음 — "+(d.reason||"조건 맞는 종목 없음"));
  }else if(tab==="daytrading"){
    trades=rows.filter(r=>r.buyPrice!=null).length;tabPct=sum;
    const today=rows.find(r=>String(r.buyTime||"").startsWith("오늘")),none=rows.find(r=>r.status==="매매 없음");
    const held=rows.find(r=>String(r.sellTime||"").includes("오늘"));
    why=(held?"전날 종가 매수분 오늘 시가 매도("+held.status+") · ":"")+
      (today?"오늘 종가 매수("+today.status+")":none?"오늘 매수 없음 — "+none.note:hm<1521?"15:21 판단 전":"오늘 판단 기록 없음");
  }else if(tab==="close30"){
    const r=rows[0];
    trades=rows.filter(r=>r.buyPrice!=null).length;tabPct=trades?sum:0;
    why=!r?(hm<1500?"15:00 판단 전":"오늘 판단 기록 없음(휴장일이 아니면 점검)"):r.status==="매매 없음"?"오늘 매수 없음 — "+(r.note||""):
      "15:00 전일 대비 "+sgn(r.sofarPct)+" → 매수("+r.status+")"+(/^모의계좌 주문 안/.test(r.vts||"")?" · "+r.vts:"");
  }else if(tab==="crypto"){
    trades=rows.filter(r=>r.hold).length;tabPct=t.basketPct==null?0:t.basketPct;
    why=rows.map(r=>r.name+" "+(r.status||"")).join(" · ")||"시세 없음";
  }else if(tab==="soxl"){
    const u=rows[0]||{};trades=u.hold||u.realized?1:0;tabPct=u.pnlPct==null?0:u.pnlPct;
    why=u.hold==null&&!u.realized?"판단 없음(밤 계산 점검)":u.status+(u.session?" · "+u.session:"");
  }
  const w=ACCOUNT_WEIGHT[tab]||0;
  const done=rows.filter(r=>r.pnlPct!=null&&(r.buyPrice!=null||r.sellPrice!=null||r.hold===true));
  return {tabPct,sumPct:sum,trades,accountPct:tabPct*w,weight:w,noTrade:trades===0,why,
    wins:done.filter(r=>r.pnlPct>0).length,losses:done.filter(r=>r.pnlPct<=0).length};
}
// 국내 칸(30%)은 ①②⑤ 중 그날 매매한 탭끼리 똑같이 나눠 쓴다(둘이면 반씩 · 셋이면 3분의 1씩 — 백테 combine_same_capital 과 같은 규칙)
export function applyKrSplit(tabs){
  const q=KR_TABS.map(k=>tabs[k]&&tabs[k].today).filter(x=>x&&!x.noTrade);
  if(q.length>1)for(const x of q){x.weight=ACCOUNT_WEIGHT.opening/q.length;x.accountPct=x.tabPct*x.weight;x.krShared=true;}
  return tabs;
}
// ④ 지금 상태: 밤 판단(nx.basedOn 종가)보다 뒤 세션이면 그 세션 시가에 할 일이 실행된 것으로 본다(모의).
export function soxlLive(nx,q,last){
  const row={code:"SOXL",name:"SOXL",hold:null,status:"판단 없음(밤 계산 점검)",pnlPct:null,realized:false};
  const ls=last?{date:last.date,pnlPct:last.pnlPct===""||last.pnlPct==null?null:+last.pnlPct,action:last.action}:null;
  row.lastSession=ls;
  if(!nx||nx.action===undefined||!(nx.close>0)||!(nx.ma>0||nx.maDays===0))return row;   // 밤 계산이 SOXL 판단을 아직 안 냈으면(옛 형식 포함) 판단 없음 · 평균 조건 없는 메인은 ma 가 비어 있다
  const ohlc=(q&&q.ohlc)||[],sess=ohlc[ohlc.length-1]||null,intra=q&&q.intraday;
  const now=intra&&(intra.regular||intra.post||intra.pre)?(intra.post||intra.regular||intra.pre).c:(q&&q.price)||null;
  const session=intra&&intra.post?"애프터마켓":intra&&intra.regular?"정규장":intra&&intra.pre?"프리마켓":"장 마감";
  Object.assign(row,{signalBasedOn:nx.basedOn,rsi2:nx.rsi2,ma200:nx.ma,signalClose:nx.close,nowPrice:now,session});
  const started=!!(sess&&sess.date>nx.basedOn&&sess.open>0);
  const half=0.1;
  if(nx.action==="buy"){
    row.hold=true;
    if(started){Object.assign(row,{status:"보유중 (시가 매수)",buyTime:sess.date+" 시가",buyPrice:sess.open,pnlPct:now?pct(now,sess.open)-half:null});}
    else Object.assign(row,{status:"다음 미국장 시가 매수 예정",buyTime:"다음 미국장 시가"});
  }else if(nx.action==="sell"){
    row.hold=false;
    if(started)Object.assign(row,{status:"청산 (시가 매도)",sellTime:sess.date+" 시가",sellPrice:sess.open,pnlPct:pct(sess.open,nx.close)-half,realized:true});
    else Object.assign(row,{status:"다음 미국장 시가 매도 예정 ("+nx.heldDays+"일 보유)",sellTime:"다음 미국장 시가",pnlPct:null});
  }else if(nx.holding){
    row.hold=true;
    Object.assign(row,{status:"보유중 "+(nx.heldDays+(started?1:0))+"일째 (최대 "+(nx.maxHoldDays||5)+"일)",pnlPct:started&&now?pct(now,nx.close):null});
  }else{
    row.hold=false;
    const rn=nx.rsiN||2,rmax=nx.rsiMax??20,md=nx.maDays??200,above=!md||nx.close>nx.ma;
    Object.assign(row,{status:"쉼 — "+(nx.why?nx.why:above?"과매도 아님 (RSI("+rn+") "+(+nx.rsi2).toFixed(0)+" ≥ "+rmax+")":md+"일 평균 아래"),pnlPct:0});   // 밤 계산이 안 맞은 조건을 적어 준다(옛 형식이면 RSI 문구)
  }
  return row;
}
// ── 📅 오늘 탭 전일·당일 칸 — 밤 계산이 확정하기 전에도 지금 아는 값으로 채운다 ──
// 밤 계산(claude_lab daily_board)의 칸과 같은 날짜 · 같은 정의(칸 자금 기준 순손익 %)다. 화면은 밤 계산 확정 값이 있으면 그것을 먼저 쓰고,
// 없을 때만 이 값을 '확정 전'으로 보인다. 칸: {v: 숫자 | "no_trade" | "holiday", final: 그날 매매가 끝났는지,
// src: "vts"(KIS 모의투자 체결 · 마감 장부) | "rule"(규칙 · 시세 계산), trades, wins, losses, note}. 주문·알림 경로는 이 값을 읽지 않는다.
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function addDays(d,n){return new Date(Date.parse(d+"T00:00:00Z")+n*864e5).toISOString().slice(0,10);}
export function prevKrDay(d){let x=d;for(let i=0;i<15;i++){x=addDays(x,-1);if(!krxDay(x).closed)return x;}return null;}
function wl(xs){return {wins:xs.filter(x=>x>0).length,losses:xs.filter(x=>x<=0).length};}
// ① 규칙 칸 — 메인 매매일인데 모의투자 체결이 하나도 없는 날(계좌 현금 부족 · 주문 거절).
// 2026-10-22: 매수가능 0원이라 메인 3종목을 모두 못 샀는데 칸이 '매매없음'으로 보였다. 밤 계산은 그날을 규칙(연구 signals 의 pnl)으로 매매일로 센다 →
// 같은 식으로: 메인이 고른 종목(깊은 갭 topK · gapMax 이하)의 그날 시가 → 종가(장 마감 전이면 지금 가격) − (0.23% + 1.5틱 × 2), 종목 평균.
// bars: {종목코드: {open, close}} · final: 그날 종가가 확정됐는지. 메인 매매일이 아니거나 가격이 하나라도 없으면 null.
const KR_TICK=[[2000,1],[5000,5],[20000,10],[50000,50],[200000,100],[500000,500]];
export function krTick(p){for(const [u,t] of KR_TICK)if(p<u)return t;return 1000;}
export function d1CostPct(p){return 0.23+2*1.5*krTick(p)/p*100;}
export function openingRuleCell(pre,P,bars,final){
  const b=pre&&pre.breadth;
  if(!b||b.qualified==null||!openingCounts(P,b.qualified))return null;
  const keep=openingPick(P,pre.picks||[]);
  if(!keep.length)return null;
  const v=[];
  for(const c of keep){const x=(bars||{})[c]||{};if(!(+x.open>0&&+x.close>0))return null;v.push(pct(+x.close,+x.open)-d1CostPct(+x.open));}
  const failed=(pre.orders||[]).filter(o=>o&&o.side==="buy"&&keep.includes(String(o.code))&&!(o.vts&&o.vts.ok));
  const why=failed.length?String((failed[0].vts||{}).msg||"").replace(/^매수 생략 — /,"").replace(/ · 계획.*$/,""):"";
  return {v:avg(v),final:!!final,src:"rule",trades:v.length,...wl(v),
    note:"모의투자 매수 안 됨"+(failed.length?"("+failed.length+"종목"+(why?" · "+why:"")+")":"")+" — 규칙대로 계산"};
}
// ① 마감 장부(15:40 체결 조회 뒤 Worker 가 한 번 저장) → 칸. 메인이 고른 종목만(측정용 제외) · 종목 균등(밤 계산 칸과 같은 평균).
// rule: 위 규칙 칸 — 체결이 하나도 없는 날에만 쓴다(체결이 있으면 모의투자 체결로).
export function openingClosedCell(c,rule=null){
  if(!c)return null;
  if(c.status==="holiday")return {v:"holiday",final:true,src:"vts"};
  if(c.basis===SETTLE_BASIS){                                              // 주문 정산 장부(2026-10-22~) — 장부가 적은 그날 값 그대로
    const tv=(c.trades||[]).map(x=>x.pnlPct).filter(x=>x!=null);
    if(c.dayPct==null)return c.settled===false?null:{v:"no_trade",final:true,src:"rule",trades:0,note:c.note||""};
    return {v:c.dayPct,final:true,src:"rule",trades:tv.length,...wl(tv),note:c.warn||""};
  }
  const t=(c.trades||[]).filter(x=>x.pnlPct!=null),o=(c.open||[]).filter(x=>x.pnlPct!=null),all=t.concat(o).map(x=>x.pnlPct);
  if(!all.length)return rule||{v:"no_trade",final:true,src:"vts",trades:0,note:c.note||""};
  return {v:avg(all),final:!o.length,src:"vts",trades:all.length,...wl(all),note:o.length?"매도 미체결 "+o.length+"건 — 시세로 평가":""};
}
// ① 오늘: 마감 장부가 있으면 그것, 없으면 08:56 판단 뒤의 오늘 요약(장중 체결가 · 현재가)
export function openingTodayCell(t,closed,holiday,rule=null){
  if(holiday)return {v:"holiday",final:true,src:"vts"};
  const c=openingClosedCell(closed,rule);if(c)return c;
  const q=t&&t.today;
  if(!t||!t.decision||!q)return null;                                    // 08:56 판단 전
  if(q.noTrade)return rule||{v:"no_trade",final:true,src:"vts",trades:0,note:q.why||""};
  return {v:q.tabPct,final:false,src:"rule",trades:q.trades,wins:q.wins,losses:q.losses};   // 매매 근거는 ① 탭에(칸은 짧게)
}
// ② 칸 d = 매수일(d 의 직전 거래일) 종가에 사서 d 아침 시가에 판 결과 — 밤 계산 ETF 칸과 같은 식(claude_lab etf_variant):
// (d 시가 ÷ 매수일 종가 − 1) − (0.03% + 2틱). 매수했는지는 매수일 15:21 판단(signal) — 모의투자 매수가 안 됐어도(현금 부족 등) 규칙 결과를 보이고 그 사실을 적는다.
// buySt · sellSt: 매수일 · d 의 장부 단계, bars: {buyClose, sellOpen} 233740 일봉 값(없으면 체결가 → 15:21 예상가로 대신하고 적는다)
export function etfDayCell(buySt,sellSt,bars,holiday){
  if(holiday)return {v:"holiday",final:true,src:"vts"};
  const b=buySt&&buySt.etf_buy;
  if(!b)return null;                                                     // 매수일 15:21 판단 기록이 없으면 모른다
  if(!b.signal)return {v:"no_trade",final:true,src:"vts",trades:0,note:"전날 15:21 매수 신호 없음"};
  const bf=((buySt.etf_reconcile||{}).fills||{}).closeBuy||{},sf=(((sellSt||{}).etf_reconcile||{}).fills||{}).openSell||{};
  const bc=+((bars||{}).buyClose)||(bf.qty>0?+bf.avgPrice:+((b.quote||{}).expectedPrice)),so=+((bars||{}).sellOpen)||(sf.qty>0?+sf.avgPrice:0);
  if(!(bc>0&&so>0))return null;                                          // 시가 전이거나 값이 없다
  const tick=bc>=2000?5:1,v=pct(so,bc)-(0.03+2*tick/bc*100),notes=[];
  if(!(bf.qty>0))notes.push("모의투자 매수 안 됨 — 규칙대로 계산");
  if(!(+((bars||{}).buyClose)>0))notes.push("매수일 종가 대신 "+(bf.qty>0?"체결가":"15:21 예상가"));
  return {v,final:true,src:"rule",trades:1,...wl([v]),note:notes.join(" · ")};
}
// ⑤ 칸 d = d 15:00 매수 → d 15:30 종가 매도 — 밤 계산 close30 칸과 같은 식: (종가 ÷ 15:00 가격 − 1) − (0.03% + 반 호가).
// 15:00 가격 = 그날 15:00 판단 때 받은 가격(c30_buy.quote.price) · 종가 = 15:40 체결 조회의 종가 동시호가 매도 체결가 또는 그날 일봉 종가(close).
// 종가 전이면 지금 가격(now)으로 평가하고 '확정 전'. 매수 신호가 났는데 모의투자 매수가 안 됐어도(현금 부족 등) 규칙 결과를 보이고 그 사실을 적는다.
export function close30DayCell(st,px,holiday){
  if(holiday)return {v:"holiday",final:true,src:"vts"};
  const b=st&&st.c30_buy;
  if(!b)return null;                                                     // 15:00 판단 전 · 기록 없음
  if(b.decisionReason==="krx_holiday")return {v:"holiday",final:true,src:"vts"};
  if(!b.signal)return {v:"no_trade",final:true,src:"vts",trades:0,note:"15:00 매수 신호 없음"};
  const f=(st.c30_reconcile||{}).fills||{},sf=f.sell||{},bf=f.buy||{};
  const p15=+((b.quote||{}).price)||0,close=+((px||{}).close)||(sf.qty>0?+sf.avgPrice:0),now=+((px||{}).now)||0,ref=close||now;
  if(!(p15>0&&ref>0))return null;
  const v=pct(ref,p15)-c30CostPct(p15),notes=[];
  if(st.c30_reconcile&&!(bf.qty>0))notes.push("모의투자 매수 안 됨 — 규칙대로 계산");
  if(!close)notes.push("15:30 종가 전 — 지금 가격으로 평가");
  return {v,final:!!close,src:"rule",trades:1,...wl([v]),note:notes.join(" · ")};
}
// ③ 칸 ud = 업비트 하루 ud(ud 09:00 ~ 다음 날 09:00, 매수한 날) — 밤 계산 코인 칸과 같은 정의(코인 평균 × 칸 자금 비율).
// 끝난 하루는 마지막 봉 종가(다음 날 09:00)로, 진행 중이면 지금 봉 종가(현재가)로 평가. coins: [{market, daily(최신순), hourly(최신순)}]
export function coinDayCell(ud,coins,P,nowMs=Date.now()){
  const s=Date.parse(ud+"T09:00:00+09:00"),final=nowMs>=s+864e5,pnl=[],why=[];
  const end=P.lastEntryHour!=null?s+((+P.lastEntryHour-9+24)%24)*36e5:s+864e5;   // 그날 새로 살 수 있는 마지막 시각(밤 돌파 금지면 그 시각)
  let open=false;                                                        // 아직 돌파 매수가 일어날 수 있는 코인이 있나
  if(nowMs<s)return null;                                                // 그 하루가 아직 시작 전
  for(const m of P.markets){
    const c=(coins||[]).find(x=>x.market===m),daily=Array.isArray(c&&c.daily)?c.daily:[];
    const i=daily.findIndex(x=>String(x.candle_date_time_kst||"").slice(0,10)===ud);
    if(i<0)return null;
    const h=coinHoldToday(daily.slice(i),P);if(!h)return null;
    const bars=barsOfDay(c.hourly,ud,nowMs);
    if(final&&bars.length<24)return null;                                // 끝난 하루인데 봉이 모자라면 계산하지 않는다
    const r=coinBreakoutDay(h,bars,bars.length?+bars[bars.length-1].trade_price:null,P);
    if(r&&r.hold&&r.pnlPct!=null)pnl.push(r.pnlPct);else{why.push(m.replace("KRW-","")+" "+(!r?"판단 없음":r.action==="쉼"?"쉼(추세 평균 아래)":r.action));if(r&&r.action==="돌파 없음"&&nowMs<end)open=true;}
  }
  const by={};for(const w of why){const k=w.slice(w.indexOf(" ")+1);(by[k]=by[k]||[]).push(w.slice(0,w.indexOf(" ")));}   // 같은 이유는 묶는다(BTC·ETH 쉼)
  const reasons=Object.keys(by).map(k=>by[k].join("·")+" "+k).join(" · ");
  // 매수가 없고 더 살 수도 없으면(모두 쉼 · 매수 마감 시각 뒤) 하루가 안 끝났어도 '매매없음'으로 끝난 값 — 2026-10-15 08:33 전일 칸이 '매매 전'으로 보였다(ETH 쉼)
  if(!pnl.length&&!open)return {v:"no_trade",final:true,...(final?{}:{decided:true}),src:"rule",trades:0,note:reasons};
  if(!pnl.length){const u=new Date(end+9*36e5).toISOString();
    return {v:"no_trade",final:false,src:"rule",trades:0,note:"아직 매수 없음 — "+reasons+" · "+u.slice(5,7)+"/"+u.slice(8,10)+" "+u.slice(11,16)+" 전까지 돌파하면 매수"};}
  return {v:pnl.reduce((a,x)=>a+x,0)/P.markets.length*P.tabSize,final,src:"rule",trades:pnl.length,...wl(pnl)};
}
// ④ 칸 d = 전날 밤 미국장(뉴욕 d−1) 하루 손익 × 칸 자금 비율 — 밤 계산 SOXL 칸과 같은 정의:
// 매수일 = 시가→종가 − 비용 절반 · 보유일 = 전날 종가→종가 · 매도일 = 전날 종가→시가 − 비용 절반. 밤 판단(nx) 다음 세션 하나만(그 전은 밤 계산이 확정).
// q: SOXL 시세(일봉 ohlc · 정규장 가격 price · marketState). 정규장 중이면 진행 중. 반환 {date(한국 칸 날짜), cell}
export function soxlDayCell(nx,q,tabSize){
  if(!nx||nx.action===undefined||!(nx.close>0))return null;
  const ohlc=(q&&q.ohlc)||[],sess=ohlc[ohlc.length-1]||null;
  if(!(sess&&sess.date>nx.basedOn&&sess.open>0))return null;            // 밤 판단 뒤 세션이 아직 안 열렸다
  const date=addDays(sess.date,1),open=+sess.open,px=+(q.price||sess.close),final=q.marketState!=="REGULAR",half=US_COST/2;
  let v=null;
  if(nx.action==="buy")v=pct(px,open)-half;
  else if(nx.action==="sell")v=pct(open,+nx.close)-half;
  else if(nx.holding)v=pct(px,+nx.close);
  else return {date,cell:{v:"no_trade",final:true,...(final?{}:{decided:true}),src:"rule",trades:0}};   // 밤 판단이 '살 것 · 가진 것 없음' — 세션 중에도 끝난 값
  if(v==null)return null;
  return {date,cell:{v:v*tabSize,final:nx.action==="sell"||final,src:"rule",trades:1,...wl([v])}};
}
export async function onRequestGet({request,env}){
  if(!(await claudeAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);   // 소유자만(서버끼리는 감시키)
  const origin=new URL(request.url).origin,now=kstToday(),out={ok:true,asOf:new Date().toISOString(),today:now.date,tabs:{}};
  try{
    // 그날 메인 전략(승격 기록) — 못 읽으면 기본 메인으로 보이고 그 사실을 응답에 남긴다
    const cfg=await loadMainEvents(env);
    const mainOf=(tab,d)=>mainFor(cfg.events,tab,d);
    out.main={ok:cfg.ok,error:cfg.error||null,events:cfg.events};
    // ①②
    const [lt,prevs]=await Promise.all([ledger(env,now.date),(async()=>{   // 직전 장부(5일 안) + 그 전 장부(② 어제 칸의 매수일) — 10일 안
      const got=[];
      for(let k=1;k<=10&&got.length<2;k++){if(!got.length&&k>5)break;const d=kstToday(Date.now()-k*864e5).date;const l=await ledger(env,d);if(l&&(l.events||[]).length)got.push({date:d,l});}
      return got;})()]);
    const prev=prevs[0]||null;
    const st=stages(lt),pst=prev?stages(prev.l):{};
    const codes=((st.preopen||{}).picks||[]).map(p=>p.code);
    const qs=await Promise.all([...codes,"233740"].map(c=>quote(origin,c)));
    const prices=Object.fromEntries([...codes,"233740"].map((c,i)=>[c,qs[i]?qs[i].price:null]));
    const pre=st.preopen||null;
    const todayBars=Object.fromEntries([...codes,"233740"].map((c,i)=>[c,barOn(qs[i],now.date)]).filter(x=>x[1]));
    out.tabs.opening={rows:openingRows(st,prices,todayBars,now.hm),decision:pre?{reason:pre.decisionReason,breadth:pre.breadth||null,candidates:pre.candidates,recheck:pre.recheck||null}:null,
      ledgerFound:!!lt,main:mainOf("opening",now.date),
      note:"08:56 예상체결가로 명단 전체 확인 → 08:58 갭 깊은 10종목 다시 확인해 판단 → 08:59 장전 동시호가 매수 → 15:21 종가 동시호가 매도 → 15:40 체결 조회. 매매일은 통과 "+mainOf("opening",now.date).params.minQ+"종목 이상."};
    const m2=mainOf("daytrading",now.date);
    const etfBars={[now.date]:barOn(qs[codes.length],now.date),...(prev?{[prev.date]:barOn(qs[codes.length],prev.date)}:{})};
    out.tabs.daytrading={rows:etfRows(st,pst,prev&&prev.date,prices["233740"],etfBars,now.hm,now.date),ledgerFound:!!lt,main:m2,
      note:"전날 "+String(m2.params.th).replace("-","−")+"% 이하 마감이면 15:21 종가 매수 → 다음 거래일 08:59 시가 매도."};
    const m5=mainOf("close30",now.date),th5=+m5.params.th;
    out.tabs.close30={rows:close30Rows(st,prices["233740"],etfBars[now.date]||{},now.hm),ledgerFound:!!lt,main:m5,
      note:"15:00 에 KODEX 코스닥150레버리지가 전일 종가보다 "+(th5?String(Math.abs(th5))+"% 넘게 ":"")+"내려 있으면 15:00 시장가 매수 → 15:21 종가 동시호가 매도(15:30 종가 체결) → 15:40 체결 조회. 하룻밤 보유 없음. 실험 전략(R14 사후 발견)."};
    // ③
    let ticks={};
    try{const r=await fetch("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH",{headers:{Accept:"application/json"}});for(const t of await r.json())ticks[t.market]=t;}catch(e){}
    const lab=await fetch(RAW+"claude-lab/latest.json?t="+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null);
    // ③ 업비트 하루(09:00 시작) 날짜의 메인 — 09시 전이면 아직 어제 하루
    const ud=kstToday(Date.now()-9*36e5).date,m3=mainOf("crypto",ud),P3=m3.params;
    // 봉은 오늘 탭 어제·오늘 칸의 메인 코인까지 받는다(메인이 바뀐 날 — 예: 10/14 부터 ETH 만 — 어제 칸은 그 전 메인의 BTC 도 필요)
    const Y=addDays(now.date,-1),P3s=[P3,mainOf("crypto",Y).params,mainOf("crypto",now.date).params];
    const nd=Math.min(200,Math.max(...P3s.map(coinDaysNeeded))+3),allM=[...new Set(P3s.flatMap(p=>p.markets))],coinRaw=[];
    const coins=(await Promise.all(allM.map(async m=>{
      const name=m.replace("KRW-",""),mine=P3.markets.includes(m);            // mine: 지금 업비트 하루의 메인 코인(탭 표시) · 아니면 칸 계산용 봉만
      try{
        const [dc,hc]=await Promise.all(["days?market="+m+"&count="+nd,"minutes/60?market="+m+"&count=48"].map(q=>
          fetch("https://api.upbit.com/v1/candles/"+q,{headers:{Accept:"application/json"}}).then(r=>r.json())));
        coinRaw.push({market:m,daily:dc,hourly:hc});
        if(!mine)return null;
        const h=coinHoldToday(dc,P3);
        const day=String((dc[0]||{}).candle_date_time_kst||"").slice(0,10);
        const t=ticks[m],now=t?+t.trade_price:null;
        const r=coinBreakoutDay(h,barsOfDay(hc,day),now,P3);
        return {code:m,name,nowPrice:now,sellTime:"다음 날 09:00",signalBasedOn:h&&h.basedOn,signalClose:h&&h.prevClose,ma20:h&&h.ma,maDays:P3.ma,...(r||{status:"판단 없음"}),
          realized:!!(r&&r.stopped)};
      }catch(e){return mine?{code:m,name,status:"시세 없음",pnlPct:null}:null;}
    }))).filter(Boolean);
    const basket=coins.reduce((s,c)=>s+(c.pnlPct||0),0)/P3.markets.length;
    out.tabs.crypto={rows:coins,basketPct:basket,tabPct:basket*P3.tabSize,main:m3,
      note:"업비트 하루는 09:00 시작. 어제 종가가 "+P3.ma+"일 평균 위인 날만, "+(P3.level==="vb"?"오늘 시가+"+P3.k+"×어제 폭":(P3.hiN>1?"최근 "+P3.hiN+"일 고가":"어제 고가"))+"를 넘는 순간 매수"+
        (P3.lastEntryHour!=null?"("+P3.lastEntryHour+"시 전까지)":"")+" → 다음 날 09:00 매도(24시간 미만). 매수가 대비 −"+P3.stopPct+"% 손절. "+
        (P3.markets.length>1?"두 코인 반반":P3.markets[0].replace("KRW-","")+" 하나")+", 탭 표시 자금 "+Math.round(P3.tabSize*100)+"%."};
    // ④ SOXL 단기 과매도 반등 — 밤 계산(미국장 마감 확정 종가)의 다음 할 일 + 지금 시세
    const us=await quote(origin,"SOXL");
    const nx=((lab&&lab.tabs&&lab.tabs.soxl)||{}).nextSignal||null;
    const sx=await csvLast("claude-lab/soxl-mr-decisions.csv",1);
    const P4=(nx&&nx.rsiMax!=null)?{rsiMax:nx.rsiMax,rsiN:nx.rsiN||2,ma:nx.maDays??200,maxHoldDays:nx.maxHoldDays||5}:MAIN_DEFAULT.soxl.params;
    out.tabs.soxl={rows:[soxlLive(nx,us,sx[0]||null)],main:mainOf("soxl",now.date),
      note:"미국장 마감 확정 종가로 "+(nx&&nx.entryRule?nx.entryRule:"RSI("+P4.rsiN+")<"+P4.rsiMax+(P4.ma?" · "+P4.ma+"일 평균 위":""))+"면 다음 미국장 시가 매수 → 오른 날 다음 시가 매도(최대 "+P4.maxHoldDays+"일). 결과는 한국시각 다음 날 아침에 확정."};
    // 하루 마감 장부(텔레그램 결과와 같은 원본, Worker Durable Object) — ①② 오늘 · ③ 마지막 한국 00:00 마감 · ④ 마지막 미국장 마감
    const claudeL={},claudeLedger=d=>claudeL[d]||(claudeL[d]=ledger(env,d,"/claude"));
    const closedOf=async(k,days)=>{for(const i of days){const d=kstToday(Date.now()-i*864e5).date;const l=await claudeLedger(d);
      const e=((l&&l.events)||[]).find(x=>x&&x.id==="close:"+k);if(e)return e.payload;}return null;};
    const [c1,c2,c3,c4,c1y,c5]=await Promise.all([closedOf("opening",[0]),closedOf("daytrading",[0]),closedOf("crypto",[1,2]),closedOf("soxl",[0,1,2,3,4]),closedOf("opening",[1]),closedOf("close30",[0])]);
    if(out.tabs.opening)out.tabs.opening.closed=c1;
    if(out.tabs.daytrading)out.tabs.daytrading.closed=c2;
    if(out.tabs.close30)out.tabs.close30.closed=c5;
    if(out.tabs.crypto)out.tabs.crypto.closed=c3;
    if(out.tabs.soxl)out.tabs.soxl.closed=c4;
    for(const k of Object.keys(ACCOUNT_WEIGHT))if(out.tabs[k])out.tabs[k].today=todaySummary(k,out.tabs[k],now.hm);
    applyKrSplit(out.tabs);
    // 📅 오늘 탭 전일·당일 칸(밤 계산 확정 전 값) — 한국 날짜 어제 · 오늘
    const etfQ=qs[codes.length]||null,etfBar=d=>((etfQ&&etfQ.ohlc)||[]).find(x=>x.date===d)||{};
    const ledAt=d=>d===now.date?lt:((prevs.find(x=>x.date===d)||{}).l||null);
    const etfCell=d=>{if(krxDay(d).closed)return etfDayCell(null,null,null,true);const bd=prevKrDay(d),b=ledAt(bd);
      return b?etfDayCell(stages(b),stages(ledAt(d)),{buyClose:etfBar(bd).close,sellOpen:etfBar(d).open},false):null;};
    const sxc=soxlDayCell(nx,us,+((mainOf("soxl",now.date).params||{}).tabSize));
    // ① 규칙 칸 재료 — 그날 메인 종목의 시가 · 종가(오늘 종목은 위에서 받은 시세 · 어제 종목은 체결이 없을 때만 더 받는다)
    const ruleOf=async(d,led,closedRec)=>{
      const pre=led&&stages(led).preopen;
      if(!pre||!(pre.picks||[]).length||(closedRec&&((closedRec.trades||[]).length||(closedRec.open||[]).length)))return null;
      const P=mainOf("opening",d).params,bars={};
      for(const c of openingPick(P,pre.picks)){
        const i=codes.indexOf(c),q=d===now.date&&i>=0?qs[i]:await quote(origin,c);
        const b=((q&&q.ohlc)||[]).find(x=>x.date===d);if(b)bars[c]=b;
      }
      return openingRuleCell(pre,P,bars,d<now.date||now.hm>=1600);
    };
    const [r1,r1y]=await Promise.all([ruleOf(now.date,lt,c1),krxDay(Y).closed?null:ruleOf(Y,ledAt(Y),c1y)]);
    const days={opening:{[Y]:krxDay(Y).closed?{v:"holiday",final:true,src:"vts"}:openingClosedCell(c1y,r1y),[now.date]:openingTodayCell(out.tabs.opening,c1,krxDay(now.date).closed,r1)},
      daytrading:{[Y]:etfCell(Y),[now.date]:etfCell(now.date)},
      close30:{[Y]:krxDay(Y).closed?{v:"holiday",final:true,src:"vts"}:(ledAt(Y)?close30DayCell(stages(ledAt(Y)),{close:etfBar(Y).close},false):null),
        [now.date]:close30DayCell(st,{close:now.hm>=1531?etfBar(now.date).close:0,now:prices["233740"]},krxDay(now.date).closed)},
      crypto:{[Y]:coinDayCell(Y,coinRaw,mainOf("crypto",Y).params),[now.date]:coinDayCell(now.date,coinRaw,mainOf("crypto",now.date).params)},
      soxl:sxc&&(sxc.date===Y||sxc.date===now.date)?{[sxc.date]:sxc.cell}:{}};
    for(const k of Object.keys(days))if(out.tabs[k])out.tabs[k].days=days[k];
    return json(out);
  }catch(e){
    return json({ok:false,error:String(e.message||e)},502);
  }
}
