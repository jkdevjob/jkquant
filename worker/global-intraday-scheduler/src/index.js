// Cloudflare Worker — BTC + SOXL intraday research signal scheduler
// Every minute, but signals are based only on completed 5m strategy bars.
// It sends Telegram research/paper alerts through Pages /api/scalping-alert.
// It NEVER places broker or exchange orders.

const FIVE=5*60*1000;
const BTC_OPEN_HM=0;
const BTC_LAST_SIGNAL_HM=2155; // 21:55 신호 -> 22:00 다음 5분봉 시가 진입
const BTC_LAST_ENTRY_HM=2200;
const BTC_EXIT_TRACK_END_HM=2305; // 22:00 진입의 최대 60분 청산까지 추적
const BTC_STRATEGY_VERSION="btc_midnight_orb_v2";
function baseUrl(env){return String(env.BASE_URL||"https://jkquant.pages.dev").replace(/\/$/,"");}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function parts(ms,tz){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,weekday:"short"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  const hh=+g("hour"),mm=+g("minute");
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hh,mm,hm:hh*100+mm,weekday:g("weekday")};
}
function signed(v,d=2){const n=Number(v||0);return (n>=0?"+":"")+n.toFixed(d)+"%";}
function money(v,currency){
  const n=Number(v||0);
  return currency==="KRW"?Math.round(n).toLocaleString("ko-KR")+"원":"$"+n.toFixed(2);
}
function reasonKo(r){return r==="take_profit"?"익절":r==="stop"||r==="stop_same_bar"?"손절":r==="time_exit"?"시간청산":String(r||"청산");}
async function alert(env,payload){
  try{
    const r=await fetch(baseUrl(env)+"/api/scalping-alert",{
      method:"POST",
      headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
      body:JSON.stringify(payload)
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));
    return j;
  }catch(e){
    console.error(JSON.stringify({type:"scalping_alert_error",strategy:payload.strategy,eventId:payload.eventId,error:String(e.message||e)}));
    return null;
  }
}
function barCompleted(tMs,now){return Number.isFinite(tMs)&&tMs+FIVE<=now-1500;}
function pct(a,b){return b>0?(a/b-1)*100:null;}

async function fetchBtc(targetDate){
  // Upbit 5분봉은 요청당 최대 200개라 22:00까지 보면 한 페이지로 자정 봉이 잘린다.
  // targetDate의 00:00 KST 봉을 확보할 때까지 최대 3페이지를 뒤로 넘긴다.
  const by=new Map();
  let to="";
  for(let page=0;page<3;page++){
    const q=new URLSearchParams({market:"KRW-BTC",count:"200"});
    if(to)q.set("to",to);
    const u="https://api.upbit.com/v1/candles/minutes/5?"+q.toString();
    const r=await fetch(u,{headers:{"accept":"application/json","user-agent":"jkquant-global-intraday/1.1"}});
    if(!r.ok)throw new Error("Upbit HTTP "+r.status);
    const a=await r.json();
    if(!Array.isArray(a)||!a.length)break;
    let oldest=Infinity;
    for(const x of a){
      const k=String(x.candle_date_time_kst||"");
      const ms=Date.parse(k+"+09:00");
      if(!Number.isFinite(ms))continue;
      oldest=Math.min(oldest,ms);
      by.set(String(ms),{ms,date:k.slice(0,10),hm:+k.slice(11,13)*100+(+k.slice(14,16)),time:k.slice(11,16),
        o:+x.opening_price||0,h:+x.high_price||0,l:+x.low_price||0,c:+x.trade_price||0,v:+x.candle_acc_trade_volume||0});
    }
    if([...by.values()].some(x=>x.date===targetDate&&x.hm===BTC_OPEN_HM))break;
    if(!Number.isFinite(oldest))break;
    to=new Date(oldest-1).toISOString();
    await sleep(120);
  }
  return [...by.values()].sort((a,b)=>a.ms-b.ms);
}
function btcTrade(bars,now,date){
  const a=bars.filter(x=>x.date===date);
  if(!a.length)return null;
  const oi=a.findIndex(x=>x.hm===BTC_OPEN_HM);
  if(oi<0)return null;
  const open=a[oi];
  if(!barCompleted(open.ms,now)||!(open.h>0)||!(open.v>0))return null;
  let pv=((open.h+open.l+open.c)/3)*open.v,cv=open.v;
  for(let i=oi+1;i<a.length-0;i++){
    const x=a[i];
    if(x.hm>BTC_LAST_SIGNAL_HM)break;
    if(!barCompleted(x.ms,now))break;
    const tp=(x.h+x.l+x.c)/3;pv+=tp*x.v;cv+=x.v;
    const vwap=cv>0?pv/cv:0,vr=x.v/open.v;
    const prev=a[i-1];
    const fresh=x.c>open.h&&prev.c<=open.h;
    if(!fresh||vr<1.2||!(x.c>vwap))continue;
    const entry=a[i+1];
    if(!entry)return {waiting:true,date,signal:x,opening:open,vwap,vr};
    if(entry.hm>BTC_LAST_ENTRY_HM)return null;
    const entryPrice=entry.o;
    if(!(entryPrice>0))return null;
    const stop=entryPrice*.995,tpPx=entryPrice*1.01,last=Math.min(a.length-1,i+1+12-1);
    let exit=null;
    for(let k=i+1;k<=last;k++){
      const b=a[k]; if(!barCompleted(b.ms,now))break;
      const hs=b.h>=tpPx,ls=b.l<=stop;
      if(ls&&hs){exit={bar:b,price:stop,reason:"stop_same_bar"};break;}
      if(ls){exit={bar:b,price:stop,reason:"stop"};break;}
      if(hs){exit={bar:b,price:tpPx,reason:"take_profit"};break;}
      if(k===last)exit={bar:b,price:b.c,reason:"time_exit"};
    }
    return {date,signal:x,opening:open,vwap,vr,entry,entryPrice,stop,tp:tpPx,exit,friction:.14};
  }
  return null;
}

