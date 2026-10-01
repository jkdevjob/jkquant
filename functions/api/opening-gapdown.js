// Cloudflare Pages Function — POST /api/opening-gapdown
// D-1 시초가 갭하락 과매도(opening_gapdown_v1) 연구용 모의체결. 실계좌 경로는 없다 — 주문 env 는 "vts" 고정.
//   stage=quote     08:50~08:59:15 전날 밤 명단(RSI<30·유동성·관리종목 대용 필터)의 예상체결가 조회 (주문 없음)
//                                한 번에 40종목 — Pages 요청당 외부호출 50건 한도 때문에 Worker 가 part 로 나눠 부른다
//   stage=preopen   ~08:59:40    Worker 가 모은 예상가로 갭 계산 → 가장 깊은 갭 3종목을 장전 동시호가 시장가 매수
//   stage=close     15:20~15:28  이 전략이 아침에 산 체결수량만 종가 동시호가 시장가 매도
//   stage=reconcile 15:35~       매수·매도 실제 체결가 조회 (주문 없음)
//   stage=etf_buy   15:20~15:28  ② 코스닥150 레버리지(233740) 예상 종가가 기준가 대비 −3% 이하면 종가 동시호가 시장가 매수
//   stage=etf_sell  08:50~08:59:40 ② 전날 이 전략이 산 수량만 장전 동시호가 시장가 매도
//   stage=etf_reconcile 15:35~   ② 오늘 매도·매수 체결가 조회 (주문 없음)
// 목적은 수익이 아니라 측정이다: 예상체결가 대 실제 시가, 실제 체결가 대 시가·종가(슬리피지)를 매 건 남긴다.
// 호출자는 opening-scheduler Worker 이고, Worker 가 응답 전체를 Durable Object 원본 ledger 에 먼저 저장한다.
// 주문은 절대 자동 재시도하지 않는다.
import { GAPDOWN_VERSION, expectedGapPct, gapdownPicks, watchlistUsable } from "./_gapdown.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const WATCH_URL="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/opening-gapdown-research/watchlist.json";
const PART_SIZE=40;            // 요청 1건의 외부호출 50건 한도 안쪽 (명단 1 + 시세 40)
const MAX_QUOTES=80;            // 과거 8년 명단 크기 중앙값 10 · 90%지점 57 — 80개 제한은 결과를 거의 안 바꾼다
const QUOTE_GAP_MS=550;         // KIS 모의투자 초당 2건 한도 안쪽
const ORDER_GAP_MS=2500;
const QUOTE_DEADLINE=85915;     // 08:59:15 이후엔 시세를 더 받지 않는다
const ORDER_DEADLINE=85940;     // 08:59:40 이후엔 매수 주문을 내지 않는다 (09:00 체결 전 접수 보장)
const BREADTH_V2_MIN=5;        // 연구 BREADTH_MIN 중 기본값 — 과거 8년 하루 +1.33%(1.5틱, t=3.0), 9개 연도 모두 양수
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let _lastOrderAt=0;

