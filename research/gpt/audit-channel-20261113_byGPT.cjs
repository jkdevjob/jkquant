'use strict';
// Independent deque signal calculation, future-candle perturbation, native
// control parity, and native IM order-plan observation; no accounting rewrite.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {rotationSetup,imSetup,CV,channel,END}=require('./channel-research-20261113_byGPT.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=process.argv[2]||'/tmp/jkq-channel-audit-20261113.json';
function dequeSignals(a,n,x){const h=[],l=[],r=[];let on=false;
 for(let i=0;i<a.length;i++){
  while(h.length&&h[0]<i-n)h.shift();while(l.length&&l[0]<i-x)l.shift();
  if(i>=Math.max(n,x)){if(a[i]>a[h[0]])on=true;else if(a[i]<a[l[0]])on=false;}r.push(on);
  while(h.length&&a[h.at(-1)]<=a[i])h.pop();h.push(i);while(l.length&&a[l.at(-1)]>=a[i])l.pop();l.push(i);
 }return r;
}
(async()=>{await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),out={end:END,signalChecks:0,nativeControls:0,terminalChecks:0,rotation:[],im:[],hashes:{}};
 for(const tk of['SOXL','TQQQ','SYNSOXL_S','SYNTQQQ_S']){
  const {pg,close}=await open([{sym:tk}]);try{await pg.evaluate(rotationSetup,CV);const input=await pg.evaluate(tk=>{__makeChannels(tk);const d=dtsOf(tk).filter(x=>x<='2026-11-12');return {d,c:d.map(x=>M[tk][x][C]),maps:Object.fromEntries(Object.entries(__channelMaps).map(([k,v])=>[k,d.map(x=>v.above[x])]))};},tk);
   for(const[v,[n,x]]of Object.entries(CV)){const independent=dequeSignals(input.c,n,x);assert.deepEqual(input.maps[v],independent);assert.deepEqual(channel(input.c,n,x),independent);out.signalChecks+=input.d.length;
    const cut=Math.floor(input.d.length*.6),changed=input.c.map((p,i)=>i>cut?p*(i%2?17:.01):p);assert.deepEqual(dequeSignals(changed,n,x).slice(0,cut+1),independent.slice(0,cut+1));out.signalChecks+=cut+1;
   }
   const cases=await pg.evaluate(({tk,END})=>{const result=[];for(const cap of[10000,100000])for(const s of['2011-04-01','2017-04-01','2020-01-01'])for(const v of['base','C55_20']){
    const marked=__maOne({tk,cap,v,s,e:END,terminal:false}),closed=__maOne({tk,cap,v,s,e:END,terminal:true});if(marked.native.endShares===0&&JSON.stringify(marked.native)!==JSON.stringify(closed.native))throw Error('flat end changed');
    if(closed.native.endShares>1e-7||closed.native.endCash<-.01)throw Error('bad terminal cash/holding');
    result.push({s,cap,v,marked:marked.final,closed:closed.final,markedShares:marked.native.endShares,closedShares:closed.native.endShares,markedTax:marked.tax,closedTax:closed.tax});
   }return result;},{tk,END});out.nativeControls+=6;out.terminalChecks+=cases.length;out.rotation.push({tk,cases});
  }finally{await close();}
 }
 const {pg,close}=await open([{sym:'SOXL'},{sym:'TQQQ'}]);try{await pg.evaluate(imSetup,{tk:'SOXL',gateTk:'TQQQ'});
  out.im=await pg.evaluate(END=>{const orig=_imBuyPlan;let plans=0,disabled=0,nonLadderDiff=0;_imBuyPlan=function(...a){const got=orig(...a),ctrl=orig(...a.slice(0,10),3,a[11]);plans++;
    if(a[10]===0){disabled++;if(got.some(x=>x.ladder))throw Error('disabled ladder survived');if(JSON.stringify(got.filter(x=>!x.ladder))!==JSON.stringify(ctrl.filter(x=>!x.ladder)))nonLadderDiff++;}return got;};
   const out=[];for(const cap of[10000,100000])for(const s of['2010-03-11','2017-04-01','2020-01-01']){window.__ROWS_AT=d=>{if(__GATE_PRIOR[d]==null)throw Error('gate date missing');return __GATE_PRIOR[d]?3:0;};
    const r=RUN({tkr:'SOXL',cap,from:s,to:END,autoTp:true,big:20,trace:true});out.push({s,cap,final:r.final,cycles:r.cycles,mdd:r.mdd,plans,disabled,nonLadderDiff,traceFirst:r.trace?.tr?.[0]});}
   if(!disabled)throw Error('no disabled-row case observed');if(nonLadderDiff)throw Error('non-ladder buy changed on the same input state');return out;
  },END);
 }finally{await close();}
 const files=['backtest.html','plan-session-engine.js','research/im_plan/imh.js','research/im_plan/GPT_DAILY_GUIDE.md',...['SOXL','TQQQ','SYNSOXL_S','SYNTQQQ_S','SYNTECL','SYNTECLN','SYNTQQQ','VIX','VXN','IRX'].map(s=>'research/im_plan/data/'+s+'.json'),...['TECL','TQQQ','SGOV'].map(s=>'research/im_plan/planrule/data/'+s+'.json')];
 const crypto=require('node:crypto');for(const f of files)out.hashes[f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex');
 fs.writeFileSync(OUT,JSON.stringify(out));console.log(JSON.stringify({status:'PASS',signalChecks:out.signalChecks,nativeControls:out.nativeControls,terminalChecks:out.terminalChecks,im:out.im.map(({traceFirst,...x})=>x)}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
