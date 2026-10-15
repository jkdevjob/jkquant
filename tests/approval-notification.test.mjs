import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { _setKeysForTest } from "../functions/api/_firebase_token.js";
import { PresaleAlertStore, approvalRecipient, approvalEmailData } from "../worker/presale-alert/src/index.js";

const adminEmail="jk82investing@gmail.com";
let pair;
async function jwt(uid,email){
  if(!pair){
    pair=await crypto.subtle.generateKey(
      {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
      true,["sign","verify"]);
  }
  const publicJwk=await crypto.subtle.exportKey("jwk",pair.publicKey);
  _setKeysForTest([{...publicJwk,kid:"approval-test-key"}],3600e3);
  const encode=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const now=Math.floor(Date.now()/1000);
  const prefix=encode({alg:"RS256",kid:"approval-test-key",typ:"JWT"})+"."+
    encode({aud:"jk-invest",iss:"https://securetoken.google.com/jk-invest",
      sub:uid,email,email_verified:true,exp:now+3600,iat:now-3,auth_time:now-10});
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",pair.privateKey,new TextEncoder().encode(prefix));
  return prefix+"."+Buffer.from(signature).toString("base64url");
}
function store(env={},Worker=PresaleAlertStore){
  const values=new Map();
  const storage={
    get:async k=>values.get(k),
    put:async(k,v)=>{values.set(k,v);},
    delete:async k=>values.delete(k),
    list:async({prefix}={})=>new Map([...values].filter(([k])=>!prefix||k.startsWith(prefix)))
  };
  return {app:new Worker({storage},env),values};
}
const userUid="recipient-001";
const userEmail="member@example.com";
const base="https://jkquant-presale-alert.example.workers.dev";
const sender={RESEND_API_KEY:"re_test_secret",APPROVAL_FROM_EMAIL:"JK 투자 <notice@verified.example>"};
function req(path,body,token){
  return new Request(base+path,{
    method:"POST",
    headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},
    body:JSON.stringify(body||{})
  });
}
function fields({approved=true,blocked=false,at=1730000000000,email=userEmail}={}){
  return {approved:{booleanValue:approved},blocked:{booleanValue:blocked},
    approvedAt:{integerValue:String(at)},email:{stringValue:email}};
}
function intercept(state){
  const old=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);
    if(url.includes("firestore.googleapis.com")){
      state.profileRead++;
      return new Response(JSON.stringify({fields:state.profile}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url.startsWith("https://script.google.com/macros/s/")){
      state.gmails=state.gmails||[];
      state.gmails.push(JSON.parse(init.body));
      if(state.gmailShouldFail)return new Response(JSON.stringify({ok:false,error:"mail quota exhausted"}),{status:200});
      return new Response(JSON.stringify({ok:true,sent:true}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url==="https://api.resend.com/emails"){
      state.emails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({id:"test-mail"}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url.includes("push.example")){
      state.pushes.push(url);
      return new Response("",{status:201});
    }
    throw new Error("unexpected network "+url);
  };
  return ()=>{globalThis.fetch=old;};
}
test("approval recipient requires true approval, not blocked, and valid email",()=>{
  assert.deepEqual(approvalRecipient(fields()),{email:userEmail,approvedAt:1730000000000});
  assert.equal(approvalRecipient(fields({approved:false})),null);
  assert.equal(approvalRecipient(fields({blocked:true})),null);
  assert.equal(approvalRecipient(fields({email:"a@evil.invalid\nBcc:other@example.com"})),null);
  assert.equal(approvalEmailData(userEmail).to[0],userEmail);
});
test("approval email is authorized, tied to server profile, and idempotent",async()=>{
  const {app}=store(sender),state={emails:[],pushes:[],profile:fields(),profileRead:0};
  const undo=intercept(state);
  try{
    const attacker=await jwt("other-user","other@example.com");
    const noAdmin=await app.approvalNotify(req("/approval/notify",{uid:userUid},attacker));
    assert.equal(noAdmin.status,403);
    assert.equal(state.profileRead,0);
    const admin=await jwt("admin-uid",adminEmail);
    const first=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    const firstBody=await first.json();
    assert.equal(firstBody.email,"sent");
    assert.equal(firstBody.push,"not_subscribed");
    assert.equal(state.emails.length,1);
    assert.equal(state.emails[0].to[0],userEmail);
    const second=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    assert.equal((await second.json()).email,"sent");
    assert.equal(state.emails.length,1,"same approvalAt must not send another email");
    const status=await app.approvalStatus(req("/approval/status",{items:[{uid:userUid,approvedAt:1730000000000}]},admin));
    assert.equal((await status.json()).states[userUid].email,"sent");
    state.profile=fields({blocked:true,at:1730000000001});
    const blocked=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    assert.equal(blocked.status,409);
    assert.equal(state.emails.length,1);
  }finally{undo();}
});
test("pending user opts into targeted push; only that user's subscription is alerted",async()=>{
  const {app}=store(sender),state={emails:[],pushes:[],profile:fields({at:1730000000100}),profileRead:0};
  const undo=intercept(state);
  try{
    const admin=await jwt("admin-uid",adminEmail);
    const user=await jwt(userUid,userEmail);
    const other=await jwt("other-uid","someoneelse@example.com");
    const ep1="https://push.example/endpoint-1",ep2="https://push.example/endpoint-2";
    assert.equal((await app.approvalSubscribe(req("/approval/subscribe",{subscription:{endpoint:ep1}},user))).status,200);
    assert.equal((await app.approvalSubscribe(req("/approval/subscribe",{subscription:{endpoint:ep2}},other))).status,200);
    const result=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    const body=await result.json();
    assert.equal(body.push,"sent");
    assert.equal(body.delivered,1);
    assert.deepEqual(state.pushes,[ep1]);
    const a=await app.approvalEvent(req("/approval/event",{endpoint:ep1}));
    assert.equal((await a.json()).alert.type,"approval");
    const b=await app.approvalEvent(req("/approval/event",{endpoint:ep2}));
    assert.equal((await b.json()).alert,null);
    await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    assert.equal(state.pushes.length,1,"same approvalAt must not push again");
  }finally{undo();}
});
test("email missing server secrets is explicit and does not falsely report sent",async()=>{
  const {app}=store({}),state={emails:[],pushes:[],profile:fields({at:1730000000200}),profileRead:0};
  const undo=intercept(state);
  try{
    const admin=await jwt("admin-uid",adminEmail);
    const r=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    assert.equal((await r.json()).email,"not_configured");
    assert.equal(state.emails.length,0);
  }finally{undo();}
});

const pending=()=>({email:{stringValue:userEmail},name:{stringValue:'신청자'},
  requestedAt:{integerValue:String(Date.now()-1000)}});
async function requestFixture(Worker=PresaleAlertStore){
  const {app,values}=store({MONITOR_KEY:'internal-test-key'},Worker),pushes=[],messages=[];
  let profile=pending(),telegramReply={ok:true};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);
    if(url.startsWith('https://firestore.googleapis.com/')){
      assert.ok(url.endsWith('/'+userUid),'body-provided UID must never be read');
      return Response.json({fields:profile});
    }
    if(url==='https://jkquant.pages.dev/api/approval-request-telegram'){
      assert.equal(init.headers['x-monitor-key'],'internal-test-key');
      messages.push(JSON.parse(init.body));return Response.json(telegramReply);
    }
    throw Error('unexpected network '+url);
  };
  app.pushOne=async(endpoint,topic)=>{pushes.push({endpoint,topic});return {ok:true,status:201};};
  const admin=await jwt('admin-uid',adminEmail),user=await jwt(userUid,userEmail);
  const adminEP='https://push.example/admin',memberEP='https://push.example/member',publicEP='https://push.example/public';
  // 이미 다른 주제를 쓰던 기기를 첫 관리자 로그인에서 자동 연결하는 경우.
  await app.subscribe(req('/subscribe',{subscription:{endpoint:adminEP},topics:['job']}));
  await app.approvalSubscribe(req('/approval/subscribe',{subscription:{endpoint:adminEP}},admin));
  await app.approvalSubscribe(req('/approval/subscribe',{subscription:{endpoint:memberEP}},user));
  await app.subscribe(req('/subscribe',{subscription:{endpoint:publicEP},topics:['research'],
    approvalEmail:adminEmail,adminRequests:true}));
  return {app,values,pushes,messages,admin,user,adminEP,memberEP,publicEP,
    setProfile:p=>{profile=p;},setTelegram:r=>{telegramReply=r;},undo:()=>{globalThis.fetch=originalFetch;}};
}
async function checkNewRequest(Worker=PresaleAlertStore){
  const x=await requestFixture(Worker);
  try{
    assert.equal((await x.app.fetch(req('/approval/request',{},''))).status,401);
    const body={uid:'victim-uid',email:'spoof@example.com',url:'https://evil.example',chat_id:'attacker'};
    const results=await Promise.all([x.app.fetch(req('/approval/request',body,x.user)),x.app.fetch(req('/approval/request',body,x.user))]);
    assert.equal(results[0].status,200);
    assert.equal((await results[0].json()).telegram,'sent');
    assert.equal(x.messages.length,1,'concurrent requests must send Telegram only once');
    assert.equal(x.messages[0].uid,userUid);assert.equal(x.messages[0].email,userEmail);
    assert.deepEqual(x.pushes,[{endpoint:x.adminEP,topic:'approval-request'}],'only server-verified admin devices');
    await x.app.fetch(req('/approval/request',body,x.user));
    x.setProfile({...pending(),requestedAt:{integerValue:String(Date.now())}});
    await x.app.fetch(req('/approval/request',body,x.user));
    assert.equal(x.messages.length,1,'changing own requestedAt or logging in again must not notify twice');
    assert.equal(x.pushes.length,1);
    for(const endpoint of [x.memberEP,x.publicEP]){
      assert.deepEqual((await(await x.app.fetch(req('/approval/request-events',{endpoint}))).json()).alerts,[]);
    }
    const alerts=(await(await x.app.fetch(req('/approval/request-events',{endpoint:x.adminEP}))).json()).alerts;
    assert.equal(alerts.length,1);assert.equal(alerts[0].url,'https://jkquant.pages.dev/admin#users');
    assert.equal(alerts[0].type,'approval-request');
    assert.ok(!JSON.stringify(await(await x.app.fetch(new Request(base+'/latest'))).json()).includes(userEmail),'no public applicant data');
    // Generic topic updates must preserve the protected admin link, never accept a forged one.
    await x.app.subscribe(req('/subscribe',{subscription:{endpoint:x.adminEP},topics:['job']}));
    assert.equal((await(await x.app.subscription(new Request(base+'/subscription?endpoint='+encodeURIComponent(x.adminEP)))).json()).adminRequests,true);
    await x.app.approvalSubscribe(req('/approval/subscribe',{subscription:{endpoint:x.adminEP},adminRequests:false},x.admin));
    assert.deepEqual((await(await x.app.approvalRequestEvents(req('/approval/request-events',{endpoint:x.adminEP}))).json()).alerts,[]);
    await x.app.approvalSubscribe(req('/approval/subscribe',{subscription:{endpoint:x.adminEP}},x.admin));
    assert.equal((await(await x.app.subscription(new Request(base+'/subscription?endpoint='+encodeURIComponent(x.adminEP)))).json()).adminRequests,false,'automatic relink must preserve OFF');
    await x.app.approvalSubscribe(req('/approval/subscribe',{subscription:{endpoint:x.adminEP},adminRequests:true},x.admin));
    assert.equal((await(await x.app.subscription(new Request(base+'/subscription?endpoint='+encodeURIComponent(x.adminEP)))).json()).adminRequests,true,'explicit ON can re-enable');
    await x.app.approvalSubscribe(req('/approval/subscribe',{subscription:{endpoint:x.adminEP},adminRequests:true},x.user));
    assert.deepEqual((await(await x.app.approvalRequestEvents(req('/approval/request-events',{endpoint:x.adminEP}))).json()).alerts,[],'shared-device account change removes admin access');
  }finally{x.undo();}
}
test('신규 신청: 본인 서버 기록·관리자 전용·동시/재로그인 중복방지·비공개·OFF 유지',()=>checkNewRequest());
async function checkNotPending(Worker=PresaleAlertStore){
  const x=await requestFixture(Worker);
  try{
    for(const p of [{...pending(),approved:{booleanValue:true}},{...pending(),blocked:{booleanValue:true}},
      {...pending(),email:{stringValue:'spoof@example.com'}},{...pending(),requestedAt:{integerValue:'0'}}]){
      x.setProfile(p);
      const j=await(await x.app.approvalRequest(req('/approval/request',{},x.user))).json();
      assert.equal(j.skipped,true);assert.equal(x.messages.length,0);assert.equal(x.pushes.length,0);
    }
  }finally{x.undo();}
}
test('승인/차단 계정·이메일 위조·신청 없는 계정은 발송 안 함',()=>checkNotPending());
test('텔레그램 불확실 응답은 재발송 안 함, 앱 푸시는 독립적으로 전달',async()=>{
  const x=await requestFixture();
  try{
    x.setTelegram({ok:false,definite:false});
    await x.app.approvalRequest(req('/approval/request',{},x.user));
    await x.app.approvalRequest(req('/approval/request',{},x.user));
    assert.equal(x.messages.length,1);assert.equal(x.pushes.length,1);
    const receipt=x.values.get('approval:request:'+userUid);assert.equal(receipt.telegram,'unknown');
  }finally{x.undo();}
});
test('신규 신청 Telegram: 서버 인증·고정 목적지·이름/계정/관리자 링크',async()=>{
  const {onRequestPost}=await import('../functions/api/approval-request-telegram.js');
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opt)=>{calls.push({url,body:JSON.parse(opt.body)});return Response.json({ok:true});};
  try{
    const env={AUTOTRADE_KEY:'test-key',TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_CHAT_ID:'configured-admin'};
    const body={uid:userUid,email:userEmail,name:'신청자',requestedAt:Date.now(),chat_id:'attacker'};
    assert.equal((await onRequestPost({request:req('/api/approval-request-telegram',body),env})).status,401);
    assert.equal(calls.length,0);
    const request=new Request(base+'/api/approval-request-telegram',{method:'POST',headers:{'x-monitor-key':'test-key','content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await onRequestPost({request,env})).status,200);
    assert.equal(calls[0].body.chat_id,'configured-admin');
    assert.ok(calls[0].body.text.includes(userEmail));assert.ok(calls[0].body.text.includes('/admin#users'));
  }finally{globalThis.fetch=old;}
});
test('서비스워커: 신규 신청과 기존 주제 알림을 함께 표시, 재푸시 중복 방지',async()=>{
  const source=fs.readFileSync(new URL('../jk-sw.js',import.meta.url),'utf8'),listeners={},shown=[],meta=new Map();
  const alerts=[{id:'approval-request:req-one',type:'approval-request',title:'신청',body:'관리자 전용',url:'/admin#users'}];
  const ctx={URL,Response,Set,Date,JSON,Promise,console,
    self:{addEventListener:(name,cb)=>listeners[name]=cb,registration:{pushManager:{getSubscription:async()=>({endpoint:'https://push.example/admin'})},
      showNotification:async(title,opt)=>shown.push({title,...opt})}},
    caches:{open:async()=>({match:async k=>meta.has(k)?Response.json(meta.get(k)):null,put:async(k,r)=>meta.set(k,await r.json())})},
    fetch:async url=>{url=String(url);if(url.includes('push-config'))return Response.json({workerUrl:base});
      if(url.endsWith('/approval/event'))return Response.json({alert:null});
      if(url.endsWith('/approval/request-events'))return Response.json({alerts});
      if(url.endsWith('/latest'))return Response.json({alerts:[{id:'trade',type:'opening',title:'매수',createdAt:new Date().toISOString()}]});
      throw Error('unexpected '+url);}};
  vm.runInNewContext(source,ctx);meta.set('/__jk_push_topics',{topics:['gpt'],topicSchemaVersion:2});
  const push=async()=>{let task;listeners.push({waitUntil:x=>{task=x;}});await task;};
  await push();assert.deepEqual(shown.map(x=>x.title),['신청','매수']);assert.equal(shown[0].data.url,'/admin#users');
  await push();assert.equal(shown.length,2);
  for(let i=0;i<110;i++)await ctx.markShown('ordinary-'+i);
  await push();assert.equal(shown.filter(x=>x.title==='신청').length,1,'많은 매매 알림 뒤에도 과거 신청을 다시 표시하지 않는다.');
});
test('신규 신청 변이 3종: 관리자 필터/중복 영수증/본인 이메일 검증 누락 탐지',async()=>{
  const file=new URL('../worker/presale-alert/src/index.js',import.meta.url),source=fs.readFileSync(file,'utf8');
  const changes=[
    [".filter(([,s])=>s.approvalEmail===APPROVAL_ADMIN&&s.adminRequests===true)",'.filter(()=>true)',checkNewRequest],
    ['let receipt=await this.state.storage.get(key);','let receipt;',checkNewRequest],
    ["||fields?.blocked?.booleanValue===true||email!==user.email","||fields?.blocked?.booleanValue===true",checkNotPending]
  ];
  for(const [from,to,check] of changes){
    assert.equal(source.split(from).length,2,'unique mutation anchor');
    const altered=source.replace(from,to).replace(/from (["'])([^"']+)\1/g,(_all,_quote,p)=>'from '+JSON.stringify(new URL(p,file).href));
    const {PresaleAlertStore:Mutant}=await import('data:text/javascript;base64,'+Buffer.from(altered).toString('base64'));
    await assert.rejects(()=>check(Mutant),{name:'AssertionError'});
  }
});
test('실제 공용 로그인 경로: 신청 저장 뒤 알림, 승인/차단은 알림 없음, 전송 실패도 승인제 유지',async()=>{
  const source=fs.readFileSync(new URL('../jk-access.js',import.meta.url),'utf8');
  function fixture({fail=false}={}){
    const classes=new Set(),calls=[],elements={};
    const node=()=>({setAttribute(){},appendChild(x){if(x.id)elements[x.id]=x;}});
    const ctx={URL,AbortSignal,Date,Promise,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,
      navigator:{},console:{warn(){}},location:{origin:'https://jkquant.pages.dev'},
      document:{documentElement:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)}},
        head:node(),body:node(),currentScript:null,createElement:node,getElementById:id=>elements[id],addEventListener(){},querySelectorAll:()=>[]},
      fetch:async(url,opt)=>{calls.push({url,opt});if(fail)throw Error('network unavailable');
        if(url==='/data/realestate/gpt/push-config.json')return Response.json({workerUrl:'https://alerts.example.workers.dev'});
        return Response.json({ok:true,telegram:'sent',push:'not_subscribed'});}};
    ctx.window=ctx;vm.runInNewContext(source,ctx);return {A:ctx.JKAccess,calls};
  }
  const user={uid:userUid,email:userEmail,getIdToken:async()=>'signed-test-token'},settle=()=>new Promise(r=>setImmediate(r));
  const fb=profile=>({db:{},doc:(_db,c,id)=>c+'/'+id,getDoc:async()=>({exists:()=>!!profile,data:()=>profile}),
    setDoc:async(_ref,p)=>{assert.equal(p.email,userEmail);assert.ok(p.requestedAt);assert.equal(p.approved,undefined);}});
  const x=fixture();assert.equal((await x.A.check(user,fb(null))).state,'pending');await settle();
  assert.equal(x.calls.length,2);assert.equal(x.calls[1].url,'https://alerts.example.workers.dev/approval/request');
  assert.equal(x.calls[1].opt.headers.Authorization,'Bearer signed-test-token');
  await x.A.check(user,fb({requestedAt:1}));await settle();assert.equal(x.calls.length,2,'same-page repeat throttled');
  for(const p of [{requestedAt:1,approved:true},{requestedAt:1,blocked:true}]){
    const y=fixture();await y.A.check(user,fb(p));await settle();assert.equal(y.calls.length,0);
  }
  const z=fixture({fail:true});assert.equal((await z.A.check(user,fb({requestedAt:1}))).state,'pending');await settle();
  assert.equal(z.A.isOk('pending'),false);
});


test("Gmail Apps Script sends only approved recipient, uses server secret, prefers Gmail and deduplicates",async()=>{
  const appEnv={
    ...sender,
    GMAIL_SCRIPT_URL:"https://script.google.com/macros/s/AKfycbTestApproval/exec",
    GMAIL_SCRIPT_SECRET:"test-key-long-enough-for-gmail-approval-0123456789"
  };
  const {app}=store(appEnv),state={emails:[],gmails:[],pushes:[],profile:fields({at:1730000000201}),profileRead:0};
  const undo=intercept(state);
  try{
    const admin=await jwt("admin-uid",adminEmail);
    const first=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    const sent=await first.json();
    assert.equal(sent.email,"sent");
    assert.equal(sent.emailProvider,"gmail");
    assert.equal(state.gmails.length,1);
    assert.equal(state.gmails[0].to,userEmail);
    assert.equal(state.gmails[0].secret,appEnv.GMAIL_SCRIPT_SECRET);
    assert.match(state.gmails[0].id,/^[a-zA-Z0-9_-]{16,80}$/);
    assert.equal(state.emails.length,0,"Gmail enabled must not fall back to Resend");
    await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    assert.equal(state.gmails.length,1,"same approval id must never call Gmail twice after success");
  }finally{undo();}
});
test("Gmail mailer reports provider rejection rather than false sent",async()=>{
  const {app}=store({
    GMAIL_SCRIPT_URL:"https://script.google.com/macros/s/AKfycbTestApproval/exec",
    GMAIL_SCRIPT_SECRET:"test-key-long-enough-for-gmail-approval-0123456789"
  });
  const state={emails:[],gmails:[],pushes:[],profile:fields({at:1730000000202}),profileRead:0,gmailShouldFail:true};
  const undo=intercept(state);
  try{
    const admin=await jwt("admin-uid",adminEmail);
    const res=await app.approvalNotify(req("/approval/notify",{uid:userUid},admin));
    const j=await res.json();
    assert.equal(j.email,"failed");
    assert.equal(j.emailProvider,"gmail");
    assert.match(j.emailError,/quota/);
  }finally{undo();}
});

test("owner-only approval status exposes safe failed-mail diagnostics but never reveals provider secrets",async()=>{
  const {app,values}=store({});
  const approvedAt=1730000000300;
  values.set("approval:send:"+userUid+":"+approvedAt,{
    email:"failed",emailProvider:"gmail",
    emailError:"send failed: quota exceeded",push:"not_subscribed",delivered:0,
    updatedAt:"2026-10-08T04:00:00Z"
  });
  const attacker=await jwt("other-user","other@example.com");
  const denied=await app.approvalStatus(req("/approval/status",{items:[{uid:userUid,approvedAt}]},attacker));
  assert.equal(denied.status,403);
  const admin=await jwt("admin-uid",adminEmail);
  const response=await app.approvalStatus(req("/approval/status",{items:[{uid:userUid,approvedAt}]},admin));
  assert.equal(response.status,200);
  const result=(await response.json()).states[userUid];
  assert.equal(result.email,"failed");
  assert.equal(result.emailProvider,"gmail");
  assert.equal(result.emailError,"send failed: quota exceeded");
  assert.equal(result.push,"not_subscribed");
  assert.equal(result.delivered,0);
  assert.equal(result.emailRecipient,undefined);
  assert.equal(result.secret,undefined);
  values.set("approval:send:"+userUid+":"+approvedAt,{
    ...values.get("approval:send:"+userUid+":"+approvedAt),
    email:"sent",emailError:"old stale error"
  });
  const accepted=await app.approvalStatus(req("/approval/status",{items:[{uid:userUid,approvedAt}]},admin));
  assert.equal((await accepted.json()).states[userUid].emailError,null);
});
