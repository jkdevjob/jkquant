import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { PresaleAlertStore } from "../worker/presale-alert/src/index.js";

const source=fs.readFileSync(new URL("../settings-notifications.js",import.meta.url),"utf8");
const endpoint="https://push.example/settings-device";
const origin="https://jkquant.pages.dev";
const worker="https://alerts.example";
const names={
  opening:"연구(지피티) · 시초가 매수·매도",daytrading:"연구(지피티) · 데이트레이딩 매수·매도",
  crypto:"연구(지피티) · 비트코인 매수·매도",soxl:"연구(지피티) · SOXL 매수·매도",
  ipo:"공모주·청약 일정",presale:"대전·세종 신규분양",
  research:"연구 결과 · 무매·플랜·텐배거",job:"대전·세종 JOB 신규공고"
};
const response=body=>new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});
const row=(html,topic)=>html.split('<div class="alert-item">').find(x=>x.includes('data-topic="'+topic+'"'))||"";

// 실제 설정 스크립트 전체와 실제 Worker의 구독 경로를 실행한다. 푸시 전송은 호출하지 않는다.
async function harness(code=source,initial=[]){
  const values=new Map(),messages=[],alerts=[],requests=[];
  const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k),
    list:async({prefix}={})=>new Map([...values].filter(([k])=>!prefix||k.startsWith(prefix)))};
  const app=new PresaleAlertStore({storage},{});
  const subscription={endpoint,toJSON:()=>({endpoint,keys:{p256dh:"test",auth:"test"}}),
    unsubscribe:async()=>{h.unsubscribed++;return true}};
  const request=(path,opt={})=>new Request(worker+path,{...opt,headers:{origin,...opt.headers}});
  if(initial.length)await app.fetch(request("/subscribe",{method:"POST",body:JSON.stringify({subscription:subscription.toJSON(),topics:initial})}));
  let html="",buttons=[],alertResolve=null;
  const host={get innerHTML(){return html},set innerHTML(v){
    html=v;buttons=[];
    for(const match of v.matchAll(/<button\b([^>]*)>/g)){
      const action=/data-action="([^"]+)"/.exec(match[1]),topic=/data-topic="([^"]+)"/.exec(match[1]);
      if(!action||!topic)continue;
      buttons.push({dataset:{action:action[1],topic:topic[1]},disabled:/\bdisabled\b/.test(match[1]),
        addEventListener(_event,fn){this.click=fn}});
    }
  },querySelectorAll:()=>buttons};
  const h={failRead:false,failWrite:false,failDelete:false,unsubscribed:0,paintFrames:0,alerts,messages,requests,
    get html(){return html},async saved(){return (await (await app.fetch(request("/subscription?endpoint="+encodeURIComponent(endpoint)))).json()).topics},
    click(action,topic){const b=buttons.find(x=>x.dataset.action===action&&x.dataset.topic===topic);
      assert.ok(b,"button exists: "+action+" "+topic);assert.equal(b.disabled,false);b.click()},
    async enable(topic){
      const pending=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("notification dialog timeout")),3000);
        alertResolve=a=>{clearTimeout(timeout);resolve(a)}});
      h.click("on",topic);return pending;
    },async idle(){for(let n=0;n<100;n++){
      if(buttons.length&&buttons.every(b=>!b.disabled))return;
      await new Promise(r=>setTimeout(r,5));
    }throw new Error("settings action did not finish")}
  };
  const postMessage=m=>messages.push(JSON.parse(JSON.stringify(m)));
  const reg={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription},active:{postMessage}};
  const context={document:{getElementById:id=>id==="notificationSettings"?host:null,
    querySelectorAll:()=>["/scalping","/ipo","/realestate","/job"].map(href=>({getAttribute:()=>href}))},
    navigator:{userAgent:"iPhone",standalone:true,serviceWorker:{register:async()=>reg,ready:Promise.resolve(reg),controller:{postMessage}}},
    window:{PushManager:{},Notification:{},matchMedia:()=>({matches:true})},Notification:{permission:"granted"},
    atob,Uint8Array,Date,setTimeout,
    requestAnimationFrame:fn=>setImmediate(()=>{h.paintFrames++;fn()}),
    alert:message=>{const a={message,html,paintFrames:h.paintFrames};alerts.push(a);if(alertResolve){const resolve=alertResolve;alertResolve=null;resolve(a)}},
    fetch:async(url,opt={})=>{
      if(String(url).startsWith("/data/"))return response({workerUrl:worker});
      const path=new URL(url).pathname;requests.push([path,opt.method||"GET"]);
      if((path==="/subscription"&&h.failRead)||(path==="/subscribe"&&opt.method==="POST"&&h.failWrite)
        ||(path==="/subscribe"&&opt.method==="DELETE"&&h.failDelete)){
        return new Response(JSON.stringify({ok:false,error:"시험 서버 실패"}),{status:503});
      }
      return app.fetch(request(String(url).slice(worker.length),opt));
    }};
  vm.runInNewContext(code.replace(/init\(\);\s*\}\)\(\);\s*$/,"globalThis.initPromise=init();\n})();"),context,{filename:"settings-notifications.js"});
  await context.initPromise;return h;
}

