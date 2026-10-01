// Cloudflare Pages Function — POST /api/claude-telegram
// 단타(클로드) Telegram 알림 — 각 탭 결과가 나오는 시각에 opening-scheduler Worker 가 부른다. 주문을 만들지 않는다.
//   preopen  08:5x  ① 오늘 매수 종목(또는 매매 없음) · ② 아침 시가 매도
//   morning  09:05  ③ 코인 어제 결과 + 오늘 할 일 · ④ SOXL 지난 세션 결과 + 오늘 밤 할 일
//   etfbuy   15:21  ② 오늘 종가 매수 판단
//   close    15:40  ① 오늘 확정 손익 · ② 결과 · 탭별 오늘 요약
//   weekly   토 09:05  이번 주 장부 확정분 — 계좌 주간 손익 · +5% 달성 · 탭별 기여 · 그림자 교체 후보
// 같은 날짜·종류는 한 번만 보낸다. Telegram 실패가 주문·기록을 막지 않는다(Worker 가 기록 뒤에 부른다).
import { coinHoldToday, coinDayResult } from "./claude-live.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
const KINDS=["preopen","morning","etfbuy","close","weekly"];
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
  }else if(kind==="morning"){
    L.push("🤖 [클로드 단타] "+date+" 09:05 코인·미국");
    const cr=extra.coins||[];
    for(const c of cr)L.push("③ "+c.name+" 어제 "+(c.y?(c.y.action+(c.y.buyTime?" "+c.y.buyTime:"")+" "+p(c.y.pnlPct)):"—")+" · 오늘 "+(c.today==null?"—":(c.today?"어제 고가 "+n(c.level)+" 돌파 시 매수":"쉼(20일 평균 아래)")));
    if(cr.length){const avg=cr.reduce((s,c)=>s+((c.y&&c.y.pnlPct)||0),0)/cr.length;L.push("   코인 칸 어제 "+p(avg)+" (탭 자금 80% "+p(avg*0.8)+")");}
    const u=extra.us;
    if(u)L.push("④ SOXL 지난 세션 "+(u.date||"")+" "+(SX_ACT[u.action]||u.action||"")+(u.pnlPct==null?"":" "+p(u.pnlPct))+" · 오늘 밤 "+(SX_NEXT[u.next]||(u.holding?"보유 유지":"쉼")));
  }else if(kind==="etfbuy"){
    L.push("🤖 [클로드 단타] "+date+" 15:21 데이트레이딩");
    const buy=(d.rows||[]).find(x=>String(x.buyTime||"").startsWith("오늘"))||(d.rows||[]).find(x=>x.status==="매매 없음");
    if(buy&&buy.status!=="매매 없음")L.push("② 코스닥150 레버리지 −3% 이하 → 종가 모의 매수 "+n(buy.buyPrice)+" ("+buy.status+") → 내일 시가 매도");
    else L.push("② 매매 없음 — "+((buy&&buy.note)||"예상 하락이 −3% 이내"));
  }else if(kind==="close"){
    L.push("🤖 [클로드 단타] "+date+" 15:40 장 마감 결과");
    if((o.rows||[]).length){
      const v=o.rows.filter(r=>r.pnlPct!=null).map(r=>r.pnlPct);
      L.push("① 갭하락 과매도 "+(v.length?p(v.reduce((a,b)=>a+b,0)/v.length):"—")+" ("+o.rows.length+"종목 평균, 비용 후)");
      for(const r of o.rows)L.push(" · "+r.name+" "+n(r.buyPrice)+"→"+n(r.sellPrice||r.nowPrice)+" "+p(r.pnlPct)+" "+r.status);
    }else L.push("① 갭하락 과매도 — 오늘 매매 없음");
    const rs=(d.rows||[]).filter(x=>x.pnlPct!=null);
    if(rs.length)for(const r of rs)L.push("② ETF 야간 "+(r.buyTime||"")+"→"+(r.sellTime||"")+" "+p(r.pnlPct)+" "+r.status);
    const nb=(d.rows||[]).find(x=>String(x.buyTime||"").startsWith("오늘"));
    L.push("② 오늘 종가 매수: "+(nb?(nb.status==="매매 없음"?"없음":nb.status):"없음"));
    const cr=(T.crypto||{}).tabPct,us=(((T.soxl||{}).rows||[])[0]||{}).pnlPct;
    L.push("③ 코인(09시~지금) "+p(cr)+" · ④ SOXL "+(us==null?"장 시작 전":p(us)));
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
  }
  L.push("");
  L.push("모의투자 기록 · 자세히: jkquant.pages.dev/claude");
  return L.join("\n");
}

export function mondayOf(date){
  const d=new Date(date+"T00:00:00Z"),w=(d.getUTCDay()+6)%7;
  return new Date(d.getTime()-w*86400000).toISOString().slice(0,10);
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  let b={};try{b=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  const kind=String(b.kind||""),date=String(b.date||"");
  if(!KINDS.includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"kind/date 오류"},400);
  if(!(await claim("claude:"+date+":"+kind)))return json({ok:true,duplicate:true});
  try{
    const origin=new URL(request.url).origin;
    const live=await fetch(origin+"/api/claude-live",{headers:{Accept:"application/json"}}).then(r=>r.json()).catch(()=>null);
    const extra={};
    if(kind==="morning"){
      extra.coins=await Promise.all(["KRW-BTC","KRW-ETH"].map(async m=>{
        try{const [c,hc]=await Promise.all(["days?market="+m+"&count=23","minutes/60?market="+m+"&count=60"].map(q=>
            fetch("https://api.upbit.com/v1/candles/"+q,{headers:{Accept:"application/json"}}).then(r=>r.json())));
          const t=coinHoldToday(c);return {name:m.replace("KRW-",""),y:coinDayResult(c,hc),today:t?t.hold:null,level:t?t.level:null};}
        catch(e){return {name:m.replace("KRW-",""),y:null,today:null};}
      }));
      const lab=await fetch(RAW+"claude-lab/latest.json?t="+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null);
      const dec=await fetch(RAW+"claude-lab/soxl-mr-decisions.csv?t="+Date.now()).then(r=>r.ok?r.text():"").catch(()=>"");
      const ln=dec.trim().split("\n"),h=(ln[0]||"").split(","),last=(ln[ln.length-1]||"").split(",");
      const row=Object.fromEntries(h.map((k,i)=>[k,last[i]]));
      const nx=((lab&&lab.tabs&&lab.tabs.soxl)||{}).nextSignal;
      extra.us={date:row.date,action:row.action,pnlPct:row.pnlPct===""||row.pnlPct==null?null:+row.pnlPct,next:nx?nx.action:null,holding:nx?nx.holding:null};
    }
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
