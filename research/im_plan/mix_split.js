// 포트폴리오 ⑮ · ⑯ (11-21 10:27) — mix3.js 틀(5/6 듀얼 가드 v1.1 + 1/6 섀넌 USD 단기국채 · 월 210$ 듀얼 · 다리마다 앱 엔진 그대로):
//   듀얼 = planrule/engine_var.js replay rules 'panic'(v1.1) · 세후 = aftertax.js afterTax(공제 × 5/6)
//   섀넌 = backtest.html runIVS(앱 기본 s0 55 · 40일 · 밴드 15%p · 단기국채 'cash' · 공제 × 1/6 · 끝 청산세)
// ⑮ 무매 끝난 돈 나눠 넣기: 옮기는 돈 X(3만+210 은 1만$ = 듀얼 5천 + 섀넌 5천 · 1만$/10만$ 는 전부)를 N 달에 나눠 —
//    첫날 1/N · 다음 N−1 달 첫 거래일에 1/N 씩(듀얼은 engine_var depX 입금 → 그날 전체 맞춤 · 섀넌은 같은 설정 계좌를 그달 하나 더 엶 · 공제 ÷ N)
//    기다리는 돈은 이자 없는 현금(⑮3r 만 ^IRX × (1 − 15.4%) 이자).
// ⑯ 대기 현금을 수수료 없는 달러 이자로: 듀얼 = engine_var sgx{fee0 · drag}(SGOV 매매 수수료 0 · SGOV 보유액에 날마다 −drag/252)
//    섀넌 = runIVS 국채 쪽 매매 수수료(LEGFEE) 0 · 보수 CASH_EXP 를 exp 로(이자 세금 15.4% 는 그대로).
// 값: 합친 세후 끝값(듀얼 afterTax.final + 섀넌 (final − 끝 청산세) + 남은 현금) · 날마다 합친 MDD(입금 뺀 단위 · 다리 사이 옮김은 입금 아님)
// 검산: base == mix3 'cash' 짝(같은 식) · 고리 안 쓴 엔진 == 앱 원본(inert 5창 · 11-21)
// 사용: node mix_split.js [out.json]   env: DS=real,syn · CFGS='3만+210,1만,10만' · ARMS=base,s2,...(base 는 늘 넣음)
const fs=require('fs'),path=require('path'); const {open}=require('./imh'); const {afterTax,capGainTax}=require('./planrule/aftertax');
const E=require('./planrule/engine_var').load({});
const DD=path.join(__dirname,'data'), PD=path.join(__dirname,'planrule','data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN')), IRX=ser('IRX');
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
const W=5/6;
const CFG={'3만+210':[30000,210,10000],'1만':[10000,0,10000],'10만':[100000,0,100000]};   // [시작 합계 · 월 입금(듀얼) · 옮기는 돈 X]
const ALL={ base:{N:1}, s2:{N:2}, s3:{N:3}, s6:{N:6}, s12:{N:12}, s3r:{N:3,int:true},
  ra:{sgx:{fee0:true,drag:-0.0009},rpx:{exp:0}}, rb:{sgx:{fee0:true,drag:0.0041},rpx:{exp:0.005}}, rc:{sgx:{fee0:true,drag:0.0091},rpx:{exp:0.010}},
  rd:{sgx:{fee0:true,drag:-0.0009}}, re:{rpx:{exp:0}}, rf:{sgx:{fee0:true,drag:0},rpx:{exp:0.0010}} };
const LAB={base:'지금(한 번에 · SGOV)',s2:'⑮2 2달 나눠',s3:'⑮3 3달 나눠',s6:'⑮6 6달 나눠',s12:'⑮12 12달 나눠(참고)',s3r:'⑮3r 3달 · 기다리는 돈 이자',
  ra:'⑯a 두 다리 RP(T-Bill)',rb:'⑯b RP(T-Bill−0.5%p)',rc:'⑯c RP(T-Bill−1.0%p)',rd:'⑯d 듀얼만 RP',re:'⑯e 섀넌만 RP',rf:'⑯f 수수료만 없앰'};
