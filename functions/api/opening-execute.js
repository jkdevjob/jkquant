// Cloudflare Pages Function — POST /api/opening-execute
// 시초가 기준전략 신호를 내부 모의체결 기준값과 함께 기록하면서 KIS VTS 시장가 주문을 순차 전송한다.
// 실계좌 경로는 없다. 5개 감시 shard가 병렬로 계산한 이벤트를 workflow가 한 번에 모아 이 endpoint로 보낸다.
// 체결 후 수수료·제세금은 이 endpoint에서 추정하지 않고 vts-reconcile이 KIS 당일 체결조회 응답으로 측정한다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const KRCODE=/^(?:\d{6}|\d{4}[A-Z]\d)$/;
const ORDER_GAP_MS=2500;
let _lastOrderAt=0;

function json(o,s=200){return new Response(JSON.stringify(o,null,2),{status:s,headers:JH});}
function kstDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
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
function hhmm(t){
  const s=String(t||"").replace(/\D/g,"").padStart(6,"0").slice(-6);
  return /^\d{6}$/.test(s)?+s.slice(0,4):0;
}
function hmMin(v){const n=+v||0;return Math.floor(n/100)*60+n%100;}
function signalId(date,x,side){return ["opening",date,String(x.code||""),String(x.entryTime||""),side].join(":");}
function uniq(rows,side,date){
  const m=new Map();
  for(const x of (Array.isArray(rows)?rows:[])){
    const code=String(x&&x.code||"").toUpperCase();
    if(!KRCODE.test(code))continue;
    const row={...x,code};
    m.set(signalId(date,row,side),row);
  }
  return [...m.values()].slice(0,20);
}
async function claimSignal(id){
  const cache=(typeof caches!=="undefined"&&caches.default)||null;
  if(!cache)return true;
  const key="https://opening-vts-signal.internal/"+encodeURIComponent(id);
  try{
    if(await cache.match(key))return false;
    // 응답 유실 시 재주문하면 중복 체결될 수 있으므로 주문 전 먼저 점유한다.
    await cache.put(key,new Response("1",{headers:{"cache-control":"max-age=21600","content-type":"text/plain"}}));
  }catch(e){return true;}
  return true;
}
async function paceOrder(){
  const wait=_lastOrderAt?ORDER_GAP_MS-(Date.now()-_lastOrderAt):0;
  if(wait>0)await sleep(wait);
  _lastOrderAt=Date.now();
}
async function kisOrder(origin,env,side,x,qty,date){
  const id=signalId(date,x,side);
  const paperPrice=side==="buy"?+x.entryPrice||0:+x.exitPrice||0;
  const paperTime=side==="buy"?+x.entryTime||0:+x.exitTime||0;
  const rec={
    signalId:id,strategy:"opening",date,side,code:x.code,name:x.name||x.code,qty,
    paper:{time:paperTime,fillPrice:paperPrice,fillModel:"completed 1m close",roundTripCostAssumptionPct:0.25},
    submittedAt:null,
    vts:{ok:false,env:"vts",priceType:"market",orderNo:"",msg:""}
  };
  if(!(qty>0)){rec.vts.msg="주문수량 0 — 예산/기준가 확인";return rec;}
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
    rec.vts={ok:r.ok&&!!j.ok,env:"vts",priceType:"market",orderNo:j.orderNo||"",
      msg:j.msg||j.error||("HTTP "+r.status),httpStatus:r.status};
  }catch(e){
    rec.vts.msg="전송 결과 불명 — 안전상 자동 재시도하지 않음: "+String(e.message||e);
  }
  return rec;
}
async function orders(origin,env,date,code){
  const u=origin+"/api/kis?op=orders&env=vts&market=kr&date="+encodeURIComponent(date.replace(/-/g,""))+
    "&code="+encodeURIComponent(code);
  const r=await fetch(u,{headers:{"x-autotrade-key":env.AUTOTRADE_KEY,"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
  return j.orders||[];
}
async function openingQty(origin,env,date,x){
  const all=await orders(origin,env,date,x.code);
  const ent=hmMin(x.entryTime);
  // 이 전략의 매수는 내부 진입시각 직후에 나간다. ±5분 밖의 체결은 수동/다른 전략 물량으로 간주한다.
  const buys=all.filter(o=>String(o.sideCode)==="02"&&+o.fillQty>0&&Math.abs(hmMin(hhmm(o.orderTime))-ent)<=5);
  const buyQty=buys.reduce((s,o)=>s+(+o.fillQty||0),0);
  if(!buyQty)return {qty:0,buyQty:0,soldQty:0,error:"시초가 VTS 매수 체결수량 0"};
  const times=buys.map(o=>hmMin(hhmm(o.orderTime))).filter(Number.isFinite);
  const first=times.length?Math.min(...times):ent;
  const sells=all.filter(o=>String(o.sideCode)==="01"&&+o.fillQty>0&&hmMin(hhmm(o.orderTime))>=first);
  const soldQty=sells.reduce((s,o)=>s+(+o.fillQty||0),0);
  return {qty:Math.max(0,buyQty-soldQty),buyQty,soldQty};
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  if(String(env.SCALPING_VTS_AUTO||"1")==="0")return json({ok:true,enabled:false,reason:"SCALPING_VTS_AUTO=0",events:[]});
  if(!env.AUTOTRADE_KEY)return json({ok:false,error:"AUTOTRADE_KEY 없음"},400);

  let b={};
  try{b=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  const date=String(b.date||"");
  if(date!==kstDate())return json({ok:false,error:"오늘 장중 신호만 VTS 자동주문할 수 있습니다.",today:kstDate(),date},400);

  const buys=uniq(b.buyEvents,"buy",date),sells=uniq(b.sellEvents,"sell",date);
  const amount=budget(env),events=[];
  try{
    for(const x of buys){
      const qty=Math.floor(amount/Math.max(1,+x.entryPrice||0));
      events.push(await kisOrder(new URL(request.url).origin,env,"buy",x,qty,date));
    }
    for(const x of sells){
      let pos;
      try{pos=await openingQty(new URL(request.url).origin,env,date,x);}
      catch(e){
        events.push({
          signalId:signalId(date,x,"sell"),strategy:"opening",date,side:"sell",code:x.code,name:x.name||x.code,qty:0,
          paper:{time:+x.exitTime||0,fillPrice:+x.exitPrice||0,fillModel:"completed 1m close",roundTripCostAssumptionPct:0.25},
          submittedAt:null,vts:{ok:false,env:"vts",priceType:"market",orderNo:"",msg:"매도 전 체결수량 조회 실패: "+String(e.message||e)}
        });
        continue;
      }
      // 조회 1회 직후 주문(hash+order 2회)이 몰리지 않게 VTS 호출창을 비운다.
      await sleep(1200);
      if(!(pos.qty>0)){
        events.push({
          signalId:signalId(date,x,"sell"),strategy:"opening",date,side:"sell",code:x.code,name:x.name||x.code,qty:0,
          paper:{time:+x.exitTime||0,fillPrice:+x.exitPrice||0,fillModel:"completed 1m close",roundTripCostAssumptionPct:0.25},
          submittedAt:null,vts:{ok:false,env:"vts",priceType:"market",orderNo:"",msg:"매도 생략 — "+(pos.error||"이 전략의 VTS 보유수량 없음")}
        });
        continue;
      }
      events.push(await kisOrder(new URL(request.url).origin,env,"sell",x,pos.qty,date));
    }
    return json({ok:true,enabled:true,mode:"internal-paper+KIS-VTS",date,budget:amount,
      buyEvents:buys.length,sellEvents:sells.length,events});
  }catch(e){
    // 한 종목 실패가 신호 엔진/Telegram을 멈추게 하지 않도록 endpoint 안에서 격리한다.
    return json({ok:false,enabled:true,mode:"internal-paper+KIS-VTS",date,budget:amount,events,error:String(e.message||e)},500);
  }
}
