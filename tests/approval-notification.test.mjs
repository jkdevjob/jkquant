import test from "node:test";
import assert from "node:assert/strict";
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
function store(env={}){
  const values=new Map();
  const storage={
    get:async k=>values.get(k),
    put:async(k,v)=>{values.set(k,v);},
    delete:async k=>values.delete(k),
    list:async({prefix}={})=>new Map([...values].filter(([k])=>!prefix||k.startsWith(prefix)))
  };
  return {app:new PresaleAlertStore({storage},env),values};
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
