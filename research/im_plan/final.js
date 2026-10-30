// 실전 조합표(사용자 보고용 · 10-31) — 무매 1/3 + 플랜 2/3 을 따로 굴린 계좌 합 · 3만$(무매 1만 + 플랜 2만) 과 그 10배(30만$)
// 실제 2011~ · 2022-01~ · 5년 롤링(분기 시작 · 창마다 새로 시작) · 합성 2000~(SYNSOXL_S · 플랜 소수 주) · 위기 구간 낙폭 · 지금 배분 대비 짝 창 점수
// 무매 = 앱 익절 자동(이자 없음) · 'RP' = 잔금 달러 RP 자동 스윕 가정(T-bill −0.5%p · 수수료 0). 플랜 = 앱 조건(수수료 0.1% · TQQQ 는 Guard 바뀔 때만, 새 플랜은 + 연 1회 맞춤).
// 사용: node final.js
const {open}=require('./imh'); const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const IM={none:{autoTp:true}, rp:{autoTp:true,cashYield:true,cashSpread:0.005}};
const NEW={gbOn:0.01,gbOff:0.03,sbDn:0,sbUp:0.15,gReb:'y',fee:0.001};
const PL={cur:{gsb:1e9,fee:0.001}, new:NEW, tw80:Object.assign({tw:0.80},NEW), wmax:Object.assign({wMax:1.43},NEW)};
const CASES=[['지금 배분(무매+지금 플랜)','none','cur',1/3],['무매 RP + 지금 플랜','rp','cur',1/3],['무매 + 새 플랜','none','new',1/3],['무매 RP + 새 플랜','rp','new',1/3],
  ['무매 RP + 새 플랜 tw0.80','rp','tw80',1/3],['무매 RP + 새 플랜 wMax1.43','rp','wmax',1/3],['새 플랜 100%',null,'new',0],['지금 플랜 100%',null,'cur',0],['무매 100%','none',null,1]];
const f=x=>x.toFixed(1), toMap=eq=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); return m; };
function comb(a,b){ if(!a) return b; if(!b) return a; const m={}; Object.keys(b).forEach(d=>{ if(a[d]!=null) m[d]=a[d]+b[d]; }); return m; }
const arr=m=>Object.keys(m).sort().map(d=>[d,m[d]]);
function dd(m,s,e){ const ds=Object.keys(m).sort(); const pre=ds.filter(d=>d<s); let pk=pre.length?Math.max(...pre.map(d=>m[d])):0, x=0;   // 그때까지 최고점 대비 구간 안 최대 낙폭 — 끝날 세금 미리 빼기 없는 곡선(endTax:false)으로 잰다
  for(const d of ds){ if(d<s||d>e) continue; pk=Math.max(pk,m[d]); x=Math.max(x,(pk-m[d])/pk); } return x*100; }
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  for(const [lab,TK,P,R,G,from,y0,W] of [
    ['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011,[['2015','2015-06-01','2016-02-29'],['2018','2018-09-01','2018-12-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31'],['2024-25','2024-07-10','2025-04-30'],['2026-10','2026-10-01','2026-12-31']]],
    ['합성','SYNSOXL_S',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000,[['닷컴','2000-03-10','2002-10-31'],['금융위기','2007-10-09','2009-03-31'],['2022','2021-12-27','2022-12-31']]]]){
    const planOf=(cap,s,e,k,noEnd)=>{ const p=PL[k], o=Object.assign({cap,from:s,to:e,fee:p.fee},mk(P,R,G,p)); if(lab==='합성') o.frac=true; if(noEnd) o.endTax=false; return toMap(sim(P,o).eq); };
    // 무매 곡선 마지막 점 = 엔진 최종값(그해 실현이익 세금을 미리 뺀 값) — 플랜(px)과 같은 기준. noEnd 면 곡선 그대로(세금 미리 빼기 없음)
    const imOf=async(cap,s,e,k,noEnd)=>toMap(await pg.evaluate(([o,ne])=>{ const r=RUN(o); const a=r.eqs.map(x=>[x[0],x[1]]); if(!ne&&a.length) a[a.length-1][1]=r.final; return a; },[Object.assign({cap,tkr:TK,from:s,to:e},IM[k]),!!noEnd]));
    const build=async(S,s,e,noEnd)=>{ const d0=Object.keys(planOf(S,s,e,'cur')).sort()[0]; const out={}, cache={};
      for(const [nm,ik,pk,w] of CASES){ const a=ik?(cache['i'+ik+w]=cache['i'+ik+w]||await imOf(S*w,d0,e,ik,noEnd)):null, b=pk?(cache['p'+pk+w]=cache['p'+pk+w]||planOf(S*(1-w),s,e,pk,noEnd)):null; out[nm]=comb(a,b); }
      return out; };
    for(const S of [30000,300000]){
      const full=await build(S,from), recent=lab==='실제'?await build(S,'2022-01-03'):null, fullNE=await build(S,from,undefined,true);
      const last=Object.keys(full[CASES[0][0]]).sort().pop(), R5={};
      for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m+=3){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue;
        const C=await build(S,s,e); for(const [nm,eq] of Object.entries(C)){ const a=arr(eq); if(a.length<100) continue; (R5[nm]=R5[nm]||[]).push(stats(a,a[0][1])); } }
      console.log(`\n■ ${lab} ${S/1e4}만$ (${from.slice(0,4)}~ · 5년 창 ${R5[CASES[0][0]].length}개 · 짝 점수는 '지금 배분' 대비)`);
      const B=R5[CASES[0][0]];
      for(const [nm] of CASES){ const a=arr(full[nm]), s1=stats(a,a[0][1]), r=R5[nm];
        const sc=r.map((x,i)=>{ const dc=x.cagr-B[i].cagr, dm=x.mdd-B[i].mdd; return (dc>=-0.05&&dm<=0.05&&(dc>0.05||dm<-0.05))?1:(dc<=0.05&&dm>=-0.05&&(dc<-0.05||dm>0.05))?-1:0; });
        const rc=recent?(()=>{ const b=arr(recent[nm]); const t=stats(b,b[0][1]); return ` | 2022-01~ ${f(t.cagr)}/${f(t.mdd)}`; })():'';
        console.log(`  ${nm.padEnd(22)} 전체 ${f(s1.cagr)}/${f(s1.mdd)} · ${f(a[a.length-1][1]/a[0][1])}배${rc} | 롤링 중앙 ${f(q(r.map(x=>x.cagr),.5))}/${f(q(r.map(x=>x.mdd),.5))} 최악 CAGR ${f(Math.min(...r.map(x=>x.cagr)))} 최악 MDD ${f(Math.max(...r.map(x=>x.mdd)))} 손실 창 ${r.filter(x=>x.cagr<0).length} · 짝 ${sc.filter(x=>x>0).length}:${sc.filter(x=>x<0).length} | 위기 낙폭 ${W.map(([n,s,e])=>n+' '+dd(fullNE[nm],s,e).toFixed(0)).join(' · ')}`); } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
