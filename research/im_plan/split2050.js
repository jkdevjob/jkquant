// 무매 두 벌 5:5 — SOXL 20분할 익절 자동 + 50분할 익절 자동 (2026-10-21 사용자 질문 "무매 20/자동익절 · 무매 50/자동익절 · 둘을 50:50 으로 한다면?")
// 앱 규칙 그대로: backtest.html runIM · 복리 · 리버스 OFF · 큰수 20 · LOC 3줄 · 수수료·슬리피지·양도세 · 잔금 이자 없음.
// 앱 분할 선택은 10~40 이지만 엔진 별% 식(base − base×0.1×20/분할×T)은 분할 수에 일반이라 50 도 같은 엔진으로 돈다. 참고로 40분할도 같이 본다.
// 5:5 = 원금 반씩 두 계좌를 따로 굴려 더한다(안 옮김). '연 1회 맞춤'은 매년 첫 거래일에 5:5 로 되돌린 곡선(옮긴 금액 0.25% 비용 · 근사).
// 자료: 실제 SOXL 2010-04~ · 합성 SYNSOXL_S 1995-06~(병합·분할 반영) · 1만$ · 10만$ · 5년 롤링(분기마다 새로 시작) · 위기 구간 · 두 계좌 일간 상관.
// 사용: node split2050.js [out.json]
const fs=require('fs'); const {open}=require('./imh');
const OUT=process.argv[2]||'split2050_out.json';
const q=(a,p)=>{ const b=a.filter(Number.isFinite).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; };
function met(eq){ const n=eq.length; if(n<3) return null; const v0=eq[0][1], v1=eq[n-1][1], yrs=(Date.parse(eq[n-1][0])-Date.parse(eq[0][0]))/(365.25*864e5);
  let pk=v0,m=0; for(const [,v] of eq){ if(v>pk) pk=v; else m=Math.max(m,(pk-v)/pk); }
  const cagr=(Math.pow(Math.max(v1,1e-9)/v0,1/Math.max(yrs,1e-6))-1)*100; return {cagr, mdd:m*100, mar:m>0?cagr/(m*100):null, mult:v1/v0}; }
const series=m=>Object.keys(m).sort().map(d=>[d,m[d]]);
const mixNone=(a,b)=>{ const o={}; Object.keys(a).forEach(d=>{ if(b[d]!=null) o[d]=a[d]+b[d]; }); return o; };
function mixYear(a,b){ const ds=Object.keys(b).filter(d=>a[d]!=null).sort(); let x=a[ds[0]], y=b[ds[0]], yr=ds[0].slice(0,4); const o={[ds[0]]:x+y};
  for(let k=1;k<ds.length;k++){ const d=ds[k],p=ds[k-1]; x*=a[d]/a[p]; y*=b[d]/b[p]; if(d.slice(0,4)!==yr){ yr=d.slice(0,4); const t=x+y, m=x-t/2; x-=m; y+=m-Math.abs(m)*0.0025; } o[d]=x+y; } return o; }
function corr(a,b){ const ds=Object.keys(a).filter(d=>b[d]!=null).sort(), x=[], y=[];
  for(let k=1;k<ds.length;k++){ const p=ds[k-1], d=ds[k]; if(a[p]>0&&b[p]>0){ x.push(a[d]/a[p]-1); y.push(b[d]/b[p]-1); } }
  const mx=x.reduce((s,v)=>s+v,0)/x.length, my=y.reduce((s,v)=>s+v,0)/y.length; let sxy=0,sx=0,sy=0;
  for(let i=0;i<x.length;i++){ sxy+=(x[i]-mx)*(y[i]-my); sx+=(x[i]-mx)**2; sy+=(y[i]-my)**2; } return sxy/Math.sqrt(sx*sy); }
// 위기 구간 — 시작일 값 대비 구간 안 최저점 · 끝 값
function crisis(m,s,e){ const ds=Object.keys(m).sort(), pre=ds.filter(d=>d<=s), sl=ds.filter(d=>d>=s&&d<=e); if(!sl.length) return null;
  const v0=m[pre.length?pre[pre.length-1]:sl[0]]; let lo=Infinity; for(const d of sl) lo=Math.min(lo,m[d]);
  return {low:(lo/v0-1)*100, end:(m[sl[sl.length-1]]/v0-1)*100}; }
