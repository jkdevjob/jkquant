// Cloudflare Pages Function — /api/opening-monitor
// 브라우저 없이 시초가 눌림→재돌파 기준전략을 서버에서 감시하고 Telegram으로 모의 매수/매도 신호를 보낸다.
// 연구용 shadow 전략은 같은 분봉/같은 엔진으로 동시에 계산하지만 실제 알림/주문에는 영향을 주지 않고 기록만 한다.

import { minuteVolume, dailyMeta, rebreakTrade, SHADOW_VARIANTS } from "./_opening.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FIREBASE_API_KEY_FALLBACK="AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS=["jk82investing@gmail.com"];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const VTS_ORDER_GAP_MS=2300;
let _lastVtsOrderAt=0;

function hhmm(t){
  const s=String(t||"").replace(/\D/g,"").padStart(6,"0").slice(-6);
  return /^\d{6}$/.test(s)?+s.slice(0,4):0;
}
function hmMin(v){const n=+v||0;return Math.floor(n/100)*60+n%100;}
function sigId(date,x,side){return ["opening",date,x.code,x.entryTime,side].join(":");}
function vtsBudget(env){
  const n=+env.SCALPING_VTS_BUDGET;
  return n>0?Math.floor(n):2000000;
}
async function paceVtsOrder(){
  const wait=_lastVtsOrderAt?VTS_ORDER_GAP_MS-(Date.now()-_lastVtsOrderAt):0;
  if(wait>0)await sleep(wait);
  _lastVtsOrderAt=Date.now();
}
async function vtsOrder(origin,env,date,x,side,qty){
  const paperPrice=side==="buy"?+x.entryPrice||0:+x.exitPrice||0;
  const paperTime=side==="buy"?+x.entryTime||0:+x.exitTime||0;
  const rec={
    signalId:sigId(date,x,side),strategy:"opening",date,side,code:x.code,name:x.name||x.code,qty,
    paper:{time:paperTime,fillPrice:paperPrice,fillModel:"completed 1m close",roundTripCostAssumptionPct:0.25},
    submittedAt:new Date().toISOString(),vts:{ok:false,orderNo:"",msg:""}
  };
  if(!(qty>0)){rec.vts.msg="주문수량 0 — 예산/기준가 확인";return rec;}
  try{
    await paceVtsOrder();
    rec.submittedAt=new Date().toISOString();
    const r=await fetch(origin+"/api/kis?op=order&internal=1",{
      method:"POST",
      headers:{"content-type":"application/json","x-autotrade-key":env.AUTOTRADE_KEY},
      body:JSON.stringify({env:"vts",side,code:x.code,qty,price:0,priceType:"market"})
    });
    const j=await r.json().catch(()=>({}));
    rec.vts={ok:r.ok&&!!j.ok,orderNo:j.orderNo||"",msg:j.msg||j.error||("HTTP "+r.status),
      priceType:"market",env:"vts",httpStatus:r.status};
  }catch(e){rec.vts.msg="VTS 주문 전송 실패: "+String(e.message||e);}
  return rec;
}
async function vtsFilledOpeningQty(origin,env,date,x){
  try{
    await sleep(700);
    const u=origin+"/api/kis?op=orders&env=vts&market=kr&date="+encodeURIComponent(date.replace(/-/g,""))+
      "&code="+encodeURIComponent(x.code);
    const r=await fetch(u,{headers:{"x-autotrade-key":env.AUTOTRADE_KEY,"Accept":"application/json"}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return {qty:0,error:j.error||("HTTP "+r.status)};
    const ent=hmMin(x.entryTime),orders=j.orders||[];
    // 같은 종목을 다른 전략/수동으로 보유했더라도 건드리지 않도록
    // 내부 시초가 진입시각 ±5분의 VTS 매수 체결만 이 전략 물량으로 본다.
    const buys=orders.filter(o=>String(o.sideCode)==="02"&&+o.fillQty>0&&Math.abs(hmMin(hhmm(o.orderTime))-ent)<=5);
    const buyQty=buys.reduce((s,o)=>s+(+o.fillQty||0),0);
    if(!buyQty)return {qty:0,error:"시초가 매수 체결수량 0"};
    const firstBuy=Math.min(...buys.map(o=>hmMin(hhmm(o.orderTime))).filter(Number.isFinite));
    const sells=orders.filter(o=>String(o.sideCode)==="01"&&+o.fillQty>0&&hmMin(hhmm(o.orderTime))>=firstBuy);
    const sold=sells.reduce((s,o)=>s+(+o.fillQty||0),0);
    return {qty:Math.max(0,buyQty-sold),buyQty,sold};
  }catch(e){return {qty:0,error:String(e.message||e)};}
}
async function dualVtsExecute(origin,env,date,buys,sells){
  const enabled=String(env.SCALPING_VTS_AUTO||"1")!=="0";
  const budget=vtsBudget(env),events=[];
  if(!enabled)return {enabled:false,budget,reason:"SCALPING_VTS_AUTO=0",events};
  if(!env.AUTOTRADE_KEY)return {enabled:false,budget,reason:"AUTOTRADE_KEY 없음",events};
  // 내부 모의체결은 rebreakTrade가 이미 만든 entry/exit 가격이다.
  // 같은 이벤트에 VTS 시장가 주문을 내고, 이후 reconcile에서 VTS 실제 모의체결가와 대조한다.
  for(const x of buys){
    const qty=Math.floor(budget/Math.max(1,+x.entryPrice||0));
    events.push(await vtsOrder(origin,env,date,x,"buy",qty));
  }
  for(const x of sells){
    const pos=await vtsFilledOpeningQty(origin,env,date,x);
    if(!(pos.qty>0)){
      events.push({
        signalId:sigId(date,x,"sell"),strategy:"opening",date,side:"sell",code:x.code,name:x.name||x.code,qty:0,
        paper:{time:+x.exitTime||0,fillPrice:+x.exitPrice||0,fillModel:"completed 1m close",roundTripCostAssumptionPct:0.25},
        submittedAt:new Date().toISOString(),
        vts:{ok:false,orderNo:"",msg:"매도 생략 — "+(pos.error||"이 전략의 VTS 보유수량 없음"),priceType:"market",env:"vts"}
      });
      continue;
    }
    events.push(await vtsOrder(origin,env,date,x,"sell",pos.qty));
  }
  return {enabled:true,budget,events};
}

function kstNow(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value||"",hh=+g("hour"),mm=+g("minute");
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:hh*100+mm,hh,mm,targetHm:mm>0?hh*100+(mm-1):(hh-1)*100+59};
}
function monitorAuthorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
function owners(env){
  const raw=String(env.OWNER_EMAIL||"").trim();
  return raw?raw.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean):DEFAULT_OWNERS;
}
async function ownerAuthorized(request,env){
  const auth=request.headers.get("Authorization")||"",idToken=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!idToken)return false;
  try{
    const key=env.FIREBASE_API_KEY||FIREBASE_API_KEY_FALLBACK;
    const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+key,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})
    });
    const j=await r.json().catch(()=>({})),u=j.users&&j.users[0],email=u?String(u.email||"").toLowerCase():"";
    return !!email&&owners(env).includes(email);
  }catch(e){return false;}
}
async function sendTelegram(env,title,lines){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)throw new Error("Telegram 환경변수 없음");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:"🔥 "+title+"\n\n"+lines.join("\n"),disable_web_page_preview:true})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("Telegram 전송 실패: "+(j.description||r.status));
  return {ok:true,messageId:j.result&&j.result.message_id};
}

