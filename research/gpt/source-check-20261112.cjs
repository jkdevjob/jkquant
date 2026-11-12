'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8'}).trim(),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{const browser=await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'SOXL'}]);const out={date:'2026-11-12',node:process.version,browser,main:git('rev-parse','origin/main'),sourceHashes:{},dataHashes:{},cutoffs:[],coreSame:{}};
 try{out.cutoffs=await pg.evaluate(()=>{const a=[];for(const cap of[10000,100000])for(const end of['2026-11-06','2026-11-10','2026-11-11']){const r=RUN({tkr:'SOXL',cap,to:end,autoTp:true,big:20});imAutoTp=true;imCostOn=true;imReverse=false;const n=runIM(Object.keys(M.SOXL).sort().filter(d=>d<=end),'SOXL',cap,20,20,true,20);for(const k of['final','mdd','cycles','tax','fees'])if(Math.abs(r[k]-n[k])>1e-7)throw Error('Cutoff native mismatch');a.push({cap,end,final:r.final,mdd:r.mdd,cycles:r.cycles,tax:r.tax,fees:r.fees});}return a;});}finally{await close();}
 const old={},now={};vm.runInNewContext(git('show','15c2f61:plan-session-engine.js'),old);vm.runInNewContext(fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8'),now);
 for(const n of['replay','panicStep','alphaDecide'])out.coreSame[n]=String(old.JKPlanSessionEngine[n])===String(now.JKPlanSessionEngine[n]);
 for(const p of['backtest.html','plan-session-engine.js','research/im_plan/imh.js','research/im_plan/GPT_DAILY_GUIDE.md'])out.sourceHashes[p]=hash(fs.readFileSync(path.join(ROOT,p)));
 for(const p of['SOXL','USD','VIX','VXN','SYNSOXL_S','SYNUSD_S'])out.dataHashes['data/'+p+'.json']=hash(fs.readFileSync(path.join(ROOT,'research/im_plan/data',p+'.json')));
 for(const p of['TECL','TQQQ','SGOV'])out.dataHashes['planrule/data/'+p+'.json']=hash(fs.readFileSync(path.join(ROOT,'research/im_plan/planrule/data',p+'.json')));
 fs.writeFileSync('/tmp/jkq-20261112-source.json',JSON.stringify(out));console.log(JSON.stringify(out));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
