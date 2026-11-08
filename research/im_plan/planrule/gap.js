// 연구 엔진(px) vs 앱 엔진 — '새 − 기본' 차가 왜 다른가. 5년 창(분기 시작 2011~2021) · 2만$ · 세전/세후 · 연구 엔진 옵션을 하나씩 앱 쪽으로 맞춘다
const fs=require('fs'),vm=require('vm'),path=require('path'); const D=__dirname, RD=process.argv[2];
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(D,'..','..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV');
const {prep,sim}=require(path.join(RD,'px')); const {mk}=require(path.join(RD,'plan_rules'));
const PX=prep(['TECL','TQQQ']); const RU={base:{gsb:1e9}, exp1:{gbOn:.01,gbOff:.03,sbDn:.01,sbUp:.15,gReb:'y'}};
const P=+(process.env.P||20000); const med=a=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor((b.length-1)/2)]; };
const cg=(eq)=>{ const y=(Date.parse(eq[eq.length-1][0])-Date.parse(eq[0][0]))/(365.25*864e5); let pk=0,m=0; for(const [,v] of eq){ if(v>pk) pk=v; else m=Math.max(m,(pk-v)/pk); } return {c:(Math.pow(eq[eq.length-1][1]/eq[0][1],1/y)-1)*100,m:m*100}; };
const wins=[]; for(let y=2011;y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<'2011-04-01'||e>'2026-10-19') continue; wins.push([s,e]); }
const variants={ '연구 세전':{tax:false}, '연구 세전 · 전일 종가 주수':{tax:false,sizePrev:true}, '연구 세후':{tax:true}, '연구 세후 · 전일 종가 주수':{tax:true,sizePrev:true} };
const rows={}; for(const [s,e] of wins){
  for(const k of ['base','exp1']){ const A=E.replay({horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:0,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div}); (rows['앱 세전']=rows['앱 세전']||{})[k]=(rows['앱 세전'][k]||[]).concat([cg(A.nav.map(x=>[x.date,x.total]))]); }
  for(const [vn,v] of Object.entries(variants)) for(const k of ['base','exp1']){ const o=Object.assign({cap:P,from:s,to:e,fee:.001,tax:v.tax,sizePrev:!!v.sizePrev},mk(PX,'TECL','TQQQ',RU[k])); let r;
      if(v.noInt){ const irx0={}; const P2=Object.assign({},PX,{irx:irx0}); r=sim(P2,o); } else r=sim(PX,o); (rows[vn]=rows[vn]||{})[k]=(rows[vn][k]||[]).concat([cg(r.eq)]); } }
console.log(`5년 창 ${wins.length}개 · 원금 ${P}$ — 새 − 기본 (연수익 짝 중앙 · 새가 높은 창 · MDD 짝 중앙)`);
for(const [vn,r] of Object.entries(rows)){ const dc=r.exp1.map((x,i)=>x.c-r.base[i].c), dm=r.exp1.map((x,i)=>x.m-r.base[i].m);
  console.log(`  ${vn.padEnd(16)} 기본 중앙 ${med(r.base.map(x=>x.c)).toFixed(1)} · 새 중앙 ${med(r.exp1.map(x=>x.c)).toFixed(1)} · 차 ${med(dc).toFixed(2)} · 새가 높은 창 ${(dc.filter(x=>x>0).length/dc.length*100).toFixed(0)}% · MDD 차 ${med(dm).toFixed(1)}`); }
