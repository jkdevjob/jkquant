// Worker가 서버에서 확인한 신규 신청만 기존 관리자 Telegram 목적지에 전달한다.
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export async function onRequestPost({request,env}){
  const key=String(env.AUTOTRADE_KEY||env.OPENING_MONITOR_KEY||'').trim();
  if(!key||request.headers.get('x-monitor-key')!==key)return json({ok:false,error:'unauthorized'},401);
  const p=await request.json().catch(()=>null);
  if(!p||!/^[a-zA-Z0-9_-]{1,128}$/.test(p.uid||'')
    ||typeof p.email!=='string'||p.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)
    ||!Number.isSafeInteger(p.requestedAt)||p.requestedAt<=0)
    return json({ok:false,definite:true,error:'invalid applicant'},400);
  const token=String(env.TELEGRAM_BOT_TOKEN||'').trim(),chat=String(env.TELEGRAM_CHAT_ID||'').trim();
  if(!token||!chat)return json({ok:false,definite:true,error:'Telegram configuration missing'},503);
  const name=String(p.name||'이름 미등록').replace(/[<>\r\n]/g,' ').slice(0,80);
  const time=new Date(p.requestedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
  const text='[JK 투자 이용 승인 신청]\n이름: '+name+'\n계정: '+p.email+'\n신청: '+time
    +'\n\n관리자에서 승인·차단을 결정해 주세요.\nhttps://jkquant.pages.dev/admin#users';
  try{
    const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)
    });
    const j=await r.json().catch(()=>null);
    return r.ok&&j?.ok?json({ok:true}):json({ok:false,definite:r.status<500&&!!j,error:'Telegram send failed'},502);
  }catch(e){return json({ok:false,definite:false,error:'Telegram delivery uncertain'},502);}
}
