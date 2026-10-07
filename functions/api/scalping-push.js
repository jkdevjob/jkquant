// 단타(지피티) 매수·매도 타이밍 웹 알림 켜기/끄기 — 소유자만.
// 구독 정보와 중복 방지 기록은 opening-scheduler 의 별도 gptpush Durable Object에 둔다.
import { claudeAuthorized } from "./_claude_auth.js";
const JH={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const WORKER_FALLBACK="https://jkquant-opening-scheduler.mumae4.workers.dev";
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:JH});
async function worker(env,op,body){
  const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!key)return {ok:false,error:"감시키 없음"};
  const base=String(env.OPENING_WORKER_URL||WORKER_FALLBACK).replace(/\/$/,"");
  const r=await fetch(base+"/gpt-push-"+op,body?{method:"POST",headers:{"content-type":"application/json","x-monitor-key":key},body:JSON.stringify(body)}
    :{headers:{"x-monitor-key":key}});
  return r.json().catch(()=>({ok:false,error:"HTTP "+r.status}));
}
export async function onRequestGet({request,env}){
  if(!(await claudeAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);
  return json(await worker(env,"key"));
}
export async function onRequestPost({request,env}){
  if(!(await claudeAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);
  const b=await request.json().catch(()=>({}));
  if(b.action==="subscribe")return json(await worker(env,"subscribe",{subscription:b.subscription,ua:request.headers.get("user-agent")||""}));
  if(b.action==="unsubscribe")return json(await worker(env,"unsubscribe",{endpoint:b.endpoint}));
  if(b.action==="test")return json(await worker(env,"test",{}));
  return json({ok:false,error:"action 오류"},400);
}
