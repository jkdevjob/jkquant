// 11-09 사용자: "'플랜 5/6 + 무매 1/6'과 '플랜 5/6 + 섀넌 1/6'을 같은 조건(1만$·10만$)에서 다시 비교해" · "이제 플랜이 아니야 듀얼이라고 해"
// 듀얼 다리 = plan-session-engine.js replay 그대로(pf_app.js 와 같음 · 체결가 판정 · 전일 종가 주수 · 다음 날 종가 · 수수료 0.1% · 배당 현금 · 월 입금 뒤 전체 맞춤).
// 무매 다리 = backtest.html runIM 그대로(imh RUN · SOXL 20분할 · 익절 자동 · LOC 3줄 · 복리 · 리버스 끔 — alloc.js 와 같은 설정).
// 섀넌 다리 = backtest.html runIVS 그대로(USD · 역분산 1/σ² · s0 55% · 40일 · 밴드 15%p · 예수금 국채 — pf_app 과 같은 호출 · 앱 기본값).
// 세금: 듀얼 = hist_at 세후(공제 250만원 × 5/6) · 무매·섀넌 = 엔진 연말 세금(공제 × 1/6 · __DEDW).
//   '들고 있음' = 마지막 해 실현분까지만 세금 · '다 팔면' = 끝날 때 안 판 이익까지 세금(공제 × 비중). 무매는 자주 팔아 세금을 먼저 내므로 둘 다 본다.
// 평가액(판정) = 듀얼 세후 끝값 + 다리 끝값. MDD = 두 다리를 더한 날마다 값(듀얼 세전 · 다리 엔진 곡선)을 입금 빼고 단위로 — 두 조합의 듀얼 다리는 같으니 차이는 다리에서만 난다.
// 구간: 실제 2011-04~ 분기 시작 5년 창 · 합성 2000-04~ 분기 시작 5년 창(SYNTECL_S·SYNTQQQ_S·SYNSOXL_S·SYNUSD_S · 국채 = IRX 로 만든 가격) · 한 길(실제 2011-04~ · 합성 2000-04~) · 위기 낙폭.
// 금액: 1만$ · 10만$ (월 입금 0) + 3만$ · 월 210$ 듀얼에(지금 계획).
// 사용: node pf_im6.js [out.json]
const fs=require('fs'),vm=require('vm'),path=require('path'); const {open}=require('./imh');
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const REAL={T:q(path.join(__dirname,'planrule','data','TECL.json')),Q:q(path.join(__dirname,'planrule','data','TQQQ.json')),G:q(path.join(__dirname,'planrule','data','SGOV.json')),im:'SOXL',iv:'USD'};
const IRXS=rd(path.join(__dirname,'data','IRX.json')).series.filter(x=>+x.close>=0).sort((a,b)=>a.date<b.date?-1:1);
const SYN=(()=>{ const T=q(path.join(__dirname,'data','SYNTECL_S.json')),Q=q(path.join(__dirname,'data','SYNTQQQ_S.json'));
  // 합성 국채 가격 — 13주 국채 금리(IRX)를 날마다 쌓는다(분배 없이 가격에 녹임). SGOV 처럼 이자를 주는 단기국채 자리.
  let p=100,j=0,r=0; const days=[]; for(const d of T.days.map(x=>x.date)){ while(j<IRXS.length&&IRXS[j].date<=d){ r=+IRXS[j].close; j++; } if(days.length) p*=1+r/100/252; days.push({date:d,close:p}); }
  return {T:{days:T.days,div:[]},Q:{days:Q.days,div:[]},G:{days,div:[]},im:'SYNSOXL_S',iv:'SYNUSD_S'}; })();
