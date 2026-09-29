// Cloudflare Pages Function — GET /api/crypto
// Public Upbit KRW-BTC market data proxy for the research UI.
// Read-only: this file never signs requests or places orders.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const UNITS=new Set(["1","3","5","10","15","30","60","240"]);
const MARKET="KRW-BTC";

function out(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:JH});
}

async function upbit(path){
  const r=await fetch("https://api.upbit.com"+path,{
    headers:{"Accept":"application/json","User-Agent":"jkquant-crypto-research/1.0"}
  });
  if(!r.ok)throw new Error("Upbit HTTP "+r.status);
  return r.json();
}

export async function onRequestGet({request}){
  const u=new URL(request.url);
  const op=(u.searchParams.get("op")||"ticker").toLowerCase();
  try{
    if(op==="ticker"){
      const j=await upbit("/v1/ticker?markets="+encodeURIComponent(MARKET));
      const x=Array.isArray(j)?j[0]:null;
      if(!x)throw new Error("ticker response empty");
      return out({ok:true,market:MARKET,ticker:x});
    }
    if(op==="candles"){
      const unit=u.searchParams.get("unit")||"5";
      if(!UNITS.has(unit))return out({ok:false,error:"unsupported unit"},400);
      const count=Math.max(1,Math.min(200,Number(u.searchParams.get("count")||12)||12));
      const j=await upbit("/v1/candles/minutes/"+unit+"?market="+encodeURIComponent(MARKET)+"&count="+count);
      return out({ok:true,market:MARKET,unit:Number(unit),candles:Array.isArray(j)?j:[]});
    }
    return out({ok:false,error:"unsupported op"},400);
  }catch(e){
    return out({ok:false,error:String(e.message||e)},502);
  }
}
