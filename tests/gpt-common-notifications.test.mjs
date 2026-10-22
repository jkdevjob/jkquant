import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { PresaleAlertStore } from "../worker/presale-alert/src/index.js";

const workerFile=new URL("../worker/presale-alert/src/index.js",import.meta.url);
const workerSource=fs.readFileSync(workerFile,"utf8");
const swSource=fs.readFileSync(new URL("../jk-sw.js",import.meta.url),"utf8");
const origin="https://jkquant.pages.dev",base="https://alerts.example";
const day=tz=>new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function fixture(Worker=PresaleAlertStore){
  const values=new Map(),calls=[];
  const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k),
    list:async({prefix}={})=>new Map([...values].filter(([k])=>!prefix||k.startsWith(prefix))),getAlarm:async()=>null};
  const app=new Worker({storage},{MONITOR_KEY:"test-key"});
  app.pushOne=async(endpoint,topic)=>{calls.push({endpoint,topic});return {ok:true,status:201}};
  const get=path=>app.fetch(new Request(base+path,{headers:{origin}}));
  const post=(path,body)=>app.fetch(new Request(base+path,{method:"POST",headers:{origin,"content-type":"application/json","x-monitor-key":"test-key"},body:JSON.stringify(body)}));
  const seed=async(endpoint,topics,version=2)=>{
    assert.equal((await post("/subscribe",{subscription:{endpoint},topics,topicSchemaVersion:version})).status,200);
  };
  return {app,values,calls,get,post,seed};
}

async function checkDeliveries(Worker=PresaleAlertStore){
  const x=fixture(Worker),ep=id=>"https://push.example/"+id;
  await x.seed(ep("group"),["gpt"]);
  await x.seed(ep("mixed"),["gpt","opening","daytrading","crypto","soxl","tenbagger_gpt"]);
  await x.seed(ep("partial"),["opening"]);
  await x.seed(ep("legacy-research"),["research"],1);
  await x.seed(ep("other-research"),["research"]);
  await x.seed(ep("job"),["job"]);
  for(const topic of ["opening","daytrading","crypto","soxl"]){
    const r=await x.post("/signal",{strategy:topic,stage:"buy",eventId:"group-test:"+topic,
      date:day(topic==="soxl"?"America/New_York":"Asia/Seoul"),time:"09:50"});
    assert.equal(r.status,200);
    const actual=x.calls.filter(c=>c.topic===topic).map(c=>c.endpoint).sort();
    const expected=[ep("group"),ep("mixed"),...(topic==="opening"?[ep("partial")]:[])].sort();
    assert.deepEqual(actual,expected,topic+": 공통·기존 동의 기기만 한 번");
    assert.equal((await (await x.post("/signal",{strategy:topic,stage:"buy",eventId:"group-test:"+topic,
      date:day(topic==="soxl"?"America/New_York":"Asia/Seoul")})).json()).duplicate,true);
    assert.equal(x.calls.filter(c=>c.topic===topic).length,expected.length);
  }
  const note={study:"tenbagger",date:"2026-10-14",body:"지피티 전향 연구",url:"https://untrusted.example/"};
  const result=await (await x.post("/research-note",note)).json();
  assert.equal(result.ok,true);assert.equal(result.alert.type,"tenbagger_gpt");
  assert.equal(result.alert.url,origin+"/scalping?strategy=tenbagger");
  assert.deepEqual(x.calls.filter(c=>c.topic==="tenbagger_gpt").map(c=>c.endpoint).sort(),
    [ep("group"),ep("mixed"),ep("legacy-research")].sort(),"새 research만 켠 기기는 지피티 연구를 받지 않음");
  assert.equal((await (await x.post("/research-note",note)).json()).skipped,true);
  await x.post("/research-note",{study:"im_plan",date:"2026-10-14",body:"무매 플랜 연구"});
  assert.deepEqual(x.calls.filter(c=>c.topic==="research").map(c=>c.endpoint).sort(),
    [ep("legacy-research"),ep("other-research")].sort(),"지피티 공통 설정이 다른 연구를 임의로 켜지 않음");
  const health=await (await x.get("/health")).json();
  assert.equal(health.version,"2.8.1");assert.equal(health.topicSchemaVersion,2);
  assert.equal(health.topicSubscriptions.gpt,4,"부분 구독 포함 등록기기는 중복 없이 집계");
  assert.equal(health.topicSubscriptions.opening,3);assert.equal(health.topicSubscriptions.tenbagger_gpt,3);
  assert.equal(health.topicSubscriptions.research,2);assert.ok(health.lastChecks.gpt);
}
test("공통 구독: 네 매매 탭·텐배거 모두 전달, 혼합 구독 중복 없음, 다른 연구·JOB 분리",()=>checkDeliveries());

