// 조합 세금 고치기(11-05) — 무매 계좌 + 플랜 계좌를 한 사람이 들 때 양도세는 '해마다 두 계좌 손익을 합쳐 250만원 한 번 공제'(해외주식 손익통산).
// 지금까지는 계좌마다 따로 250만원을 빼 줬다(공제 두 번 · 손실 상계 없음). 같은 해 두 계좌의 실현손익(엔진 기록: 무매 o.yp · 플랜 o.ylog)으로
//   차이 A = (따로 낸 세금) − (합쳐 낸 세금) 을 해마다 구해, 세금 낸 날 계좌 전체에 비례로 더한다(근사: 아낀/더 낸 돈이 두 계좌에 비중대로 들어간다고 봄).
// 무매 = 익절 자동(이자 없음 · 앱 조건) · 플랜 = 앱 조건(새 플랜 운영형 · 지금 앱) · 무매 곡선 마지막 점 = 엔진 최종값(끝날 세금) · 3만$ · 30만$
// 실제 2011~ 전체 · 5년 롤링(분기 시작 · 창마다 새로 시작) · 합성 2000~ 전체(SYNSOXL_S · 플랜 소수 주)
// 사용: node taxmix.js
const {open}=require('./imh'); const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const KRW=1350, DED=250e4, RATE=0.22, tx=p=>p>0?Math.max(0,p*KRW-DED)*RATE/KRW:0;
const PL={new:{gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}, cur:{gsb:1e9,fee:0.001}};
const CASES=[['새 플랜 100%','new',0],['무매 10% + 새 플랜','new',0.1],['무매 20% + 새 플랜','new',0.2],['무매 33% + 새 플랜','new',1/3],['무매 50% + 새 플랜','new',0.5],['무매 33% + 지금 플랜(지금 배분)','cur',1/3]];
const f=x=>x.toFixed(1);
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  for(const [lab,TK,P,R,G,from,y0,fullOnly] of [['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011,false],['합성','SYNSOXL_S',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000,true]]){
    const planOf=(cap,s,e,k)=>{ const p=PL[k], yl=[], o=Object.assign({cap,from:s,to:e,fee:p.fee,ylog:yl},mk(P,R,G,p)); if(lab==='합성') o.frac=true; const m={}; sim(P,o).eq.forEach(([d,v])=>m[d]=v); return {m,yl}; };
    const imOf=async(cap,s,e)=>{ const r=await pg.evaluate(o=>{ const r=RUN(o); const a=r.eqs.map(x=>[x[0],x[1]]); if(a.length) a[a.length-1][1]=r.final; return {a,yp:r.yp}; },{cap,tkr:TK,from:s,to:e,autoTp:true,yp:true});
      const m={}; r.a.forEach(([d,v])=>m[d]=v); return {m,yp:r.yp}; };
    // 한 경우를 돌려 '따로 공제' 곡선과 '합산 공제' 곡선을 같이 낸다
    const run=async(S,s,e,k,w)=>{ const pl=planOf(S*(1-w),s,e,k); const ds=Object.keys(pl.m).sort(); let im=null; if(w>0) im=await imOf(S*w,ds[0],e);
      const base=[]; for(const d of ds){ const a=im?im.m[d]:0; if(im&&a==null) continue; base.push([d,pl.m[d]+a]); }
      if(!im) return {sep:base, comb:base, dTax:0, nY:0};
      const Y={}; im.yp.forEach(([y,p,t])=>{ const o=Y[y]=Y[y]||{pi:0,ti:0,pp:0,tp:0,pay:null}; o.pi+=p; o.ti+=t; });
      pl.yl.forEach(([y,p,t,d])=>{ const o=Y[y]=Y[y]||{pi:0,ti:0,pp:0,tp:0,pay:null}; o.pp+=p; o.tp+=t; o.pay=d; });
      const pays={}; let dTax=0, nY=0; for(const [y,o] of Object.entries(Y)){ const A=(o.ti+o.tp)-tx(o.pi+o.pp); if(Math.abs(A)<1e-9) continue; const d=o.pay||ds.find(x=>x.slice(0,4)>y); if(!d) continue; pays[d]=(pays[d]||0)+A; dTax+=A; nY++; }
      let F=1; const comb=base.map(([d,v])=>{ if(pays[d]!=null){ F*=1+pays[d]/v; } return [d,v*F]; });
      return {sep:base, comb, dTax, nY}; };
    for(const S of [30000,300000]){
      console.log(`\n■ ${lab} ${S/1e4}만$ (${from.slice(0,4)}~${fullOnly?'':' · 5년 롤링 분기 시작'}) — 따로 공제(지금까지) → 합산 공제`);
      const last=P.dates[P.dates.length-1]; const W=[]; if(!fullOnly) for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m+=3){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e<=last) W.push([s,e]); }
      let B=null;   // 새 플랜 100% 창 결과(짝 기준)
      for(const [nm,k,w] of CASES){ const r=await run(S,from,undefined,k,w); const a=stats(r.sep,S), b=stats(r.comb,S);
        let rl='';
        if(!fullOnly){ const R=[]; for(const [s,e] of W){ const x=await run(S,s,e,k,w); R.push({s:stats(x.sep,x.sep[0][1]),c:stats(x.comb,x.comb[0][1])}); }
          if(!B) B=R; const sc=(sel)=>{ let u=0,v=0; R.forEach((x,i)=>{ const dc=sel(x).cagr-B[i].s.cagr, dm=sel(x).mdd-B[i].s.mdd; if(dc>=-0.05&&dm<=0.05&&(dc>0.05||dm<-0.05)) u++; else if(dc<=0.05&&dm>=-0.05&&(dc<-0.05||dm>0.05)) v++; }); return u+':'+v; };
          rl=` | 롤링 중앙 ${f(q(R.map(x=>x.s.cagr),.5))}/${f(q(R.map(x=>x.s.mdd),.5))} → ${f(q(R.map(x=>x.c.cagr),.5))}/${f(q(R.map(x=>x.c.mdd),.5))} · 창별 CAGR 차이 중앙 ${f(q(R.map(x=>x.c.cagr-x.s.cagr),.5))} (하10 ${f(q(R.map(x=>x.c.cagr-x.s.cagr),.1))}) · 새 플랜 100% 대비 짝 ${sc(x=>x.s)} → ${sc(x=>x.c)}`; }
        console.log(`  ${nm.padEnd(20)} 전체 ${f(a.cagr)}/${f(a.mdd)} → ${f(b.cagr)}/${f(b.mdd)} · 세금 차이 합 ${r.dTax>=0?'+':''}${Math.round(r.dTax)}$(${r.nY}개 해 · +면 합산이 덜 냄)${rl}`); } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
