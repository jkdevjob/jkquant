// Cloudflare Pages Function — GET /api/claude-live
// 단타(클로드) 탭별 "오늘 모의 매매이력" (장중 실시간). 읽기 전용 — 주문 경로 없음.
//  ① 시초가 · ② 데이트레이딩: opening-scheduler Worker 의 오늘 gapdown ledger(KIS 모의투자 주문·체결 원본)를
//     서버에서 감시키로 읽어 가격·시각·손익만 돌려준다(주문번호·수량·키는 내보내지 않는다).
//  ③ 코인 · ④ 미국: 전날 확정 판단(scalping-data claude-lab/*-decisions.csv)과 현재 시세로 오늘 손익을 계산한다.
// 확정 결과는 밤 workflow 의 모의투자 장부(claude-paper)가 따로 남긴다. 이 응답은 화면 표시용이다.

import { claudeAuthorized } from "./_claude_auth.js";
import { MAIN_DEFAULT, loadMainEvents, mainFor, openingCounts, openingPick } from "./_claude_main.js";
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

// ① 시초가: 08:59 장전 동시호가 매수 → 15:30 종가 매도
export function openingRows(st,prices){
  const pre=st.preopen||{},rec=st.reconcile||st.close||{};
  const pos=Object.fromEntries((rec.positions||[]).map(p=>[p.code,p]));
  const ord=Object.fromEntries((pre.orders||[]).filter(o=>o.side==="buy").map(o=>[o.code,o]));
  const sells=Object.fromEntries(((st.close||{}).orders||[]).filter(o=>o.side==="sell").map(o=>[o.code,o]));
  return (pre.picks||[]).map(p=>{
    const ps=pos[p.code]||{},o=ord[p.code]||{},bf=(ps.buy||{}).avgPrice||null,sf=(ps.sell||{}).avgPrice||null;
    const buy=bf||p.expectedPrice||null,now=prices[p.code]||null;
    const status=!(o.vts&&o.vts.ok)?"주문 실패":sf?"청산":(sells[p.code]&&sells[p.code].vts&&!sells[p.code].vts.ok)?"매도 실패":"보유중";
    const ref=sf||now;
    return {code:p.code,name:p.name||p.code,buyTime:"08:59 동시호가",buyPrice:buy,buyPriceKind:bf?"체결":"예상",
      sellTime:sf?"15:30 종가":null,sellPrice:sf,nowPrice:now,status,
      pnlPct:buy&&ref?pct(ref,buy)-KR_COST:null,realized:!!sf,expectedGapPct:p.expectedGapPct,
      note:o.vts&&!o.vts.ok?String(o.vts.msg||""):""};
  });
}
// ② ETF: 전날 15:21 종가 매수 → 오늘 08:59 시가 매도 · 오늘 15:21 종가 매수(오버나잇 보유)
export function etfRows(todaySt,prevSt,prevDate,nowPrice){
  const rows=[];
  const sell=todaySt.etf_sell,buyPrev=prevSt&&prevSt.etf_buy;
  if(sell&&buyPrev&&buyPrev.signal){
    const b=((prevSt.etf_reconcile||{}).fills||{}).closeBuy||{},s=((todaySt.etf_reconcile||{}).fills||{}).openSell||{};
    const bp=b.avgPrice||(buyPrev.quote||{}).expectedPrice||null,sp=s.avgPrice||null;
    rows.push({code:"233740",name:"KODEX 코스닥150레버리지",buyTime:prevDate+" 15:30 종가",buyPrice:bp,buyPriceKind:b.avgPrice?"체결":"예상",
      sellTime:"오늘 09:00 시가",sellPrice:sp,nowPrice:nowPrice,status:sp?"청산":(sell.order&&sell.order.vts&&sell.order.vts.ok?"매도 접수":"매도 대기"),
      pnlPct:bp&&(sp||nowPrice)?pct(sp||nowPrice,bp)-ETF_COST:null,realized:!!sp,note:sell.decisionReason||""});
  }
  const buy=todaySt.etf_buy;
  if(buy){
    const b=((todaySt.etf_reconcile||{}).fills||{}).closeBuy||{};
    if(buy.signal){
      const bp=b.avgPrice||(buy.quote||{}).expectedPrice||null;
      rows.push({code:"233740",name:"KODEX 코스닥150레버리지",buyTime:"오늘 15:30 종가",buyPrice:bp,buyPriceKind:b.avgPrice?"체결":"예상",
        sellTime:"다음 거래일 09:00 시가",sellPrice:null,nowPrice:nowPrice,status:buy.order&&buy.order.vts&&buy.order.vts.ok?"보유중(오버나잇)":"주문 실패",
        pnlPct:null,realized:false,dropPct:buy.dropPct,note:(buy.order&&buy.order.vts&&!buy.order.vts.ok)?String(buy.order.vts.msg||""):""});
    }else if(buy.decisionReason==="krx_holiday")rows.push({code:"233740",name:"KODEX 코스닥150레버리지",status:"매매 없음",note:"국내 휴장일"});
    else rows.push({code:"233740",name:"KODEX 코스닥150레버리지",status:"매매 없음",note:"15:21 예상 하락 "+(buy.dropPct==null?"—":buy.dropPct.toFixed(2)+"%")+" (기준 "+String((buy.rule&&buy.rule.dropMaxPct)??-3).replace("-","−")+"% 이하)"});
  }
  return rows;
}
// ③ 코인 하루 단타: 어제 확정 종가 > 20일 평균(어제 포함)인 날, 오늘 60분봉 고가가 어제 고가를 넘는 첫 봉에서 매수 → 다음 날 09:00 매도.
// 추세 판단 = 어제까지 확정된 20개 종가의 평균 < 어제 종가. candles: 업비트 일봉 최신순(0 = 진행 중인 오늘). claude_lab.coin_breakout 과 같은 규칙.
// p: 그날 ③ 메인 변수(ma · level prevhigh=어제 고가 / vb=오늘 시가+k×어제 폭). 두 번째 인자가 숫자면 옛 호출(ma 만).
export function coinHoldToday(candles,p=MAIN_DEFAULT.crypto.params){
  if(typeof p==="number")p={...MAIN_DEFAULT.crypto.params,ma:p};
  const ma=p.ma,c=Array.isArray(candles)?candles:[];
  const done=c.slice(1,1+ma).map(x=>+x.trade_price);
  if(done.length<ma||done.some(x=>!(x>0)))return null;
  const avg=done.reduce((a,b)=>a+b,0)/ma,y=c[1];
  const level=p.level==="vb"?+c[0].opening_price+p.k*(+y.high_price-+y.low_price):+y.high_price;
  return {hold:done[0]>avg,prevClose:done[0],ma:avg,maDays:ma,level,levelKind:p.level,basedOn:String(y.candle_date_time_kst||"").slice(0,10)};
}
// day: 그날(09:00 시작) 판단 + 그날 60분봉(오래된 순) → 매수 시각·가격·손절·손익. last: 지금 가격(진행 중) 또는 그날 마지막 봉 종가(확정).
// 밤 계산 coin_breakout 과 같은 규칙: 업비트 하루(09:00~)의 봉을 순서대로 보며, lastEntryHour 시(밤) 이후 봉에 오면 그날은 더 사지 않는다.
export function coinBreakoutDay(h,bars,last,p=MAIN_DEFAULT.crypto.params){
  if(!h)return null;
  const lv=h.levelKind==="vb"?"기준선(시가+"+p.k+"×어제 폭)":"어제 고가",stopPct=+p.stopPct;
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
export const ACCOUNT_WEIGHT={opening:0.3,daytrading:0.3,crypto:0.3,soxl:0.4};
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
    const uv=use.filter(r=>r.pnlPct!=null).map(r=>r.pnlPct),us=uv.reduce((a,x)=>a+x,0);
    const ok=use.filter(r=>r.status!=="주문 실패");trades=ok.length;tabPct=uv.length?us/uv.length:0;
    if(rows.length&&b&&!counts){                     // 메인 기준 매매일이 아니면 측정용 주문 — 칸 수익률·계좌에 넣지 않는다(장부와 같게)
      const w=ACCOUNT_WEIGHT[tab];
      return {tabPct:0,sumPct:0,trades:0,accountPct:0,weight:w,noTrade:true,wins:0,losses:0,measurePct:tabPct,
        why:lab+" 아님(통과 "+b.qualified+"<"+P.minQ+") — 측정용 모의 매수 "+rows.length+"종목 "+(uv.length?(tabPct>=0?"+":"")+tabPct.toFixed(2)+"%":"")+" (칸 수익률에는 안 셈)"};
    }
    if(rows.length)why=(b&&counts?lab+"(통과 "+b.qualified+"종목) — ":"측정용 매수("+lab+" 아님"+(b?": 통과 "+b.qualified+"<"+P.minQ:"")+") — ")+"갭 깊은 "+rows.length+"종목 모의 매수"+
      (use.length<rows.length?" · 장부에는 "+use.length+"종목(메인: 깊은 "+P.topK+"종목"+(P.gapMax!=null?" · 갭 "+P.gapMax+"% 이하":"")+")":"")+(rows.length>ok.length&&use.length===rows.length?" · 주문 실패 "+(rows.length-ok.length)+"건":"");
    const done=use.filter(r=>r.pnlPct!=null&&(r.buyPrice!=null||r.sellPrice!=null||r.hold===true)&&r.status!=="주문 실패");
    if(rows.length){const w=ACCOUNT_WEIGHT[tab];return {tabPct,sumPct:us,trades,accountPct:tabPct*w,weight:w,noTrade:trades===0,why,
      wins:done.filter(r=>r.pnlPct>0).length,losses:done.filter(r=>r.pnlPct<=0).length};}
    else if(!d)why=hm<856?"08:56 판단 전":"오늘 판단 기록 없음(휴장일이 아니면 점검)";
    else why=GAP_REASON[d.reason]||("매매 없음 — "+(d.reason||"조건 맞는 종목 없음"));
  }else if(tab==="daytrading"){
    trades=rows.filter(r=>r.buyPrice!=null&&r.status!=="주문 실패").length;tabPct=sum;
    const today=rows.find(r=>String(r.buyTime||"").startsWith("오늘")),none=rows.find(r=>r.status==="매매 없음");
    const held=rows.find(r=>String(r.sellTime||"").includes("오늘"));
    why=(held?"전날 종가 매수분 오늘 시가 매도("+held.status+") · ":"")+
      (today?"오늘 종가 매수("+today.status+")":none?"오늘 매수 없음 — "+none.note:hm<1521?"15:21 판단 전":"오늘 판단 기록 없음");
  }else if(tab==="crypto"){
    trades=rows.filter(r=>r.hold).length;tabPct=t.basketPct==null?0:t.basketPct;
    why=rows.map(r=>r.name+" "+(r.status||"")).join(" · ")||"시세 없음";
  }else if(tab==="soxl"){
    const u=rows[0]||{};trades=u.hold||u.realized?1:0;tabPct=u.pnlPct==null?0:u.pnlPct;
    why=u.hold==null&&!u.realized?"판단 없음(밤 계산 점검)":u.status+(u.session?" · "+u.session:"");
  }
  const w=ACCOUNT_WEIGHT[tab]||0;
  const done=rows.filter(r=>r.pnlPct!=null&&(r.buyPrice!=null||r.sellPrice!=null||r.hold===true)&&r.status!=="주문 실패");
  return {tabPct,sumPct:sum,trades,accountPct:tabPct*w,weight:w,noTrade:trades===0,why,
    wins:done.filter(r=>r.pnlPct>0).length,losses:done.filter(r=>r.pnlPct<=0).length};
}
// 국내 칸(30%)은 ①②가 같은 날 둘 다 매매하면 반씩 쓴다(백테 combine_same_capital 과 같은 규칙)
export function applyKrSplit(tabs){
  const o=tabs.opening&&tabs.opening.today,d=tabs.daytrading&&tabs.daytrading.today;
  if(o&&d&&!o.noTrade&&!d.noTrade)for(const q of [o,d]){q.weight=ACCOUNT_WEIGHT.opening/2;q.accountPct=q.tabPct*q.weight;q.krShared=true;}
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
    Object.assign(row,{status:"쉼 — "+(above?"과매도 아님 (RSI("+rn+") "+(+nx.rsi2).toFixed(0)+" ≥ "+rmax+")":md+"일 평균 아래"),pnlPct:0});
  }
  return row;
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
    const [lt,prev]=await Promise.all([ledger(env,now.date),(async()=>{
      for(let k=1;k<=5;k++){const d=kstToday(Date.now()-k*864e5).date;const l=await ledger(env,d);if(l&&(l.events||[]).length)return {date:d,l};}
      return null;})()]);
    const st=stages(lt),pst=prev?stages(prev.l):{};
    const codes=((st.preopen||{}).picks||[]).map(p=>p.code);
    const qs=await Promise.all([...codes,"233740"].map(c=>quote(origin,c)));
    const prices=Object.fromEntries([...codes,"233740"].map((c,i)=>[c,qs[i]?qs[i].price:null]));
    const pre=st.preopen||null;
    out.tabs.opening={rows:openingRows(st,prices),decision:pre?{reason:pre.decisionReason,breadth:pre.breadth||null,candidates:pre.candidates}:null,
      ledgerFound:!!lt,main:mainOf("opening",now.date),
      note:"08:56 예상체결가로 갭 판단 → 08:59 장전 동시호가 매수 → 15:21 종가 동시호가 매도 → 15:40 체결 조회. 매매일은 통과 "+mainOf("opening",now.date).params.minQ+"종목 이상."};
    const m2=mainOf("daytrading",now.date);
    out.tabs.daytrading={rows:etfRows(st,pst,prev&&prev.date,prices["233740"]),ledgerFound:!!lt,main:m2,
      note:"전날 "+String(m2.params.th).replace("-","−")+"% 이하 마감이면 15:21 종가 매수 → 다음 거래일 08:59 시가 매도."};
    // ③
    let ticks={};
    try{const r=await fetch("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH",{headers:{Accept:"application/json"}});for(const t of await r.json())ticks[t.market]=t;}catch(e){}
    const lab=await fetch(RAW+"claude-lab/latest.json?t="+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null);
    // ③ 업비트 하루(09:00 시작) 날짜의 메인 — 09시 전이면 아직 어제 하루
    const ud=kstToday(Date.now()-9*36e5).date,m3=mainOf("crypto",ud),P3=m3.params;
    const coins=await Promise.all(P3.markets.map(async m=>{
      const name=m.replace("KRW-","");
      try{
        const [dc,hc]=await Promise.all(["days?market="+m+"&count="+Math.min(200,P3.ma+2),"minutes/60?market="+m+"&count=30"].map(q=>
          fetch("https://api.upbit.com/v1/candles/"+q,{headers:{Accept:"application/json"}}).then(r=>r.json())));
        const h=coinHoldToday(dc,P3);
        const day=String((dc[0]||{}).candle_date_time_kst||"").slice(0,10);
        const t=ticks[m],now=t?+t.trade_price:null;
        const r=coinBreakoutDay(h,barsOfDay(hc,day),now,P3);
        return {code:m,name,nowPrice:now,sellTime:"다음 날 09:00",signalBasedOn:h&&h.basedOn,signalClose:h&&h.prevClose,ma20:h&&h.ma,maDays:P3.ma,...(r||{status:"판단 없음"}),
          realized:!!(r&&r.stopped)};
      }catch(e){return {code:m,name,status:"시세 없음",pnlPct:null};}
    }));
    const basket=coins.reduce((s,c)=>s+(c.pnlPct||0),0)/P3.markets.length;
    out.tabs.crypto={rows:coins,basketPct:basket,tabPct:basket*P3.tabSize,main:m3,
      note:"업비트 하루는 09:00 시작. 어제 종가가 "+P3.ma+"일 평균 위인 날만, "+(P3.level==="vb"?"오늘 시가+"+P3.k+"×어제 폭":"어제 고가")+"를 넘는 순간 매수"+
        (P3.lastEntryHour!=null?"("+P3.lastEntryHour+"시 전까지)":"")+" → 다음 날 09:00 매도(24시간 미만). 매수가 대비 −"+P3.stopPct+"% 손절. "+
        (P3.markets.length>1?"두 코인 반반":P3.markets[0].replace("KRW-","")+" 하나")+", 탭 표시 자금 "+Math.round(P3.tabSize*100)+"%."};
    // ④ SOXL 단기 과매도 반등 — 밤 계산(미국장 마감 확정 종가)의 다음 할 일 + 지금 시세
    const us=await quote(origin,"SOXL");
    const nx=((lab&&lab.tabs&&lab.tabs.soxl)||{}).nextSignal||null;
    const sx=await csvLast("claude-lab/soxl-mr-decisions.csv",1);
    const P4=(nx&&nx.rsiMax!=null)?{rsiMax:nx.rsiMax,rsiN:nx.rsiN||2,ma:nx.maDays??200,maxHoldDays:nx.maxHoldDays||5}:MAIN_DEFAULT.soxl.params;
    out.tabs.soxl={rows:[soxlLive(nx,us,sx[0]||null)],main:mainOf("soxl",now.date),
      note:"미국장 마감 확정 종가로 RSI("+P4.rsiN+")<"+P4.rsiMax+(P4.ma?" · "+P4.ma+"일 평균 위":"")+"면 다음 미국장 시가 매수 → 오른 날 다음 시가 매도(최대 "+P4.maxHoldDays+"일). 결과는 한국시각 다음 날 아침에 확정."};
    // 하루 마감 장부(텔레그램 결과와 같은 원본, Worker Durable Object) — ①② 오늘 · ③ 마지막 한국 00:00 마감 · ④ 마지막 미국장 마감
    const closedOf=async(k,days)=>{for(const i of days){const d=kstToday(Date.now()-i*864e5).date;const l=await ledger(env,d,"/claude");
      const e=((l&&l.events)||[]).find(x=>x&&x.id==="close:"+k);if(e)return e.payload;}return null;};
    const [c1,c2,c3,c4]=await Promise.all([closedOf("opening",[0]),closedOf("daytrading",[0]),closedOf("crypto",[1,2]),closedOf("soxl",[0,1,2,3,4])]);
    if(out.tabs.opening)out.tabs.opening.closed=c1;
    if(out.tabs.daytrading)out.tabs.daytrading.closed=c2;
    if(out.tabs.crypto)out.tabs.crypto.closed=c3;
    if(out.tabs.soxl)out.tabs.soxl.closed=c4;
    for(const k of Object.keys(ACCOUNT_WEIGHT))if(out.tabs[k])out.tabs[k].today=todaySummary(k,out.tabs[k],now.hm);
    applyKrSplit(out.tabs);
    return json(out);
  }catch(e){
    return json({ok:false,error:String(e.message||e)},502);
  }
}
