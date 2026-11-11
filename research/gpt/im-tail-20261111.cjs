'use strict';
// Investigate the worst paired-drawdown counterexamples found AFTER the frozen
// full-grid audit. Diagnostic only; does not select a replacement candidate.
const fs=require('node:fs');
(async()=>{await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh'),out={date:'2026-11-11',cases:[]};for(const[tk,from,to]of[['SOXL','2017-04-01','2022-04-01'],['SYNSOXL_S','2020-10-01','2025-10-01']]){const{pg,close}=await open([{sym:tk}]);try{
 const rows=await pg.evaluate(({tk,from,to})=>{const rows=[];for(const j of[.99,1,1.01])for(const v of['base','ye']){const r=RUN({tkr:tk,cap:10000*j,from,to,autoTp:true,trace:true,...(v==='ye'?{ye:{}}:{})});let pk=0,peak='',bottom='',mdd=0;for(const[d,e]of r.eqs){if(e>pk){pk=e;peak=d;}else if((pk-e)/pk>mdd){mdd=(pk-e)/pk;bottom=d;}}const b=r.trace.tr.find(x=>x[0]===bottom);rows.push({j,v,final:r.final,cycles:r.cycles,mdd:mdd*100,bottom,atBottom:b,yeLog:r.yeLog,cycleStarts:r.trace.cyc});}return rows;},{tk,from,to});out.cases.push({tk,from,to,rows});
}finally{await close();}}fs.writeFileSync('/tmp/jkq-20261111-im-tail.json',JSON.stringify(out));for(const c of out.cases)console.log(JSON.stringify({...c,rows:c.rows.map(({cycleStarts,...r})=>r)}));})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
