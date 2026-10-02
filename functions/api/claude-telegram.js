// Cloudflare Pages Function — POST /api/claude-telegram
// 단타(클로드) Telegram 알림 — opening-scheduler Worker 가 부른다. 주문을 만들지 않는다.
//  알림(kind):  preopen 08:5x ① 오늘 매수 종목 · etfbuy 15:21 ② 종가 매수 판단 · weekly 토 09:05 주간 결과
//  하루 마감(op=close → op=send): 각 전략의 당일 모의매매가 끝난 뒤 그 장부로 결과 메시지
//    ① 시초가 · ② 데이트레이딩 · 📅 전일·당일 = 15:40 체결조회 뒤 · ③ 코인 = 한국 00:05(전날 00:00~24:00) · ④ SOXL = 뉴욕 16:05
//  마감 장부는 Worker 가 Durable Object 에 한 번만 저장하고, 보냄·모름을 기록해 중복 발송을 막는다(재시도는 텔레그램이 거절한 경우만).
import { ledger, quote } from "./claude-live.js";
import { openingDay, etfDay, coinDay, soxlDay, composeDay, composeOverview } from "./_claude_day.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
const KINDS=["preopen","etfbuy","weekly","duel"];
const SX_ACT={enter:"시가 매수",hold:"보유",exit:"시가 매도",flat:"쉼"};
const SX_NEXT={buy:"시가 매수 (과매도 신호)",sell:"시가 매도"};
const PART={opening_d1v2:"① 시초가",daytrading_etf:"② ETF 야간",crypto_btc:"③ BTC",crypto_eth:"③ ETH",us_soxl:"④ SOXL"};
const TABN={opening:"①",daytrading:"②",crypto:"③",soxl:"④"};
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
export function p(v,d=2){return v==null||!isFinite(v)?"—":(v>=0?"+":"")+(+v).toFixed(d)+"%";}
function n(v){return v==null||!isFinite(v)?"—":(+v>=1000?Math.round(+v).toLocaleString("en-US"):(+v).toFixed(2));}
async function claim(id){
  if(typeof caches==="undefined"||!caches.default)return true;
  const key="https://claude-telegram.internal/"+encodeURIComponent(id);
  try{if(await caches.default.match(key))return false;await caches.default.put(key,new Response("1",{headers:{"cache-control":"max-age=172800"}}));}catch(e){return true;}
  return true;
}
async function send(env,text){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)throw new Error("Telegram 환경변수 없음");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.description||("HTTP "+r.status));
  return j.result&&j.result.message_id;
}
// 메시지 본문 — 순수 함수(값 시험 대상)
export function compose(kind,date,live,extra={}){
  const T=(live&&live.tabs)||{},L=[];
  const o=T.opening||{},d=T.daytrading||{};
  if(kind==="preopen"){
    L.push("🤖 [클로드 단타] "+date+" 08:59 시초가");
    const dec=o.decision||{},b=dec.breadth;
    if((o.rows||[]).length){
      L.push("① 갭하락 과매도 — 모의 매수 "+o.rows.length+"종목"+(b?" (통과 "+b.qualified+"개 · v2 매매일 "+(b.v2Signal?"예":"아니오")+")":""));
      for(const r of o.rows)L.push(" · "+r.name+" "+n(r.buyPrice)+(r.buyPriceKind==="예상"?"(예상)":"")+" 갭 "+p(r.expectedGapPct)+(r.status==="주문 실패"?" ⚠️주문 실패":""));
      L.push("→ 15:30 종가 동시호가에 매도");
    }else L.push("① 갭하락 과매도 — 매매 없음 ("+(dec.reason||"조건 맞는 종목 없음")+")");
    for(const r of (d.rows||[]).filter(x=>x.sellTime&&String(x.sellTime).includes("시가")))L.push("② ETF 야간 — 전날 종가 매수분 시가 매도 ("+r.status+")");
  }else if(kind==="etfbuy"){
    L.push("🤖 [클로드 단타] "+date+" 15:21 데이트레이딩");
    const buy=(d.rows||[]).find(x=>String(x.buyTime||"").startsWith("오늘"))||(d.rows||[]).find(x=>x.status==="매매 없음");
    if(buy&&buy.status!=="매매 없음")L.push("② 코스닥150 레버리지 −3% 이하 → 종가 모의 매수 "+n(buy.buyPrice)+" ("+buy.status+") → 내일 시가 매도");
    else L.push("② 매매 없음 — "+((buy&&buy.note)||"예상 하락이 −3% 이내"));
  }else if(kind==="duel"){
    L.push(duelLines(extra.duel,"🆚 [클로드 vs GPT] "+date+" 대결"));
  }else if(kind==="weekly"){
    const lab=extra.lab||{},w=lab.week||{},a=w.account||{};
    L.push("🤖 [클로드 단타] 주간 결과 "+(w.weekStart||"?")+" ~ "+(w.asOf||"?"));
    if(!w.weekStart||w.error||(extra.weekStart&&w.weekStart!==extra.weekStart))L.push("⚠️ 이번 주 장부 요약이 없습니다 — 밤 계산을 확인하세요");
    else{
      L.push("🏦 전체 계좌 "+p(a.weekPct)+" · 목표 +5% "+(a.hit5?"달성 ✅":"미달")+" · +1% 달성일 "+(a.plus1Days||0)+"/"+(a.days||0)+"일");
      L.push("탭별 기여 (계좌 비중 반영, %p · 칸 안 주간 손익):");
      for(const k of Object.keys(PART)){const z=(w.parts||{})[k]||{};
        L.push(" · "+PART[k]+" "+p(z.contribPct)+" ("+p(z.weekPct,1)+", 매매 "+(z.tradeDays||0)+"일"+(z.through?" · ~"+z.through:"")+")");}
    }
    const cand=[];
    for(const [tab,rows] of Object.entries(lab.shadows||{}))for(const x of (Array.isArray(rows)?rows:[]))
      if(x.promotion&&x.promotion.code==="candidate")cand.push((TABN[tab]||tab)+" "+x.name+" — "+x.promotion.text);
    L.push(cand.length?"🧪 그림자 교체 후보:\n · "+cand.join("\n · "):"🧪 그림자 교체 후보 없음 (판정 표본 매매 20일 이상 + 기준보다 나을 때만 표시)");
    const du=lab.duel||{},dt=du.total||{},dl=(dt.days||[])[(dt.days||[]).length-1];
    L.push(duelLines({start:du.start,record:dt.record,cumClaude:(dt.claude||{}).totalPct,cumGpt:(dt.gpt||{}).totalPct,last:dl,
      tabs:Object.fromEntries(Object.entries(du.tabs||{}).map(([k,t])=>{const lr=(t.days||[])[(t.days||[]).length-1];return [k,{cumClaude:(t.claude||{}).totalPct,cumGpt:(t.gpt||{}).totalPct,
        last:lr?{date:lr.date,claude:lr.claude.pnlPct,gpt:lr.gpt.pnlPct,winner:lr.winner}:null}]}))},"🆚 GPT 대결 (누적)"));
  }
  L.push("");
  L.push("모의투자 기록 · 자세히: jkquant.pages.dev/claude");
  return L.join("\n");
}

