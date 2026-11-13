// 포트폴리오 ⑦(11-13) 시중 매매법 섞기 — 섀넌 USD 1/6 자리를 시중 매매법 X 로 바꾼 구성 vs 지금(듀얼 가드 v1.1 5/6 + 섀넌 USD 1/6 · 월 210$ 는 듀얼 가드).
// 다리마다 앱 엔진 그대로:
//   듀얼 가드 = planrule/engine_var.js replay rules 'panic'(고리 안 씀 = 앱 그대로 · VIX·VXN) · 세후 = planrule/aftertax.js afterTax(공제 × 5/6)
//   섀넌 = backtest.html runIVS(USD · s0 55 · 40일 · 밴드 15%p · 단기국채 · 공제 × 1/6 · 끝날 평가이익 청산세 = pf_mix.js '다 팔면' 과 같은 식)
//   X = pop/sim.js(앱과 같은 체결·세후 규약 · 공제 × 1/6)
// 합친 날마다 값(듀얼 세전 + 섀넌 엔진 곡선 + X 세전) · 입금 빼고 단위 · MDD. 판정 = 합친 세후 끝값 짝 비(X ÷ 지금).
// X1 = LRS_N3q 'SPY +4/−3% → TQQQ · 밖은 QQQ' · X2 = HFEA_TQ 'TQQQ 55 · TMF 45 분기' · X3 = LRS_N3b 'SPY +4/−3% → TQQQ · 밖은 BIL'
// 실제 = 2011-04~ 매달 시작 5년 창 · 합성 = 2000-06~ (듀얼 가드 SYNTECL·SYNTQQQ·SYNBIL 창마다 100 · 섀넌 SYNUSD_S · X 는 SYN* 창마다 100)
// 사용: node mix_pop.js [out.json]   env: DS=real,syn · CFGS='3만+210,1만,10만'
const fs=require('fs'),path=require('path'); const {open}=require('./imh'); const {afterTax,capGainTax}=require('./planrule/aftertax');
const E=require('./planrule/engine_var').load({}); const {run}=require('./pop/sim'); const {S}=require('./pop/strats');
const DD=path.join(__dirname,'data'), PD=path.join(__dirname,'planrule','data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
const XS={X1:{k:'LRS_N3q',syn:S.LRS_N3q.syn}, X2:{k:'HFEA_TQ',syn:S.HFEA_TQ.syn}, X3:{k:'LRS_N3b',syn:{SPY:'SYNSPY',TQQQ:'SYNTQQQ',BIL:'SYNBIL'}}};
const CFG={'3만+210':[30000,210],'1만':[10000,0],'10만':[100000,0]}, W=5/6;
const DS=(process.env.DS||'real,syn').split(','), CFGS=(process.env.CFGS||'3만+210,1만,10만').split(','), OUT=process.argv[2]||'mix_pop_out.json';
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','return {invested:cap,final:fin,','window.__UNR=(A.sh*lc-A.lot.basis)+(X1?(B.sh*lc1-B.lot.basis):0); return {invested:cap,final:fin,');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };   // pf_mix.js 와 같은 고리
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'USD'},{sym:'SYNUSD_S'}]); await pg.evaluate(HOOK);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const ivs=async(tkr,cap,from,to,w)=>pg.evaluate(([tkr,cap,from,to,w])=>{ window.__EQ=[]; window.__DEDW=w; window.__UNR=0; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to);
    const r=runIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'); window.__DEDW=1; const m={}; window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=r.final;
    return {m,final:r.final,unr:window.__UNR}; },[tkr,cap,from,to,w]);
  const res={meta:{made:new Date().toISOString(),xs:XS,cfg:CFG,w:W}}; const t0=Date.now();
  for(const ds of DS){ res[ds]={};
    const D=ds==='real'?(()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',half:'2016-04-01',iv:'USD',rescale:false}; })()
      :{T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',half:'2011-01-01',iv:'SYNUSD_S',rescale:true};
    const LAST=[D.T[D.T.length-1].date,'2026-11-10'].sort()[0];
    for(const cn of CFGS){ const [cap,M]=CFG[cn]; const rows=[];
      for(let s=D.s0; addM(s,60)<=LAST; s=addM(s,1)){ const e=addM(s,60);
        const T=D.rescale?cut(D.T,s,e):D.T, Q=D.rescale?cut(D.Q,s,e):D.Q, G=D.rescale?cut(D.G,s,e):D.G; if(!T||!Q||!G) continue;
        const R=E.replay({horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*W,monthlyAdd:M,tecl:T,tqqq:Q,sgov:G,teclDiv:D.div[0],tqqqDiv:D.div[1],sgovDiv:D.div[2],vix:VIXr,vxn:VXNr}); if(!R.stats) continue;
        const at=afterTax(R,W);
        const legs={};
        const L=await ivs(D.iv,cap*(1-W),s,e,1-W); legs.now={m:L.m,fv:L.final-capGainTax(L.unr,1-W)};
        let ok=true; for(const x in XS){ const r=run(S[XS[x].k],{start:s,end:e,principal:cap*(1-W),monthly:0,rescale:D.rescale,map:D.rescale?XS[x].syn:null,dm:1-W}); if(!r){ ok=false; break; }
          const m={}; r.nav.forEach(n=>m[n.date]=n.total); legs[x]={m,fv:r.at.final,legMdd:r.mdd,nTr:r.nTr/r.yrs}; }
        if(!ok) continue;
        const row={s,yrs:R.stats.yrs,dg:at.final,dgIn:+R.nav[R.nav.length-1].inflow};
        for(const k in legs){ const lg=legs[k]; let nav=1,pk=1,mdd=0,prevV=null,prevIn=null,lastV=null;
          for(const n of R.nav){ const v=lg.m[n.date]!=null?(lastV=lg.m[n.date]):lastV; if(v==null) continue; const V=+n.total+v;
            if(prevV!=null){ const F=+n.inflow-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=+n.inflow; }
          row[k]={fv:at.final+lg.fv,leg:lg.fv,mdd:mdd*100,legMdd:lg.legMdd??null,nTr:lg.nTr??null}; }
        rows.push(row); }
      res[ds][cn]=rows;
      const qt=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qt(a,.5), f=(x,d=3)=>x.toFixed(d), sg=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
      const B=rows.map(r=>r.now), inflowAll=r=>r.dgIn+cap*(1-W), annF=(r,fv)=>(Math.pow(Math.max(1e-9,fv/inflowAll(r)),1/r.yrs)-1)*100;
      console.log('\n■ '+ds+' '+cn+' · 5년 창 '+rows.length+' · 지금(듀얼 v1.1 5/6 + 섀넌 USD 1/6) 합친 세후 연 중앙 '+f(med(rows.map(r=>annF(r,r.now.fv))),2)+' · MDD 중앙 '+f(med(B.map(x=>x.mdd)),1)+' · 최악 '+f(Math.max(...B.map(x=>x.mdd)),1)
        +' · 섀넌 다리 세후 연 중앙 '+f(med(rows.map(r=>(Math.pow(Math.max(1e-9,r.now.leg/(cap*(1-W))),1/r.yrs)-1)*100)),1)+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
      for(const x in XS){ const rt=rows.map(r=>r[x].fv/r.now.fv), h1=rows.filter(r=>r.s<D.half).map(r=>r[x].fv/r.now.fv), h2=rows.filter(r=>r.s>=D.half).map(r=>r[x].fv/r.now.fv);
        const dm=rows.map(r=>r[x].mdd-r.now.mdd), wM=Math.max(...rows.map(r=>r[x].mdd))-Math.max(...B.map(b=>b.mdd)), da=rows.map(r=>annF(r,r[x].fv)-annF(r,r.now.fv));
        console.log('  '+x+' '+S[XS[x].k].name.padEnd(26)+' 짝 비 중앙 ×'+f(med(rt))+' · 나은 창 '+(rt.filter(v=>v>1).length/rt.length*100).toFixed(0)+'% · 앞/뒤 ×'+f(med(h1))+'/×'+f(med(h2))+' · 연 차 중앙 '+sg(med(da))+'%p · 10% '+sg(qt(da,.1))
          +' | MDD 중앙 '+f(med(rows.map(r=>r[x].mdd)),1)+' · 최악 '+f(Math.max(...rows.map(r=>r[x].mdd)),1)+' (최악 차 '+sg(wM,1)+' · 짝 차 중앙 '+sg(med(dm),1)+') · 다리 세후 연 중앙 '+f(med(rows.map(r=>(Math.pow(Math.max(1e-9,r[x].leg/(cap*(1-W))),1/r.yrs)-1)*100)),1)+' · 다리 MDD 최악 '+f(Math.max(...rows.map(r=>r[x].legMdd)),1)); } }
    fs.writeFileSync(OUT,JSON.stringify(res)); }
  console.error('→ '+OUT+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
