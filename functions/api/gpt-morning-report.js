import {ownerAuthorized} from './global-paper.js';
import {GPT_REPORT_HEAD} from './_gpt_morning_report.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
function monitor(request,env){const key=String(env.AUTOTRADE_KEY||env.OPENING_MONITOR_KEY||'').trim();return !!key&&request.headers.get('x-monitor-key')===key;}
export async function onRequestGet({request,env}){
  if(!await ownerAuthorized(request,env))return json({ok:false,error:'unauthorized'},401);
  const key=String(env.AUTOTRADE_KEY||env.OPENING_MONITOR_KEY||'').trim();if(!key)return json({ok:false,error:'report key missing'},503);
  const date=new URL(request.url).searchParams.get('date')||'';
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:'invalid date'},400);
  const base=String(env.PUSH_WORKER_URL||'https://jkquant-presale-alert.mumae4.workers.dev').replace(/\/$/,'');
  try{const r=await fetch(base+'/gpt-morning-report'+(date?'?date='+date:''),{headers:{'x-monitor-key':key,Accept:'application/json'},signal:AbortSignal.timeout(8000)});return json(await r.json(),r.status);}
  catch(e){return json({ok:false,error:'report source unavailable'},502);}
}
// Uses only the existing JKQuant Telegram destination, never an input recipient.
export async function onRequestPost({request,env}){
  if(!monitor(request,env))return json({ok:false,error:'unauthorized'},401);
  const b=await request.json().catch(()=>({})),text=typeof b.text==='string'?b.text:'';
  if(!text.startsWith(GPT_REPORT_HEAD)||text.length>3500)return json({ok:false,definite:true,error:'invalid report'},400);
  const token=String(env.TELEGRAM_BOT_TOKEN||'').trim(),chat=String(env.TELEGRAM_CHAT_ID||'').trim();
  if(!token||!chat)return json({ok:false,definite:true,error:'Telegram configuration missing'},503);
  try{
    const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)});
    const j=await r.json().catch(()=>null);
    if(r.ok&&j?.ok)return json({ok:true,messageId:j.result?.message_id});
    return json({ok:false,definite:r.status<500&&!!j,error:j?.description||'Telegram response uncertain'},502);
  }catch(e){return json({ok:false,definite:false,error:'Telegram delivery uncertain'},502);}
}