function emptyShadow(){
  return Object.fromEntries(SHADOW_VARIANTS.map(v=>[v.name,{
    name:v.name,label:v.label,description:v.description,params:v.params,trades:[]
  }]));
}

async function scanShard(origin,now,shard,shards,limit,cutoffHm){
  const uj=await (await fetch(origin+"/api/universe?limit="+limit)).json();
  const universe=(uj.universe||[]).filter((_,i)=>i%shards===shard);
  const trades=[],shadow=emptyShadow(),errors=[];let idx=0;

  async function worker(){
    while(idx<universe.length){
      const u=universe[idx++];
      try{
        const [mj,dj]=await Promise.all([
          fetch(origin+"/api/quote?symbol="+encodeURIComponent(u.code)+"&minute=1").then(r=>r.json()),
          fetch(origin+"/api/quote?symbol="+encodeURIComponent(u.code)+"&range=5d&intraday=0&div=0").then(r=>r.json())
        ]);
        if(!mj.minutes||!mj.minutes.length||!dj.ohlc||!dj.ohlc.length)continue;

        const rows=minuteVolume(mj.minutes).filter(x=>String(x.t||"").slice(0,10)===now.date);
        const meta=dailyMeta(dj,now.date);
        if(!meta)continue;

        const base=rebreakTrade(rows,meta,cutoffHm);
        if(base)trades.push({code:u.code,name:u.name||u.code,...base});

        for(const v of SHADOW_VARIANTS){
          const tr=rebreakTrade(rows,meta,cutoffHm,v.params);
          if(tr)shadow[v.name].trades.push({code:u.code,name:u.name||u.code,...tr});
        }
      }catch(e){
        errors.push({code:u.code,error:String(e.message||e).slice(0,120)});
      }
    }
  }
  await Promise.all([worker(),worker()]);

  const sorter=(a,b)=>a.entryTime-b.entryTime||(b.amountRatio-a.amountRatio)||String(a.code).localeCompare(String(b.code));
  trades.sort(sorter);
  Object.values(shadow).forEach(x=>x.trades.sort(sorter));
  return {universe:universe.length,trades,shadow,errors};
}
function buyLines(rows){
  return rows.flatMap((x,i)=>[
    (i+1)+". "+x.name+" ("+x.code+")",
    "매수신호 "+String(x.entryTime).padStart(4,"0")+" · "+Math.round(x.entryPrice).toLocaleString("ko-KR")+"원",
    "갭 "+(x.gap>=0?"+":"")+x.gap.toFixed(2)+"% · 눌림 -"+x.pullbackPct.toFixed(2)+"% · 거래량 "+x.volRatio.toFixed(2)+"배 · 거래대금 "+x.amountRatio.toFixed(2)+"배"
  ]);
}
function sellLines(rows){
  return rows.flatMap((x,i)=>[
    (i+1)+". "+x.name+" ("+x.code+")",
    "매도신호 "+String(x.exitTime).padStart(4,"0")+" · "+Math.round(x.exitPrice).toLocaleString("ko-KR")+"원 · "+x.reason,
    "진입 "+Math.round(x.entryPrice).toLocaleString("ko-KR")+"원 · 비용 0.25% 반영 손익 "+(x.pnl>=0?"+":"")+x.pnl.toFixed(2)+"%"
  ]);
}
function shadowEvents(shadow,targetHm){
  return Object.values(shadow).map(v=>({
    name:v.name,label:v.label,description:v.description,params:v.params,
    buyEvents:v.trades.filter(x=>x.entryTime===targetHm),
    sellEvents:v.trades.filter(x=>x.exitTime===targetHm),
    trades:v.trades,
  }));
}

