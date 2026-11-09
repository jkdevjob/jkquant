// 11-09 사용자: "듀얼+무매+섀넌을 4/1/1 · '듀얼 5/6 + 무매 1/6'과 '듀얼 5/6 + 섀넌 1/6' 3가지를 비교하고 무매와 섀넌의 상세 설정 알려줘"
// pf_im6.js 를 다리 여럿으로 넓힘 — 같은 엔진·같은 세금·같은 창. 듀얼 다리 = 앱 엔진 replay(비중 4/6 · 5/6 따로) · 다리(무매·섀넌) = backtest 엔진(모두 1/6).
//   무매 im  = SOXL 20분할 · 익절 자동(앱 실험 스위치 · 연구 기준선 조건) · 하방 LOC 3줄 · 큰수 20 · 복리 · 리버스 끔
//   무매 im0 = 같은데 익절 자동 끔(공식 V4.0 · 익절 20% 고정) — 설정 안내용 감도
//   섀넌 iv  = USD · 역분산 1/σ² · s0 55% · 40일 · 밴드 15%p · 예수금 국채(앱 기본)
// 세금 공제 250만원은 사람당 한 번 → 다리마다 비중만큼(듀얼 4/6·5/6 · 다리 1/6). '들고 있음'·'다 팔면' 둘 다(pf_im6.js 와 같음).
// 사용: node pf_mix.js [out.json]   (QUICK=1 이면 창 2개)
const fs=require('fs'),vm=require('vm'),path=require('path'); const {open}=require('./imh');
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const REAL={T:q(path.join(__dirname,'planrule','data','TECL.json')),Q:q(path.join(__dirname,'planrule','data','TQQQ.json')),G:q(path.join(__dirname,'planrule','data','SGOV.json')),im:'SOXL',iv:'USD'};
const IRXS=rd(path.join(__dirname,'data','IRX.json')).series.filter(x=>+x.close>=0).sort((a,b)=>a.date<b.date?-1:1);
const SYN=(()=>{ const T=q(path.join(__dirname,'data','SYNTECL_S.json')),Q=q(path.join(__dirname,'data','SYNTQQQ_S.json'));
  let p=100,j=0,r=0; const days=[]; for(const d of T.days.map(x=>x.date)){ while(j<IRXS.length&&IRXS[j].date<=d){ r=+IRXS[j].close; j++; } if(days.length) p*=1+r/100/252; days.push({date:d,close:p}); }
  return {T:{days:T.days,div:[]},Q:{days:Q.days,div:[]},G:{days,div:[]},im:'SYNSOXL_S',iv:'SYNUSD_S'}; })();
const lastOf=a=>a.days[a.days.length-1].date;
const OUT=process.argv[2]||'pf_mix_out.json';
const CFG=[['1만$',10000,0],['10만$',100000,0],['3만$+월210',30000,210]];
const COMBOS=[['A 4/1/1',{dual:4/6,legs:['im','iv']}],['B 듀얼5/6+무매',{dual:5/6,legs:['im']}],['C 듀얼5/6+섀넌',{dual:5/6,legs:['iv']}],
              ['A0 4/1/1(무매 공식)',{dual:4/6,legs:['im0','iv']}],['B0 듀얼5/6+무매(공식)',{dual:5/6,legs:['im0']}]];
const LEGW=1/6;
const ded=(pnl,w)=>pnl>0?Math.max(0,pnl*1350-250e4*w)*0.22/1350:0;
function acc(w){ let N=0,Lost=0,year='',rg=0,last=null; const s=()=>Math.max(0,(N-Lost)/N);
  return { step(date,Eq,inflow,x){ if(!(Eq>0)||!(inflow>0)) return; const y=String(date).slice(0,4);
      if(!last){ N=Eq; year=y; last={E:Eq,inflow,realized:0,held:0,cost:0}; }
      if(y!==year){ const Tx=ded(rg,w); Lost+=Tx/(last.E/N); rg=0; year=y; }
      const dIn=inflow-last.inflow; if(dIn>0&&Eq-dIn>0) N+=dIn/((Eq-dIn)/N);
      const dR=(+x.realized||0)-last.realized; if(dR){ rg+=s()*dR; }
      last={E:Eq,inflow,realized:+x.realized||0,held:+x.held||0,cost:+x.cost||0}; },
    done(){ const k=s(), unr=k*(last.held-last.cost); return {held:k*last.E-ded(rg,w), liq:k*last.E-ded(rg+unr,w), inflow:last.inflow}; } }; }
