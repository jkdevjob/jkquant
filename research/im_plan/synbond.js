// 합성 채권·금·QQQ(11-03) — 플랜 'Guard OFF 동안 TQQQ 몫을 SGOV 대신 다른 자산으로' 합성 2000~ 시험용. 날짜는 SYNTECL(1998-12~) 축에 맞춘다(빠진 날은 직전 값).
// SYNIEF: 만기 8.5년 고정 · 금리 0.3×^FVX + 0.7×^TNX 의 액면 채권을 매일 갈아탐(쿠폰 = 전일 금리 · 반기 지급) − 보수 0.15%/년
// SYNTLT: 만기 25년 · 금리 0.25×^TNX + 0.75×^TYX · 보수 0.15%/년
// SYNGLD: 금 선물 근월물(GC=F, 2000-08-30~) − 보수 0.40%/년 · 그 전은 T-bill(^IRX) 이자만(현금과 같음)
// SYNQQQ: 실제 QQQ(1999-03-10~ 총수익) · 그 전은 ^NDX(가격) — 예열용
// 검증: 실제 IEF·TLT(2002-07~) · GLD(2004-11~) 와 연복리 · 월수익 상관 · 최대 낙폭 · 해마다 수익을 견준다.
// 사용: node synbond.js   (fetch.sh 뒤 · ^TNX ^TYX ^FVX GC=F 자료가 data/ 에 있어야 함)
const fs=require('fs'), path=require('path'); const D=path.join(__dirname,'data');
const load=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series.filter(x=>x.close>0);
const mapOf=s=>{ const m={}; load(s).forEach(x=>m[x.date]=x.close); return m; };
function build(axisSym){ const axis=load(axisSym).map(x=>x.date);
const ff=(m,ds)=>{ let last=null; return ds.map(d=>{ if(m[d]!=null) last=m[d]; return last; }); };
  const TNX=ff(mapOf('TNX'),axis), TYX=ff(mapOf('TYX'),axis), FVX=ff(mapOf('FVX'),axis), IRX=ff(mapOf('IRX'),axis);
function price(c,y,M){ const n=Math.round(M*2), h=y/2; let p=0; for(let i=1;i<=n;i++) p+=(c/2)/Math.pow(1+h,i); return p+1/Math.pow(1+h,n); }
function bond(yOf,M,fee){ const out=[100]; for(let k=1;k<axis.length;k++){ const y0=yOf(k-1)/100, y1=yOf(k)/100, gap=(Date.parse(axis[k])-Date.parse(axis[k-1]))/864e5;
    const r=price(y0,y1,M)-1+y0*gap/365-fee*gap/365; out.push(out[k-1]*(1+r)); } return out; }
const SYNIEF=bond(k=>0.3*FVX[k]+0.7*TNX[k],8.5,0.0015), SYNTLT=bond(k=>0.25*TNX[k]+0.75*TYX[k],25,0.0015);
// 금: GC=F 가 있는 날부터 선물 수익 − 보수 · 그 전은 T-bill
const G=mapOf('GCF'); const SYNGLD=[100]; { let lastG=null; for(let k=1;k<axis.length;k++){ const d=axis[k], gap=(Date.parse(d)-Date.parse(axis[k-1]))/864e5; const g=G[d]!=null?G[d]:lastG;
  let r; if(lastG!=null&&g!=null) r=g/lastG-1-0.004*gap/365; else r=Math.max(0,IRX[k-1]/100-0.0009)*gap/365; if(g!=null) lastG=g; SYNGLD.push(SYNGLD[k-1]*(1+r)); } }
// QQQ: 실제(1999-03-10~) · 그 전 NDX
const Q=mapOf('QQQ'), N=mapOf('NDX'); const SYNQQQ=[100]; { for(let k=1;k<axis.length;k++){ const a=axis[k-1], b=axis[k]; const r=(Q[a]!=null&&Q[b]!=null)?Q[b]/Q[a]-1:(N[a]!=null&&N[b]!=null)?N[b]/N[a]-1:0; SYNQQQ.push(SYNQQQ[k-1]*(1+r)); } }
const SYNBIL=[100]; for(let k=1;k<axis.length;k++){ const gap=(Date.parse(axis[k])-Date.parse(axis[k-1]))/864e5; SYNBIL.push(SYNBIL[k-1]*(1+Math.max(0,IRX[k-1]/100-0.00135)*gap/365)); }
const SYNMIX=[100]; for(let k=1;k<axis.length;k++) SYNMIX.push(SYNMIX[k-1]*(1+0.5*(SYNGLD[k]/SYNGLD[k-1]-1)+0.5*(SYNIEF[k]/SYNIEF[k-1]-1)));
return {axis,SYNIEF,SYNTLT,SYNGLD,SYNQQQ,SYNBIL,SYNMIXGI:SYNMIX,IRX}; }
module.exports={build};
if(require.main===module){ const {axis,SYNIEF,SYNTLT,SYNGLD,SYNQQQ,SYNBIL,SYNMIXGI:SYNMIX}=build('SYNTECL');
const save=(nm,arr)=>fs.writeFileSync(path.join(D,nm+'.json'),JSON.stringify({symbol:nm,src:'synthetic',series:axis.map((d,i)=>({date:d,close:+arr[i].toFixed(6)}))}));
save('SYNIEF',SYNIEF); save('SYNTLT',SYNTLT); save('SYNGLD',SYNGLD); save('SYNQQQ',SYNQQQ);
{ const L=build('SYNTQQQ'); const sv=(nm,arr)=>fs.writeFileSync(path.join(D,nm+'.json'),JSON.stringify({symbol:nm,src:'synthetic',series:L.axis.map((d,i)=>({date:d,close:+arr[i].toFixed(6)}))}));   // _L: SYNTQQQ 축(1985-10~) — planoos.js(표본 밖 1987~) 용(11-06)
  sv('SYNIEF_L',L.SYNIEF); sv('SYNTLT_L',L.SYNTLT); sv('SYNGLD_L',L.SYNGLD); sv('SYNBIL_L',L.SYNBIL); }
// 검증
const f=x=>x.toFixed(1);
for(const [nm,syn,real,from] of [['IEF',SYNIEF,'IEF','2002-07-30'],['TLT',SYNTLT,'TLT','2002-07-30'],['GLD',SYNGLD,'GLD','2004-11-18'],['QQQ',SYNQQQ,'QQQ','1999-03-10']]){
  const R=mapOf(real); const ds=axis.map((d,i)=>[d,i]).filter(([d])=>d>=from&&R[d]!=null); const a=ds[0], b=ds[ds.length-1]; const y=(Date.parse(b[0])-Date.parse(a[0]))/(365.25*864e5);
  const cr=(Math.pow(R[b[0]]/R[a[0]],1/y)-1)*100, cs=(Math.pow(syn[b[1]]/syn[a[1]],1/y)-1)*100;
  const mo={}; ds.forEach(([d,i])=>{ mo[d.slice(0,7)]=[R[d],syn[i]]; }); const ks=Object.keys(mo).sort(); const rr=[], rs=[]; for(let j=1;j<ks.length;j++){ rr.push(mo[ks[j]][0]/mo[ks[j-1]][0]-1); rs.push(mo[ks[j]][1]/mo[ks[j-1]][1]-1); }
  const mean=x=>x.reduce((p,q)=>p+q,0)/x.length, mr=mean(rr), ms=mean(rs); const cov=rr.reduce((p,q,j)=>p+(q-mr)*(rs[j]-ms),0), corr=cov/Math.sqrt(rr.reduce((p,q)=>p+(q-mr)**2,0)*rs.reduce((p,q)=>p+(q-ms)**2,0));
  const mdd=v=>{ let pk=0,m=0; v.forEach(x=>{ if(x>pk)pk=x; else m=Math.max(m,(pk-x)/pk); }); return m*100; };
  const yr={}; ds.forEach(([d,i])=>{ const Y=d.slice(0,4); (yr[Y]=yr[Y]||{a:[R[d],syn[i]]}).b=[R[d],syn[i]]; });
  const yl=Object.entries(yr).filter(([Y])=>['2002','2003','2008','2011','2013','2018','2020','2022','2023','2024','2025'].includes(Y)).map(([Y,o])=>`${Y} ${f((o.b[0]/o.a[0]-1)*100)}/${f((o.b[1]/o.a[1]-1)*100)}`).join(' · ');
  console.log(`${nm} ${a[0]}~${b[0]} 연복리 실제 ${cr.toFixed(2)} · 합성 ${cs.toFixed(2)} · 월수익 상관 ${corr.toFixed(3)} · 최대낙폭 ${f(mdd(ds.map(([d])=>R[d])))} / ${f(mdd(ds.map(([,i])=>syn[i])))} | 해마다 실제/합성 ${yl}`); }
// 2000~2002 구간(합성만 있음): 닷컴 때 채권·금
const at=d=>axis.findIndex(x=>x>=d); for(const [a,b] of [['2000-03-10','2002-10-09'],['2007-10-09','2009-03-09'],['2021-12-27','2022-12-30']]){ const i=at(a), j=at(b);
  console.log(`  ${a}~${b}: SYNIEF ${f((SYNIEF[j]/SYNIEF[i]-1)*100)}% · SYNTLT ${f((SYNTLT[j]/SYNTLT[i]-1)*100)}% · SYNGLD ${f((SYNGLD[j]/SYNGLD[i]-1)*100)}% · SYNQQQ ${f((SYNQQQ[j]/SYNQQQ[i]-1)*100)}%`); }
// 비교용(11-03): SYNBIL = T-bill 이자만(^IRX − BIL 보수 0.135%) — '현금 대신 BIL ETF' 가짜 비교(경로 잡음 바닥) · MIXGI = GLD 반 + IEF 반 매일 맞춤(실제 GLD∩IEF 날짜) · SYNMIXGI = SYNGLD 반 + SYNIEF 반
save('SYNBIL',SYNBIL); save('SYNMIXGI',SYNMIX);
{ const g=mapOf('GLD'), e=mapOf('IEF'); const ds=Object.keys(g).filter(d=>e[d]!=null).sort(); const v=[100]; for(let i=1;i<ds.length;i++) v.push(v[i-1]*(1+0.5*(g[ds[i]]/g[ds[i-1]]-1)+0.5*(e[ds[i]]/e[ds[i-1]]-1)));
  fs.writeFileSync(path.join(D,'MIXGI.json'),JSON.stringify({symbol:'MIXGI',src:'mix',series:ds.map((d,i)=>({date:d,close:+v[i].toFixed(6)}))})); }
}
