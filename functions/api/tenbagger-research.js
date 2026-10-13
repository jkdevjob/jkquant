// Public price-only research, never user ledgers or broker credentials.
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
export async function onRequestGet({env,request}){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12000);
  try{
    const r=await fetch('https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/tenbagger-forward/latest.json',{signal:ac.signal,headers:{Accept:'application/json'}});
    let j;
    if(r.status===404){
      const seed=await env.ASSETS.fetch(new Request(new URL('/data/tenbagger/gpt/forward-latest.json',request.url)));
      if(!seed.ok)throw new Error('initial research snapshot unavailable');
      j=await seed.json();j.dataSource='initial_locked_snapshot';
    }else{if(!r.ok)throw new Error('research source HTTP '+r.status);j=await r.json();j.dataSource='daily_research_branch';}
    if(j.schemaVersion!==1||!Array.isArray(j.records)||!Array.isArray(j.candidates))throw new Error('research schema mismatch');
    return new Response(JSON.stringify({...j,ok:true}),{headers:HEADERS});
  }catch(e){return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:HEADERS});}
  finally{clearTimeout(timer);}
}
