#!/usr/bin/env node
'use strict';
const expected=['v3.137.0','세후 CAGR</th>','세후 MDD</th>','세후 MAR</th>','성장 MAR 1.5</th>','paperAfterTaxDrawdown(points)'];
(async()=>{
 for(let n=1;n<=8;n++){
   const u='https://jkquant.pages.dev/?risk_smoke='+Date.now();
   try{const r=await fetch(u,{signal:AbortSignal.timeout(12000),headers:{'Cache-Control':'no-cache'}});const t=await r.text(),missing=expected.filter(x=>!t.includes(x));console.log('SMOKE '+JSON.stringify({try:n,status:r.status,missing,bytes:t.length}));
     if(r.status===200&&!missing.length){console.log('AFTERTAX_4COLS_PROD_CONFIRMED');return;}
   }catch(e){console.log('SMOKE_ERROR '+String(e));}
   if(n<8)await new Promise(r=>setTimeout(r,8000));
 }
 throw Error('production v3.137.0 aftertax metrics not verified');
})().catch(e=>{console.error(e);process.exitCode=1});
