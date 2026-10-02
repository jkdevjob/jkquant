import { DurableObject } from "cloudflare:workers";

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
const SOXL_STRATEGY_VERSION="soxl_orb_v1";
const SOXL_LAST_SIGNAL_HM=1130;
const SOXL_PAPER_TRACK_END_HM=1605;
const BTC_VARIANTS=Object.freeze({
  baseline:{rangeBars:1,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12},
  no_vwap:{rangeBars:1,volumeMult:1.2,useVwap:false,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12},
  "vol_1.0":{rangeBars:1,volumeMult:1.0,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12},
  "vol_1.5":{rangeBars:1,volumeMult:1.5,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12},
  range_15m:{rangeBars:3,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12},
  range_30m:{rangeBars:6,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12},
  "stop_0.3_tp_0.6":{rangeBars:1,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.3,takeProfitPct:.6,maxHoldBars:12},
  "stop_0.7_tp_1.4":{rangeBars:1,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.7,takeProfitPct:1.4,maxHoldBars:12},
  hold_30m:{rangeBars:1,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:6},
  hold_120m:{rangeBars:1,volumeMult:1.2,useVwap:true,entryCutoffHm:2155,stopPct:.5,takeProfitPct:1.0,maxHoldBars:24},
  entry_by_1800:{rangeBars:1,volumeMult:1.2,useVwap:true,entryCutoffHm:1755,stopPct:.5,takeProfitPct:1.0,maxHoldBars:12}
});
const SOXL_VARIANTS=Object.freeze({
  baseline:{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18},
  range_5m:{rangeBars:1,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18},
  range_30m:{rangeBars:6,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18},
  "vol_0.8":{rangeBars:3,volumeLookback:6,volumeMult:.8,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18},
  "vol_1.2":{rangeBars:3,volumeLookback:6,volumeMult:1.2,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18},
  no_vwap:{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:false,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18},
  "stop_0.8_tp_1.6":{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:.8,takeProfitPct:1.6,maxHoldBars:18},
  "stop_1.5_tp_3.0":{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:1.5,takeProfitPct:3.0,maxHoldBars:18},
  hold_45m:{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:9},
  hold_120m:{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1130,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:24},
  entry_by_1030:{rangeBars:3,volumeLookback:6,volumeMult:1.0,useVwap:true,entryCutoffHm:1030,stopPct:1.2,takeProfitPct:2.4,maxHoldBars:18}
});
function variantParams(strategy,name){
  const map=strategy==="crypto"?BTC_VARIANTS:SOXL_VARIANTS;
  return {name:map[name]?name:"baseline",params:map[name]||map.baseline};
}
function json(o,status=200){return new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function authorized(request,env){const got=request.headers.get("x-monitor-key")||"";return !!env.MONITOR_KEY&&got===env.MONITOR_KEY;}

export class PaperStore extends DurableObject{
  async fetch(request){
    const u=new URL(request.url);
    if(request.method==="GET"&&u.pathname==="/config"){
      const strategy=String(u.searchParams.get("strategy")||"");
      const config=(await this.ctx.storage.get("strategyConfig"))||{schema:1,strategy,selectedVariant:"baseline",updatedAt:null,updatedBy:null};
      return json({ok:true,config});
    }
    if(request.method==="POST"&&u.pathname==="/config"){
      const b=await request.json(),strategy=String(b&&b.strategy||""),variant=String(b&&b.variant||"");
      const map=strategy==="crypto"?BTC_VARIANTS:strategy==="soxl"?SOXL_VARIANTS:null;
      if(!map||!map[variant])return json({ok:false,error:"unsupported strategy/variant"},400);
      const config={schema:1,strategy,selectedVariant:variant,updatedAt:new Date().toISOString(),updatedBy:String(b.updatedBy||"owner"),source:String(b.source||"manual-promotion")};
      await this.ctx.storage.put("strategyConfig",config);
      return json({ok:true,config});
    }
    if(request.method==="GET"&&u.pathname==="/paper"){
      return json({ok:true,ledger:(await this.ctx.storage.get("ledger"))||null});
    }
    if(request.method==="POST"&&u.pathname==="/paper"){
      const ledger=await request.json();
      if(!ledger||!ledger.strategy||!ledger.date||!Array.isArray(ledger.trades))return json({ok:false,error:"invalid paper ledger"},400);
      await this.ctx.storage.put("ledger",ledger);
      return json({ok:true,ledger});
    }
    return json({ok:false,error:"not found"},404);
  }
}
function paperStore(env,strategy,date){return env.PAPER_STORE.get(env.PAPER_STORE.idFromName(strategy+":"+date));}
function configStore(env,strategy){return env.PAPER_STORE.get(env.PAPER_STORE.idFromName("__gpt_strategy_config__:"+strategy));}
async function readStrategyConfig(env,strategy){
  const r=await configStore(env,strategy).fetch("https://paper.internal/config?strategy="+encodeURIComponent(strategy));
  const j=await r.json().catch(()=>({}));
  return j.config||{schema:1,strategy,selectedVariant:"baseline",updatedAt:null};
}
async function writeStrategyConfig(env,strategy,b){
  const r=await configStore(env,strategy).fetch("https://paper.internal/config",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...b,strategy})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("config store HTTP "+r.status));
  return j.config;
}
async function mainVariantForDate(env,strategy,date){
  const ledger=await readPaper(env,strategy,date).catch(()=>null);
  if(ledger&&ledger.mainVariant)return String(ledger.mainVariant);
  const cfg=await readStrategyConfig(env,strategy);
  return variantParams(strategy,String(cfg.selectedVariant||"baseline")).name;
}
async function readPaper(env,strategy,date){
  const r=await paperStore(env,strategy,date).fetch("https://paper.internal/paper");
  const j=await r.json(); return j.ledger||null;
}
async function writePaper(env,ledger){
  const r=await paperStore(env,ledger.strategy,ledger.date).fetch("https://paper.internal/paper",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(ledger)
  });
  const j=await r.json(); if(!r.ok||!j.ok)throw new Error(j.error||("paper store HTTP "+r.status)); return j.ledger;
}
function paperLedger(strategy,date,t,opts={}){
  const currency=opts.currency||"USD",timezone=opts.timezone||"UTC",version=opts.version||"",friction=Number(opts.friction||0);
  let trades=[];
  if(t){
    const waiting=!!t.waiting;
    const current=t.exit?t.exit.bar:(t.currentBar||t.entry||null);
    const entryPrice=waiting?null:Number(t.entryPrice||0)||null;
    const exitPrice=t.exit?Number(t.exit.price||0)||null:null;
    const currentPrice=current?Number(current.c||current.o||0)||null:entryPrice;
    let gross=null,pnl=null;
    if(entryPrice&&((exitPrice||currentPrice)>0)){
      gross=pct(exitPrice||currentPrice,entryPrice);
      pnl=gross-friction;
    }
    trades=[{
      id:strategy+":"+date+":"+String(t.signal&&t.signal.time||""),
      strategyVersion:version,mainVariant:String(opts.mainVariant||"baseline"),strategyParams:opts.params||t.params||null,status:waiting?"pending":(t.exit?"closed":"open"),
      signalTime:t.signal&&t.signal.time||null,entryTime:t.entry&&t.entry.time||null,
      exitTime:t.exit&&t.exit.bar&&t.exit.bar.time||null,
      entryPrice,exitPrice,currentPrice,
      reason:t.exit?t.exit.reason:(waiting?"next_bar_open_wait":"tracking"),
      grossPnlPct:gross,pnlPct:pnl,frictionPct:friction,
      currency,updatedAt:new Date().toISOString()
    }];
  }
  const live=trades.map(x=>Number(x.pnlPct)).filter(Number.isFinite);
  const sum=live.reduce((a,b)=>a+b,0);
  return {
    schema:1,strategy,date,timezone,strategyVersion:version,mainVariant:String(opts.mainVariant||"baseline"),strategyParams:opts.params||t?.params||null,mode:"server-live-paper-no-order",
    updatedAt:new Date().toISOString(),slots:1,frictionPct:friction,trades,
    summary:{selected:trades.length,pending:trades.filter(x=>x.status==="pending").length,open:trades.filter(x=>x.status==="open").length,
      closed:trades.filter(x=>x.status==="closed").length,accountReturnPct:sum,tradeSumPct:sum}
  };
}
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
function btcTrade(bars,now,date,overrides={}){
  const p={...BTC_VARIANTS.baseline,...(overrides||{})};
  const a=bars.filter(x=>x.date===date);
  if(a.length<p.rangeBars+2)return null;
  const oi=a.findIndex(x=>x.hm===BTC_OPEN_HM);
  if(oi<0)return null;
  const opening=a.slice(oi,oi+p.rangeBars);
  if(opening.length!==p.rangeBars)return null;
  for(let k=0;k<opening.length;k++)if(opening[k].hm!==k*5)return null;
  if(!opening.every(x=>barCompleted(x.ms,now)))return null;
  const orHigh=Math.max(...opening.map(x=>x.h)),orLow=Math.min(...opening.map(x=>x.l));
  const baseVol=opening.reduce((s,x)=>s+x.v,0)/opening.length;
  if(!(orHigh>0)||!(baseVol>0))return null;
  let pv=0,cv=0;
  for(const z of opening){const tp=(z.h+z.l+z.c)/3;pv+=tp*z.v;cv+=z.v;}
  for(let i=oi+p.rangeBars;i<a.length;i++){
    const x=a[i];
    if(x.hm>p.entryCutoffHm)break;
    if(!barCompleted(x.ms,now))break;
    const tp=(x.h+x.l+x.c)/3;pv+=tp*x.v;cv+=x.v;
    const vwap=cv>0?pv/cv:0,vr=x.v/baseVol,prev=a[i-1];
    const fresh=x.c>orHigh&&prev.c<=orHigh;
    if(!fresh||vr<p.volumeMult||(p.useVwap&&!(x.c>vwap)))continue;
    const entry=a[i+1];
    if(!entry)return {waiting:true,date,signal:x,opening:{h:orHigh,l:orLow},vwap,vr,params:p};
    if(entry.hm>BTC_LAST_ENTRY_HM)return null;
    const entryPrice=entry.o;if(!(entryPrice>0))return null;
    const stop=entryPrice*(1-p.stopPct/100),tpPx=entryPrice*(1+p.takeProfitPct/100),last=Math.min(a.length-1,i+1+p.maxHoldBars-1);
    let exit=null;
    for(let k=i+1;k<=last;k++){
      const b=a[k];if(!barCompleted(b.ms,now))break;
      const hs=b.h>=tpPx,ls=b.l<=stop;
      if(ls&&hs){exit={bar:b,price:stop,reason:"stop_same_bar"};break;}
      if(ls){exit={bar:b,price:stop,reason:"stop"};break;}
      if(hs){exit={bar:b,price:tpPx,reason:"take_profit"};break;}
      if(k===last)exit={bar:b,price:b.c,reason:"time_exit"};
    }
    const completed=a.slice(i+1,last+1).filter(b=>barCompleted(b.ms,now));
    const currentBar=exit?exit.bar:(completed.length?completed[completed.length-1]:entry);
    return {date,signal:x,opening:{h:orHigh,l:orLow},vwap,vr,entry,entryPrice,stop,tp:tpPx,exit,currentBar,friction:.14,params:p};
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
function soxlTrade(bars,now,date,overrides={}){
  const p={...SOXL_VARIANTS.baseline,...(overrides||{})};
  const a=bars.filter(x=>x.date===date);
  if(a.length<p.rangeBars+2)return null;
  for(let i=0;i<p.rangeBars;i++){
    const minute=9*60+30+i*5,expected=Math.floor(minute/60)*100+(minute%60);
    if(!a[i]||a[i].hm!==expected||!barCompleted(a[i].ms,now))return null;
  }
  const opening=a.slice(0,p.rangeBars),orHigh=Math.max(...opening.map(x=>x.h)),orLow=Math.min(...opening.map(x=>x.l));
  let pv=0,cv=0;
  for(const x of opening){const tp=(x.h+x.l+x.c)/3;pv+=tp*x.v;cv+=x.v;}
  for(let i=p.rangeBars;i<a.length;i++){
    const x=a[i];
    if(x.hm>p.entryCutoffHm)break;
    if(!barCompleted(x.ms,now))break;
    const typical=(x.h+x.l+x.c)/3;pv+=typical*x.v;cv+=x.v;
    const vwap=cv>0?pv/cv:0,prev=a[i-1];
    const hist=a.slice(Math.max(0,i-p.volumeLookback),i).map(z=>z.v).filter(v=>v>0);
    const ref=hist.length?hist.reduce((s,v)=>s+v,0)/hist.length:0,vr=ref>0?x.v/ref:0;
    const fresh=x.c>orHigh&&prev.c<=orHigh;
    if(!fresh||vr<p.volumeMult||(p.useVwap&&!(x.c>vwap)))continue;
    const entry=a[i+1];
    if(!entry)return {waiting:true,date,signal:x,orHigh,orLow,vwap,vr,params:p};
    const entryPrice=entry.o;if(!(entryPrice>0))return null;
    const stop=entryPrice*(1-p.stopPct/100),tpPx=entryPrice*(1+p.takeProfitPct/100),last=Math.min(a.length-1,i+1+p.maxHoldBars-1);
    let exit=null;
    for(let k=i+1;k<=last;k++){
      const b=a[k];if(!barCompleted(b.ms,now))break;
      const hs=b.h>=tpPx,ls=b.l<=stop;
      if(ls&&hs){exit={bar:b,price:stop,reason:"stop_same_bar"};break;}
      if(ls){exit={bar:b,price:stop,reason:"stop"};break;}
      if(hs){exit={bar:b,price:tpPx,reason:"take_profit"};break;}
      if(k===last)exit={bar:b,price:b.c,reason:"time_exit"};
    }
    const completed=a.slice(i+1,last+1).filter(b=>barCompleted(b.ms,now));
    const currentBar=exit?exit.bar:(completed.length?completed[completed.length-1]:entry);
    return {date,signal:x,orHigh,orLow,vwap,vr,entry,entryPrice,stop,tp:tpPx,exit,currentBar,friction:.20,params:p};
  }
  return null;
}
async function runBtc(env,now){
  const k=parts(now,"Asia/Seoul");
  // 신규 진입은 00:05~22:00 KST. 22:00 진입분은 최대 60분 청산까지 계속 추적한다.
  if(k.hm<5||k.hm>BTC_EXIT_TRACK_END_HM)return;
  const mainVariant=await mainVariantForDate(env,"crypto",k.date),vp=variantParams("crypto",mainVariant);
  const t=btcTrade(await fetchBtc(k.date),now,k.date,vp.params);
  await writePaper(env,paperLedger("crypto",k.date,t,{currency:"KRW",timezone:"Asia/Seoul",version:BTC_STRATEGY_VERSION+"@"+vp.name,mainVariant:vp.name,params:vp.params,friction:.14}));
  if(!t||t.waiting)return;
  await alert(env,{
    strategy:"crypto",stage:"buy",eventId:"crypto:"+BTC_STRATEGY_VERSION+"@"+mainVariant+":"+t.date+":"+t.signal.time+":buy",date:t.date,time:t.entry.time,
    lines:[
      "KRW-BTC · 메인 "+mainVariant+" · 다음 5분봉 시가 "+money(t.entryPrice,"KRW"),
      "신호 "+t.signal.time+" · 00:00~00:05 OR고점 "+money(t.opening.h,"KRW")+" · VWAP "+money(t.vwap,"KRW")+" · 거래량 "+t.vr.toFixed(2)+"배",
      "손절 "+money(t.stop,"KRW")+" (-"+t.params.stopPct.toFixed(2)+"%) · 익절 "+money(t.tp,"KRW")+" (+"+t.params.takeProfitPct.toFixed(2)+"%) · 최대 "+(t.params.maxHoldBars*5)+"분",
      "비용가정: 수수료+슬리피지 왕복 0.14%"
    ]
  });
  if(t.exit){
    const gross=pct(t.exit.price,t.entryPrice),net=gross-t.friction;
    await alert(env,{
      strategy:"crypto",stage:"sell",eventId:"crypto:"+BTC_STRATEGY_VERSION+"@"+mainVariant+":"+t.date+":"+t.signal.time+":sell:"+t.exit.bar.time,date:t.date,time:t.exit.bar.time,
      lines:[
        "KRW-BTC · 메인 "+mainVariant+" · "+reasonKo(t.exit.reason),
        "매수 "+t.entry.time+" · "+money(t.entryPrice,"KRW"),
        "매도 "+t.exit.bar.time+" · "+money(t.exit.price,"KRW"),
        "모의 순손익 "+signed(net)+" · 왕복 비용 0.14% 반영"
      ]
    });
  }
}
async function runSoxl(env,now){
  const n=parts(now,"America/New_York");
  if(["Sat","Sun"].includes(n.weekday)||n.hm<935||n.hm>SOXL_PAPER_TRACK_END_HM)return;
  const mainVariant=await mainVariantForDate(env,"soxl",n.date),vp=variantParams("soxl",mainVariant);
  const t=soxlTrade(await fetchSoxl(),now,n.date,vp.params);
  await writePaper(env,paperLedger("soxl",n.date,t,{currency:"USD",timezone:"America/New_York",version:SOXL_STRATEGY_VERSION+"@"+vp.name,mainVariant:vp.name,params:vp.params,friction:.20}));
  if(!t||t.waiting)return;
  await alert(env,{
    strategy:"soxl",stage:"buy",eventId:"soxl:"+mainVariant+":"+t.date+":"+t.signal.time+":buy",date:t.date,time:t.entry.time+" ET",
    lines:[
      "SOXL · 메인 "+mainVariant+" · 다음 5분봉 시가 "+money(t.entryPrice,"USD"),
      "신호 "+t.signal.time+" ET · OR고점 "+money(t.orHigh,"USD")+" · VWAP "+money(t.vwap,"USD")+" · 거래량 "+t.vr.toFixed(2)+"배",
      "청산계획: 손절 "+money(t.stop,"USD")+" (-"+t.params.stopPct.toFixed(2)+"%) · 익절 "+money(t.tp,"USD")+" (+"+t.params.takeProfitPct.toFixed(2)+"%) · 최대 "+(t.params.maxHoldBars*5)+"분",
      "비용가정: 왕복 마찰 0.20%"
    ]
  });
  if(t.exit){
    const gross=pct(t.exit.price,t.entryPrice),net=gross-t.friction;
    await alert(env,{
      strategy:"soxl",stage:"sell",eventId:"soxl:"+mainVariant+":"+t.date+":"+t.signal.time+":sell:"+t.exit.bar.time,date:t.date,time:t.exit.bar.time+" ET",
      lines:[
        "SOXL · 메인 "+mainVariant+" · "+reasonKo(t.exit.reason),
        "매수 "+t.entry.time+" ET · "+money(t.entryPrice,"USD"),
        "매도 "+t.exit.bar.time+" ET · "+money(t.exit.price,"USD"),
        "모의 순손익 "+signed(net)+" · 왕복 마찰 0.20% 반영"
      ]
    });
  }
}
function previousDate(date){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
async function sendCloseSummary(env,strategy,date,timeLabel){
  const ledger=await readPaper(env,strategy,date);
  const a=ledger&&Array.isArray(ledger.trades)?ledger.trades:[];
  const closed=a.filter(x=>x.status==="closed"),open=a.filter(x=>x.status==="open"),pending=a.filter(x=>x.status==="pending");
  const pn=closed.map(x=>Number(x.pnlPct)).filter(Number.isFinite),wins=pn.filter(x=>x>0).length,losses=pn.filter(x=>x<0).length;
  const avg=pn.length?pn.reduce((s,x)=>s+x,0)/pn.length:0;
  const friction=Number(ledger&&ledger.frictionPct||0);
  const lines=[
    "후보/진입 "+a.length+"건 · 청산 "+closed.length+"건 · 미청산 "+open.length+"건 · 대기 "+pending.length+"건",
    "승 "+wins+" · 패 "+losses+" · 승률 "+(pn.length?(wins/pn.length*100).toFixed(1):"0.0")+"%",
    "실현 평균 순수익률 "+signed(avg)+" · 왕복 마찰비용 "+friction.toFixed(2)+"% 반영"
  ];
  for(const x of closed)lines.push((strategy==="crypto"?"KRW-BTC":"SOXL")+" · "+String(x.entryTime||"—")+"→"+String(x.exitTime||"—")+" · "+signed(x.pnlPct)+" · "+reasonKo(x.reason));
  if(!a.length)lines.push("오늘 조건 충족 모의거래 없음");
  return alert(env,{strategy,stage:"summary",eventId:strategy+":"+date+":close-summary",date,time:timeLabel,lines});
}
async function runCloseSummaries(env,now){
  const k=parts(now,"Asia/Seoul");
  if(k.hm===5)await sendCloseSummary(env,"crypto",previousDate(k.date),"00:05 KST");
  const n=parts(now,"America/New_York");
  if(!["Sat","Sun"].includes(n.weekday)&&n.hm===1605)await sendCloseSummary(env,"soxl",n.date,"16:05 ET");
}

async function run(env){
  if(!env.MONITOR_KEY)throw new Error("MONITOR_KEY secret missing");
  const now=Date.now();
  const out=await Promise.allSettled([runBtc(env,now),runSoxl(env,now),runCloseSummaries(env,now)]);
  out.forEach((x,i)=>{if(x.status==="rejected")console.error(JSON.stringify({type:"global_intraday_error",strategy:i===0?"crypto":i===1?"soxl":"close-summary",error:String(x.reason&&x.reason.message||x.reason)}));});
}
export {btcTrade,soxlTrade,paperLedger,variantParams,BTC_VARIANTS,SOXL_VARIANTS,BTC_OPEN_HM,BTC_LAST_SIGNAL_HM,BTC_LAST_ENTRY_HM,BTC_EXIT_TRACK_END_HM,BTC_STRATEGY_VERSION,SOXL_STRATEGY_VERSION,SOXL_LAST_SIGNAL_HM,SOXL_PAPER_TRACK_END_HM};

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil(run(env));},
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/health")return json({ok:true,service:"jkquant-global-intraday-scheduler",schedule:"every minute",strategies:["crypto","soxl"],crypto:{strategyVersion:BTC_STRATEGY_VERSION,openingRange:"00:00~00:05 KST",newEntryThrough:"22:00 KST",exitTrackingThrough:"23:05 KST"},soxl:{symbol:"SOXL",strategyVersion:SOXL_STRATEGY_VERSION,openingRange:"09:30~09:45 ET",newEntryThrough:"11:30 ET",paperTrackingThrough:"16:05 ET",overnight:false},mode:"research-paper-alert-no-order",manualPromotion:"owner button -> next session lock"});
    if(u.pathname==="/bars"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const strategy=String(u.searchParams.get("strategy")||"").toLowerCase();
      if(strategy!=="soxl")return json({ok:false,error:"unsupported strategy"},400);
      const bars=await fetchSoxl();
      return json({ok:true,strategy:"soxl",symbol:"SOXL",source:"Yahoo via Cloudflare Worker",fetchedAt:new Date().toISOString(),bars});
    }
    if(u.pathname==="/config"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const strategy=String(u.searchParams.get("strategy")||"").toLowerCase();
      if(!["crypto","soxl"].includes(strategy))return json({ok:false,error:"unsupported strategy"},400);
      try{
        if(request.method==="GET")return json({ok:true,config:await readStrategyConfig(env,strategy)});
        if(request.method==="POST"){
          const b=await request.json();
          return json({ok:true,config:await writeStrategyConfig(env,strategy,b)});
        }
        return json({ok:false,error:"method not allowed"},405);
      }catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    if(u.pathname==="/paper"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const strategy=String(u.searchParams.get("strategy")||"").toLowerCase();
      if(!["crypto","soxl"].includes(strategy))return json({ok:false,error:"unsupported strategy"},400);
      const now=Date.now(),tz=strategy==="crypto"?"Asia/Seoul":"America/New_York";
      const date=String(u.searchParams.get("date")||parts(now,tz).date);
      return json({ok:true,strategy,date,ledger:await readPaper(env,strategy,date)});
    }
    return json({ok:false,error:"not found"},404);
  }
};