export async function onRequestGet({request,env}){
  const url=new URL(request.url);
  const history=url.searchParams.get("history")==="1";
  const serverHistory=url.searchParams.get("serverHistory")==="1";
  const execute=url.searchParams.get("execute")==="1";
  if(history){
    if(!(await ownerAuthorized(request,env)))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  }else if(!monitorAuthorized(request,env)){
    return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  }

  const now=kstNow();
  const shard=Math.max(0,parseInt(url.searchParams.get("shard")||"0",10)||0);
  const shards=Math.max(1,Math.min(10,parseInt(url.searchParams.get("shards")||"5",10)||5));
  const limit=Math.max(10,Math.min(100,parseInt(url.searchParams.get("limit")||"100",10)||100));
  const origin=url.origin;

  if(!history&&!serverHistory&&(now.hm<905||now.hm>931)){
    return new Response(JSON.stringify({ok:true,skipped:"outside_market_window",now}),{headers:JH});
  }
  const cutoffHm=(history||serverHistory)?Math.min(930,now.hm>930?930:now.targetHm):now.targetHm;

  try{
    const res=await scanShard(origin,now,shard,shards,limit,cutoffHm);

    if(history||serverHistory){
      return new Response(JSON.stringify({
        ok:true,date:now.date,cutoffHm,shard,shards,universe:res.universe,
        trades:res.trades,
        shadowVariants:Object.values(res.shadow),
        errors:res.errors.length
      }),{headers:JH});
    }

    const buys=res.trades.filter(x=>x.entryTime===now.targetHm);
    const sells=res.trades.filter(x=>x.exitTime===now.targetHm);
    const telegram={buySent:false,sellSent:false,buyMessageId:null,sellMessageId:null};
    // execute=1 은 GitHub의 정규 장중 감시에서만 붙인다. history/serverHistory 재구성은 주문하지 않는다.
    // 주문 실패는 신호/Telegram을 중단시키지 않는다 — 모의계좌 실행품질 관측이 목적이다.
    const vtsExecution=execute?await dualVtsExecute(origin,env,now.date,buys,sells)
      :{enabled:false,budget:vtsBudget(env),reason:"execute=0",events:[]};

    // Telegram은 기준전략만 보낸다. shadow는 연구 기록 전용이라 알림을 섞지 않는다.
    if(buys.length){
      const t=await sendTelegram(env,"시초가 모의 매수 신호 · "+String(now.targetHm).padStart(4,"0"),buyLines(buys));
      telegram.buySent=true;telegram.buyMessageId=t.messageId||null;
    }
    if(sells.length){
      const t=await sendTelegram(env,"시초가 모의 매도 신호 · "+String(now.targetHm).padStart(4,"0"),sellLines(sells));
      telegram.sellSent=true;telegram.sellMessageId=t.messageId||null;
    }

    return new Response(JSON.stringify({
      ok:true,date:now.date,targetHm:now.targetHm,shard,shards,universe:res.universe,
      buyEvents:buys,sellEvents:sells,trades:res.trades,
      shadowEvents:shadowEvents(res.shadow,now.targetHm),
      vtsExecution,telegram,errors:res.errors.length
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