async function fetchSoxl(){
  const q="?interval=5m&range=5d&includePrePost=false&events=div%2Csplits";
  let last=null;
  for(const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]){
    try{
      const r=await fetch("https://"+host+"/v8/finance/chart/SOXL"+q,{headers:{"user-agent":"Mozilla/5.0","accept":"application/json"}});
      if(!r.ok){last=new Error("Yahoo "+host+" HTTP "+r.status);continue;}
      const j=await r.json();
      const z=j&&j.chart&&j.chart.result&&j.chart.result[0];
      if(!z)continue;
      const ts=z.timestamp||[],qq=((z.indicators||{}).quote||[{}])[0];
      const O=qq.open||[],H=qq.high||[],L=qq.low||[],C=qq.close||[],V=qq.volume||[];
      return ts.map((t,i)=>{
        const p=parts(t*1000,"America/New_York");
        return {ms:t*1000,date:p.date,hm:p.hm,time:String(p.hh).padStart(2,"0")+":"+String(p.mm).padStart(2,"0"),
          o:+(O[i]??C[i])||0,h:+(H[i]??C[i])||0,l:+(L[i]??C[i])||0,c:+C[i]||0,v:+V[i]||0};
      }).filter(x=>x.c>0&&x.hm>=930&&x.hm<1600).sort((a,b)=>a.ms-b.ms);
    }catch(e){last=e;await sleep(200);}
  }
  throw last||new Error("Yahoo SOXL empty");
}
function soxlTrade(bars,now,date){
  const a=bars.filter(x=>x.date===date);
  if(a.length<4)return null;
  if(a[0].hm!==930||a[1].hm!==935||a[2].hm!==940)return null;
  if(!barCompleted(a[2].ms,now))return null;
  const opening=a.slice(0,3),orHigh=Math.max(...opening.map(x=>x.h)),orLow=Math.min(...opening.map(x=>x.l));
  let pv=0,cv=0;
  for(const x of opening){const tp=(x.h+x.l+x.c)/3;pv+=tp*x.v;cv+=x.v;}
  for(let i=3;i<a.length;i++){
    const x=a[i];
    if(x.hm>1130)break;
    if(!barCompleted(x.ms,now))break;
    const typical=(x.h+x.l+x.c)/3;pv+=typical*x.v;cv+=x.v;
    const vwap=cv>0?pv/cv:0,prev=a[i-1];
    const hist=a.slice(Math.max(0,i-6),i).map(z=>z.v).filter(v=>v>0);
    const ref=hist.length?hist.reduce((s,v)=>s+v,0)/hist.length:0,vr=ref>0?x.v/ref:0;
    const fresh=x.c>orHigh&&prev.c<=orHigh;
    if(!fresh||vr<1.0||!(x.c>vwap))continue;
    const entry=a[i+1];
    if(!entry)return {waiting:true,date,signal:x,orHigh,orLow,vwap,vr};
    const entryPrice=entry.o;if(!(entryPrice>0))return null;
    const stop=entryPrice*.988,tpPx=entryPrice*1.024,last=Math.min(a.length-1,i+1+18-1);
    let exit=null;
    for(let k=i+1;k<=last;k++){
      const b=a[k];if(!barCompleted(b.ms,now))break;
      const hs=b.h>=tpPx,ls=b.l<=stop;
      if(ls&&hs){exit={bar:b,price:stop,reason:"stop_same_bar"};break;}
      if(ls){exit={bar:b,price:stop,reason:"stop"};break;}
      if(hs){exit={bar:b,price:tpPx,reason:"take_profit"};break;}
      if(k===last)exit={bar:b,price:b.c,reason:"time_exit"};
    }
    return {date,signal:x,orHigh,orLow,vwap,vr,entry,entryPrice,stop,tp:tpPx,exit,friction:.20};
  }
  return null;
}
async function runBtc(env,now){
  const k=parts(now,"Asia/Seoul");
  // 신규 진입은 00:05~22:00 KST. 22:00 진입분은 최대 60분 청산까지 계속 추적한다.
  if(k.hm<5||k.hm>BTC_EXIT_TRACK_END_HM)return;
  const t=btcTrade(await fetchBtc(k.date),now,k.date);
  if(!t||t.waiting)return;
  await alert(env,{
    strategy:"crypto",stage:"buy",eventId:"crypto:"+BTC_STRATEGY_VERSION+":"+t.date+":"+t.signal.time+":buy",date:t.date,time:t.entry.time,
    lines:[
      "KRW-BTC · 00:00 ORB · 다음 5분봉 시가 "+money(t.entryPrice,"KRW"),
      "신호 "+t.signal.time+" · 00:00~00:05 OR고점 "+money(t.opening.h,"KRW")+" · VWAP "+money(t.vwap,"KRW")+" · 거래량 "+t.vr.toFixed(2)+"배",
      "신규진입: 22:00 KST까지 · 손절 "+money(t.stop,"KRW")+" (-0.50%) · 익절 "+money(t.tp,"KRW")+" (+1.00%) · 최대 60분",
      "비용가정: 수수료+슬리피지 왕복 0.14%"
    ]
  });
  if(t.exit){
    const gross=pct(t.exit.price,t.entryPrice),net=gross-t.friction;
    await alert(env,{
      strategy:"crypto",stage:"sell",eventId:"crypto:"+BTC_STRATEGY_VERSION+":"+t.date+":"+t.signal.time+":sell:"+t.exit.bar.time,date:t.date,time:t.exit.bar.time,
      lines:[
        "KRW-BTC · 00:00 ORB · "+reasonKo(t.exit.reason),
        "매수 "+t.entry.time+" · "+money(t.entryPrice,"KRW"),
        "매도 "+t.exit.bar.time+" · "+money(t.exit.price,"KRW"),
        "모의 순손익 "+signed(net)+" · 왕복 비용 0.14% 반영"
      ]
    });
  }
}
async function runSoxl(env,now){
  const n=parts(now,"America/New_York");
  if(["Sat","Sun"].includes(n.weekday)||n.hm<945||n.hm>1330)return;
  const t=soxlTrade(await fetchSoxl(),now,n.date);
  if(!t||t.waiting)return;
  await alert(env,{
    strategy:"soxl",stage:"buy",eventId:"soxl:"+t.date+":"+t.signal.time+":buy",date:t.date,time:t.entry.time+" ET",
    lines:[
      "SOXL · 다음 5분봉 시가 "+money(t.entryPrice,"USD"),
      "신호 "+t.signal.time+" ET · OR고점 "+money(t.orHigh,"USD")+" · VWAP "+money(t.vwap,"USD")+" · 거래량 "+t.vr.toFixed(2)+"배",
      "청산계획: 손절 "+money(t.stop,"USD")+" (-1.20%) · 익절 "+money(t.tp,"USD")+" (+2.40%) · 최대 90분",
      "비용가정: 왕복 마찰 0.20%"
    ]
  });
  if(t.exit){
    const gross=pct(t.exit.price,t.entryPrice),net=gross-t.friction;
    await alert(env,{
      strategy:"soxl",stage:"sell",eventId:"soxl:"+t.date+":"+t.signal.time+":sell:"+t.exit.bar.time,date:t.date,time:t.exit.bar.time+" ET",
      lines:[
        "SOXL · "+reasonKo(t.exit.reason),
        "매수 "+t.entry.time+" ET · "+money(t.entryPrice,"USD"),
        "매도 "+t.exit.bar.time+" ET · "+money(t.exit.price,"USD"),
        "모의 순손익 "+signed(net)+" · 왕복 마찰 0.20% 반영"
      ]
    });
  }
}
async function run(env){
  if(!env.MONITOR_KEY)throw new Error("MONITOR_KEY secret missing");
  const now=Date.now();
  const out=await Promise.allSettled([runBtc(env,now),runSoxl(env,now)]);
  out.forEach((x,i)=>{if(x.status==="rejected")console.error(JSON.stringify({type:"global_intraday_error",strategy:i===0?"crypto":"soxl",error:String(x.reason&&x.reason.message||x.reason)}));});
}
export {btcTrade,BTC_OPEN_HM,BTC_LAST_SIGNAL_HM,BTC_LAST_ENTRY_HM,BTC_EXIT_TRACK_END_HM,BTC_STRATEGY_VERSION};

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil(run(env));},
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/health")return new Response(JSON.stringify({ok:true,service:"jkquant-global-intraday-scheduler",schedule:"every minute",strategies:["crypto","soxl"],crypto:{strategyVersion:BTC_STRATEGY_VERSION,openingRange:"00:00~00:05 KST",newEntryThrough:"22:00 KST",exitTrackingThrough:"23:05 KST"},mode:"research-paper-alert-no-order"}),{headers:{"content-type":"application/json","cache-control":"no-store"}});
    return new Response("not found",{status:404});
  }
};
