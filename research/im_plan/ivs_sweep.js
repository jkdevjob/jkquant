// 11-09 사용자: "섀넌 설정값을 바꾸면 결과가 더 좋을거 같은데" — 사전 등록(RESEARCH_LOG 11-09) 그대로.
// 조합 C(듀얼 5/6 + 섀넌 USD 1/6) 안에서 섀넌 설정 200가지를 기준(역분산 · s0 55 · 40일 · 15%p · 단기국채)과 창마다 짝지어 잰다.
// 듀얼 다리 = 앱 엔진 replay(pf_mix.js 와 같음) — 창·금액마다 한 번만 세고, 섀넌 다리 200가지는 페이지 안에서 돌려 조합 값(평가액·MDD)만 돌려받는다.
// 사용: node ivs_sweep.js [out.json]   (QUICK=1 이면 창 2개 · 후보 일부)
const fs=require('fs'),vm=require('vm'),path=require('path'); const {open}=require('./imh');
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const REAL={T:q(path.join(__dirname,'planrule','data','TECL.json')),Q:q(path.join(__dirname,'planrule','data','TQQQ.json')),G:q(path.join(__dirname,'planrule','data','SGOV.json')),iv:'USD'};
const IRXS=rd(path.join(__dirname,'data','IRX.json')).series.filter(x=>+x.close>=0).sort((a,b)=>a.date<b.date?-1:1);
const SYN=(()=>{ const T=q(path.join(__dirname,'data','SYNTECL_S.json')),Q=q(path.join(__dirname,'data','SYNTQQQ_S.json'));
  let p=100,j=0,r=0; const days=[]; for(const d of T.days.map(x=>x.date)){ while(j<IRXS.length&&IRXS[j].date<=d){ r=+IRXS[j].close; j++; } if(days.length) p*=1+r/100/252; days.push({date:d,close:p}); }
  return {T:{days:T.days,div:[]},Q:{days:Q.days,div:[]},G:{days,div:[]},iv:'SYNUSD_S'}; })();
const lastOf=a=>a.days[a.days.length-1].date;
const OUT=process.argv[2]||'ivs_sweep_out.json', W=5/6, LEGW=1/6, CAPS=[['1만$',10000],['10만$',100000]];
const VARS=[]; for(const pair of ['cash','x1']){ for(const s0 of [35,40,45,50,55,60]) for(const look of [20,40,60,90]) for(const band of [5,10,15,20]) VARS.push({k:`iv s${s0} L${look} b${band} ${pair==='x1'?'1배수':'국채'}`,mode:'iv',s0,look,band,pair});
  for(const band of [5,10,15,20]) VARS.push({k:`고정5:5 b${band} ${pair==='x1'?'1배수':'국채'}`,mode:'fix',s0:55,look:40,band,pair}); }
const BASE='iv s55 L40 b15 국채'; if(!VARS.some(v=>v.k===BASE)) throw new Error('기준 없음');
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
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),');
  // 페이지 안: 듀얼 날마다 값(nav=[[날짜,총자산,투입]])에 섀넌 다리 후보마다 더해 조합 값만 돌려준다
  window.SWEEP=function(o){ const days=Object.keys(M[o.tkr]).sort().filter(d=>d>=o.from&&d<=o.to), out={};
    const dedOf=(pnl,w)=>pnl>0?Math.max(0,pnl*1350-250e4*w)*0.22/1350:0;
    for(const v of o.vars){ window.__EQ=[]; window.__UNR=0; window.__DEDW=o.legw;
      const r=runIVS(days,o.tkr,o.cap,v.s0/100,v.look,v.band/100,true,v.mode,v.pair); window.__DEDW=1;
      const m={}; window.__EQ.forEach(([d,x])=>{ if(!String(d).endsWith('~')) m[d]=x; }); const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=r.final;
      let nav=1,pk=1,mdd=0,prevV=null,prevIn=null,last=null;
      for(const [d,tot,inf] of o.nav){ const lv=m[d]!=null?(last=m[d]):last; if(lv==null) continue; const V=tot+lv;
        if(prevV!=null){ const F=inf-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=inf; }
      out[v.k]={leg:r.final,legMdd:r.mdd,unr:window.__UNR,mdd:mdd*100,held:o.dualHeld+r.final,liq:o.dualLiq+r.final-dedOf(window.__UNR,o.legw),trades:r.trades}; }
    return out; }; };
(async()=>{ const {pg,close}=await open([{sym:'USD'},{sym:'SYNUSD_S'}]); await pg.evaluate(HOOK);
  const vars=process.env.QUICK?VARS.filter((v,i)=>i%25===0||v.k===BASE):VARS;
  const res={meta:{made:new Date().toISOString(),base:BASE,vars:vars.map(v=>v.k),caps:CAPS}}; const t0=Date.now();
  for(const [lab,D,from] of [['real',REAL,'2011-04-01'],['syn',SYN,'2000-04-01']]){
    const END=[lastOf(D.T),lastOf(D.Q),lastOf(D.G)].concat(await pg.evaluate(a=>[Object.keys(M[a]).sort().pop()],D.iv)).sort()[0];
    const wins=[]; for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>END) continue; wins.push([s,e]); }
    if(process.env.QUICK) wins.splice(2);
    res[lab]={end:END,wins:wins.map(w=>w[0])};
    for(const [cl,cap] of CAPS){ const rows=[];
      for(const [s,e] of wins){ const R=E.replay({horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*W,monthlyAdd:0,tecl:D.T.days,tqqq:D.Q.days,sgov:D.G.days,teclDiv:D.T.div,tqqqDiv:D.Q.div,sgovDiv:D.G.div});
        if(!R.stats||!R.nav.length) continue; const at=dualAfterTax(R,W);
        const v=await pg.evaluate(o=>SWEEP(o),{tkr:D.iv,from:s,to:e,cap:cap*LEGW,legw:LEGW,vars,nav:R.nav.map(n=>[n.date,+n.total,+n.inflow]),dualHeld:at.held,dualLiq:at.liq});
        rows.push({s,yrs:R.stats.yrs,inflow:at.inflow+cap*LEGW,v}); }
      res[lab][cl]=rows; process.stderr.write(`${lab} ${cl} ${rows.length}창 · ${((Date.now()-t0)/1000).toFixed(0)}초 · `); } }
  fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`\n${((Date.now()-t0)/1000).toFixed(0)}초 → ${OUT}`);
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