const DUEL_NAME={opening:"① 시초가",daytrading:"② 데이트레이딩",crypto:"③ 비트코인",soxl:"④ SOXL"};
export function duelLines(d,title){
  d=d||{};const L=[title];
  const rec=d.record||{},last=d.last;
  if(!last){L.push("아직 같은 날 기록 없음 — "+(d.start||"")+" 부터 두 쪽 실시간 모의매매 기록으로 비교합니다.");return L.join("\n");}
  const W=w=>w==="claude"?"🤖 승":w==="gpt"?"GPT 승":"무";
  L.push("합계(4탭 균등) "+last.date+": 🤖 "+p(last.claudePct)+" vs GPT "+p(last.gptPct)+" → "+W(last.winner));
  L.push("누적 🤖 "+p(d.cumClaude)+" vs GPT "+p(d.cumGpt)+" · "+(rec.claude||0)+"승 "+(rec.gpt||0)+"패 "+(rec.draw||0)+"무 (클로드 기준)");
  for(const k of Object.keys(DUEL_NAME)){const t=(d.tabs||{})[k];if(!t)continue;
    L.push(DUEL_NAME[k]+": "+(t.last?t.last.date.slice(5)+" 🤖 "+p(t.last.claude)+" vs "+p(t.last.gpt)+" "+W(t.last.winner):"기록 없음")+" · 누적 🤖 "+p(t.cumClaude)+" vs "+p(t.cumGpt));}
  L.push("같은 시작일 · 같은 비용표 · 실시간 모의매매 기록끼리");
  return L.join("\n");
}
export function mondayOf(date){
  const d=new Date(date+"T00:00:00Z"),w=(d.getUTCDay()+6)%7;
  return new Date(d.getTime()-w*86400000).toISOString().slice(0,10);
}

