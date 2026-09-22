// Cloudflare Pages Function — /api/opening-monitor
// 브라우저 없이 시초가 눌림→재돌파 전략을 서버에서 감시하고 Telegram으로 매수/매도 신호를 보낸다.
// history=1 은 로그인한 소유자에게 오늘 재구성 매매이력을 반환한다.

import { minuteVolume, dailyMeta, rebreakTrade } from "./_opening.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FIREBASE_API_KEY_FALLBACK="AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS=["jk82investing@gmail.com"];

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
async function scanShard(origin,now,shard,shards,limit,cutoffHm){
  const uj=await (await fetch(origin+"/api/universe?limit="+limit)).json();
  const universe=(uj.universe||[]).filter((_,i)=>i%shards===shard);
  const trades=[],errors=[];let idx=0;
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
        const meta=dailyMeta(dj,now.date),tr=rebreakTrade(rows,meta,cutoffHm);
        if(tr)trades.push({code:u.code,name:u.name||u.code,...tr});
      }catch(e){errors.push({code:u.code,error:String(e.message||e).slice(0,120)});}
    }
  }
  await Promise.all([worker(),worker()]);
  trades.sort((a,b)=>a.entryTime-b.entryTime||(b.amountRatio-a.amountRatio));
  return {universe:universe.length,trades,errors};
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

export async function onRequestGet({request,env}){
  const url=new URL(request.url);
  const history=url.searchParams.get("history")==="1";
  const serverHistory=url.searchParams.get("serverHistory")==="1";
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
      return new Response(JSON.stringify({ok:true,date:now.date,cutoffHm,shard,shards,universe:res.universe,trades:res.trades,errors:res.errors.length}),{headers:JH});
    }

    const buys=res.trades.filter(x=>x.entryTime===now.targetHm);
    const sells=res.trades.filter(x=>x.exitTime===now.targetHm);
    const telegram={buySent:false,sellSent:false,buyMessageId:null,sellMessageId:null};
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
      buyEvents:buys,sellEvents:sells,trades:res.trades,telegram,errors:res.errors.length
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
