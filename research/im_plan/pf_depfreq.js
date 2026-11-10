// 포트폴리오 ③-b(11-10) — 플랜 입금 주기(매달 vs 2·3·6·12개월)를 '앱 엔진'으로: 플랜 다리 = plan-session-engine.js replay 그대로
// (planrule/engine_var.js 의 depEvery 고리만 — 안 주면 앱과 344건 같음 확인 · 체결가 판정 · 전일 종가 주수 · 다음 날 종가 · 수수료 0.1% · 배당 현금 · 입금 날 전체 맞춤),
// 섀넌 다리 = backtest.html runIVS(USD · s0 55 · 40일 · 밴드 15%p · 단기국채 · 공제 × 1/6) — 입금 주기와 무관해 모든 간격에서 같다.
// 기다리는 돈은 계좌 밖(이자 없음) · 끝날 못 넣은 돈은 현금으로 더한다(낸 돈 합이 매달과 같게). 세후 = pf_app.js 와 같은 계산(공제 × 플랜 비중).
// 사용: node pf_depfreq.js [out.json]   env: EVERY=1,2,3,6,12 · CAPS=10000,30000,100000 · MONTHLY=210 · W=0.8333
const fs=require('fs'),path=require('path'); const {open}=require('./imh');
const src=fs.readFileSync(path.join(__dirname,'pf_app.js'),'utf8'); const a=src.indexOf('const capTaxW='), b=src.indexOf('(async()=>{');
if(a<0||b<0) throw new Error('pf_app.js 조각을 못 찾음'); eval(src.slice(a,b).replace(/\bconst /g,'var '));   // capTaxW · acc · afterTax · HOOK (pf_app 과 같은 세후 계산)
const E=require('./planrule/engine_var').load({});
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(__dirname,'planrule','data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const END=T.days[T.days.length-1].date;
const OUT=process.argv[2]||'pf_depfreq_out.json', M=+(process.env.MONTHLY||210), W=+(process.env.W||5/6);
const EV=(process.env.EVERY||'1,2,3,6,12').split(',').map(Number), CAPS=(process.env.CAPS||'10000,30000,100000').split(',').map(Number);
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'USD'}]); await pg.evaluate(HOOK);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const ivs=async(cap,from,to,w)=>pg.evaluate(([cap,from,to,w])=>{ window.__EQ=[]; window.__DEDW=w; const days=Object.keys(M.USD).sort().filter(d=>d>=from&&d<=to);
    const r=runIVS(days,'USD',cap,.55,40,.15,true,'iv','cash'); window.__DEDW=1; const m={}; window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=r.final; return {m,final:r.final}; },[cap,from,to,w]);
  const windows=[]; for(let y=2011;y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<'2011-03-01'||e>END) continue; windows.push([s,e]); }
  const res={meta:{end:END,monthly:M,w:W,every:EV,windows:windows.map(w=>w[0])}}; const t0=Date.now();
  for(const cap of CAPS){ res[cap]={}; for(const ev of EV) res[cap][ev]=[];
    for(const [s,e] of windows){ const S=await ivs(cap*(1-W),s,e,1-W); const sm=S.m;
      for(const ev of EV){ const R=E.replay({horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*W,monthlyAdd:M,depEvery:ev,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
        const at=afterTax(R,W), last=R.nav[R.nav.length-1];
        const months=new Set(R.nav.map(n=>n.date.slice(0,7))), expect=M*(months.size-(months.has(s.slice(0,7))?1:0)), pend=expect-(+last.inflow-cap*W);   // 끝날 아직 못 넣은 돈(현금)
        // 두 다리를 더한 날마다 값(플랜 세전 + 섀넌 엔진 곡선) · 입금 빼고 단위 수익 · MDD(밖에 둔 돈은 안 셈)
        let nav=1,pk=1,mdd=0,prevV=null,prevIn=null,lastS=null;
        for(const n of R.nav){ const sv=sm[n.date]!=null?(lastS=sm[n.date]):lastS; if(sv==null) continue; const V=+n.total+sv;
          if(prevV!=null){ const F=+n.inflow-prevIn; nav*=(V-F)/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevIn=+n.inflow; }
        const tr=R.ledger.events.filter(x=>x.type==='trade'), fees=tr.reduce((x,t)=>x+(+t.fee||0),0);
        res[cap][ev].push({s,fv:at.final+pend+S.final,plan:at.final,pend,ivs:S.final,tax:at.tax,fees,nTr:tr.length,dep:R.ledger.events.filter(x=>x.kind==='dep').length,mdd:mdd*100,twr:(Math.pow(nav,1/(R.stats?R.stats.yrs:5))-1)*100}); } }
    process.stderr.write(`${cap/1e4}만$ · `); }
  fs.writeFileSync(OUT,JSON.stringify(res)); console.error(`\n${((Date.now()-t0)/1000).toFixed(0)}초 → ${OUT}`);
  const qt=(x,p)=>{ const b=[...x].sort((u,v)=>u-v); return b[Math.floor(p*(b.length-1))]; }, med=x=>qt(x,.5), f=(x,d=3)=>x.toFixed(d);
  console.log(`앱 엔진(체결가) · 실제 5년 창 ${windows.length}(분기 시작) · 플랜 ${f(W,3)} + 섀넌 USD ${f(1-W,3)} · 월 ${M}$ 상당을 플랜에 · 자료 끝 ${END}`);
  for(const cap of CAPS){ const B=res[cap][EV[0]];
    console.log(`  ${cap/1e4}만$ 기준 ${EV[0]}개월 — 세후 평가액 중앙 ${(med(B.map(x=>x.fv))/1e3).toFixed(1)}k · 최악 ${(Math.min(...B.map(x=>x.fv))/1e3).toFixed(1)}k · MDD 중앙 ${med(B.map(x=>x.mdd)).toFixed(1)} · 최악 ${Math.max(...B.map(x=>x.mdd)).toFixed(1)} · 매매 ${(med(B.map(x=>x.nTr))/5).toFixed(1)}회/년 · 수수료+세금 중앙 ${med(B.map(x=>x.fees+x.tax)).toFixed(0)}$`);
    for(const ev of EV.slice(1)){ const A=res[cap][ev]; const part=flt=>{ const ix=A.map((x,i)=>flt(x.s)?i:-1).filter(i=>i>=0); const r=ix.map(i=>A[i].fv/B[i].fv); return `×${f(med(r))} ${(r.filter(x=>x>1).length/ix.length*100).toFixed(0)}%`; };
      const dc=A.map((x,i)=>x.fees+x.tax-(B[i].fees+B[i].tax)), dm=A.map((x,i)=>x.mdd-B[i].mdd);
      console.log(`    ${String(ev).padStart(2)}개월 vs ${EV[0]}: 전체 ${part(()=>true)} · 앞 2011~15 ${part(s=>s<'2016-01-01')} · 뒤 2016~ ${part(s=>s>='2016-01-01')} | 매매 ${(med(A.map(x=>x.nTr))/5).toFixed(1)}회/년 · 수수료+세금 짝 차 중앙 ${(med(dc)>=0?'+':'')+med(dc).toFixed(0)}$ · MDD 중앙 ${med(A.map(x=>x.mdd)).toFixed(1)} · 최악 ${Math.max(...A.map(x=>x.mdd)).toFixed(1)} · MDD 짝 차 중앙 ${(med(dm)>=0?'+':'')+med(dm).toFixed(2)}`); } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
