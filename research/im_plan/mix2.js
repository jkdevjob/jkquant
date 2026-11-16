// 포트폴리오 ⑧ · ⑨ (11-16) — mix_pop.js 틀. 다리마다 앱 엔진 그대로:
//   듀얼 가드 = planrule/engine_var.js replay rules 'panic'(v1.1 · VIX·VXN · 고리 안 씀) · 세후 = aftertax.js afterTax(공제 × 듀얼 비중)
//   섀넌 = backtest.html runIVS(앱 기본: s0 55 · 40일 · 밴드 15%p · 단기국채 · 공제 × 섀넌 비중 · 끝 청산세 = pf_mix '다 팔면')
// ⑧ 배분 비율: 듀얼 비중 2/3 · 3/4 · 5/6(지금) · 100% — 나머지는 섀넌 USD · 월 210$ 는 듀얼 가드 · 짝 = 5/6
// ⑨ 섀넌 종목(비중 5/6:1/6): USD(지금) · TQQQ · SOXL · QLD · TECL — 짝 = USD
// 합친 날마다 값(듀얼 세전 + 섀넌 엔진 곡선) · 입금 빼고 단위 · MDD. 판정 값 = 합친 세후 끝값 짝 비.
// 실제 = 2011-04~ 매달 시작 5년 창 · 합성 = 2000-06~ (듀얼 SYNTECL·SYNTQQQ·SYNBIL 창마다 100 · 섀넌 SYN*_S)
// 사용: node mix2.js [out.json]   env: DS=real,syn · CFGS='3만+210,1만,10만'
const fs=require('fs'),path=require('path'); const {open}=require('./imh'); const {afterTax,capGainTax}=require('./planrule/aftertax');
const E=require('./planrule/engine_var').load({});
const DD=path.join(__dirname,'data'), PD=path.join(__dirname,'planrule','data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
const WS=[['2/3',2/3],['3/4',3/4],['5/6',5/6],['100%',1]], TK=['USD','TQQQ','SOXL','QLD','TECL'];
const CFG={'3만+210':[30000,210],'1만':[10000,0],'10만':[100000,0]};
const DS=(process.env.DS||'real,syn').split(','), CFGS=(process.env.CFGS||'3만+210,1만,10만').split(','), OUT=process.argv[2]||'mix2_out.json';
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','return {invested:cap,final:fin,','window.__UNR=(A.sh*lc-A.lot.basis)+(X1?(B.sh*lc1-B.lot.basis):0); return {invested:cap,final:fin,');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };
(async()=>{ const syms=[]; for(const t of TK){ syms.push({sym:t}); syms.push({sym:'SYN'+t+'_S'}); }
  const {pg,close}=await open(syms); await pg.evaluate(HOOK);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const ivs=async(tkr,cap,from,to,w)=>pg.evaluate(([tkr,cap,from,to,w])=>{ window.__EQ=[]; window.__DEDW=w; window.__UNR=0; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to);
    const r=runIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'); window.__DEDW=1; const m={}; window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=r.final;
    return {m,final:r.final,unr:window.__UNR}; },[tkr,cap,from,to,w]);
  const res={meta:{made:new Date().toISOString(),ws:WS,tk:TK,cfg:CFG}}; const t0=Date.now();
  for(const ds of DS){ res[ds]={};
    const D=ds==='real'?(()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',half:'2016-04-01',pre:'',rescale:false}; })()
      :{T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',half:'2011-01-01',pre:'SYN',rescale:true};
    const LAST=[D.T[D.T.length-1].date,'2026-11-10'].sort()[0];
    for(const cn of CFGS){ const [cap,Mo]=CFG[cn]; const rows=[];
      for(let s=D.s0; addM(s,60)<=LAST; s=addM(s,1)){ const e=addM(s,60);
        const T=D.rescale?cut(D.T,s,e):D.T, Q=D.rescale?cut(D.Q,s,e):D.Q, G=D.rescale?cut(D.G,s,e):D.G; if(!T||!Q||!G) continue;
        const row={s}; let ok=true;
        const comb=(R,at,leg,inSh)=>{ let nav=1,pk=1,mdd=0,prevV=null,prevIn=null,lastV=leg?null:0;
          for(const n of R.nav){ const v=leg?(leg.m[n.date]!=null?(lastV=leg.m[n.date]):lastV):0; if(v==null) continue; const V=+n.total+v;
            if(prevV!=null){ const F=+n.inflow-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=+n.inflow; }
          const lf=leg?leg.final-capGainTax(leg.unr,1-at.w):0; return {fv:at.final+lf,leg:lf,mdd:mdd*100,inflow:+R.nav[R.nav.length-1].inflow+inSh}; };
        for(const [wn,w] of WS){ const R=E.replay({horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*w,monthlyAdd:Mo,tecl:T,tqqq:Q,sgov:G,teclDiv:D.div[0],tqqqDiv:D.div[1],sgovDiv:D.div[2],vix:VIXr,vxn:VXNr}); if(!R.stats){ ok=false; break; }
          const at=Object.assign(afterTax(R,w),{w}); row.yrs=R.stats.yrs;
          const tks=w===1?[null]:(wn==='5/6'?TK:['USD']);
          for(const tk of tks){ const leg=tk?await ivs(D.pre+tk+(D.pre?'_S':''),cap*(1-w),s,e,1-w):null; row[wn+(tk?':'+tk:'')]=comb(R,at,leg,tk?cap*(1-w):0); } }
        if(ok) rows.push(row); }
      res[ds][cn]=rows;
      const qt=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qt(a,.5), f=(x,d=3)=>x.toFixed(d), sg=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d);
      const ann=(r,k)=>(Math.pow(Math.max(1e-9,r[k].fv/r[k].inflow),1/r.yrs)-1)*100;
      const line=(k,ref)=>{ const rt=rows.map(r=>r[k].fv/r[ref].fv), h1=rows.filter(r=>r.s<D.half).map(r=>r[k].fv/r[ref].fv), h2=rows.filter(r=>r.s>=D.half).map(r=>r[k].fv/r[ref].fv), wM=Math.max(...rows.map(r=>r[k].mdd))-Math.max(...rows.map(r=>r[ref].mdd));
        return `${k.padEnd(10)} 세후 연 중앙 ${f(med(rows.map(r=>ann(r,k))),2)} · MDD 중앙 ${f(med(rows.map(r=>r[k].mdd)),1)} · 최악 ${f(Math.max(...rows.map(r=>r[k].mdd)),1)} | 짝 비 ×${f(med(rt))} · 나은 창 ${(rt.filter(v=>v>1).length/rt.length*100).toFixed(0)}% · 앞/뒤 ×${f(med(h1))}/×${f(med(h2))} · 최악 MDD 차 ${sg(wM)} · MDD 짝 차 중앙 ${sg(med(rows.map(r=>r[k].mdd-r[ref].mdd)))}`; };
      console.log('\n■ '+ds+' '+cn+' · 5년 창 '+rows.length+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
      console.log('  ⑧ 배분(짝 = 5/6 · 섀넌 USD)'); for(const [wn] of WS){ const k=wn==='100%'?'100%':wn+':USD'; console.log('    '+line(k,'5/6:USD')); }
      console.log('  ⑨ 섀넌 종목(5/6:1/6 · 짝 = USD)'); for(const tk of TK) console.log('    '+line('5/6:'+tk,'5/6:USD')); }
    fs.writeFileSync(OUT,JSON.stringify(res)); }
  console.error('→ '+OUT+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