function dualAfterTax(R,w){ const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const pos={}, A=acc(w); let i=0, realized=0;
  for(const n of R.nav){ while(i<ev.length&&ev[i].date<=n.date){ const e=ev[i++], qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } }
    let cost=0; for(const k in pos) cost+=pos[k].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); }
  return A.done(); }
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','return {invested:cap,final:fin,','window.__UNR=(A.sh*lc-A.lot.basis)+(X1?(B.sh*lc1-B.lot.basis):0); return {invested:cap,final:fin,');
  patch('runIMx','return {invested:cap,peakInvested,final:fin,','window.__UNR=shares*tradeBar(tkr,days[days.length-1])[C]-LOT.basis; return {invested:cap,peakInvested,final:fin,');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'USD'},{sym:'SYNSOXL_S'},{sym:'SYNUSD_S'}]); await pg.evaluate(HOOK);
  const leg=async(kind,tkr,cap,from,to,w)=>pg.evaluate(([kind,tkr,cap,from,to,w])=>{ window.__DEDW=w; window.__UNR=0; let m={},final=0,extra={};
      if(kind==='im'||kind==='im0'){ const r=RUN({tkr,cap,from,to,autoTp:kind==='im'}); r.eqs.forEach(([d,v])=>{ m[d]=v; }); final=r.final; extra={cycles:r.cycles,tax:r.tax}; }
      else { window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=runIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'); window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); final=r.final; extra={trades:r.trades,tax:r.tax}; }
      window.__DEDW=1; const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=final; return {m,final,unr:window.__UNR,extra}; },[kind,tkr,cap,from,to,w]);
  const one=async(D,cap,M,s,e,keepCurve)=>{ const duals={}, legs={};
    for(const w of [...new Set(COMBOS.map(c=>c[1].dual))]){ const R=E.replay({horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*w,monthlyAdd:M,tecl:D.T.days,tqqq:D.Q.days,sgov:D.G.days,teclDiv:D.T.div,tqqqDiv:D.Q.div,sgovDiv:D.G.div});
      if(!R.stats||!R.nav.length) return null; duals[w]={R,at:dualAfterTax(R,w)}; }
    for(const k of [...new Set(COMBOS.flatMap(c=>c[1].legs))]) legs[k]=await leg(k,k==='iv'?D.iv:D.im,cap*LEGW,s,e,LEGW);
    const yrs=Object.values(duals)[0].R.stats.yrs, out={s,yrs,legs:Object.fromEntries(Object.entries(legs).map(([k,L])=>[k,{final:L.final,unr:L.unr,...L.extra}]))};
    for(const [nm,c] of COMBOS){ const {R,at}=duals[c.dual], Ls=c.legs.map(k=>legs[k]);
      let nav=1,pk=1,mdd=0,prevV=null,prevIn=null; const lastL=Ls.map(()=>null), curve=[];
      for(const n of R.nav){ let lv=0,ok=true; Ls.forEach((L,i)=>{ const v=L.m[n.date]!=null?(lastL[i]=L.m[n.date]):lastL[i]; if(v==null) ok=false; else lv+=v; }); if(!ok) continue;
        const V=+n.total+lv; if(prevV!=null){ const F=+n.inflow-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=+n.inflow; if(keepCurve) curve.push([n.date,nav]); }
      const inflow=at.inflow+cap*LEGW*c.legs.length, held=at.held+Ls.reduce((a,L)=>a+L.final,0), liq=at.liq+Ls.reduce((a,L)=>a+L.final-ded(L.unr,LEGW),0);
      out[nm]={held,liq,mdd:mdd*100,inflow,cagrH:(Math.pow(held/inflow,1/yrs)-1)*100,cagrL:(Math.pow(liq/inflow,1/yrs)-1)*100,...(keepCurve?{curve}:{})}; }
    return out; };
  const res={meta:{made:new Date().toISOString(),combos:COMBOS.map(c=>c[0]),cfg:CFG}}; const t0=Date.now();
  for(const [lab,D,from] of [['real',REAL,'2011-04-01'],['syn',SYN,'2000-04-01']]){
    const END=[lastOf(D.T),lastOf(D.Q),lastOf(D.G)].concat(await pg.evaluate(([a,b])=>[Object.keys(M[a]).sort().pop(),Object.keys(M[b]).sort().pop()],[D.im,D.iv])).sort()[0];
    const wins=[]; for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>END) continue; wins.push([s,e]); }
    if(process.env.QUICK) wins.splice(2);
    res[lab]={end:END,wins:wins.map(w=>w[0])};
    for(const [cl,cap,M] of CFG){ const rows=[]; for(const [s,e] of wins){ const r=await one(D,cap,M,s,e,false); if(r) rows.push(r); }
      res[lab][cl]={rows,path:await one(D,cap,M,from,END,true)}; process.stderr.write(`${lab} ${cl} ${rows.length}창 · `); } }
  fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`\n${((Date.now()-t0)/1000).toFixed(0)}초 → ${OUT}`);
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
