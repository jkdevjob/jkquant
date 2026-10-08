import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import workerMain, {PresaleAlertStore} from "../worker/presale-alert/src/index.js";

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


test("푸시 전체 실패이면 영속 중복잠금을 풀고 다음 감시에서 재전송한다",async()=>{
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
    {id:"001:1016",code:"001",name:"테스트1",signalTime:1016,entryTime:1017,signalPrice:5000,status:"closed",
      exitTime:1018,exitPrice:4920,reason:"stop",pnl:-1.85},
    {id:"002:1001",code:"002",signalTime:1001,entryTime:1002,status:"open"}
  ]};
  const a=fn(ledger);
  assert.equal(a.length,2);
  assert.deepEqual(a.map(x=>x.stage),["buy","sell"]);
  assert.equal(a[0].eventId,"daytrading:2026-10-08:001:1016:buy");
  assert.equal(a[1].eventId,"daytrading:2026-10-08:001:1016:sell:1018");
  assert.ok(a.every(x=>x.webOnly===true));
  assert.equal(fn({...ledger,targetHm:1030}).length,0);
  assert.match(source,/await retryPaperWebPush\(env,saved\)/);
});