test("공통 OFF 뒤 구형 화면이 다른 주제를 저장해도 텐배거를 다시 켜지 않음 · 승인 연결 보존",async()=>{
  const x=fixture(),endpoint="https://push.example/retain";
  await x.seed(endpoint,["gpt","research","presale"]);
  const record=[...x.values.values()].find(v=>v.endpoint===endpoint);record.approvalUid="bound-user";
  await x.post("/subscribe",{subscription:{endpoint},topics:["research","presale"],topicSchemaVersion:2});
  // 예전 분양 화면은 버전 값을 보내지 않는다. 이미 저장한 최신 의미를 그대로 이어간다.
  await x.post("/subscribe",{subscription:{endpoint},topics:["research","presale","job"]});
  const sub=await (await x.get("/subscription?endpoint="+encodeURIComponent(endpoint))).json();
  assert.deepEqual(sub.topics,["research","presale","job"]);assert.equal(sub.approvalLinked,true);
  await x.post("/research-note",{study:"tenbagger",date:"2026-10-14",body:"끄기 후 지피티"});
  assert.equal(x.calls.length,0);
  await x.post("/research-note",{study:"im_plan",date:"2026-10-14",body:"다른 연구는 계속"});
  assert.equal(x.calls.length,1);assert.equal(x.calls[0].topic,"research");
});

test("통합 테스트 버튼은 한 기기에 한 번 · 공통 화면 링크 · 기존 일부 구독도 시험 가능",async()=>{
  for(const topics of [["gpt"],["opening"]]){
    const x=fixture(),endpoint="https://push.example/test-group";await x.seed(endpoint,topics);
    const r=await (await x.post("/test",{endpoint,topic:"gpt"})).json();assert.equal(r.ok,true);
    assert.deepEqual(x.calls,[{endpoint,topic:"gpt"}]);
    const latest=await (await x.get("/latest")).json();
    assert.equal(latest.alert.url,origin+"/scalping");assert.match(latest.alert.title,/지피티 연구.*전체 탭/);
    assert.equal(latest.alert.type,topics[0]);
  }
});

