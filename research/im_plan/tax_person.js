// 포트폴리오 ⑥-c (11-17) — 연말 세금 정리 사람 단위: 듀얼 가드 v1.1 장부(plan) + 섀넌 USD 체결 목록(trades)을 앱 portfolio() 에 같이 넣는다
//   = index.html pfTaxSources 와 같은 모양(듀얼가드 kind 'plan' · 섀넌 kind 'trades' harvest:true · 사람당 공제 250만원 한 번 · 22%).
// 다리: 듀얼 가드 = planrule/engine_var.js replay 'panic' · 섀넌 = backtest.html runIVS 앱 기본(s0 55 · 40일 · 밴드 15%p · 단기국채)
//   섀넌 엔진 안 세금은 끈다(공제를 아주 크게) — 세금은 밖에서 두 다리 합쳐 aftertax.js acc(생존 비율 근사 · 듀얼 가드 판과 같은 식)로.
// 판: pn 사람 단위 · 정리 안 함(기준) · pa 해마다 앱 마감일에 portfolio() 두 다리 제안 그대로 체결(후보) · pd 듀얼 다리만 정리(참고)
//     pa25 = pa 인데 섀넌 정리 수수료 0.25%(백테 COST_FEE · 민감도) · sep = 다리별 세금(공제 5/6:1/6 나눔 · mix2 '5/6:USD' 와 같은 셈 · 참고)
//     위약 = 두 다리 원금·입금 × 1.003 의 pn(경로 잡음)
// 섀넌 수량·값은 창 시작 단위(실제 = 그날 실제 거래 가격 단위 · 합성 = 시작 100$)로 바꿔 앱 정수 주 판정에 넣는다(값은 그대로).
// 사용: node tax_person.js [out.json]   env: DS=real,syn,oos · CFGS='3만+210,1만,10만' · CHK=1(검산만) · PS=1(11-19 ⑥-d: ps 판 = 섀넌 다리만 정리 · 듀얼 장부 harvest:false)
const fs=require('fs'),path=require('path'); const {open}=require('./imh'); const {acc,afterTax,afterTaxApp,capGainTax}=require('./planrule/aftertax');
const TC=require('../../plan-tax-check.js'); const E=require('./planrule/engine_var').load({});
const DD=path.join(__dirname,'data'), PD=path.join(__dirname,'planrule','data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
const W=5/6, CFG={'3만+210':[30000,210],'1만':[10000,0],'10만':[100000,0]};
const DS=(process.env.DS||'real,syn,oos').split(','), CFGS=(process.env.CFGS||'3만+210,1만,10만').split(','), OUT=process.argv[2]||'tax_person_out.json';
const FX=[{date:'1900-01-01',close:1350}], feeD=E.alphaFee, feeS=TC.defaultFee, fee25=(q,p)=>q*p*0.0025;
const ann=(tr,yrs)=>(Math.pow(Math.max(1e-9,1+tr/100),1/yrs)-1)*100;
// 두 다리 합친 사람 단위 세후 — R = 듀얼 가드 replay · S = {eqs:[[d,eq,shAdj,pxAdj]], tr:[[d,side,qAdj,pAdj,fee]], cap, F} · o={mode:'pn'|'pa'|'pd', feeS, margin}
function personAT(R,S,o){ const mode=o.mode, F=S.F||1, fS=o.feeS||feeS;
  const evD=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const trS=(S.tr||[]).map(t=>({type:'trade',date:t[0],symbol:'USD',side:t[1],qty:t[2]/F,price:t[3]*F,fee:t[4]}));
  const exD=[], exS=[], posD={}, posS={q:0,c:0}, A=acc(1); let iD=0, iS=0, rD=0, rS=0;
  const hv={g:0,l:0,fees:0,n:0,nSug:0,nS:0,gS:0,lS:0,fill:0,offset:0,mixed:0};
  const applyD=e=>{ const qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=posD[e.symbol]||(posD[e.symbol]={q:0,c:0});
    if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; rD+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } };
  const applyS=e=>{ const qn=e.qty, px=e.price, fee=e.fee;
    if(e.side==='buy'){ posS.q+=qn; posS.c+=qn*px+fee; } else if(qn>0&&posS.q>0){ const qq=Math.min(qn,posS.q), avg=posS.c/posS.q; rS+=qq*px-fee-avg*qq; posS.q-=qq; posS.c-=avg*qq; if(posS.q<1e-9){ posS.q=0; posS.c=0; } } };
  const sm={}; for(const [d,eq,sh,px] of (S.eqs||[])) sm[d]={eq,sh,px};
  const NV=R.nav, dl={}, hd={}; for(const n of NV){ const y=n.date.slice(0,4); if(!(y in dl)) dl[y]=TC.lastTradeDate(y); }
  for(const n of NV){ const y=n.date.slice(0,4); if(n.date<=dl[y]) hd[y]=n.date; }
  let last={eq:S.cap||0,sh:0,px:0};
  for(let t=0;t<NV.length;t++){ const n=NV[t]; while(iD<evD.length&&evD[iD].date<=n.date) applyD(evD[iD++]); while(iS<trS.length&&trS[iS].date<=n.date) applyS(trS[iS++]);
    if(sm[n.date]) last=sm[n.date];
    const y=n.date.slice(0,4); let fees=0;
    if(mode!=='pn'&&hd[y]===n.date&&t>0&&t<NV.length-1&&n.date.slice(5)>='12-01'){ const k=A.surv();
      const srcs=[{key:'plan',kind:'plan',ledger:{base:R.ledger.base,events:evD.slice(0,iD).concat(exD)},prices:{TECL:n.teclPx,TQQQ:n.tqqqPx,SGOV:n.sgovPx||0},feeFn:feeD,harvest:mode!=='ps'}];
      if(S.cap>0) srcs.push({key:'ivs',kind:'trades',trades:trS.slice(0,iS).concat(exS),prices:{USD:last.px*F},feeFn:fS,harvest:mode==='pa'||mode==='ps'});
      const C=TC.portfolio({sources:srcs,fxSeries:FX,year:y,dedKrw:250e4/k,rate:.22,margin:o.margin});
      if(C.ok){ hv[C.mode]=(hv[C.mode]||0)+1;
        for(const sg of C.suggestions){ const isS=sg.key==='ivs', f1=(isS?fS:feeD)(sg.qty,sg.price);
          const es={type:'trade',date:n.date,side:'sell',symbol:sg.symbol,qty:sg.qty,price:sg.price,fee:f1}, eb={type:'trade',date:n.date,side:'buy',symbol:sg.symbol,qty:sg.qty,price:sg.price,fee:f1};
          const r0=rD+rS; if(isS){ exS.push(es,eb); applyS(es); applyS(eb); hv.nS++; } else { exD.push(es,eb); applyD(es); applyD(eb); }
          fees+=2*f1; const dr=(rD+rS-r0)*k; if(dr>=0){ hv.g+=dr; if(isS) hv.gS+=dr; } else { hv.l-=dr; if(isS) hv.lS-=dr; } hv.nSug++; } }
      if(fees>0){ hv.fees+=fees*k; hv.n++; } }
    let cost=posS.c; for(const s2 in posD) cost+=posD[s2].c;
    const held=n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)+last.sh*last.px;
    A.step(n.date,+n.total+last.eq,+n.inflow+(S.cap||0),{realized:rD+rS,cost,held});
    if(fees>0) A.payFee(fees); }
  const r=A.done(); r.hv=hv; return r; }
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(!s.includes(from)) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','const uA=unitOf(tkr,d), uB=','window.__D=d; window.__U=unitOf(tkr,d); const uA=unitOf(tkr,d), uB=');
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','if(window.__EQ) window.__EQ.push([d,eq,A.sh*uA,M[tkr][d][C]]); if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','lotBuy(P.lot,q,px,fee+lf); P.sh+=q; cash-=spend+lf; feesTotal+=fee+lf; trades++;','lotBuy(P.lot,q,px,fee+lf); P.sh+=q; cash-=spend+lf; feesTotal+=fee+lf; trades++; if(window.__TR&&P===A) window.__TR.push([window.__D,"buy",q*window.__U,px/window.__U,fee+lf]);');
  patch('runIVS','yearPnl+=lotSell(P.lot,q,px,fee+lf); P.sh-=q; feesTotal+=fee+lf; trades++;','yearPnl+=lotSell(P.lot,q,px,fee+lf); P.sh-=q; feesTotal+=fee+lf; trades++; if(window.__TR&&P===A) window.__TR.push([window.__D,"sell",q*window.__U,px/window.__U,fee+lf]);');
  patch('runIVS','return {invested:cap,final:fin,','window.__UNR=(A.sh*lc-A.lot.basis)+(X1?(B.sh*lc1-B.lot.basis):0); return {invested:cap,final:fin,');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };
