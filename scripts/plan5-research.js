'use strict';
const syms=['TECL','TQQQ','SGOV'];
(async()=>{
 for(const sym of syms){
  const url='https://jkquant.pages.dev/api/quote?symbol='+sym+'&range=max&div=1&intraday=0';
  const started=Date.now();
  try{
   const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(40000)});
   const j=await r.json();
   const arr=j.ohlcTrade?.length?j.ohlcTrade:j.series||[];
   console.log('DATA '+JSON.stringify({sym,http:r.status,src:j.src,priceBasis:j.priceBasis,
    series:j.series?.length,trade:j.ohlcTrade?.length,dividends:j.dividends?.length,
    from:arr[0]?.date,to:arr.at(-1)?.date,rawFrom:j.raw?.[0]?.date,
    error:j.error,debug:j.debug,ms:Date.now()-started}));
  }catch(e){console.log('DATA '+JSON.stringify({sym,error:String(e),ms:Date.now()-started}));}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
