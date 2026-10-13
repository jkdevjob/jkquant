import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const {default:workerMain,PresaleAlertStore}=await import(process.env.SCALPING_PUSH_MODULE||"../worker/presale-alert/src/index.js");

function fakeStore(){
  const state=new Map();
  const storage={
    async get(k){return state.get(k)},
    async put(k,v){state.set(k,v)},
    async delete(k){state.delete(k)},
    async list({prefix}){return new Map([...state].filter(([k])=>k.startsWith(prefix)))}
  };
  const worker=new PresaleAlertStore({storage},{MONITOR_KEY:"test-monitor-key"});
  const deliveries=[];
  worker.notifyAll=async topic=>{deliveries.push(topic);return {eligible:1,sent:1,failed:0,removed:0,total:1}};
  const send=(body,key="test-monitor-key")=>worker.fetch(new Request("https://push.invalid/signal",{method:"POST",
    headers:{"content-type":"application/json","x-monitor-key":key},body:JSON.stringify(body)}));
  return {worker,state,deliveries,send};
}
function today(tz){
  return new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

test("신호 인증·중복 차단·시장일 제한·매수/매도 각각 푸시",async()=>{
  const x=fakeStore(),b={strategy:"opening",stage:"buy",eventId:"opening-test-1",date:today("Asia/Seoul"),time:"09:07 KST",lines:["000001 테스트","모의 매수"]};
  assert.equal((await x.send(b,"wrong")).status,401);
  assert.equal((await x.send({...b,stage:"summary"})).status,400);
  assert.equal((await x.send({...b,date:"2025-01-01"})).status,409);
  assert.equal((await x.send(b)).status,200);
  assert.deepEqual(x.deliveries,["opening"]);
  const duplicate=await (await x.send(b)).json();
  assert.equal(duplicate.duplicate,true);
  assert.equal(x.deliveries.length,1);
  const latest=await (await x.worker.fetch(new Request("https://push.invalid/latest"))).json();
  assert.equal(latest.alert.type,"opening");
  assert.match(latest.alert.title,/모의 매수 타이밍/);
  assert.equal(latest.alert.url,"https://jkquant.pages.dev/scalping?strategy=opening");
  assert.equal(latest.alerts.length,1);
  assert.equal((await x.send({...b,stage:"sell",eventId:"opening-test-1:sell"})).status,200);
  assert.deepEqual(x.deliveries,["opening","opening"]);
});

test("네 전략의 시장별 거래일 검증과 알림 주제를 유지한다",async()=>{
  const x=fakeStore();
  for(const topic of ["opening","daytrading","crypto","soxl"]){
    const date=today(topic==="soxl"?"America/New_York":"Asia/Seoul");
    const resp=await x.send({strategy:topic,stage:"sell",eventId:"test:"+topic,date,time:"09:50",lines:["모의손익 +1%"]});
    assert.equal(resp.status,200,topic);
  }
  assert.deepEqual(x.deliveries,["opening","daytrading","crypto","soxl"]);
  assert.equal((await x.send({strategy:"soxl",stage:"buy",eventId:"tomorrow",date:"2099-01-01"})).status,409);
});

test("기존 JOB/분양 수신 보존 · 전략별 설정 · 앱 이동 확인",async()=>{
  const x=fakeStore(),endpoint="https://push.example.test/subscription";
  const r=await x.worker.fetch(new Request("https://push.invalid/subscribe",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({subscription:{endpoint},topics:["job","presale","opening","soxl","unknown"]})}));
  assert.equal(r.status,200);
  const sub=await (await x.worker.fetch(new Request("https://push.invalid/subscription?endpoint="+encodeURIComponent(endpoint)))).json();
  assert.deepEqual(sub.topics,["job","presale","opening","soxl"]);
  const health=await (await x.worker.fetch(new Request("https://push.invalid/health"))).json();
  assert.equal(health.topicSubscriptions.opening,1);
  assert.equal(health.topicSubscriptions.soxl,1);
  const settings=readFileSync(new URL("../settings-notifications.js",import.meta.url),"utf8");
  const sw=readFileSync(new URL("../jk-sw.js",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../scalping.html",import.meta.url),"utf8");
  for(const topic of ["opening","daytrading","crypto","soxl"]){
    assert.ok(settings.includes('topic:"'+topic+'"'),topic+" setting");
    assert.ok(sw.includes('"'+topic+'"'),topic+" service worker");
  }
  assert.match(sw,/if\(!allowed.length\)return \[\]/);
  assert.match(sw,/age>20\*60\*1000/);
  assert.match(ui,/URLSearchParams\(location.search\).get\('strategy'\)/);
  const alert=readFileSync(new URL("../functions/api/scalping-alert.js",import.meta.url),"utf8");
  const opening=readFileSync(new URL("../worker/opening-scheduler/src/index.js",import.meta.url),"utf8");
  assert.match(alert,/await webPush\(env/);
  assert.match(opening,/await notifyOpeningWebPush\(env/);
});

test("Cloudflare 무료 Cron 한 개로 IPO 08:10 KST와 기존 :07/:37 수집을 정확히 분기한다",()=>{
  const schedule=JSON.parse(readFileSync(new URL("../worker/presale-alert/wrangler.jsonc",import.meta.url),"utf8"));
  assert.deepEqual(schedule.triggers.crons,["7,10,37 * * * *"]);
  function run(iso){
    const paths=[],ctx={waitUntil(p){void p.catch(()=>{});}};
    const env={ALERT_STORE:{idFromName(x){return x},get(){return {fetch(r){paths.push(new URL(r.url).pathname);return Promise.resolve(new Response("{}"));}}}}};
    workerMain.scheduled({scheduledTime:Date.parse(iso)},env,ctx);
    return paths;
  }
  assert.deepEqual(run("2026-10-07T23:10:00Z"),["/check-ipo"]);
  assert.deepEqual(run("2026-10-07T23:07:00Z"),["/check","/check-jobs"]);
  assert.deepEqual(run("2026-10-07T23:37:00Z"),["/check","/check-jobs"]);
  assert.deepEqual(run("2026-10-08T00:10:00Z"),[]);
});


test("푸시 전체 실패이면 실패 영수증을 남기고 다음 감시에서 재전송한다",async()=>{
  const x=fakeStore(),date=today("Asia/Seoul");
  let attempts=0;
  x.worker.notifyAll=async()=>{
    attempts++;
    return attempts===1?{eligible:1,sent:0,failed:1,removed:0,total:1}:
      {eligible:1,sent:1,failed:0,removed:0,total:1};
  };
  const payload={strategy:"daytrading",stage:"buy",eventId:"daytrading-retry-test",date,time:"10:12 KST",lines:["모의 신호"]};
  const first=await x.send(payload);
  assert.equal(first.status,502);
  assert.equal((await first.json()).retryable,true);
  const recovered=await (await x.send(payload)).json();
  assert.equal(recovered.status,"sent");
  assert.equal(recovered.delivery.sent,1);
  assert.equal(attempts,2);
  const dup=await (await x.send(payload)).json();
  assert.equal(dup.duplicate,true);
  assert.equal(attempts,2);
  const health=await (await x.worker.fetch(new Request("https://push.invalid/health"))).json();
  assert.equal(health.lastDeliveries.daytrading.status,"sent");
  assert.equal(health.lastDeliveries.daytrading.sent,1);
});

test('일부 기기만 실패하면 실패한 기기만 재시도하고 성공 기기는 중복 발송하지 않는다',async()=>{
  const x=fakeStore();x.worker.notifyAll=PresaleAlertStore.prototype.notifyAll;
  for(const [key,endpoint] of [['sub:a','https://push.test/a'],['sub:b','https://push.test/b']])
    x.state.set(key,{endpoint,topics:['crypto']});
  const calls=[];let failB=true;
  x.worker.pushOne=async endpoint=>{calls.push(endpoint);return {ok:!endpoint.endsWith('/b')||!failB,status:503};};
  const b={strategy:'crypto',stage:'buy',eventId:'partial-fixture',date:today('Asia/Seoul')};
  const first=await x.send(b);assert.equal(first.status,502);assert.equal((await first.json()).delivery.sent,1);
  failB=false;assert.equal((await x.send(b)).status,200);
  assert.deepEqual(calls,['https://push.test/a','https://push.test/b','https://push.test/b']);
  assert.equal((await (await x.send(b)).json()).duplicate,true);assert.equal(calls.length,3);
});

test('전송 중 예외·만료된 잠금은 복구하고 최근 신호만 전달한다',async()=>{
  const x=fakeStore(),b={strategy:'crypto',stage:'sell',eventId:'exception-fixture',date:today('Asia/Seoul')};
  let calls=0;x.worker.notifyAll=async()=>{calls++;if(calls===1)throw new Error('fixture outage');return {eligible:1,sent:1,failed:0,removed:0,total:1};};
  assert.equal((await x.send(b)).status,502);assert.equal((await x.send(b)).status,200);assert.equal(calls,2);
  const [key,value]=[...x.state].find(([key])=>key.startsWith('signal:'));
  x.state.set(key,{status:'sending',at:new Date().toISOString()});assert.equal((await x.send(b)).status,409);
  x.state.set(key,{status:'sending',at:new Date(Date.now()-121_000).toISOString()});assert.equal((await x.send(b)).status,200);
  const before=calls;
  const stale=await (await x.send({...b,eventId:'stale-fixture',eventAt:new Date(Date.now()-21*60_000).toISOString()})).json();
  assert.equal(stale.skipped,'stale_or_future_signal');assert.equal(calls,before);
  const future=await (await x.send({...b,eventId:'future-fixture',eventAt:new Date(Date.now()+120_000).toISOString()})).json();
  assert.equal(future.skipped,'stale_or_future_signal');assert.equal(calls,before);
});

test('자정에 확정된 전일 BTC 마지막 매도만 허용하고 전일 매수·오래된 신호는 차단한다',async()=>{
  const OriginalDate=globalThis.Date,now=Date.parse('2026-10-01T15:05:00Z');
  globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  try{
    const x=fakeStore(),b={strategy:'crypto',stage:'sell',eventId:'midnight-fixture',date:'2026-10-01',time:'23:55',eventAt:'2026-10-01T15:00:00Z'};
    assert.equal((await x.send(b)).status,200);assert.deepEqual(x.deliveries,['crypto']);
    assert.equal((await x.send({...b,eventId:'old-buy',stage:'buy'})).status,409);
    assert.equal((await x.send({...b,eventId:'old-date',date:'2026-09-30'})).status,409);
    assert.equal((await x.send({...b,eventId:'old-time',time:'23:30'})).status,409);
  }finally{globalThis.Date=OriginalDate;}
});

test("구독자가 0명이면 과거 매수·매도 신호를 후속 가입자에게 재전송하지 않는다",async()=>{
  const x=fakeStore();
  x.worker.notifyAll=async()=>({eligible:0,sent:0,failed:0,removed:0,total:0});
  const signal={strategy:"daytrading",stage:"sell",eventId:"no-replay",date:today("Asia/Seoul")};
  const j=await (await x.send(signal)).json();
  assert.equal(j.status,"no_subscribers");
  assert.equal((await (await x.send(signal)).json()).duplicate,true);
});

test("데이트레이딩 최근 8분만 매수·매도 푸시 복구 — 날짜·이벤트 ID 불변",()=>{
  const source=readFileSync(new URL("../worker/daytrading-scheduler/src/index.js",import.meta.url),"utf8");
  const start=source.indexOf("export function recentPaperPushEvents("),end=source.indexOf("async function retryPaperWebPush(",start);
  assert.ok(start>=0&&end>start);
  const code=source.slice(start,end).replace("export function ","function ");
  const hmMin=hm=>Math.floor((+hm||0)/100)*60+(+hm||0)%100;
  const fn=new Function("hmToMin","hmLabel","exitLabel","signedPct",code+"; return recentPaperPushEvents;")(
    hmMin,v=>String(v).padStart(4,"0"),v=>v==="stop"?"손절":String(v),v=>"+"+Number(v).toFixed(2)+"%");
  const ledger={date:"2026-10-08",targetHm:1018,trades:[
    {id:"001:1016",code:"001",name:"테스트1",signalTime:1016,entryTime:1017,signalPrice:5000,entryPrice:5000,status:"closed",
      exitTime:1018,exitPrice:4920,reason:"stop",pnl:-1.85},
    {id:"002:1001",code:"002",signalTime:1001,entryTime:1002,status:"open"}
  ]};
  const a=fn(ledger);
  assert.equal(a.length,2);
  assert.deepEqual(a.map(x=>x.stage),["buy","sell"]);
  assert.equal(a[0].eventId,"daytrading:2026-10-08:001:1016:buy");
  assert.equal(a[1].eventId,"daytrading:2026-10-08:001:1016:sell:1018");
  assert.ok(a.every(x=>x.webOnly!==true)); // Retry both channels; successful Telegram receipts suppress duplicates.
  assert.equal(fn({...ledger,targetHm:1030}).length,0);
  assert.match(source,/await retryPaperWebPush\(env,saved\)/);
});


test("GPT 연구 정책: 후보 매수 알림 금지, 확정 1분봉 시가와 청산 때만 발송",async()=>{
  const source=readFileSync(new URL("../worker/daytrading-scheduler/src/index.js",import.meta.url),"utf8");
  const first=source.indexOf("async function notifyPaperTransitions("),last=source.indexOf("// 장부 기록 후 첫 알림",first);
  assert.ok(first>=0&&last>first);
  const code=source.slice(first,last);
  const out=[],fn=new Function("sendScalpingAlert","hmLabel","signedPct","exitLabel","PAPER_STOP_PCT","PAPER_TAKE_PROFIT_PCT","PAPER_FINAL_EXIT_HM","PAPER_FRICTION_PCT",code+"; return notifyPaperTransitions;")(
    async (_env,b)=>{out.push(b);return {ok:true}},n=>String(n||"").padStart(4,"0"),
    n=>(Number(n)>=0?"+":"")+Number(n).toFixed(2)+"%",n=>n==="stop"?"손절":String(n),1,2,1510,.25);
  const candidate={id:"247540:1426",code:"247540",name:"에코프로비엠",status:"pending",signalTime:1426,signalPrice:114000,
    entryTime:1427,entryPrice:null,exitTime:null,exitPrice:null,sessionRet:1.33,score:70,volRatio:1.56};
  const book=x=>({date:"2026-10-13",trades:[x],stopPct:1,takeProfitPct:2});
  await fn(null,null,book(candidate));
  assert.equal(out.length,0,"14:26 후보 신호는 Telegram과 Push 모두 금지");
  const opened={...candidate,status:"open",entryPrice:114200};
  await fn(null,book(candidate),book(opened));
  assert.equal(out.length,1);
  assert.equal(out[0].stage,"buy");
  assert.equal(out[0].time,"1427");
  assert.ok(out[0].lines.some(x=>x.includes("모의 매수 확정")));
  assert.ok(out[0].lines.every(x=>!x.includes("진입 대기")));
  const closed={...opened,status:"closed",exitTime:1430,exitPrice:112770,reason:"stop",pnl:-1.25};
  await fn(null,book(opened),book(closed));
  assert.equal(out.length,2);
  assert.equal(out[1].stage,"sell");
  await fn(null,book(closed),book(closed));
  assert.equal(out.length,2);
});

test("GPT 연구 마감요약 금지, 연구 전략명 메시지 첫 줄 검증",async()=>{
  const {onRequestPost}=await import("../functions/api/scalping-alert.js");
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),body:JSON.parse(options.body)});
    return new Response(JSON.stringify(String(url).includes("api.telegram.org")?{ok:true,result:{message_id:19}}:{ok:true,delivery:{sent:1}}),{status:200});
  };
  try{
    const env={AUTOTRADE_KEY:"test",TELEGRAM_BOT_TOKEN:"token",TELEGRAM_CHAT_ID:"chat"};
    const run=async stage=>{const r=await onRequestPost({env,request:new Request("https://host.invalid/api/scalping-alert",{
      method:"POST",headers:{"x-monitor-key":"test","content-type":"application/json"},
      body:JSON.stringify({strategy:"opening",stage,eventId:"test-"+stage,date:"2026-10-13",time:"09:08"})})});return r.json()};
    assert.equal((await run("summary")).skipped,"trade_notifications_only");
    assert.equal(calls.length,0);
    assert.equal((await run("buy")).ok,true);
    assert.equal(calls.length,2);
    assert.ok(calls.some(x=>String(x.body.text||"").startsWith("[지피티 연구 시초가]")));
  }finally{globalThis.fetch=old;}
  const opening=readFileSync(new URL("../functions/api/opening-monitor.js",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../worker/presale-alert/src/index.js",import.meta.url),"utf8");
  assert.ok(opening.includes("[지피티 연구 시초가]"));
  assert.ok(worker.includes('title:"[지피티 연구 "+name+"] "'));
});


test("클로드 연구: 매매없음·예상가·매도접수는 외부알림이 아니고 체결확인만 푸시",async()=>{
  const {pushEvents}=await import("../functions/api/_claude_push.js");
  const now=Date.parse("2026-10-13T06:43:00Z");
  const candidate=pushEvents({today:"2026-10-13",tabs:{
    opening:{rows:[{code:"247540",name:"에코프로비엠",status:"보유중",buyPrice:114000,buyPriceKind:"예상"}]},
    daytrading:{rows:[{status:"매매 없음"}]}
  }},now,{});
  assert.equal(candidate.length,0);
  const filled=pushEvents({today:"2026-10-13",tabs:{
    opening:{rows:[{code:"247540",name:"에코프로비엠",status:"보유중",buyPrice:114200,buyPriceKind:"체결"}]},
    daytrading:{rows:[{name:"ETF",status:"보유중(오버나잇)",buyTime:"오늘 15:30 종가",buyPrice:1000,buyPriceKind:"체결"}]}
  }},now,{});
  assert.equal(filled.length,2);
  assert.ok(filled.every(x=>x.title.startsWith("[클로드 연구 ")));
  const received=pushEvents({today:"2026-10-13",tabs:{daytrading:{rows:[
    {name:"ETF",status:"매도 접수",sellTime:"오늘 09:00 시가",sellPrice:null,realized:false}
  ]}}},now,{});
  assert.equal(received.length,0);
});

test("클로드 매매없음 Telegram과 GPT/Claude 대결 일일보고는 보내지 않는다",async()=>{
  const claude=await import("../functions/api/claude-telegram.js");
  const duel=await import("../functions/api/scalping-duel.js");
  const env={AUTOTRADE_KEY:"test"};
  const post=async(fn,body)=>{
    const r=await fn({env,request:new Request("https://host.invalid/api/check",{
      method:"POST",headers:{"content-type":"application/json","x-monitor-key":"test"},body:JSON.stringify(body)})});
    return r.json();
  };
  const one=await post(claude.onRequestPost,{kind:"etfbuy",date:"2026-10-13"});
  const two=await post(claude.onRequestPost,{op:"send",strategy:"daytrading",date:"2026-10-13"});
  const three=await post(duel.onRequestPost,{date:"2026-10-13"});
  assert.equal(one.skipped,"confirmed_trades_only");
  assert.equal(two.skipped,"confirmed_trades_only");
  assert.equal(three.skipped,"confirmed_trades_only");
});
