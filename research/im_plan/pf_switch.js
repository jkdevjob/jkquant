// 포트폴리오 ④(11-11) — 무매 → 섀넌·플랜 옮기는 때: A 기다림(사이클 끝까지 무매 → 끝난 다음 날부터 섀넌 1/2 + 플랜 1/2) vs B 지금 옮김(그날 종가에 SOXL 전부 팔고 다음 날부터 같은 섞음).
// 무매 = 앱 조건 runIM(imh RUN · trace · 익절 자동 · 이자 없음 · 비용·세금) 을 시작 달 RUNS 가지로 돌린 길 · 결정일 = 매달 첫 거래일(사이클 진행 중일 때만).
// 섞음: 실제 = 섀넌 runIVS(USD · 앱 기본 s0 55 · 40일 · 15%p · 단기국채) + 플랜 replay(앱 엔진 · hist_at 세후 = pf_app 과 같은 afterTax) /
//       합성 = 섀넌 runIVS(SYNUSD_S) + 플랜 px(plan_rules 기본 · sizePrev · 소수 주 · 수수료 0.1% · 끝날 청산).
// 세금: 공제는 이 돈 몫 DEDW(기본 1/3 — 3만$ 구성에서 1만$ 몫) · 무매 = DEDW · 섀넌·플랜 = DEDW/2 씩. A 는 끝난 날 그해 실현손익 세금을, B 는 판 날 그해 실현손익(+ 청산 손익) 세금을 그 자리에서 뺀다.
// 비교: 같은 끝날(결정일 + H 년)의 세후 청산 가치 B ÷ A · 그날부터 끝날까지 MDD(세전 날마다 값). 상태 = 투입(보유 평단 원가 ÷ (현금 + 보유 평단 원가)) · 평단 대비 종가.
// 사용: node pf_switch.js out.json   env: DS=real,syn · CAPS=10000,100000 · H=3,5 · RUNS=12 · DEDW=0.3333
const fs=require('fs'),path=require('path'); const {open}=require('./imh'); const {prep,sim}=require('./px'); const {mk}=require('./plan_rules');
const src=fs.readFileSync(path.join(__dirname,'pf_app.js'),'utf8'); const ga=src.indexOf('const capTaxW='), gb=src.indexOf('(async()=>{');
if(ga<0||gb<0) throw new Error('pf_app.js 조각을 못 찾음'); eval(src.slice(ga,gb).replace(/\bconst /g,'var '));   // capTaxW · acc · afterTax(R,w) · HOOK
const E=require('./planrule/engine_var').load({});
const OUT=process.argv[2]||'pf_switch_out.json', DS=(process.env.DS||'real,syn').split(','), CAPS=(process.env.CAPS||'10000,100000').split(',').map(Number);
const CN=(process.env.CN||'6,12,18').split(',').map(Number), HS=(process.env.H||'3,5').split(',').map(Number), RUNS=+(process.env.RUNS||12), DEDW=+(process.env.DEDW||1/3), FEE=0.0025;
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(__dirname,'planrule','data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const PT=qd('TECL'),PQ=qd('TQQQ'),PG=qd('SGOV');
const PXP=prep(['SYNTECL','SYNTQQQ']);
const SETS={ real:{tk:'SOXL',file:'SOXL',usd:'USD',r0:'2010-04',d0:'2011-06',plan:'app'},
  // 합성: 1995~96 에 시작한 길은 모두 2000 사이클에 갇혀 2026 까지 안 끝난다(11-06 기록) — 시작을 흩어 여러 국면이 들어가게(11-11)
  syn:{tk:'SYNSOXL_S',file:'SYNSOXL_S',usd:'SYNUSD_S',starts:['1995-06','1997-01','1998-06','2001-06','2002-10','2004-01','2006-01','2007-06','2009-03','2011-01','2013-01','2015-01'],d0:'2000-06',plan:'px'} };
const tax=(p,w)=>p>0?Math.max(0,p*1350-250e4*w)*0.22/1350:0;
const addM=(ym,k)=>{ const y=+ym.slice(0,4), m=+ym.slice(5,7)-1+k; return `${y+Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`; };
const addY=(d,h)=>`${+d.slice(0,4)+h}${d.slice(4)}`;
const PAGE=()=>{
  window.TRACE=function(o){ window.__DEDW=o.dedW; let r; try{ r=RUN({autoTp:true,tkr:o.tkr,cap:o.cap,from:o.from,trace:true}); } finally { window.__DEDW=1; }
    return r.trace.tr.map(x=>[x[0],x[1],x[2],x[3],x[4],x[5],x[8],x[9],x[10]]); };   // 날짜 · 종가 · 현금 · 주수 · 평단 · T · 그해 실현손익 · 세무 원가 · 따로 둔 돈
  window.IVS=function(jobs){ return jobs.map(([cap,from,to,w])=>{ window.__EQ=[]; window.__DEDW=w; const days=Object.keys(M.USD).sort().filter(d=>d>=from&&d<=to); let r;
      try{ r=runIVS(days,'USD',cap,.55,40,.15,true,'iv','cash'); } finally { window.__DEDW=1; }
      const m={}; window.__EQ.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); return {d:Object.keys(m).sort(),v:Object.keys(m).sort().map(k=>Math.round(m[k]*100)/100),final:r.final}; }); }; };