async function checkEnable(code=source){
  const h=await harness(code,["ipo"]),a=await h.enable("research");
  assert.equal(a.message,names.research+" 알림을 켰습니다.");
  assert.match(row(a.html,"research"),/>ON<\/span>/,"팝업 표시 시 연구 ON");
  assert.match(row(a.html,"research"),/data-action="off"/,"팝업 표시 시 끄기 버튼");
  assert.equal(/\bdisabled\b/.test(row(a.html,"research")),false,"버튼 처리 완료");
  assert.ok(a.paintFrames>=2,"팝업 전 새 화면을 그릴 기회 제공");
  assert.deepEqual(await h.saved(),["ipo","research"],"기존 구독 보존 + 서버 저장");
  assert.deepEqual(h.messages.at(-1).topics,["ipo","research"],"서비스워커 상태도 일치");
}
async function checkFailedWrite(code=source){
  const h=await harness(code,["ipo"]);h.failWrite=true;
  const a=await h.enable("research");
  assert.match(a.message,/알림 설정 실패/);assert.doesNotMatch(a.message,/알림을 켰습니다/);
  assert.match(row(a.html,"research"),/>OFF<\/span>/,"저장 실패 시 OFF 유지");
  assert.match(row(a.html,"ipo"),/>ON<\/span>/,"기존 구독 ON 유지");
  assert.deepEqual(await h.saved(),["ipo"]);
  assert.deepEqual(h.messages.at(-1).topics,["ipo"],"실패한 변경은 서비스워커에 반영하지 않음");
}

test("연구 알림: 서버 저장·ON 표시·버튼·페인트가 성공 팝업보다 먼저",()=>checkEnable());
test("설정 목록의 모든 8개 주제: 안내 이름 일치, undefined 없음",async()=>{
  for(const [topic,name] of Object.entries(names)){
    const h=await harness(),a=await h.enable(topic);
    assert.equal(a.message,name+" 알림을 켰습니다.");assert.doesNotMatch(a.message,/undefined/);
    const reload=await harness(source,await h.saved());assert.match(row(reload.html,topic),/>ON<\/span>/,"다시 열면 서버 구독 복원");
  }
});
test("구독 저장 실패: 성공 안내·잘못된 ON·기존 주제 손실 없음",()=>checkFailedWrite());
test("구독 조회 실패: 기존 주제를 비우거나 덮어쓰지 않고 설정 실패",async()=>{
  const h=await harness(source,["ipo"]);h.failRead=true;
  const a=await h.enable("research");
  assert.match(a.message,/알림 설정 실패/);assert.match(row(a.html,"ipo"),/>ON<\/span>/);
  assert.deepEqual(await h.saved(),["ipo"]);
  assert.equal(h.requests.filter(([path,method])=>path==="/subscribe"&&method==="POST").length,0);
});
test("끄기 저장·삭제 실패: 서버와 화면 ON 유지, 기기 구독 삭제 없음",async()=>{
  for(const initial of [["research","ipo"],["research"]]){
    const h=await harness(source,initial);h.failWrite=true;h.failDelete=true;
    h.click("off","research");await h.idle();
    assert.match(h.alerts[0].message,/알림 해제 실패/);assert.match(row(h.html,"research"),/>ON<\/span>/);
    assert.deepEqual(await h.saved(),initial);assert.equal(h.unsubscribed,0);
  }
});
test("끄기 성공: 다른 주제 유지, 마지막 주제 해제 때만 기기 구독 삭제",async()=>{
  for(const initial of [["research","ipo"],["research"]]){
    const h=await harness(source,initial);h.click("off","research");await h.idle();
    assert.match(row(h.html,"research"),/>OFF<\/span>/);
    assert.deepEqual(await h.saved(),initial.filter(x=>x!=="research"));
    assert.equal(h.unsubscribed,initial.length===1?1:0);
    assert.deepEqual(h.messages.at(-1).topics,initial.filter(x=>x!=="research"));
  }
});
test("회귀 변이 3종: 이름 누락·팝업 뒤 갱신·저장 전 ON을 실제 값 검사로 차단",async()=>{
  const mutants=[
    [source.replace('(def?def.name:"선택한 항목")','({ipo:"공모주·청약 일정"})[topic]'),checkEnable],
    [source.replace('finally{busy=false;render()}','finally{busy=false}').replace('alert(message);','alert(message);render();'),checkEnable],
    [source.replace('await server("/subscribe",{','topics=new Set(nextTopics);\n  await server("/subscribe",{'),checkFailedWrite]
  ];
  for(const [code,check] of mutants){assert.notEqual(code,source,"변이 적용");await assert.rejects(()=>check(code),{name:"AssertionError"})}
});