(async()=>{
  // 검산(결과 보기 전): 섀넌 0$ 이면 pn == afterTax(R,1) · pa == afterTaxApp(R,{dm:1})
  { const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); let mx1=0,mx2=0,n=0;
    for(let s='2011-04-01'; n<24; s=addM(s,5),n++){ const e=addM(s,60);
      const R=E.replay({horizon:5,rules:'panic',startDate:s,endDate:e,principal:25000,monthlyAdd:210,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div,vix:VIXr,vxn:VXNr}); if(!R.stats) continue;
      const S0={eqs:[],tr:[],cap:0,F:1};
      mx1=Math.max(mx1,Math.abs(personAT(R,S0,{mode:'pn'}).final-afterTax(R,1).final));
      mx2=Math.max(mx2,Math.abs(personAT(R,S0,{mode:'pa'}).final-afterTaxApp(R,{TC,fee:feeD,dm:1}).final)); }
    console.log('검산 섀넌 0$: pn−afterTax 최대 |차| '+mx1.toFixed(6)+'$ · pa−afterTaxApp 최대 |차| '+mx2.toFixed(6)+'$ ('+n+'창)');
    if(mx1>1e-6||mx2>1e-6){ console.error('검산 실패'); process.exit(1); } if(process.env.CHK) process.exit(0); }
  const {pg,close}=await open([{sym:'USD'},{sym:'SYNUSD_S'}]); await pg.evaluate(HOOK);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const ivs=async(tkr,cap,from,to,dedw,wantTr)=>pg.evaluate(([tkr,cap,from,to,dedw,wantTr])=>{ window.__EQ=[]; window.__TR=wantTr?[]:null; window.__DEDW=dedw; window.__UNR=0;
    const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const u0=unitOf(tkr,days[0]), p0=M[tkr][days[0]][C];
    const r=runIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'); window.__DEDW=1; const eqs=window.__EQ, tr=window.__TR; window.__EQ=null; window.__TR=null;
    return {eqs,tr,final:r.final,unr:window.__UNR,u0,p0,tax:r.tax,fees:r.fees}; },[tkr,cap,from,to,dedw,wantTr]);
  const res={meta:{made:new Date().toISOString(),cfg:CFG,W}}; const t0=Date.now();
  for(const ds of DS){ res[ds]={};
    const D=ds==='real'?(()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',half:'2016-04-01',sh:'USD',rescale:false}; })()
      :ds==='syn'?{T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',half:'2011-01-01',sh:'SYNUSD_S',rescale:true}
      :{T:srows('SYNTECLN'),Q:srows('SYNTQQQ'),G:srows('SYNBIL_L'),div:[[],[],[]],s0:'1994-08-01',half:'1997-03-01',until:'1999-12-01',sh:'SYNUSD_S',rescale:true};
    const LAST=[D.T[D.T.length-1].date,'2026-11-10'].sort()[0];
    for(const cn of CFGS){ const [cap,Mo]=CFG[cn]; const rows=[]; const t1=Date.now();
      for(let s=D.s0; addM(s,60)<=LAST&&(!D.until||s<=D.until); s=addM(s,1)){ const e=addM(s,60);
        const T=D.rescale?cut(D.T,s,e):D.T, Q=D.rescale?cut(D.Q,s,e):D.Q, G=D.rescale?cut(D.G,s,e):D.G; if(!T||!Q||!G) continue;
        const base={horizon:5,rules:'panic',startDate:s,endDate:e,tecl:T,tqqq:Q,sgov:G,teclDiv:D.div[0],tqqqDiv:D.div[1],sgovDiv:D.div[2],vix:VIXr,vxn:VXNr};
        const R=E.replay(Object.assign({principal:cap*W,monthlyAdd:Mo},base)); if(!R.stats) continue;
        const Rp=E.replay(Object.assign({principal:cap*W*1.003,monthlyAdd:Mo*1.003},base)); if(!Rp.stats) continue;
        const sc=cap*(1-W), sn=await ivs(D.sh,sc,s,e,1e6,true), sp=await ivs(D.sh,sc*1.003,s,e,1e6,true), ss=await ivs(D.sh,sc,s,e,1-W,false);
        if(!sn.eqs.length) continue;
        const F=D.rescale?100/sn.p0:sn.u0, S={eqs:sn.eqs,tr:sn.tr,cap:sc,F}, Sp={eqs:sp.eqs,tr:sp.tr,cap:sc*1.003,F};
        const yrs=R.stats.yrs, row={s,yrs,nTrS:sn.tr.length};
        for(const [k,o] of (process.env.PS?[['pn',{mode:'pn'}],['pa',{mode:'pa'}],['pd',{mode:'pd'}],['ps',{mode:'ps'}],['pa25',{mode:'pa',feeS:fee25}]]:[['pn',{mode:'pn'}],['pa',{mode:'pa'}],['pd',{mode:'pd'}],['pa25',{mode:'pa',feeS:fee25}]])){ const a=personAT(R,S,o); row[k]={a:ann(a.tr,yrs),fv:a.final,tax:a.tax,hv:a.hv}; }
        const ap=personAT(Rp,Sp,{mode:'pn'}); row.plc={a:ann(ap.tr,Rp.stats.yrs)};
        { const at=afterTax(R,W), lf=ss.final-capGainTax(ss.unr,1-W), fv=at.final+lf, inflow=+R.nav[R.nav.length-1].inflow+sc; row.sep={a:ann((fv/inflow-1)*100,yrs),fv}; }
        rows.push(row); }
      res[ds][cn]=rows;
      const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=3)=>(x>=0?'+':'')+x.toFixed(d), sum=(k,fl)=>rows.reduce((a,r)=>a+(r[k].hv[fl]||0),0);
      const d0=rows.map(r=>r.plc.a-r.pn.a);
      console.log('\n■ '+ds+' '+cn+' · 5년 창 '+rows.length+' · 사람 단위 세후 연 중앙(pn) '+qq(rows.map(r=>r.pn.a),.5).toFixed(2)+' · 섀넌 체결 중앙 '+qq(rows.map(r=>r.nTrS),.5)+'건/창 · '+((Date.now()-t1)/1000).toFixed(0)+'초');
      console.log('  위약(×1.003) 경로 잡음: 연 차 중앙 '+f(qq(d0,.5))+' · |차| 90% '+qq(d0.map(Math.abs),.9).toFixed(3)+' · 가장 나쁜 '+f(Math.min(...d0))+' · 가장 좋은 '+f(Math.max(...d0)));
      for(const k of (process.env.PS?['pa','pd','ps','pa25','sep']:['pa','pd','pa25','sep'])){ const d=rows.map(r=>r[k].a-r.pn.a), h1=rows.filter(r=>r.s<D.half).map(r=>r[k].a-r.pn.a), h2=rows.filter(r=>r.s>=D.half).map(r=>r[k].a-r.pn.a);
        let ex=''; if(k!=='sep'){ const g=rows.map(r=>r[k].hv.g/r.yrs), l=rows.map(r=>r[k].hv.l/r.yrs), fe=rows.map(r=>r[k].hv.fees/r.yrs), tx=rows.map(r=>r.pn.tax-r[k].tax);
          ex=' | 해마다 채움 '+qq(g,.5).toFixed(0)+'$ · 상계 '+qq(l,.5).toFixed(0)+'$ · 수수료 '+qq(fe,.5).toFixed(1)+'$ · 세금 줄어든 합 중앙 '+qq(tx,.5).toFixed(0)+'$ · 판정 채우기:상계:갈림 '+sum(k,'fill')+':'+sum(k,'offset')+':'+sum(k,'mixed')+' · 제안 '+sum(k,'nSug')+'건(섀넌 '+sum(k,'nS')+' · 섀넌 채움 '+sum(k,'gS').toFixed(0)+'$ · 상계 '+sum(k,'lS').toFixed(0)+'$)'; }
        console.log('  '+k.padEnd(5)+' − pn 연 차 중앙 '+f(qq(d,.5))+' · 평균 '+f(d.reduce((a,b)=>a+b,0)/d.length)+' · 10% '+f(qq(d,.1))+' · 최소 '+f(Math.min(...d))+' · 최대 '+f(Math.max(...d))+' · 나빠진 창 '+d.filter(x=>x<-1e-9).length+' · 앞/뒤 '+f(qq(h1,.5))+'/'+f(qq(h2,.5))+ex); }
      fs.writeFileSync(OUT,JSON.stringify(res)); } }
  console.error('→ '+OUT+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