const CR={real:[['2018-10-01','2018-12-24','2018 4분기'],['2020-02-19','2020-03-23','2020 코로나'],['2021-11-19','2022-12-28','2022 하락장'],['2024-07-10','2025-04-08','2024~25 관세']],
          syn:[['2000-03-24','2002-10-09','닷컴'],['2007-10-09','2009-03-09','금융위기'],['2020-02-19','2020-03-23','2020 코로나'],['2021-11-19','2022-12-28','2022 하락장']]};
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  const im=async(cap,divs,from,to,syn)=>{ const r=await pg.evaluate(o=>{ const r=RUN(o); return {eq:r.eqs.map(x=>[x[0],x[1]]),final:r.final,cycles:r.cycles}; },
      {cap,tkr:syn?'SYNSOXL_S':'SOXL',autoTp:true,divs,from,to});
    const m={}; r.eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); const ks=Object.keys(m).sort(); if(ks.length) m[ks[ks.length-1]]=r.final; m.__cyc=r.cycles; return m; };
  const clean=m=>{ const o={...m}; delete o.__cyc; return o; };
  const res={meta:{made:new Date().toISOString(),note:'SOXL 익절 자동 · 복리 · 리버스 OFF · 큰수 20 · LOC 3줄 · 수수료·세금 · 잔금 이자 없음 · 5:5 = 반씩 따로(안 옮김) / 연 1회 맞춤(근사)'}};
  for(const [lab,syn,from] of [['real',false,'2010-04-01'],['syn',true,'1995-06-01']]){ res[lab]={};
    const days=await pg.evaluate(tk=>Object.keys(M[tk]).sort(),syn?'SYNSOXL_S':'SOXL'); const last=days[days.length-1];
    for(const cap of [10000,100000]){ const R={full:{},crisis:{},roll:{},cycles:{}}; res[lab][cap]=R; console.error(`[${lab} ${cap/1e4}만$]`);
      const full={}, half={};
      for(const dv of [20,40,50]){ const f=await im(cap,dv,from,'2099-12-31',syn), h=await im(cap/2,dv,from,'2099-12-31',syn); R.cycles[dv]=f.__cyc; full[dv]=clean(f); half[dv]=clean(h); }
      const C={'20분할 100%':full[20],'50분할 100%':full[50],'40분할 100%':full[40],'20+50 따로':mixNone(half[20],half[50]),'20+50 연1회':mixYear(half[20],half[50]),'20+40 따로':mixNone(half[20],half[40])};
      for(const [k,m] of Object.entries(C)){ R.full[k]=met(series(m)); R.crisis[k]={}; for(const [s,e,n] of CR[lab]) R.crisis[k][n]=crisis(m,s,e);
        console.error('  '+k.padEnd(12), R.full[k].cagr.toFixed(1)+'/'+R.full[k].mdd.toFixed(1)); }
      R.corr2050=corr(full[20],full[50]); R.corr2040=corr(full[20],full[40]);
      // 5년 롤링 — 분기마다 새로 시작(각 계좌 새 원금)
      const W={}; for(const k of Object.keys(C)) W[k]=[];
      for(let y=+from.slice(0,4);y<=2021;y++) for(const mo of ['01','04','07','10']){ const s=`${y}-${mo}-01`, e=`${y+5}-${mo}-01`; if(s<from||e>last) continue;
        const f={}, h={}; for(const dv of [20,40,50]){ f[dv]=clean(await im(cap,dv,s,e,syn)); h[dv]=clean(await im(cap/2,dv,s,e,syn)); }
        const c={'20분할 100%':f[20],'50분할 100%':f[50],'40분할 100%':f[40],'20+50 따로':mixNone(h[20],h[50]),'20+50 연1회':mixYear(h[20],h[50]),'20+40 따로':mixNone(h[20],h[40])};
        for(const [k,m] of Object.entries(c)){ const x=met(series(m)); if(x) W[k].push({s,...x}); } }
      for(const [k,a] of Object.entries(W)) R.roll[k]={n:a.length,cMed:q(a.map(x=>x.cagr),.5),c10:q(a.map(x=>x.cagr),.1),cMin:Math.min(...a.map(x=>x.cagr)),
        mMed:q(a.map(x=>x.mdd),.5),mMax:Math.max(...a.map(x=>x.mdd)),bust:a.filter(x=>x.mult<0.2).length/a.length*100,
        win20:k==='20분할 100%'?null:a.filter((x,i)=>x.cagr>W['20분할 100%'][i].cagr).length/a.length*100};
      fs.writeFileSync(OUT,JSON.stringify(res)); } }
  await close(); fs.writeFileSync(OUT,JSON.stringify(res)); console.error('done'); })().catch(e=>{console.error(e);process.exit(1);});
