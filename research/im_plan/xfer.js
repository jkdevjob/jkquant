// 조합 근사 검증(11-06) — 무매 계좌 입출금을 '사이클이 끝나 전량 현금인 날'에만 하는 엔진 고리(imh `xfer`)와 combo3 의 비례 근사(무매를 펀드처럼 매일 비례로 줄이고 늘림)를 같은 조건에서 비교.
// 무매 = 익절 자동(이자 없음 · 앱 조건) · 플랜 = 앱 조건(지금 앱 · 새 플랜 운영형) · 무매 곡선 마지막 점 = 엔진 최종값 · 플랜 쪽은 두 방법 모두 비례 배율(플랜은 사이클이 없다).
// 방식: none(안 옮김 — 두 방법이 같아야 한다) · year(매년 첫 거래일 → 엔진은 그 뒤 첫 사이클 끝) · oneway(매년 · 무매가 넘칠 때만 플랜으로) · band:b(비중이 목표±b 를 넘으면) · oneband:b(넘칠 때만)
// 실제 2011~ · 합성 2000~(SYNSOXL_S · 플랜 소수 주) · 3만$·30만$ · 무매 1/3 · 1/2 · 전체 · 5년 롤링(매월 · 한 곡선을 잘라) · 옮긴 횟수 · 신호(1월 첫 거래일)→실행 지연(거래일)
// 사용: node xfer.js            MODES='none,year,oneway,band:0.1,oneband:0.1' WS='0.333,0.5' PLANS='cur,new' CAPS='30000,300000'
const {open}=require('./imh'); const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules'); const {mix,FEE}=require('./combo3');
const PL={cur:{gsb:1e9,fee:0.001}, new:{gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}};
const MODES=(process.env.MODES||'none,year,oneway,band:0.1,oneband:0.1').split(','), WS=(process.env.WS||'0.333,0.5').split(',').map(Number), PLANS=(process.env.PLANS||'cur,new').split(','), CAPS=(process.env.CAPS||'30000,300000').split(',').map(Number);
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=x=>x.toFixed(1);
function roll(eq,y0){ const R=[], last=eq[eq.length-1][0]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last||s<eq[0][0]) continue; const sl=eq.filter(x=>x[0]>=s&&x[0]<e); if(sl.length>100) R.push(stats(sl.map(([d,v])=>[d,v/sl[0][1]]),1)); } return R; }
const sum=R=>`롤링 중앙 ${f(q(R.map(x=>x.cagr),.5))}/${f(q(R.map(x=>x.mdd),.5))} 하10 ${f(q(R.map(x=>x.cagr),.1))} 최악MDD ${f(Math.max(...R.map(x=>x.mdd)))}`;
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  for(const [lab,TK,P,R,G,from,y0] of [['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011],['합성','SYNSOXL_S',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000]]){
    for(const S of CAPS) for(const pk of PLANS) for(const w of WS){
      const pp=PL[pk]; const pl={}; { const o=Object.assign({cap:S*(1-w),from,fee:pp.fee},mk(P,R,G,pp)); if(lab==='합성') o.frac=true; sim(P,o).eq.forEach(([d,v])=>pl[d]=v); }
      const ds=Object.keys(pl).sort(), d0=ds[0]; const yearStart={}; ds.forEach(d=>{ const y=d.slice(0,4); if(!yearStart[y]) yearStart[y]=d; });
      const im0=await pg.evaluate(o=>{ const r=RUN(o); const a=r.eqs.map(x=>[x[0],x[1]]); if(a.length) a[a.length-1][1]=r.final; return a; },{cap:S*w,tkr:TK,from:d0,autoTp:true});
      const imA={}; im0.forEach(([d,v])=>imA[d]=v);
      console.log(`\n■ ${lab} ${S/1e4}만$ · ${pk==='cur'?'지금 앱 플랜':'새 플랜 운영형'} · 무매 ${Math.round(w*100)}% (${d0}~) — 근사(비례) → 엔진(사이클 끝에만 입출금)`);
      for(const mode of MODES){ const [kind,bs]=mode.split(':'), b=+bs||0;
        // 근사: combo3 mix (비율 곡선 → S 배)
        const ap=mix(imA,pl,w,mode).eq.map(([d,v])=>[d,v*S]); const sa=stats(ap,S), ra=roll(ap,y0);
        // 엔진: 사이클 끝에만 입출금 — 플랜 쪽은 배율 F(옮긴 다음 날부터)
        const r=await pg.evaluate(o=>{ const r=RUN(o); const a=r.eqs.map(x=>[x[0],x[1]]); if(a.length) a[a.length-1][1]=r.final; return {a,xlog:r.xlog||[]}; },{cap:S*w,tkr:TK,from:d0,autoTp:true,xfer:{mode:kind,b,w,pl,fee:FEE}});
        const F={}; let fv=1, xi=0; const xl=r.xlog; const en=[]; for(const [d,v] of r.a){ if(pl[d]==null) continue; while(xi<xl.length&&xl[xi][0]<d){ fv=xl[xi][2]; xi++; } en.push([d,v+pl[d]*fv]); }
        const se=stats(en,S), re=roll(en,y0);
        const delays=xl.map(([d])=>{ const y0d=yearStart[d.slice(0,4)]; return ds.indexOf(d)-ds.indexOf(y0d); });
        const moved=xl.reduce((a,[d,x])=>a+Math.abs(x),0);
        const dl=(kind==='year'||kind==='oneway')&&delays.length?` · 1월 첫 거래일→실행 지연 중앙 ${q(delays,.5)} 최대 ${Math.max(...delays)} 거래일 · 실행된 해 ${new Set(xl.map(x=>x[0].slice(0,4))).size}/${Object.keys(yearStart).length-1}`:'';
        console.log(`  ${mode.padEnd(12)} 근사 ${f(sa.cagr)}/${f(sa.mdd)} · ${sum(ra)} | 엔진 ${f(se.cagr)}/${f(se.mdd)} · ${sum(re)} | 차이 ${(se.cagr-sa.cagr>=0?'+':'')}${f(se.cagr-sa.cagr)}/${(se.mdd-sa.mdd>=0?'+':'')}${f(se.mdd-sa.mdd)} · 옮김 ${xl.length}회(${Math.round(moved/S*100)}%)${dl}`); } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
