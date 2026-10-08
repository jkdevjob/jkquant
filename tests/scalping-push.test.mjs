import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PresaleAlertStore} from "../worker/presale-alert/src/index.js";

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
    assert.ok(settings.includes('item("'+topic+'"'),topic+" setting");
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
