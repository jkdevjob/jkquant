'use strict';
// Review section 5(b): own px target rather than calling plan_rules.mk.
const fs=require('node:fs'),path=require('node:path'),{prep,sim,stats,ind}=require('../im_plan/px');
const {volatility,guard,VARS}=require('./panic-independent-20261110.cjs'),{mk}=require('../im_plan/plan_rules');
const D=path.resolve(__dirname,'../im_plan/data'),P=prep(['TECL','TQQQ']),v=ind.vol(P.C.TECL,20),slow=ind.ma(P.C.TQQQ,225),fast=ind.ma(P.C.TQQQ,50),cfg=VARS.main;
const aligned=s=>{const m=Object.fromEntries(JSON.parse(fs.readFileSync(path.join(D,s+'.json'),'utf8')).series.map(x=>[x.date,x.close]));let last=null;return P.dates.map(d=>{if(m[d]>0)last=m[d];return last;});},vi=aligned('VIX'),vn=aligned('VXN');
function own(panic){return {assets:['TECL','TQQQ'],warm:226,bandOf:(s,t,c)=>s==='TECL'?.07:(t>0&&c>0?1e9:.02),target(k,cur,st){
 const state=st.machine||(st.machine={normal:null,gArm:false,gFast:false,sArm:false,sFast:false});
 const used=panic?volatility(v[k],vi[k],vn[k],cfg,state):v[k],price=P.C.TQQQ[k];
 let on;if(panic){on=guard(price,slow[k],fast[k],vi[k],st.previousOn??false,cfg,state)==='ON';}
 else{if(st.previousOn==null)st.previousOn=price>slow[k];on=price>slow[k]*1.01?true:price<slow[k]*.99?false:st.previousOn;}
 st.previousOn=on;return {TECL:.7*Math.min(1,.55*.55/(used*used)),TQQQ:on?.3:0};}};}
const out={};for(const name of ['base','main']){const opt={cap:10000,fee:.001,sizePrev:true,from:'2011-01-01'},a=sim(P,{...opt,...own(name==='main')}),b=sim(P,{...opt,...mk(P,'TECL','TQQQ',{gsb:1e9,fee:.001,...(name==='main'?{panic:{...cfg,sleeve:'min'}}:{})})});
 out[name]={own:stats(a.eq,10000),reference:stats(b.eq,10000),maxDifference:Math.max(...a.eq.map((x,i)=>Math.abs(x[1]-b.eq[i][1]))),differentDates:a.eq.filter((x,i)=>Math.abs(x[1]-b.eq[i][1])>.005).slice(0,10).map(x=>x[0])};}
fs.writeFileSync(process.argv[2]||'/tmp/jkq-r1-own-target.json',JSON.stringify(out));console.log(JSON.stringify(out,null,2));
