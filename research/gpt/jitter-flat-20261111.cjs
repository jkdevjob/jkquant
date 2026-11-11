'use strict';
// The frozen central-principal sample has one +1% account already flat on its
// decision date. Native-state verification justifies C12 == A for that row:
// there is no remaining current cycle to wait for under either policy.
const fs=require('node:fs');
(async()=>{await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'SOXL'}]);try{const r=await pg.evaluate(()=>{const c=costOf.toString();(0,eval)('costOf='+c.replace('deduct:COST_DEDUCT,','deduct:COST_DEDUCT/3,'));const r=RUN({tkr:'SOXL',cap:10100,from:'2011-02-01',to:'2026-11-09',autoTp:true,trace:true}),x=r.trace.tr.find(x=>x[0]==='2012-01-03');if(!x||x[3]!==0||x[4]!==0)throw Error('Missing jitter row is not flat');return {ds:'real',principal:10100,run:10,t:x[0],cash:x[2],shares:x[3],avg:x[4],samePolicy:true,ratio:1,mddDifference:0};});fs.writeFileSync('/tmp/jkq-20261111-switch-jitter-flat-audit.json',JSON.stringify(r));console.log(JSON.stringify(r));}finally{await close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