function planLeg(kind,V,from,to,w){
  if(kind==='app'){ const R=E.replay({horizon:5,rules:'base',startDate:from,endDate:to,principal:V,monthlyAdd:0,tecl:PT.days,tqqq:PQ.days,sgov:PG.days,teclDiv:PT.div,tqqqDiv:PQ.div,sgovDiv:PG.div});
    if(!R.nav||!R.nav.length) return null; const at=afterTax(R,w); const m={}; R.nav.forEach(n=>m[n.date]=+n.total); return {final:at.final,m}; }
  const o=Object.assign({cap:V,from,to,fee:.001,tax:true,dedMul:w,frac:true,sizePrev:true,liq:true},mk(PXP,'SYNTECL','SYNTQQQ',{gsb:1e9})); const eq=sim(PXP,o).eq; if(!eq.length) return null;   // 규칙(mk)은 상태가 섞이지 않게 매번 새로
  const m={}; eq.forEach(([d,v])=>m[d]=v); return {final:eq[eq.length-1][1],m}; }
const mddOf=a=>{ let pk=-Infinity,m=0; for(const v of a){ if(v>pk) pk=v; else if(pk>0) m=Math.max(m,(pk-v)/pk); } return m*100; };
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; };
const BK={D:x=>x.inv>=.90&&x.loss<=-.30, 'D-':x=>x.inv>=.80&&x.loss<=-.20, 'D+':x=>x.inv>=.95&&x.loss<=-.40, M:x=>x.inv>=.30&&x.inv<=.70&&x.loss<=-.05&&x.loss>=-.30};
(async()=>{ const out={meta:{made:new Date().toISOString(),DEDW,RUNS,HS,CAPS,fee:FEE},sets:{}}; const t0=Date.now();
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.tk,file:S.file},{sym:'USD',file:S.usd}]); await pg.evaluate(HOOK);
    const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(PAGE);
    out.sets[ds]={};
    for(const cap of CAPS){ out.sets[ds][cap]={};
      // 1) 무매 길 RUNS 가지(시작 달만 다름)
      const runs=[]; for(let k=0;k<RUNS;k++){ const from=(S.starts?S.starts[k%S.starts.length]:addM(S.r0,k))+'-01'; const tr=await pg.evaluate(o=>TRACE(o),{tkr:S.tk,cap,from,dedW:DEDW}); runs.push({from,tr,ix:Object.fromEntries(tr.map((x,i)=>[x[0],i]))}); } /* 결정일은 그 길 시작 6개월 뒤부터 */
      const days=runs.reduce((a,r)=>r.tr.length>a.length?r.tr:a,[]).map(x=>x[0]); /* 가장 긴 길의 거래일 */ const END=days[days.length-1]; const nextDay=d=>days.find(x=>x>d)||null; const lastLE=d=>{ let r=null; for(const x of days){ if(x<=d) r=x; else break; } return r; };
      // 2) 결정일 · 상태
      const decide=[]; for(let ym=S.d0; ym<=END.slice(0,7); ym=addM(ym,1)){ const d=days.find(x=>x>=ym+'-01'); if(d&&d.slice(0,7)===ym) decide.push(d); }
      for(const H of HS){ const rows=[]; const ivsJobs=[], pend=[];
        for(let ri=0; ri<runs.length; ri++){ const R=runs[ri];
          for(const t of decide){ if(t<addM(R.from.slice(0,7),6)+'-01') continue; const k=R.ix[t]; if(k==null) continue; const [d,c,cash,sh,avg,T,yp,basis,res]=R.tr[k]; if(!(sh>0)||!(avg>0)) continue;
            const Tend=lastLE(addY(t,H)); if(!Tend||addY(t,H)>END) continue;
            const st={inv:sh*avg/(cash+res+sh*avg), loss:c/avg-1}; if(!Object.values(BK).some(f=>f(st))) continue;
            let k0=k; while(k0>0&&R.tr[k0-1][3]>0) k0--; const age=k-k0;   /* 사이클 나이(시작부터 거래일 · 11-11 ④-b) */
            // B: 그날 종가에 다 팔고(수수료) 그해 실현손익 + 청산 손익의 세금을 뺀다
            const gross=sh*c, VB=cash+res+gross*(1-FEE)-tax(yp+gross*(1-FEE)-basis,DEDW), fB=nextDay(t);
            // A: 같은 길로 사이클 끝(주수 0)까지 · 끝난 날 그해 세금을 빼고 다음 날부터 섞음 · 끝날까지 안 끝나면 끝날 청산 가치
            let kt=null; for(let j=k+1;j<R.tr.length&&R.tr[j][0]<=Tend;j++){ if(!(R.tr[j][3]>0)){ kt=j; break; } }
            const pathA=[]; for(let j=k;j<=(kt??R.ix[Tend]);j++){ const x=R.tr[j]; pathA.push(x[2]+x[8]+x[3]*x[1]); }
            let VA, fA=null, tau=null;
            if(kt!=null){ const x=R.tr[kt]; tau=x[0]; VA=x[2]+x[8]-tax(x[6],DEDW); fA=nextDay(tau); if(fA&&fA>Tend) fA=null; }
            else { const x=R.tr[R.ix[Tend]]; const g=x[3]*x[1]; VA=x[2]+x[8]+g*(1-FEE)-tax(x[6]+g*(1-FEE)-x[7],DEDW); }
            const row={run:ri,t,Tend,T,age,inv:st.inv,loss:st.loss,V0:cash+res+sh*c,VB,VA0:VA,tau,fA,fB,pathA,C:{}}; rows.push(row);
            if(fB&&fB<=Tend) ivsJobs.push([VB/2,fB,Tend,DEDW/2]); else row.noB=true;
            if(fA) ivsJobs.push([VA/2,fA,Tend,DEDW/2]);
            /* C_N(④-b): N개월 안에 사이클이 끝나면 A 와 같고, 안 끝나면 기한 날 종가에 팔고(수수료 · 그해 세금) 다음 날부터 섞음 */
            for(const N of CN){ const dl=lastLE(addM(t.slice(0,7),N)+t.slice(7)); if(!dl||dl>=Tend||(tau&&tau<=dl)){ row.C[N]={same:true}; continue; }
              const x=R.tr[R.ix[dl]]; const g=x[3]*x[1]; const VC=x[2]+x[8]+g*(1-FEE)-tax(x[6]+g*(1-FEE)-x[7],DEDW); const fC=nextDay(dl);
              const pc=[]; for(let j=k;j<=R.ix[dl];j++){ const y=R.tr[j]; pc.push(y[2]+y[8]+y[3]*y[1]); }
              row.C[N]={dl,VC,fC,pathC:pc}; if(fC&&fC<=Tend) ivsJobs.push([VC/2,fC,Tend,DEDW/2]); else row.C[N].noMix=true; }
            }
        }
        // 3) 섀넌 다리를 한꺼번에(페이지 왕복 줄이기)
        const IV=[]; for(let i=0;i<ivsJobs.length;i+=200) IV.push(...await pg.evaluate(j=>IVS(j),ivsJobs.slice(i,i+200)));
        let ii=0;
        for(const r of rows){
          const leg=(V,from)=>{ const iv=IV[ii++]; const pl=planLeg(S.plan,V/2,from,r.Tend,DEDW/2); if(!pl) return null;
            const ds_=Object.keys(pl.m).sort(); const im={}; iv.d.forEach((d,k)=>im[d]=iv.v[k]); let lv=V/2; const path=ds_.map(d=>{ if(im[d]!=null) lv=im[d]; return pl.m[d]+lv; });
            return {final:pl.final+iv.final,path}; };
          const mb=r.noB?null:leg(r.VB,r.fB); const ma=r.fA?leg(r.VA0,r.fA):null;
          r.B=mb?mb.final:r.VB; r.A=ma?ma.final:r.VA0;
          r.mddB=mddOf([r.V0].concat(mb?mb.path:[])); r.mddA=mddOf(r.pathA.concat(ma?ma.path:[])); r.ratio=r.B/r.A;
          for(const N of CN){ const c=r.C[N]; if(c.same){ r.C[N]={v:r.A,mdd:r.mddA,cut:false}; continue; } const mc=c.noMix?null:leg(c.VC,c.fC); r.C[N]={v:mc?mc.final:c.VC,mdd:mddOf(c.pathC.concat(mc?mc.path:[])),cut:true,dl:c.dl}; }
          delete r.pathA; }
        out.sets[ds][cap][H]=rows;
        const line=(nm,f)=>{ const R=rows.filter(f); if(!R.length) return `  ${nm}: 없음`; const rt=R.map(x=>x.ratio), months=new Set(R.map(x=>x.t.slice(0,7))), notEnd=R.filter(x=>!x.tau).length;
          return `  ${nm.padEnd(3)} n ${String(R.length).padStart(4)}(결정 달 ${months.size}) · B÷A 중앙 ×${q(rt,.5).toFixed(3)} · 하10 ×${q(rt,.1).toFixed(3)} · 상10 ×${q(rt,.9).toFixed(3)} · B 가 이긴 날 ${(rt.filter(x=>x>1).length/R.length*100).toFixed(0)}% · MDD 중앙 A ${q(R.map(x=>x.mddA),.5).toFixed(1)} · B ${q(R.map(x=>x.mddB),.5).toFixed(1)} · 짝 차 ${q(R.map(x=>x.mddB-x.mddA),.5).toFixed(1)} · A 가 끝날까지 사이클 못 끝냄 ${(notEnd/R.length*100).toFixed(0)}% · 끝 가치 중앙 A ${(q(R.map(x=>x.A/x.V0),.5)).toFixed(2)} · B ${(q(R.map(x=>x.B/x.V0),.5)).toFixed(2)}(그날 평가액 배수)`; };
        console.log(`${ds} ${cap/1e4}만$ · ${H}년 뒤 · 무매 길 ${RUNS} · 결정일 ${decide.length} · ${((Date.now()-t0)/1000).toFixed(0)}초`);
        for(const [nm,f] of Object.entries(BK)) console.log(line(nm,f));
        fs.writeFileSync(OUT,JSON.stringify(out)); } }
    await close(); }
  console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
