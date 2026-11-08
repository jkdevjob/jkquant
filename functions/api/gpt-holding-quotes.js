// Internal, read-only prices for the prospective holding laboratory. Uses the
// same minute endpoints as operating strategies, with no account/order action.
import {minuteVolume} from './_opening.js';
import {holdingClock,holdingMs} from './_gpt-holding-lab.js';
const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'');
 if(!key||request.headers.get('x-monitor-key')!==key)return reply({ok:false,error:'unauthorized'},401);
 const u=new URL(request.url),strategy=u.searchParams.get('strategy'),date=u.searchParams.get('date');
 let codes,from;try{codes=JSON.parse(u.searchParams.get('codes')||'[]');from=JSON.parse(u.searchParams.get('from')||'{}');}catch{return reply({ok:false,error:'invalid input'},400);}
 const now=Date.now(),clock=holdingClock(now);
 if(!['opening','daytrading'].includes(strategy)||date!==clock.date||!Array.isArray(codes)||codes.length>10||codes.some(c=>!/^\d{6}$/.test(c)))return reply({ok:false,error:'invalid current-session request'},400);
 const bars=[],errors=[],sources=[],latest=Math.min(1530,holdingClock(now-60_000).hm);
 for(const code of codes){
  try{
   if(strategy==='opening'){
    const r=await fetch(u.origin+'/api/quote?symbol='+code+'&minute=1'),j=await r.json();
    if(!r.ok||!Array.isArray(j.minutes))throw Error('opening minute source unavailable');
    for(const b of minuteVolume(j.minutes)){
     if(String(b.t).slice(0,10)!==date)continue;
     const hm=+String(b.t).slice(11,13)*100+(+String(b.t).slice(14,16));
     if(hm<900||hm>1000)continue;
     bars.push({code,date,hm,ms:holdingMs(date,hm),durationMs:60_000,o:+b.close,h:+b.close,l:+b.close,c:+b.close});
    }
    sources.push({code,source:'app /api/quote minute · Naver completed closes'});
   }else{
    const hm=Number(from[code]||900),first=Math.floor(hm/100)*60+hm%100,last=Math.floor(latest/100)*60+latest%100;
    for(let at=Math.max(540,first);at<=last;at+=119){
     const end=Math.min(last,at+118),endHm=Math.floor(end/60)*100+end%60;
     const r=await fetch(u.origin+'/api/kis?op=minhist&env=vts&market=kr&code='+code+'&date='+date.replaceAll('-','')+'&hour='+String(endHm).padStart(4,'0')+'00'),j=await r.json();
     if(!r.ok||j.error||!Array.isArray(j.bars))throw Error('KIS minute source unavailable');
     for(const b of j.bars){
      const digits=String(b.t||'').replace(/\D/g,''),hhmm=+digits.slice(-6,-2);
      if(hhmm<900||hhmm>latest)continue;
      bars.push({code,date,hm:hhmm,ms:holdingMs(date,hhmm),durationMs:60_000,o:+(b.o||b.c),h:+(b.h||b.c),l:+(b.l||b.c),c:+b.c});
     }
    }
    sources.push({code,source:'app /api/kis minhist · operating daytrading source'});
   }
   if(!bars.some(b=>b.code===code))throw Error('completed minute bars missing');
  }catch(e){errors.push({code,error:String(e.message||e)});}
 }
 return reply({ok:true,strategy,date,bars:[...new Map(bars.map(b=>[b.code+':'+b.ms,b])).values()],errors,sources,fetchedAt:new Date(now).toISOString()});
}
