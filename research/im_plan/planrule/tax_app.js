// 포트폴리오 ⑥-b(11-13) 연말 세금 정리를 '앱 절차 그대로' — 해마다 마감일에 plan-tax-check.js check()(앱 🧾 연말 세금 점검이 부르는 함수)의
// 제안을 그대로 체결해 듀얼 가드 v1.1 앱 엔진 장부에 넣는다(aftertax.js afterTaxApp · 정수 주 · 공제 채우기는 남은 공제의 90% · 손실 상계는 수수료보다 이득일 때만).
// tax_eval.js(단순 판: 공제 100% · 소수 주 · 수수료 따지지 않음)와 같은 창 · 같은 세후 · 같은 위약(원금·입금 × 1.003 = 경로 잡음).
// 사용: node tax_app.js [out.json]   env: DS=real,syn,oos · SETS='2.5만,1억,1만,10만'
const fs=require('fs'),path=require('path'); const {afterTaxH,afterTaxApp}=require('./aftertax'); const TC=require('../../../plan-tax-check.js');
const DD=path.join(__dirname,'..','data'), PD=path.join(__dirname,'data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const E=require('./engine_var').load({});
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
const DS=(process.env.DS||'real,syn,oos').split(','), OUT=process.argv[2]||'tax_app_out.json';
const CFG={'2.5만':[25000,210],'1억':[69244,69.24],'1만':[10000,0],'10만':[100000,0]};
const SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const SRC={ real:()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',rescale:false,half:'2016-04-01'}; },
  syn:()=>({T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',rescale:true,half:'2011-01-01'}),
  oos:()=>({T:srows('SYNTECLN'),Q:srows('SYNTQQQ'),G:srows('SYNBIL_L'),div:[[],[],[]],s0:'1990-06-01',rescale:true,half:'1995-01-01',until:'1999-12-01'}) };
const MODES=[['none',1],['app',1],['both',1],['none',5/6],['app',5/6]];
const ann=(tr,yrs)=>(Math.pow(Math.max(1e-9,1+tr/100),1/yrs)-1)*100;
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
const sum=(rows,k,fld)=>rows.reduce((a,r)=>a+(r[k].hv[fld]||0),0);
const res={meta:{made:new Date().toISOString(),modes:MODES}};
for(const ds of DS){ const S=SRC[ds](); const LAST=S.T[S.T.length-1].date; res[ds]={};
  for(const key of SETS){ const [P,M]=CFG[key]; const rows=[]; const t0=Date.now();
    for(let s=S.s0; addM(s,60)<=LAST&&(!S.until||s<=S.until); s=addM(s,1)){ const e=addM(s,60);
      const T=S.rescale?cut(S.T,s,e):S.T, Q=S.rescale?cut(S.Q,s,e):S.Q, G=S.rescale?cut(S.G,s,e):S.G; if(!T||!Q||!G) continue;
      const base={horizon:5,rules:'panic',startDate:s,endDate:e,tecl:T,tqqq:Q,sgov:G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix:VIXr,vxn:VXNr};
      const R=E.replay(Object.assign({principal:P,monthlyAdd:M},base)); if(!R.stats) continue;
      const Rp=E.replay(Object.assign({principal:P*1.003,monthlyAdd:M*1.003},base)); if(!Rp.stats) continue;
      const r={s,yrs:R.stats.yrs,mdd:R.stats.mdd};
      for(const [m,dm] of MODES){ const a=m==='app'?afterTaxApp(R,{TC,fee:E.alphaFee,dm}):afterTaxH(R,{mode:m,dm}); r[m+'@'+dm.toFixed(3)]={a:ann(a.tr,R.stats.yrs),fv:a.final,tax:a.tax,hv:a.hv}; }
      const ap=afterTaxH(Rp,{mode:'none',dm:1.003}); r.plc={a:ann(ap.tr,Rp.stats.yrs),fv:ap.final/1.003,mdd:Rp.stats.mdd};
      rows.push(r); }
    res[ds][key]=rows;
    const K0='none@1.000', d0=rows.map(r=>r.plc.a-r[K0].a);
    console.log('\n■ '+ds+' '+key+' · 5년 창 '+rows.length+' · v1.1 세후 연 중앙 '+qq(rows.map(r=>r[K0].a),.5).toFixed(2)+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
    console.log('  위약(×1.003) 경로 잡음: 연 차 중앙 '+f(qq(d0,.5),3)+' · |차| 90% '+qq(d0.map(Math.abs),.9).toFixed(3)+' · 가장 나쁜 '+f(Math.min(...d0),3)+' · 가장 좋은 '+f(Math.max(...d0),3));
    for(const [m,dm] of MODES.slice(1)){ const k=m+'@'+dm.toFixed(3), ref=dm===1?K0:'none@'+dm.toFixed(3);
      if(m==='none'){ console.log('  '+k.padEnd(10)+' 세후 연 중앙 '+qq(rows.map(r=>r[k].a),.5).toFixed(2)+' (공제 5/6 기준)'); continue; }
      const d=rows.map(r=>r[k].a-r[ref].a), h1=rows.filter(r=>r.s<S.half).map(r=>r[k].a-r[ref].a), h2=rows.filter(r=>r.s>=S.half).map(r=>r[k].a-r[ref].a);
      const g=rows.map(r=>r[k].hv.g/r.yrs), l=rows.map(r=>r[k].hv.l/r.yrs), fe=rows.map(r=>r[k].hv.fees/r.yrs), tx=rows.map(r=>(r[ref].tax-r[k].tax));
      const md=m==='app'?(' · 해마다 판정 채우기:상계:갈림 '+sum(rows,k,'fill')+':'+sum(rows,k,'offset')+':'+sum(rows,k,'mixed')+' · 제안 '+sum(rows,k,'nSug')+'건'):'';
      console.log('  '+k.padEnd(10)+' 연 차 중앙 '+f(qq(d,.5),3)+' · 평균 '+f(d.reduce((a,b)=>a+b,0)/d.length,3)+' · 10% '+f(qq(d,.1),3)+' · 최소 '+f(Math.min(...d),3)+' · 최대 '+f(Math.max(...d),3)+' · 나빠진 창 '+d.filter(x=>x<-1e-9).length
        +' · 앞/뒤 '+f(qq(h1,.5),3)+'/'+f(qq(h2,.5),3)+' | 해마다 채움 '+qq(g,.5).toFixed(0)+'$ · 상계 '+qq(l,.5).toFixed(0)+'$ · 수수료 '+qq(fe,.5).toFixed(1)+'$ · 세금 줄어든 합 중앙 '+qq(tx,.5).toFixed(0)+'$'+md); } }
  fs.writeFileSync(OUT,JSON.stringify(res)); }
console.error('→ '+OUT);