const lastOf=a=>a.days[a.days.length-1].date;
const OUT=process.argv[2]||'pf_im6_out.json', W=5/6;
const CFG=[['1만$',10000,0],['10만$',100000,0],['3만$+월210',30000,210]];
const ded=(pnl,w)=>pnl>0?Math.max(0,pnl*1350-250e4*w)*0.22/1350:0;
// hist_at.js 와 같은 세후 — 들고 있음(마지막 해 실현분만) · 다 팔면(안 판 이익까지)
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
// 페이지 고리 — pf_app.js 와 같은 두 개 + 끝날 때 안 판 이익(세무 원가 기준)을 남긴다
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','return {invested:cap,final:fin,','window.__UNR=(A.sh*lc-A.lot.basis)+(X1?(B.sh*lc1-B.lot.basis):0); return {invested:cap,final:fin,');
  patch('runIMx','return {invested:cap,peakInvested,final:fin,','window.__UNR=shares*tradeBar(tkr,days[days.length-1])[C]-LOT.basis; return {invested:cap,peakInvested,final:fin,');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'USD'},{sym:'SYNSOXL_S'},{sym:'SYNUSD_S'}]); await pg.evaluate(HOOK);
  const leg=async(kind,tkr,cap,from,to,w)=>pg.evaluate(([kind,tkr,cap,from,to,w])=>{ window.__DEDW=w; window.__UNR=0; let m={},final=0;
      if(kind==='im'){ const r=RUN({tkr,cap,from,to,autoTp:true}); r.eqs.forEach(([d,v])=>{ m[d]=v; }); final=r.final; }
      else { window.__EQ=[]; const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=runIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'); window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); final=r.final; }
      window.__DEDW=1; const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=final; return {m,final,unr:window.__UNR}; },[kind,tkr,cap,from,to,w]);
  const one=async(D,cap,M,s,e)=>{ const R=E.replay({horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*W,monthlyAdd:M,tecl:D.T.days,tqqq:D.Q.days,sgov:D.G.days,teclDiv:D.T.div,tqqqDiv:D.Q.div,sgovDiv:D.G.div});
    if(!R.stats||!R.nav.length) return null; const at=dualAfterTax(R,W), yrs=R.stats.yrs, out={s,yrs};
    for(const [k,kind,tkr] of [['im','im',D.im],['iv','iv',D.iv]]){ const L=await leg(kind,tkr,cap*(1-W),s,e,1-W);
      let nav=1,pk=1,mdd=0,prevV=null,prevIn=null,lastL=null; const curve=[];
      for(const n of R.nav){ const lv=L.m[n.date]!=null?(lastL=L.m[n.date]):lastL; if(lv==null) continue; const V=+n.total+lv;
        if(prevV!=null){ const F=+n.inflow-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=+n.inflow; curve.push([n.date,nav]); }
      const inflow=at.inflow+cap*(1-W), held=at.held+L.final, liq=at.liq+L.final-ded(L.unr,1-W);
      out[k]={held,liq,leg:L.final,legUnr:L.unr,mdd:mdd*100,cagrH:(Math.pow(held/inflow,1/yrs)-1)*100,cagrL:(Math.pow(liq/inflow,1/yrs)-1)*100,curve}; }
    out.dual=at.held; out.inflow=at.inflow+cap*(1-W); return out; };
  const res={meta:{made:new Date().toISOString(),w:W,cfg:CFG}}; const t0=Date.now();
  for(const [lab,D,from] of [['real',REAL,'2011-04-01'],['syn',SYN,'2000-04-01']]){
    const END=[lastOf(D.T),lastOf(D.Q),lastOf(D.G)].concat(await pg.evaluate(([a,b])=>[Object.keys(M[a]).sort().pop(),Object.keys(M[b]).sort().pop()],[D.im,D.iv])).sort()[0];
    const wins=[]; for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>END) continue; wins.push([s,e]); }
    if(process.env.QUICK) wins.splice(2);
    res[lab]={end:END,wins:wins.map(w=>w[0])};
    for(const [cl,cap,M] of (process.env.QUICK?CFG.slice(0,1):CFG)){ const rows=[]; for(const [s,e] of wins){ const r=await one(D,cap,M,s,e); if(r){ delete r.im.curve; delete r.iv.curve; rows.push(r); } }
      const path1=await one(D,cap,M,from,END);   // 한 길
      res[lab][cl]={rows,path:path1}; process.stderr.write(`${lab} ${cl} ${rows.length}창 · `); } }
  fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`\n${((Date.now()-t0)/1000).toFixed(0)}초 → ${OUT}`);
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
