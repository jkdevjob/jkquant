'use strict';
// Fresh execution of Claude's pf_switch.js. Only exact memoization and an END
// cutoff are added in memory; the source files and trading engines are unchanged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
(async()=>{await require('./run.cjs').prepareChromium();const imh=require('../im_plan/imh'),open=imh.open;let hits=0,misses=0;
imh.open=async(...args)=>{const p=await open(...args),ev=p.pg.evaluate.bind(p.pg),cache=new Map();p.pg.evaluate=async(fn,arg)=>{
 if(typeof fn!=='function'||fn.toString().replace(/\s/g,'')!=='j=>IVS(j)')return ev(fn,arg);
 const missing=[],seen=new Set();for(const job of arg){const k=JSON.stringify(job);if(cache.has(k)){hits++;continue;}if(!seen.has(k)){seen.add(k);missing.push(job);}}
 if(missing.length){const values=await ev(fn,missing);for(let i=0;i<missing.length;i++){cache.set(JSON.stringify(missing[i]),values[i]);misses++;}}
 return arg.map(x=>cache.get(JSON.stringify(x)));
 };return p;};
const target=path.resolve(__dirname,'../im_plan/pf_switch.js'),source=fs.readFileSync(target,'utf8');let s=source;
const replace=(a,b)=>{if(s.split(a).length!==2)throw Error('Reference hook shape changed: '+a);s=s.replace(a,b);};
replace('function planLeg(kind,V,from,to,w){','const __planMemo=new Map(); function planLeg(kind,V,from,to,w){const key=JSON.stringify([kind,V,from,to,w]);if(__planMemo.has(key))return __planMemo.get(key);const value=__plainPlanLeg(kind,V,from,to,w);__planMemo.set(key,value);return value;} function __plainPlanLeg(kind,V,from,to,w){');
replace('RUN({autoTp:true,tkr:o.tkr,cap:o.cap,from:o.from,trace:true})','RUN({autoTp:true,tkr:o.tkr,cap:o.cap,from:o.from,to:o.to,trace:true})');
replace('{tkr:S.tk,cap,from,dedW:DEDW}','{tkr:S.tk,cap,from,to:process.env.END||"2026-11-09",dedW:DEDW}');
if(process.env.GPT_CENTRAL){const decisions=JSON.parse(fs.readFileSync(process.env.GPT_CENTRAL,'utf8'));const central=Object.fromEntries(Object.entries(decisions).map(([ds,caps])=>[ds,Object.fromEntries(Object.entries(caps).map(([cap,hs])=>[cap,Object.fromEntries(Object.entries(hs).map(([H,keys])=>[H,new Set(keys)]))]))]));global.__JKQ_CENTRAL_SWITCH=central;
 replace('if(!Object.values(BK).some(f=>f(st))) continue;','if(!global.__JKQ_CENTRAL_SWITCH[ds][cap<50000?10000:100000][H].has(ri+"|"+t)) continue;');}
console.error(JSON.stringify({referenceSha256:crypto.createHash('sha256').update(source).digest('hex'),cutoff:process.env.END||'2026-11-09',memoization:'exact input keys only'}));
process.on('beforeExit',()=>console.error(JSON.stringify({ivsCacheHits:hits,ivsNativeCalls:misses})));
process.argv=[process.execPath,target,...process.argv.slice(2)];const m=new Module(target,module);m.filename=target;m.paths=Module._nodeModulePaths(path.dirname(target));m._compile(s,target);
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
