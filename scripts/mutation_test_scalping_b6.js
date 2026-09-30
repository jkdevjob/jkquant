#!/usr/bin/env node
const fs=require('fs');
const src0=fs.readFileSync(require('path').join(__dirname,'..','scalping.html'),'utf8');
function extractFn(src,marker){ const i=src.indexOf(marker); if(i<0)throw new Error('missing '+marker); let j=src.indexOf('{',i),d=0,k=j; for(;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)break;}} return src.slice(i,k+1); }
function env(src){
  const code=[
    'const REF_ATR_LEN=14, REF_ATR_STOP_MULT=2, REF_ATR_TGT_MULT=4;',
    'const OPENING_FIXED_FRICTION_PCT=0.23, OPENING_VTS_MIN_MATCHES=30, OPENING_FALLBACK_TICKS_PER_SIDE='+(src.match(/OPENING_FALLBACK_TICKS_PER_SIDE=([0-9.]+)/)||[])[1]+';',
    'let OPENING_FRICTION_CAL={completeMatches:0,observedRoundTripSlippagePct:null};',
    extractFn(src,'function referenceAtr14('),extractFn(src,'function openingKrTickSize('),extractFn(src,'function openingFrictionPct('),extractFn(src,'function levelsOf('),
    'const BT={hold:5,minAmt:50};',extractFn(src,'function btSimOne('),
    'return {referenceAtr14,openingFrictionPct,levelsOf,btSimOne};'
  ].join('\n'); return new Function(code)();
}
function valueProbe(src){ try{
  const e=env(src),bars=Array.from({length:16},()=>({open:15000,high:15000.5,low:14999.5,close:15000}));
  bars[15]={open:15000,high:15000.2,low:14997.5,close:15000};
  const a=e.referenceAtr14(bars,15),l=e.levelsOf(15000,a),none=e.levelsOf(15000,null);
  const fb=e.openingFrictionPct(15000,{completeMatches:29,observedRoundTripSlippagePct:.42});
  const tr=e.btSimOne(bars,14);
  return !!l&&Math.abs(a-1)<1e-12&&Math.abs(l.stop-14998)<1e-12&&Math.abs(l.tgt-15004)<1e-12&&none===null&&Math.abs(fb-.5633333333333334)<1e-12&&tr&&Math.abs(tr.fee-fb)<1e-12&&Math.abs(tr.atr14-1)<1e-12;
}catch(e){return false;} }
function pathProbe(src){ return (src.match(/fee:openingFrictionPct\(p\.entry\)/g)||[]).length===2 && /const fee=openingFrictionPct\(en\)/.test(src) && /pct:\(r\.price-b\.px\)\/b\.px\*100-openingFrictionPct\(b\.px\)/.test(src) && !/fee:0\.5/.test(src); }
function nth(src,needle,repl,n){let at=-1,from=0;for(let i=0;i<n;i++){at=src.indexOf(needle,from);if(at<0)throw new Error('needle');from=at+needle.length;}return src.slice(0,at)+repl+src.slice(at+needle.length);}
if(!valueProbe(src0)||!pathProbe(src0)){console.error('✗ production probe failed');process.exit(1);}
const muts=[
 ['B-6 ATR level must not revert to fixed -4/+6',s=>s.replace('const stop=Math.max(0,e-REF_ATR_STOP_MULT*a),tgt=e+REF_ATR_TGT_MULT*a;','const stop=e*(1-0.04),tgt=e*1.06;'),s=>valueProbe(s)],
 ['B-6 missing ATR must not fall back to fixed levels',s=>s.replace("if(!(e>0&&a>0&&isFinite(e)&&isFinite(a)))return null;","if(!(e>0&&a>0&&isFinite(e)&&isFinite(a)))return {entry:e,stop:e*.96,tgt:e*1.06};"),s=>valueProbe(s)],
 ['B-6 local A-3 fallback remains 2.5 ticks per side',s=>s.replace('OPENING_FALLBACK_TICKS_PER_SIDE=2.5','OPENING_FALLBACK_TICKS_PER_SIDE=1.5'),s=>valueProbe(s)],
 ['B-6 backtest fee uses shared A-3 cost',s=>s.replace('const fee=openingFrictionPct(en);','const fee=0.5;'),s=>valueProbe(s)],
 ['B-6 manual close fee uses shared A-3 cost',s=>nth(s,'fee:openingFrictionPct(p.entry)','fee:0.5',1),s=>pathProbe(s)],
 ['B-6 KIS close fee uses shared A-3 cost',s=>nth(s,'fee:openingFrictionPct(p.entry)','fee:0.5',2),s=>pathProbe(s)],
 ['B-6 realized FIFO uses shared A-3 cost',s=>s.replace('pct:(r.price-b.px)/b.px*100-openingFrictionPct(b.px)','pct:(r.price-b.px)/b.px*100-0.5'),s=>pathProbe(s)]
];
let fail=0; for(const [name,mutate,stillPasses] of muts){ const m=mutate(src0); if(stillPasses(m)){console.error('✗ mutation survived: '+name);fail++;} else console.log('✓ mutation killed: '+name); }
console.log(`${muts.length-fail}/${muts.length} PASS`); process.exit(fail?1:0);