const ARMS=['base',...(process.env.ARMS||Object.keys(ALL).join(',')).split(',').filter(k=>k!=='base'&&ALL[k])];
const LIM=+(process.env.LIM||0); const DS=(process.env.DS||'real,syn').split(','), CFGS=(process.env.CFGS||'3만+210,1만,10만').split(','), OUT=process.argv[2]||'mix_split_out.json';
const HOOK=()=>{ const patch=(name,from,to)=>{ let s=window[name].toString(); if(s.split(from).length!==2) throw new Error('hook '+name+': '+from); s=s.split(from).join(to); (0,eval)(name+'='+s); };
  patch('runIVS','if(i%10===0)snap.push([d,eq]);','window.__EQ.push([d,eq]);if(i%10===0)snap.push([d,eq]);');
  patch('runIVS','return {invested:cap,final:fin,','window.__UNR=(A.sh*lc-A.lot.basis)+(X1?(B.sh*lc1-B.lot.basis):0); return {invested:cap,final:fin,');
  patch('runIVS','CASH_EXP=costOn?0.0010:0;','CASH_EXP=costOn?(window.__RPX?window.__RPX.exp:0.0010):0;');
  patch('runIVS','const LEGFEE=(costOn&&!X1)?costOf(tkr).fee:0;','const LEGFEE=(costOn&&!X1&&!window.__RPX)?costOf(tkr).fee:0;');
  patch('costOf','deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'); };
