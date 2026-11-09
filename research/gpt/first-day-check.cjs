'use strict';
// Guide 0-1 reproduction only. Uses the complete backtest.html through unchanged
// imh.js; compares RUN without candidate options against native runIM in that page.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
(async()=>{
  const runtime=await require('./run.cjs').prepareChromium();
  const root=path.resolve(__dirname,'../..'),data=path.join(root,'research/im_plan/data/SOXL.json');
  const quote=JSON.parse(fs.readFileSync(data,'utf8'));
  const {open,stats}=require('../im_plan/imh.js'),{pg,close}=await open([{sym:'SOXL'}]);
  const rows=[];let summaryCycleCheck=[];
  try{
    for(const cap of [10000,100000]){
      const r=await pg.evaluate(cap=>{
        imAutoTp=true;imCostOn=true;imReverse=false;
        const days=Object.keys(M.SOXL).sort();
        const native=runIM(days,'SOXL',cap,20,20,true,20);
        const harness=RUN({tkr:'SOXL',cap,autoTp:true});
        return {harness,native:{final:native.final,cycles:native.cycles,mdd:native.mdd,tax:native.tax,fees:native.fees}};
      },cap);
      if(Math.abs(r.harness.final-r.native.final)>0.005||r.harness.cycles!==r.native.cycles)
        throw Error('Native/harness baseline mismatch at '+cap);
      rows.push({cap,...stats(r.harness,cap),cycles:r.harness.cycles,tax:r.harness.tax,fees:r.harness.fees,
        first:r.harness.first,last:r.harness.last,bars:r.harness.n,native:r.native,delta:r.harness.final-r.native.final});
    }
    // capsize_sum.js reports the mean over its five jittered principals, whereas
    // the guide example is one exact $10,000 account. Check that distinction.
    summaryCycleCheck=await pg.evaluate(()=>[0.98,0.99,1,1.01,1.02].map(j=>{
      const r=RUN({tkr:'SOXL',cap:10000*j,autoTp:true});return {j,cycles:r.cycles};
    }));
  }finally{await close();}
  console.log(JSON.stringify({type:'first-day reproduction, not a strategy candidate',runtime,
    researchHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    main:execFileSync('git',['rev-parse','origin/main'],{cwd:root,encoding:'utf8'}).trim(),
    quote:{source:quote.src,last:quote.last,priceBasis:quote.priceBasis,sha256:crypto.createHash('sha256').update(fs.readFileSync(data)).digest('hex')},
    expectedClaudeFinal10000:503411.23,expectedGuideCycles:112,latestClaudeCycles:113,
    summaryCycleCheck,summaryCycleMean:summaryCycleCheck.reduce((s,x)=>s+x.cycles,0)/summaryCycleCheck.length,
    rows},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
