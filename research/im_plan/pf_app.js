// 포트폴리오 ①-b(11-09) — 플랜:섀넌 비중 비교를 '앱 엔진'으로: 플랜 다리 = plan-session-engine.js replay 그대로(체결가 판정 · 전일 종가 주수 ·
// 다음 날 종가 · 수수료 0.1% · 배당 현금 · 매달 입금 뒤 전체 맞춤), 섀넌 다리 = backtest.html runIVS 그대로(trio_dca 와 같은 호출 · USD · s0 55 · 40일 · 밴드 15%p).
// 세후: 플랜 다리는 hist_at.js 의 모의 목록 세후 계산(공제 250만원 × 플랜 비중) · 섀넌 다리는 엔진 세금(공제 × 섀넌 비중 · trio_dca 와 같은 __DEDW).
// 평가액 = 플랜 세후 끝값 + 섀넌 끝값(판정은 이것) · MDD·TWR = 두 다리를 더한 날마다 값을 입금 빼고 단위로 — 플랜 다리는 세전, 섀넌 다리(엔진 곡선)는 세후라
// TWR 짝 차는 플랜이 많은 쪽에 유리하게 나온다(11-09 확인) — 참고로만.
// 사용: node pf_app.js [out.json]   (실제 2011~ 분기 시작 5년 창 43 · 1만$·3만$·10만$ · 월 210$ 를 플랜에)
const fs=require('fs'),vm=require('vm'),path=require('path'); const {open}=require('./imh');
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(__dirname,'planrule','data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const END=T.days[T.days.length-1].date;
const OUT=process.argv[2]||'pf_app_out.json', M=+(process.env.MONTHLY||210), CAPS=(process.env.CAPS||'10000,30000,100000').split(',').map(Number);
const WS=[['2/3',2/3],['3/4',3/4],['5/6',5/6],['100%',1]];
// hist_at.js 와 같은 세후 계산 — 공제만 비중만큼(dedW)
const capTaxW=(pnl,w)=>pnl>0?Math.max(0,pnl*1350-250e4*w)*0.22/1350:0;
function acc(w){ let N=0,Lost=0,year='',rg=0,taxPaid=0,last=null; const s=()=>Math.max(0,(N-Lost)/N);
  return { step(date,Eq,inflow,x){ if(!(Eq>0)||!(inflow>0)) return; const y=String(date).slice(0,4);
      if(!last){ N=Eq; year=y; last={E:Eq,inflow,realized:0,held:0,cost:0}; }
      if(y!==year){ const Tx=capTaxW(rg,w); taxPaid+=Tx; Lost+=Tx/(last.E/N); rg=0; year=y; }
      const dIn=inflow-last.inflow; if(dIn>0&&Eq-dIn>0) N+=dIn/((Eq-dIn)/N);
      const dR=(+x.realized||0)-last.realized; if(dR){ rg+=s()*dR; }
      last={E:Eq,inflow,realized:+x.realized||0,held:+x.held||0,cost:+x.cost||0}; },
    done(){ const k=s(), gainNow=rg+k*(last.held-last.cost), Tn=capTaxW(gainNow,w); const final=k*last.E-Tn; return {final,tr:(final/last.inflow-1)*100,tax:taxPaid+Tn}; } }; }
function afterTax(R,w){ const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const pos={}, A=acc(w); let i=0, realized=0;
  for(const n of R.nav){ while(i<ev.length&&ev[i].date<=n.date){ const e=ev[i++], qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } }
    let cost=0; for(const k in pos) cost+=pos[k].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); }
  return A.done(); }
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };   // trio_dca.js 와 같은 고리
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'USD'}]); await pg.evaluate(HOOK);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const ivs=async(cap,from,to,w)=>pg.evaluate(([cap,from,to,w])=>{ window.__EQ=[]; window.__DEDW=w; const days=Object.keys(M.USD).sort().filter(d=>d>=from&&d<=to);
    const r=runIVS(days,'USD',cap,.55,40,.15,true,'iv','cash'); window.__DEDW=1; const m={}; window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=r.final; return {m,final:r.final}; },[cap,from,to,w]);
  const windows=[]; for(let y=2011;y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<'2011-03-01'||e>END) continue; windows.push([s,e]); }
  const res={meta:{end:END,monthly:M,windows:windows.map(w=>w[0]),ws:WS.map(w=>w[0])}}; const t0=Date.now();
  for(const cap of CAPS){ res[cap]={};
    for(const [nm,w] of WS){ const rows=[];
      for(const [s,e] of windows){
        const R=E.replay({horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*w,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
        const at=afterTax(R,w); const S=w<1?await ivs(cap*(1-w),s,e,1-w):{m:null,final:0};
        // 두 다리를 더한 날마다 값(세전) · 입금(플랜 inflow 증가분) 빼고 단위 수익 · MDD
        let nav=1,pk=1,mdd=0,prevV=null,prevIn=null,lastS=S.m?null:0; const sm=S.m||{};
        for(const n of R.nav){ const sv=S.m?(sm[n.date]!=null?(lastS=sm[n.date]):lastS):0; if(sv==null) continue; const V=+n.total+sv;
          if(prevV!=null){ const F=+n.inflow-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=+n.inflow; }
        const yrs=R.stats?R.stats.yrs:5;
        rows.push({s,fv:at.final+S.final,plan:at.final,ivs:S.final,inflow:+R.nav[R.nav.length-1].inflow+cap*(1-w),twr:(Math.pow(nav,1/yrs)-1)*100,mdd:mdd*100}); }
      res[cap][nm]=rows; process.stderr.write(`${cap/1e4}만$ ${nm} · `); } }
  fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`\n${((Date.now()-t0)/1000).toFixed(0)}초 → ${OUT}`);
  // 요약: 기준 2/3 대비 · 5/6 대비 짝
  const med=a=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor((b.length-1)/2)]; }, f=(x,d=3)=>x.toFixed(d);
  console.log(`앱 엔진(체결가) · 실제 5년 창 ${windows.length} · 월 ${M}$ 플랜 입금 · 자료 끝 ${END}`);
  for(const cap of CAPS){ const B=res[cap]['2/3'];
    console.log(`  ${cap/1e4}만$ 기준 2/3:1/3 — 평가액 중앙 ${(med(B.map(x=>x.fv))/1e3).toFixed(1)}k · 최악 ${(Math.min(...B.map(x=>x.fv))/1e3).toFixed(1)}k · MDD 중앙 ${med(B.map(x=>x.mdd)).toFixed(1)} · 최악 ${Math.max(...B.map(x=>x.mdd)).toFixed(1)}`);
    for(const [nm] of WS.slice(1)){ const A=res[cap][nm]; const part=flt=>{ const ix=A.map((x,i)=>flt(x.s)?i:-1).filter(i=>i>=0); const r=ix.map(i=>A[i].fv/B[i].fv); return `×${f(med(r))} ${(r.filter(x=>x>1).length/ix.length*100).toFixed(0)}%`; };
      const dt=A.map((x,i)=>x.twr-B[i].twr);
      console.log(`    ${nm.padEnd(4)} vs 2/3: 전체 ${part(()=>true)} · 앞 2011~15 ${part(s=>s<'2016-01-01')} · 뒤 2016~ ${part(s=>s>='2016-01-01')} | (참고) TWR 짝 차(플랜 세전·섀넌 세후 섞임) ${(med(dt)>=0?'+':'')+med(dt).toFixed(2)}%p · MDD 중앙 ${med(A.map(x=>x.mdd)).toFixed(1)} · 최악 ${Math.max(...A.map(x=>x.mdd)).toFixed(1)}`); } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