function json(o,s=200){return new Response(JSON.stringify(o,null,2),{status:s,headers:JH});}
export function kstNow(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hms:+g("hour")*10000+ +g("minute")*100+ +g("second"),weekday:g("weekday")};
}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||request.headers.get("x-autotrade-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
function budget(env){
  const n=+env.SCALPING_VTS_BUDGET;
  return n>0?Math.floor(n):2000000;
}
// 단계별 허용 시간창. 창 밖 호출은 아무 주문도 내지 않고 거절한다.
export function stageWindow(stage,hms){
  if(stage==="etf_sell")return hms>=85000&&hms<ORDER_DEADLINE;
  if(stage==="etf_buy")return hms>=152000&&hms<152800;
  if(stage==="etf_reconcile")return hms>=153500&&hms<235959;
  if(stage==="quote")return hms>=85000&&hms<QUOTE_DEADLINE;
  if(stage==="preopen")return hms>=85000&&hms<ORDER_DEADLINE;
  if(stage==="close")return hms>=152000&&hms<152800;
  if(stage==="reconcile")return hms>=153500&&hms<235959;
  return false;
}
export function signalId(date,code,side){return ["gapdown",date,String(code),side].join(":");}

async function claimSignal(id){
  const cache=(typeof caches!=="undefined"&&caches.default)||null;
  if(!cache)return true;
  const key="https://opening-gapdown-signal.internal/"+encodeURIComponent(id);
  try{
    if(await cache.match(key))return false;
    // 응답 유실 시 다시 내면 이중 주문이 되므로 주문 전에 먼저 점유한다.
    await cache.put(key,new Response("1",{headers:{"cache-control":"max-age=43200","content-type":"text/plain"}}));
  }catch(e){return true;}
  return true;
}
async function paceOrder(){
  const wait=_lastOrderAt?ORDER_GAP_MS-(Date.now()-_lastOrderAt):0;
  if(wait>0)await sleep(wait);
  _lastOrderAt=Date.now();
}
async function vtsOrder(origin,env,date,side,x,qty,meta={}){
  const id=meta.id||signalId(date,x.code,side);
  const rec={signalId:id,strategy:meta.strategy||"opening_gapdown",strategyVersion:meta.version||GAPDOWN_VERSION,date,side,code:x.code,name:x.name||x.code,qty,
    submittedAt:null,vts:{ok:false,env:"vts",priceType:"market",orderNo:"",msg:""}};
  if(!(qty>0)){rec.vts.msg="주문수량 0 — 예산/예상가 확인";return rec;}
  if(!(await claimSignal(id))){rec.vts.msg="중복 signal_id 차단";rec.vts.duplicateBlocked=true;return rec;}
  try{
    await paceOrder();
    rec.submittedAt=new Date().toISOString();
    const r=await fetch(origin+"/api/kis?op=order&internal=1",{
      method:"POST",
      headers:{"content-type":"application/json","x-autotrade-key":env.AUTOTRADE_KEY},
      body:JSON.stringify({env:"vts",side,code:x.code,qty,price:0,priceType:"market"})
    });
    const j=await r.json().catch(()=>({}));
    rec.vts={ok:r.ok&&!!j.ok,env:"vts",priceType:"market",orderNo:j.orderNo||"",msg:j.msg||j.error||("HTTP "+r.status),httpStatus:r.status};
  }catch(e){
    rec.vts.msg="전송 결과 불명 — 안전상 자동 재시도하지 않음: "+String(e.message||e);
  }
  return rec;
}
async function quote(origin,code){
  const r=await fetch(origin+"/api/kis?op=expected&env=vts&code="+encodeURIComponent(code),{headers:{"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.error)throw new Error(j.error||("HTTP "+r.status));
  return j;
}
async function orders(origin,env,date,code){
  const u=origin+"/api/kis?op=orders&env=vts&market=kr&date="+encodeURIComponent(date.replace(/-/g,""))+"&code="+encodeURIComponent(code);
  const r=await fetch(u,{headers:{"x-autotrade-key":env.AUTOTRADE_KEY,"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
  return j.orders||[];
}
function hms6(t){const s=String(t||"").replace(/\D/g,"").padStart(6,"0").slice(-6);return /^\d{6}$/.test(s)?+s:0;}
// 이 전략 물량만 센다: 매수는 09:00 전(장전 동시호가) 접수분, 매도는 15:15 이후 접수분.
// 같은 모의계좌의 시초가 재돌파 전략(09:05~09:31 매매)과 시간으로 갈린다.
export function strategyFills(rows){
  const fills=(side,from,to)=>(Array.isArray(rows)?rows:[]).filter(o=>String(o.sideCode)===side&&+o.fillQty>0&&hms6(o.orderTime)>=from&&hms6(o.orderTime)<to);
  const agg=list=>{
    const qty=list.reduce((s,o)=>s+(+o.fillQty||0),0);
    const amt=list.reduce((s,o)=>s+(+o.fillAmount||(+o.fillQty||0)*(+o.fillPrice||0)),0);
    return {qty,avgPrice:qty?amt/qty:null,orderNos:list.map(o=>o.orderNo),orderTimes:list.map(o=>o.orderTime)};
  };
  return {buy:agg(fills("02",83000,90000)),sell:agg(fills("01",151500,240000))};
}

async function loadWatchlist(date){
  let wl=null;
  try{
    const r=await fetch(WATCH_URL+"?t="+Date.now(),{headers:{"Accept":"application/json"}});
    wl=r.ok?await r.json():null;
  }catch(e){wl=null;}
  const use=watchlistUsable(wl,date);
  const meta=wl?{basedOn:wl.basedOn||null,generatedAt:wl.generatedAt||null,size:(wl.names||[]).length,rule:wl.rule||null,
    quotedLimit:MAX_QUOTES,truncated:(wl.names||[]).length>MAX_QUOTES}:null;
  return {wl:use.ok?wl:null,meta,reason:use.reason};
}
function candidateRow(x){
  return {code:String(x.code),name:x.name||x.code,market:x.market||"",rsi14Prev:+x.rsi14,prevClose:+x.prevClose,
    prevAmountKrw:+x.prevAmountKrw||null,quotedAt:null,expectedPrice:null,basePrice:null,expectedChgPct:null,
    expectedVolume:null,phase:"",expectedGapPct:null,error:null};
}

// 읽기 전용: 명단의 part 번째 40종목 예상체결가.
async function quotePart(origin,date,part){
  const out={stage:"quote",strategyVersion:GAPDOWN_VERSION,date,part,startedAt:new Date().toISOString(),watchlist:null,candidates:[],decisionReason:""};
  const {wl,meta,reason}=await loadWatchlist(date);
  out.watchlist=meta;
  if(!wl){out.decisionReason=reason;return out;}
  const names=wl.names.slice(0,MAX_QUOTES).slice(part*PART_SIZE,(part+1)*PART_SIZE);
  for(const x of names){
    const row=candidateRow(x);
    if(kstNow().hms>=QUOTE_DEADLINE){row.error="quote_deadline";out.candidates.push(row);continue;}
    try{
      const q=await quote(origin,row.code);
      Object.assign(row,{quotedAt:new Date().toISOString(),expectedPrice:q.expectedPrice||null,basePrice:q.basePrice||null,
        expectedChgPct:q.expectedChgPct,expectedVolume:q.expectedVolume||null,phase:q.phase||""});
      row.expectedGapPct=expectedGapPct(q,row.prevClose);
      if(row.expectedGapPct===null)row.error="expected_price_missing";
    }catch(e){row.error=String(e.message||e);}
    out.candidates.push(row);
    await sleep(QUOTE_GAP_MS);
  }
  return out;
}

// Worker 가 모은 예상가를 받아 규칙대로 고르고 주문한다. 명단에 없는 종목은 받지 않고 갭은 여기서 다시 계산한다.
export function sanitizeCandidates(rows,wl){
  const byCode=new Map((wl&&Array.isArray(wl.names)?wl.names.slice(0,MAX_QUOTES):[]).map(x=>[String(x.code),x]));
  const out=[];
  for(const r of (Array.isArray(rows)?rows:[])){
    const w=byCode.get(String(r&&r.code||""));
    if(!w)continue;
    const row=candidateRow(w);
    row.expectedPrice=+r.expectedPrice>0?+r.expectedPrice:null;
    row.basePrice=+r.basePrice>0?+r.basePrice:null;
    row.expectedGapPct=expectedGapPct(row,row.prevClose);
    out.push(row);
    byCode.delete(row.code);
  }
  return out;
}
async function preopen(origin,env,date,rows){
  const out={stage:"preopen",strategyVersion:GAPDOWN_VERSION,date,startedAt:new Date().toISOString(),
    watchlist:null,candidates:0,picks:[],orders:[],decisionReason:""};
  const {wl,meta,reason}=await loadWatchlist(date);
  out.watchlist=meta;
  if(!wl){out.decisionReason=reason;return out;}
  const cands=sanitizeCandidates(rows,wl);
  out.candidates=cands.length;
  const picks=gapdownPicks(cands,wl.rule);
  // v2 판단 근거: 오늘 조건(갭 범위)을 통과한 종목 수 = 시장 투매 강도. 주문은 v1 그대로 매일 내서 체결을 재고, v2 는 이 값으로 가른다.
  const qualified=gapdownPicks(cands,{...wl.rule,picks:1e9}).length;
  out.breadth={qualified,v2MinQualified:BREADTH_V2_MIN,v2Signal:qualified>=BREADTH_V2_MIN};
  out.picks=picks.map(x=>({code:x.code,name:x.name,expectedPrice:x.expectedPrice,basePrice:x.basePrice,expectedGapPct:x.expectedGapPct,rsi14Prev:x.rsi14Prev}));
  if(!picks.length){out.decisionReason=cands.some(x=>x.expectedGapPct!==null)?"no_expected_gap_down":"no_expected_prices";return out;}
  out.decisionReason="rsi14_prev<30+expected_gap<=-2%+deepest3";
  if(String(env.SCALPING_VTS_AUTO||"1")==="0"){out.ordersSkipped="SCALPING_VTS_AUTO=0";return out;}
  if(!env.AUTOTRADE_KEY){out.ordersSkipped="AUTOTRADE_KEY 없음";return out;}
  const amount=budget(env);
  out.budgetPerPick=amount;
  for(const x of picks){
    if(kstNow().hms>=ORDER_DEADLINE){
      out.orders.push({signalId:signalId(date,x.code,"buy"),code:x.code,side:"buy",qty:0,vts:{ok:false,env:"vts",msg:"08:59:40 이후 — 동시호가 마감 전 접수 보장이 안 돼 주문 생략"}});
      continue;
    }
    out.orders.push(await vtsOrder(origin,env,date,"buy",x,Math.floor(amount/Math.max(1,+x.expectedPrice||0))));
  }
  return out;
}

async function closeOrReconcile(origin,env,date,stage,picks){
  const out={stage,strategyVersion:GAPDOWN_VERSION,date,startedAt:new Date().toISOString(),positions:[],orders:[]};
  for(const p of picks){
    const code=String(p&&p.code||"");
    if(!/^\d{6}$/.test(code))continue;
    let f;
    try{f=strategyFills(await orders(origin,env,date,code));}
    catch(e){out.positions.push({code,error:"체결조회 실패: "+String(e.message||e)});continue;}
    const pos={code,name:p.name||code,buy:f.buy,sell:f.sell,openQty:Math.max(0,f.buy.qty-f.sell.qty)};
    out.positions.push(pos);
    if(stage!=="close")continue;
    if(!(pos.openQty>0)){out.orders.push({signalId:signalId(date,code,"sell"),code,side:"sell",qty:0,vts:{ok:false,env:"vts",msg:"매도 생략 — 이 전략의 VTS 보유수량 없음"}});continue;}
    // 조회 직후 주문(hash+order)이 초당 한도에 몰리지 않게 비운다.
    await sleep(1200);
    out.orders.push(await vtsOrder(origin,env,date,"sell",{code,name:pos.name},pos.openQty));
    await sleep(600);
  }
  return out;
}

// ── ② etf_dip_overnight_v1: 코스닥150 레버리지 하락일 종가 매수 → 다음 거래일 시가 매도 ──
// 과거 2018-04~2026-09: 하루 −3% 이하인 날 연 45회, 평균 +0.40%(t=2.8), 9개 연도 중 8개 양수, 기준을 −2→−6% 로
// 바꾸면 +0.23→+0.98% 로 단조 증가. ETF 라 증권거래세가 없다(왕복 비용 약 0.1%). D-1 과 시간이 겹치지 않는다.
export const ETF_RULE=Object.freeze({code:"233740",name:"KODEX 코스닥150레버리지",dropMaxPct:-3,version:"etf_dip_overnight_v1",budgetMultiple:3});
export function etfDropPct(q){
  const px=+(q&&q.expectedPrice)||0,base=+(q&&q.basePrice)||0;
  return px>0&&base>0?(px/base-1)*100:null;
}
export function etfDecision(dropPct){
  if(dropPct===null||!Number.isFinite(dropPct))return {signal:false,decisionReason:"expected_price_missing"};
  if(dropPct>ETF_RULE.dropMaxPct)return {signal:false,decisionReason:"no_signal_drop_above_-3%"};
  return {signal:true,decisionReason:"expected_close_vs_base<=-3%"};
}
export function etfSignalId(buyDate,side){return ["etf_dip",buyDate,ETF_RULE.code,side].join(":");}
// 매수는 15:15 이후(종가 동시호가) 접수분, 매도는 09:00 전(장전 동시호가) 접수분만 이 전략 물량으로 센다.
export function etfFills(rows){
  const f=(side,from,to)=>(Array.isArray(rows)?rows:[]).filter(o=>String(o.sideCode)===side&&+o.fillQty>0&&hms6(o.orderTime)>=from&&hms6(o.orderTime)<to);
  const agg=list=>{
    const qty=list.reduce((s,o)=>s+(+o.fillQty||0),0);
    const amt=list.reduce((s,o)=>s+(+o.fillAmount||(+o.fillQty||0)*(+o.fillPrice||0)),0);
    return {qty,avgPrice:qty?amt/qty:null,orderNos:list.map(o=>o.orderNo),orderTimes:list.map(o=>o.orderTime)};
  };
  return {closeBuy:agg(f("02",151500,240000)),openSell:agg(f("01",83000,90000))};
}
async function etfBuy(origin,env,date){
  const out={stage:"etf_buy",strategy:"etf_dip_overnight",strategyVersion:ETF_RULE.version,date,code:ETF_RULE.code,
    rule:ETF_RULE,startedAt:new Date().toISOString(),quote:null,dropPct:null,signal:false,order:null,decisionReason:""};
  let q;
  try{q=await quote(origin,ETF_RULE.code);}catch(e){out.decisionReason="quote_failed: "+String(e.message||e);return out;}
  out.quote={expectedPrice:q.expectedPrice||null,basePrice:q.basePrice||null,expectedChgPct:q.expectedChgPct,phase:q.phase||"",time:q.time||""};
  out.dropPct=etfDropPct(q);
  Object.assign(out,etfDecision(out.dropPct));
  if(!out.signal)return out;
  if(String(env.SCALPING_VTS_AUTO||"1")==="0"){out.ordersSkipped="SCALPING_VTS_AUTO=0";return out;}
  if(!env.AUTOTRADE_KEY){out.ordersSkipped="AUTOTRADE_KEY 없음";return out;}
  const qty=Math.floor(budget(env)*ETF_RULE.budgetMultiple/Math.max(1,+q.expectedPrice||0));
  out.order=await vtsOrder(origin,env,date,"buy",{code:ETF_RULE.code,name:ETF_RULE.name},qty,
    {id:etfSignalId(date,"buy"),strategy:"etf_dip_overnight",version:ETF_RULE.version});
  return out;
}
async function etfSell(origin,env,date,buyDate){
  const out={stage:"etf_sell",strategy:"etf_dip_overnight",strategyVersion:ETF_RULE.version,date,buyDate,code:ETF_RULE.code,
    startedAt:new Date().toISOString(),boughtQty:0,alreadySoldQty:0,order:null,decisionReason:""};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(buyDate||""))||buyDate>=date||(Date.parse(date)-Date.parse(buyDate))/864e5>5){
    out.decisionReason="buy_date_invalid";return out;
  }
  try{
    out.boughtQty=etfFills(await orders(origin,env,buyDate,ETF_RULE.code)).closeBuy.qty;
    await sleep(700);
    out.alreadySoldQty=etfFills(await orders(origin,env,date,ETF_RULE.code)).openSell.qty;
  }catch(e){out.decisionReason="체결조회 실패: "+String(e.message||e);return out;}
  const qty=Math.max(0,out.boughtQty-out.alreadySoldQty);
  if(!(qty>0)){out.decisionReason="no_position";return out;}
  await sleep(1200);
  out.decisionReason="next_open_exit";
  out.order=await vtsOrder(origin,env,date,"sell",{code:ETF_RULE.code,name:ETF_RULE.name},qty,
    {id:etfSignalId(buyDate,"sell"),strategy:"etf_dip_overnight",version:ETF_RULE.version});
  return out;
}
async function etfReconcile(origin,env,date){
  const out={stage:"etf_reconcile",strategy:"etf_dip_overnight",strategyVersion:ETF_RULE.version,date,code:ETF_RULE.code,fills:null};
  try{out.fills=etfFills(await orders(origin,env,date,ETF_RULE.code));}catch(e){out.error="체결조회 실패: "+String(e.message||e);}
  return out;
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  let b={};
  try{b=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  const stage=String(b.stage||""),now=kstNow(),date=String(b.date||"");
  if(date!==now.date)return json({ok:false,error:"오늘 날짜만 처리합니다.",today:now.date,date},400);
  if(["Sat","Sun"].includes(now.weekday))return json({ok:false,error:"주말"},400);
  if(!stageWindow(stage,now.hms))return json({ok:false,error:"허용 시간창 밖",stage,kstHms:now.hms},400);
  const origin=new URL(request.url).origin;
  try{
    if(stage==="quote"){
      const part=Math.floor(+b.part||0);
      if(!(part>=0&&part*PART_SIZE<MAX_QUOTES))return json({ok:false,error:"part 범위 오류"},400);
      return json({ok:true,...await quotePart(origin,date,part),finishedAt:new Date().toISOString()});
    }
    if(stage==="preopen")return json({ok:true,...await preopen(origin,env,date,b.candidates),finishedAt:new Date().toISOString()});
    if(stage==="etf_buy")return json({ok:true,...await etfBuy(origin,env,date),finishedAt:new Date().toISOString()});
    if(stage==="etf_sell")return json({ok:true,...await etfSell(origin,env,date,String(b.buyDate||"")),finishedAt:new Date().toISOString()});
    if(stage==="etf_reconcile")return json({ok:true,...await etfReconcile(origin,env,date),finishedAt:new Date().toISOString()});
    const picks=(Array.isArray(b.picks)?b.picks:[]).slice(0,5);
    return json({ok:true,...await closeOrReconcile(origin,env,date,stage,picks),finishedAt:new Date().toISOString()});
  }catch(e){
    return json({ok:false,stage,date,error:String(e.message||e)},500);
  }
}