function swFixture(code=swSource){
  const meta=new Map(),handlers=new Map();
  const cache={match:async k=>meta.has(k)?new Response(JSON.stringify(meta.get(k))):null,
    put:async(k,r)=>meta.set(k,await r.json())};
  const ctx={self:{addEventListener:(name,handler)=>handlers.set(name,handler)},caches:{open:async()=>cache},Response,Date};
  vm.runInNewContext(code,ctx);
  const message=async data=>{let pending;handlers.get("message")({data,waitUntil:p=>{pending=p}});await pending};
  return {ctx,meta,message};
}
async function checkServiceWorker(code=swSource){
  const x=swFixture(code),now=Date.now(),createdAt=new Date(now-1000).toISOString();
  const trade=["opening","daytrading","crypto","soxl","closing30","tenbagger_gpt"].map(type=>({id:type,type,createdAt}));
  const payload={alerts:[...trade,{id:"im",type:"research",study:"im_plan",createdAt},
    {id:"claude",type:"research",study:"tenbagger_claude",createdAt},{id:"job",type:"job",createdAt},
    {id:"tenbagger_gpt",type:"research",study:"tenbagger",createdAt}]};
  assert.deepEqual([...x.ctx.pickAlerts(payload,["gpt"],[],now)].map(a=>a.id),trade.map(a=>a.id),"공통 동의 기기는 전체 탭만 한 번씩");
  assert.deepEqual([...x.ctx.pickAlerts(payload,["research"],[],now)].map(a=>a.id),["im","claude"],"새 research 동의는 다른 연구만");
  assert.equal(x.ctx.pickAlerts(payload,[],[],now).length,0);
  assert.equal(x.ctx.pickAlerts(payload,["gpt"],["opening"],now).length,5);
  assert.equal(x.ctx.pickAlerts({alerts:[{id:"expired",type:"crypto",createdAt:new Date(now-21*60000).toISOString()}]},["gpt"],[],now).length,0);
  x.meta.set("/__jk_push_topics",["research"]);
  assert.deepEqual([...await x.ctx.topics()],["research","tenbagger_gpt"],"기존 캐시 동의 범위만 복원, 네 단타는 확대하지 않음");
  await x.message({type:"JK_PUSH_TOPICS",topics:["research"],topicSchemaVersion:2});
  assert.deepEqual([...await x.ctx.topics()],["research"],"통합 OFF를 보존");
  await x.message({type:"JK_PUSH_TOPICS",topics:["research"]});
  assert.deepEqual([...await x.ctx.topics()],["research"],"구형 다른 화면 메시지가 OFF를 되돌리지 않음");
  await x.message({type:"JK_PUSH_TOPICS",topics:["gpt","constructor"],topicSchemaVersion:2});
  assert.deepEqual([...await x.ctx.topics()],["gpt"],"미지원 주제 제외");
}
test("서비스워커: 공통 탭 선택·원천 구분·중복/오래된 신호 차단·기존 캐시 동의·OFF 보존",()=>checkServiceWorker());

test("여섯 탭 개별 동의는 설정 화면과 같이 전체 보고 동의 · 일부 탭은 제외",async()=>{
  const all=["opening","daytrading","crypto","soxl","closing30","tenbagger_gpt"],x=fixture(),endpoint="https://push.example/all-individual";
  await x.seed(endpoint,all);await x.seed("https://push.example/four",all.slice(0,5));
  const delivery=await x.app.notifyAll("gpt");assert.equal(delivery.sent,1);assert.equal(delivery.eligible,1);
  assert.deepEqual(x.calls,[{endpoint,topic:"gpt"}]);
  assert.equal((await(await x.get("/health")).json()).topicSubscriptions.gpt,2,"전체 기기를 두 번 집계하지 않음");
  const sw=swFixture(),now=Date.now(),payload={alerts:[{id:"morning",type:"gpt",createdAt:new Date(now).toISOString()}]};
  assert.deepEqual([...sw.ctx.pickAlerts(payload,all,[],now)].map(a=>a.id),["morning"]);
  assert.equal(sw.ctx.pickAlerts(payload,all.slice(0,5),[],now).length,0);
  assert.equal(sw.ctx.pickAlerts(payload,["research"],[],now).length,0);
});

test("공통 알림 변이 2종: 서버 또는 기기 공통 주제 누락을 실제 전달/표시 결과로 차단",async()=>{
  const badWorker=workerSource.replace('||(GPT_TOPICS.has(topic)&&t.includes("gpt"))','');assert.notEqual(badWorker,workerSource);
  const imports=badWorker.replace(/from (["'])([^"']+)\1/g,(_all,_quote,path)=>"from "+JSON.stringify(new URL(path,workerFile).href));
  const {PresaleAlertStore:Mutant}=await import("data:text/javascript;base64,"+Buffer.from(imports).toString("base64"));
  await assert.rejects(()=>checkDeliveries(Mutant),{name:"AssertionError"});
  const badSW=swSource.replace('||(allowed.includes("gpt")&&GPT_TOPICS.has(topic))','');assert.notEqual(badSW,swSource);
  await assert.rejects(()=>checkServiceWorker(badSW),{name:"AssertionError"});
});