(async()=>{ const {pg,close}=await open([{sym:'USD'},{sym:'SYNUSD_S'}]); await pg.evaluate(HOOK);
  // 섀넌 계좌 여럿을 한 번에: jobs=[{cap,from,dedw,rpx}] → [{m(날짜→평가액),final,unr}]
  const ivsMany=(tkr,to,jobs)=>pg.evaluate(([tkr,to,jobs])=>jobs.map(j=>{ window.__EQ=[]; window.__DEDW=j.dedw; window.__RPX=j.rpx||null; window.__UNR=0;
      const days=Object.keys(M[tkr]).sort().filter(d=>d>=j.from&&d<=to); const r=runIVS(days,tkr,j.cap,.55,40,.15,true,'iv','cash'); window.__DEDW=1; window.__RPX=null;
      const m={}; window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); return {m,final:r.final,unr:window.__UNR,d0:days[0]}; }),[tkr,to,jobs]);
  const res={meta:{made:new Date().toISOString(),W,cfg:CFG,arms:ARMS}}; const t0=Date.now();
  for(const ds of DS){ res[ds]={};
    const D=ds==='real'?(()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',half:'2016-04-01',pre:'',rescale:false}; })()
      :{T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',half:'2011-01-01',pre:'SYN',rescale:true};
    const LAST=[D.T[D.T.length-1].date,'2026-11-10'].sort()[0], SH=D.pre?'SYNUSD_S':'USD';
    for(const cn of CFGS){ const [cap,Mo,X]=CFG[cn]; const capSh=cap*(1-W), Xdg=X-capSh; const rows=[];
      for(let s=D.s0; addM(s,60)<=LAST&&!(LIM&&rows.length>=LIM); s=addM(s,1)){ const e=addM(s,60);
        const T=D.rescale?cut(D.T,s,e):D.T, Q=D.rescale?cut(D.Q,s,e):D.Q, G=D.rescale?cut(D.G,s,e):D.G; if(!T||!Q||!G) continue;
        const run=(N,sgx)=>{ const mk=new Set(); for(let k=1;k<N;k++) mk.add(addM(s,k).slice(0,7));
          return E.replay({horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*W-Xdg*(N-1)/N,monthlyAdd:Mo,tecl:T,tqqq:Q,sgov:G,teclDiv:D.div[0],tqqqDiv:D.div[1],sgovDiv:D.div[2],vix:VIXr,vxn:VXNr,
            depX:N>1?(dt=>mk.has(dt.slice(0,7))?Xdg/N:0):undefined, sgx}); };
        // 듀얼 판(같은 것은 한 번만) · 섀넌 계좌 판
        const dgKey=a=>(ALL[a].N||1)+'|'+JSON.stringify(ALL[a].sgx||null), shKey=a=>(ALL[a].N||1)+'|'+JSON.stringify(ALL[a].rpx||null);
        const DG={}, SHJ={}; let ok=true;
        for(const a of ARMS){ const k=dgKey(a); if(!DG[k]){ const R=run(ALL[a].N||1,ALL[a].sgx); if(!R.stats){ ok=false; break; } DG[k]=R; }
          const h=shKey(a); if(!SHJ[h]){ const N=ALL[a].N||1; SHJ[h]=[]; for(let k=0;k<N;k++) SHJ[h].push({cap:capSh/N,from:k?addM(s,k):s,dedw:(1-W)/N,rpx:ALL[a].rpx||null}); } }
        if(!ok) continue;
        const hk=Object.keys(SHJ), flat=[]; hk.forEach(h=>SHJ[h].forEach(j=>flat.push(j)));
        const out=await ivsMany(SH,e,flat); const SHR={}; let q=0; hk.forEach(h=>{ SHR[h]=SHJ[h].map(()=>out[q++]); });
        const row={s,arms:{}};
        for(const a of ARMS){ const N=ALL[a].N||1, R=DG[dgKey(a)], legs=SHR[shKey(a)], at=afterTax(R,W); row.yrs=R.stats.yrs;
          // 합친 날마다 값: 듀얼 + 섀넌 계좌들(연 날부터) + 기다리는 현금(+ 이자)
          const mk={}; for(let k=1;k<N;k++) mk[addM(s,k).slice(0,7)]=k;
          let Wc=X*(N-1)/N, I=0, nav=1, pk=1, mdd=0, prevV=null, prevF=null, lastM=s.slice(0,7); const lv=legs.map(()=>null);
          for(const n of R.nav){ const d=n.date, mo=d.slice(0,7);
            if(mo!==lastM){ if(mk[mo]) Wc-=X/N; lastM=mo; }
            if(ALL[a].int&&Wc>0&&prevV!=null){ const r=IRX[d]; if(r>0) I+=Wc*r/100/252*(1-0.154); }
            let sv=0, sc=0; legs.forEach((L,k)=>{ if(L.m[d]!=null) lv[k]=L.m[d]; if(lv[k]!=null){ sv+=lv[k]; sc+=capSh/N; } });
            const V=+n.total+sv+Wc+I, F=+n.inflow+sc+Wc;
            if(prevV!=null){ nav*=(V-(F-prevF))/prevV; if(nav>pk) pk=nav; else mdd=Math.max(mdd,(pk-nav)/pk); } prevV=V; prevF=F; }
          const lf=legs.reduce((t,L)=>t+L.final-capGainTax(L.unr,(1-W)/N),0);
          const sgf=R.ledger.events.filter(x=>x.type==='trade'&&x.symbol==='SGOV').reduce((t,x)=>t+(+x.fee||0),0), allf=R.ledger.events.filter(x=>x.type==='trade').reduce((t,x)=>t+(+x.fee||0),0);
          row.arms[a]={fv:at.final+lf+Wc+I,mdd:mdd*100,inflow:+R.nav[R.nav.length-1].inflow+capSh,sgf,allf}; }
        rows.push(row); }
      res[ds][cn]=rows;
      const qt=(a,p)=>{ if(!a.length) return NaN; const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qt(a,.5), f=(x,d=3)=>x.toFixed(d), sg=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
      const ann=(r,k)=>(Math.pow(Math.max(1e-9,r.arms[k].fv/r.arms[k].inflow),1/r.yrs)-1)*100;
      console.log('\n■ '+ds+' '+cn+' · 5년 창 '+rows.length+' · '+((Date.now()-t0)/1000).toFixed(0)+'초 · 지금: 세후 연 중앙 '+f(med(rows.map(r=>ann(r,'base'))),2)+' · MDD 중앙 '+f(med(rows.map(r=>r.arms.base.mdd)),1)+' · 최악 '+f(Math.max(...rows.map(r=>r.arms.base.mdd)),1)
        +' · 듀얼 SGOV 수수료 중앙 '+f(med(rows.map(r=>r.arms.base.sgf)),0)+'$ / 전체 수수료 '+f(med(rows.map(r=>r.arms.base.allf)),0)+'$ (5년)');
      for(const k of ARMS){ if(k==='base') continue; const rt=rows.map(r=>r.arms[k].fv/r.arms.base.fv), h1=rows.filter(r=>r.s<D.half).map(r=>r.arms[k].fv/r.arms.base.fv), h2=rows.filter(r=>r.s>=D.half).map(r=>r.arms[k].fv/r.arms.base.fv);
        const da=rows.map(r=>ann(r,k)-ann(r,'base')), dm=rows.map(r=>r.arms[k].mdd-r.arms.base.mdd), wM=Math.max(...rows.map(r=>r.arms[k].mdd))-Math.max(...rows.map(r=>r.arms.base.mdd));
        console.log(`  ${LAB[k].padEnd(22)} 짝 비 ×${f(med(rt),4)} · 나은 창 ${(rt.filter(v=>v>1).length/rt.length*100).toFixed(0)}% · 앞/뒤 ×${f(med(h1),4)}/×${f(med(h2),4)} · 세후 연 차 중앙 ${sg(med(da))}[${sg(qt(da,.05))}~${sg(qt(da,.95))}] · MDD 짝 차 중앙 ${sg(med(dm),1)} · 최악 MDD 차 ${sg(wM,1)} · 창별 최대 증가 ${sg(Math.max(...dm),1)}`); } }
    fs.writeFileSync(OUT,JSON.stringify(res)); }
  console.error('→ '+OUT+' · '+((Date.now()-t0)/1000).toFixed(0)+'초');
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