// ── 전략별 하루 마감(op=close) · 발송(op=send) — Worker 가 마감 장부를 Durable Object 에 한 번만 저장한 뒤 그 장부로 보낸다 ──
const DAY_STRATEGIES=["opening","daytrading","crypto","soxl","overview"];
async function krOpenOn(origin,date){
  const q=await quote(origin,"233740");
  const o=(q&&q.ohlc)||[];
  return o.length?o[o.length-1].date===date:null;
}
export async function closeDay(origin,env,strategy,date){
  if(strategy==="opening"){
    const l=await ledger(env,date);
    const st=Object.fromEntries(((l&&l.events)||[]).map(e=>[e.stage,e.payload||{}]));
    const open=((((st.reconcile||{}).positions)||[]).filter(p=>p.buy&&p.buy.qty>0&&!(p.sell&&p.sell.qty>0))).map(p=>p.code);
    const marks={};for(const c of open){const q=await quote(origin,c);if(q)marks[c]=q.price;}
    return openingDay(date,l,await krOpenOn(origin,date),marks);
  }
  if(strategy==="daytrading"){
    const l=await ledger(env,date);let prev=null,pd=null;
    for(let k=1;k<=5&&!prev;k++){const d=new Date(Date.parse(date+"T12:00:00+09:00")-k*864e5).toISOString().slice(0,10);const x=await ledger(env,d);if(x&&(x.events||[]).length){prev=x;pd=d;}}
    return etfDay(date,l,prev,pd,await krOpenOn(origin,date));
  }
  if(strategy==="crypto"){
    const end=Date.parse(date+"T00:00:00+09:00")+864e5,to=new Date(end).toISOString().replace(".000Z","Z");   // 마감(00:00) 전 자료만
    const coins=[];
    for(const m of ["KRW-BTC","KRW-ETH"]){
      const [daily,hourly]=await Promise.all(["days?market="+m+"&count=25&to="+to,"minutes/60?market="+m+"&count=60&to="+to].map(q=>
        fetch("https://api.upbit.com/v1/candles/"+q,{headers:{Accept:"application/json"}}).then(r=>r.json())));
      coins.push({market:m,daily,hourly});
    }
    return coinDay(date,coins,end);
  }
  if(strategy==="soxl"){
    const lab=await fetch(RAW+"claude-lab/latest.json?t="+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null);
    const nx=((lab&&lab.tabs&&lab.tabs.soxl)||{}).nextSignal||null;
    const csv=await fetch(RAW+"claude-lab/soxl-mr-decisions.csv?t="+Date.now()).then(r=>r.ok?r.text():"").catch(()=>"");
    const ln=csv.trim().split("\n"),h=(ln[0]||"").split(",");
    const rows=ln.slice(1).map(x=>Object.fromEntries(x.split(",").map((v,i)=>[h[i],v])));
    const entry=[...rows].reverse().find(r=>r.action==="enter")||null;
    return soxlDay(date,nx,await quote(origin,"SOXL"),entry);
  }
  return null;
}
// 텔레그램 보내기 — 결과를 셋으로 나눈다: sent(보냄) · definite(텔레그램이 거절, 안 보내짐 → 다시 시도 가능) · unknown(보냈는지 모름 → 다시 보내지 않음)
export async function sendOnce(env,text){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)return {ok:false,definite:true,error:"Telegram 환경변수 없음"};
  let r;
  try{r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});}
  catch(e){return {ok:false,definite:false,error:"연결 오류: "+String(e.message||e)};}
  const j=await r.json().catch(()=>null);
  if(r.ok&&j&&j.ok)return {ok:true,messageId:j.result&&j.result.message_id};
  if(r.status>=500||!j)return {ok:false,definite:false,error:"HTTP "+r.status};
  return {ok:false,definite:true,error:(j&&j.description)||("HTTP "+r.status)};
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  let b={};try{b=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  if(b.op==="close"||b.op==="send"){
    const strategy=String(b.strategy||""),date=String(b.date||"");
    if(!DAY_STRATEGIES.includes(strategy)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"strategy/date 오류"},400);
    if(b.op==="close"){
      try{const result=await closeDay(new URL(request.url).origin,env,strategy,date);return json({ok:!!result,result});}
      catch(e){return json({ok:false,error:String(e.message||e)},502);}
    }
    const text=strategy==="overview"?composeOverview(date,b.records||{}):(b.result?composeDay(b.result):null);
    if(!text)return json({ok:false,definite:true,error:"마감 장부 없음"},400);
    const r=await sendOnce(env,text);
    return json(r,r.ok?200:502);
  }
  const kind=String(b.kind||""),date=String(b.date||"");
  if(!KINDS.includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"kind/date 오류"},400);
  if(!(await claim("claude:"+date+":"+kind)))return json({ok:true,duplicate:true});
  try{
    const origin=new URL(request.url).origin;
    const live=await fetch(origin+"/api/claude-live",{headers:{Accept:"application/json"}}).then(r=>r.json()).catch(()=>null);
    const extra={};
    if(kind==="duel")extra.duel=b.duel;
    if(kind==="weekly"){
      extra.lab=await fetch(RAW+"claude-lab/latest.json?t="+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null);
      extra.weekStart=mondayOf(date);
    }
    const text=compose(kind,date,live,extra);
    const id=await send(env,text);
    return json({ok:true,kind,date,messageId:id});
  }catch(e){
    return json({ok:false,kind,date,error:String(e.message||e)},502);
  }
}
