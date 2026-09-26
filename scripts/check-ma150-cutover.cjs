#!/usr/bin/env node
// Run the actual four production decision functions. Mutants must fail the same cases.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
const files=['index.html','backtest.html','plan.html','functions/api/_im.js'];
function extract(s,name){const start=s.indexOf('function '+name+'(');assert(start>=0,name);let end=s.indexOf('{',start),depth=0;for(;end<s.length;end++){if(s[end]==='{')depth++;else if(s[end]==='}'&&!--depth)break;}return s.slice(start,end+1);}
const dates=Array.from({length:190},(_,i)=>new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10));
const bars=price=>dates.map((date,i)=>({date,close:i===170?price:100}));
function cases(f){
 const base={tp:20,mode:'auto'},a=bars(94),b=bars(89);
 assert.equal(f(a,dates[160],dates[171],base).tp,20,'old -5% trigger must remain 20');
 assert.equal(f(b,dates[160],dates[170],base).tp,20,'today is not known at order time');
 const lowered=f(b,dates[160],dates[171],base);
 assert.equal(lowered.tp,10);assert.equal(lowered.m1AsOf,dates[170]);
 assert.equal(f(b,dates[160],dates[180],base).tp,10,'recovery must not restore 20 within cycle');
 assert.equal(f(b,dates[175],dates[180],base).tp,20,'previous cycle cannot lower a new cycle');
 assert.equal(f(b,dates[160],dates[171],{tp:10}).tp,10,'initial 10 stays 10');
 assert.equal(f(b,'',dates[171],base).tp,20,'no cycle');
 assert.equal(f(b.slice(0,100),dates[80],dates[99],base).tp,20,'insufficient history');
 const boundary=bars(90);boundary[169].close=110; // last 150 sum=15000, MA=100 exactly
 assert.equal(f(boundary,dates[160],dates[171],base).tp,20,'strictly below 90%, not equal');
}
let killed=0;
for(const file of files){const s=fs.readFileSync(path.join(root,file),'utf8');const body=s.match(/const IM_AUTOTP_M1=\{[^\n]*\};/)[0]+'\n'+extract(s,'imAutoTPM1');
 const make=b=>new Function(b+'\nreturn imAutoTPM1;')();cases(make(body));
 for(const mutant of [body.replace('below:0.10','below:0.05'),body.replace('if(close<ma*','if(close<=ma*'),body.replace('to=a-1','to=a'),body.replace('tp:10,m1:true','tp:16,m1:true')]){assert.notEqual(mutant,body);assert.throws(()=>cases(make(mutant)));killed++;}
 console.log('PASS '+file+': threshold, strict boundary, prior-day signal, cycle latch/reset, fallback');
}
// A Korean browser must select the same completed bar as a UTC/US process.
for(const file of ['index.html','plan.html']){const s=fs.readFileSync(path.join(root,file),'utf8'),f=extract(s,'simCutoff');
 const script=`const MKT_CLOSE_MIN={usd:960,krw:930},SETTLE_LAG_MIN=20;function _exchNow(){return {date:'2026-06-24',min:600};}\n${f}\nprocess.stdout.write(simCutoff('usd'));`;
 for(const TZ of ['UTC','Asia/Seoul','America/New_York'])assert.equal(cp.execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ},encoding:'utf8'}),'2026-06-23',file+' '+TZ);
 const old=script.replace("T00:00:00Z'); y.setUTCDate(y.getUTCDate()-1)","T00:00:00'); y.setDate(y.getDate()-1)");
 assert.notEqual(old,script);assert.equal(cp.execFileSync(process.execPath,['-e',old],{env:{...process.env,TZ:'Asia/Seoul'},encoding:'utf8'}),'2026-06-22');
}
console.log(`PASS: four production paths; ${killed} strategy mutants rejected; timezone cases and two date mutants verified`);
