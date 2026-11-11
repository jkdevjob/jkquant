// QQQ·QLD·NDX 일별 자료 — 실제(조정종가 = 배당 재투자 총수익) + 상장 전 합성
//  QQQ 합성(1999-03-10 전): NDX 가격 수익 + (배당 − 보수) 연 a% (겹치는 구간에서 맞춤)
//  QLD 합성(2006-06-21 전): 2 × QQQ 일수익 − (c + 1×T-bill)/252 — c 는 겹치는 구간(2006-06-21~)에서 실제 QLD 연복리와 같게 맞춤
//  모두 이어 붙인 날의 실제값에 맞춰 비율로 잇는다. 매수 단위 가격 = 조정종가 × 그 뒤 액면분할 배수(정수 주 계산용)
const fs=require('fs'),path=require('path');const D=path.join(__dirname,'data');
const J=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json')));
function load(){
  const q=J('QQQ'),l=J('QLD'),n=J('NDX'),ir=J('IRX');
  const N={};n.series.forEach(x=>{if(x.close>0)N[x.date]=x.close;});
  const Q={};q.series.forEach(x=>{if(x.close>0)Q[x.date]=x.close;});
  const L={};l.series.forEach(x=>{if(x.close>0)L[x.date]=x.close;});
  const IR={};ir.series.forEach(x=>{if(x.close!=null)IR[x.date]=x.close;});
  const dates=Object.keys(N).filter(d=>d>='1985-10-01').sort();
  return {q,l,N,Q,L,IR,dates};
}
function cagr(a,b,d0,d1){return Math.pow(b/a,365.25*864e5/(Date.parse(d1)-Date.parse(d0)))-1;}
function build(opt={}){
  const {q,l,N,Q,L,IR,dates}=load();
  // T-bill(전일 값 이어 쓰기)
  const irx=[];let last=null;for(const d of dates){if(IR[d]!=null)last=IR[d];irx.push(last==null?5:last);}
  // QQQ 합성 보정 a: 1999-03-10~2009-12-31 (NDX 배당이 지금보다 낮던 때) — 겹치는 구간 연복리 차이
  const qd=dates.filter(d=>Q[d]&&N[d]);const qs=qd[0];
  const ovA=qd.filter(d=>d<=(opt.qCalTo||'2009-12-31'));
  const a=opt.a!=null?opt.a:(cagr(Q[ovA[0]],Q[ovA[ovA.length-1]],ovA[0],ovA[ovA.length-1])-cagr(N[ovA[0]],N[ovA[ovA.length-1]],ovA[0],ovA[ovA.length-1]));
  const qq=new Array(dates.length);const iq=dates.indexOf(qs);qq[iq]=Q[qs];
  for(let k=iq+1;k<dates.length;k++){const d=dates[k];qq[k]=Q[d]!=null?Q[d]:qq[k-1]*(N[d]/N[dates[k-1]]);}   // 상장 뒤 빈 날(거의 없음)은 NDX로 채움
  for(let k=iq-1;k>=0;k--){qq[k]=qq[k+1]/((N[dates[k+1]]/N[dates[k]])*(1+a/252));}
  // QLD 합성: 2×QQQ − (c + T-bill)/252, c 를 2006-06-21~ 겹침에서 맞춤
  const ls=dates.find(d=>L[d]);const il=dates.indexOf(ls);
  const synFrom=(c,i0,i1)=>{let v=1;for(let k=i0+1;k<=i1;k++){v*=1+2*(qq[k]/qq[k-1]-1)-(c+irx[k-1]/100)/252;if(v<1e-9)v=1e-9;}return v;};
  const realC=cagr(L[ls],L[dates[dates.length-1]],ls,dates[dates.length-1]);
  let c=opt.c;
  if(c==null){let lo=-0.05,hi=0.05;for(let it=0;it<60;it++){const m=(lo+hi)/2;const v=synFrom(m,il,dates.length-1);const sc=Math.pow(v,365.25*864e5/(Date.parse(dates[dates.length-1])-Date.parse(ls)))-1;if(sc>realC)lo=m;else hi=m;}c=(lo+hi)/2;}
  const ll=new Array(dates.length);ll[il]=L[ls];
  for(let k=il+1;k<dates.length;k++){const d=dates[k];ll[k]=L[d]!=null?L[d]:ll[k-1]*(1+2*(qq[k]/qq[k-1]-1)-(c+irx[k-1]/100)/252);}
  for(let k=il-1;k>=0;k--){const r=1+2*(qq[k+1]/qq[k]-1)-(c+irx[k]/100)/252;ll[k]=ll[k+1]/Math.max(r,1e-6);}
  // 매수 단위 가격 = 조정종가 × 그 날 뒤 분할 배수 곱
  const sf=(splits,d)=>splits.filter(s=>s.date>d).reduce((m,s)=>m*s.ratio,1);
  const uq=dates.map((d,k)=>qq[k]*sf(q.splits||[],d)), ul=dates.map((d,k)=>ll[k]*sf(l.splits||[],d));
  const nn=dates.map(d=>N[d]);
  return {dates,N:nn,Q:qq,L:ll,UQ:uq,UL:ul,irx,a,c,qStart:qs,lStart:ls};
}
module.exports={build,load,cagr};
if(require.main===module){
  const S=build();const {dates,Q,L,N}=S;
  console.log('QQQ 합성 보정 a(배당−보수) 연',(S.a*100).toFixed(2)+'%','· QLD 합성 비용 c 연',(S.c*100).toFixed(2)+'% (+T-bill)');
  // 검증: 겹치는 구간을 해마다 — 실제 QLD vs 합성(2×QQQ − 비용)
  const {L:LR,Q:QR}=load();const ys={};
  for(let k=1;k<dates.length;k++){const d=dates[k],p=dates[k-1];if(!(LR[d]&&LR[p]))continue;const y=d.slice(0,4);ys[y]=ys[y]||{r:1,s:1};ys[y].r*=LR[d]/LR[p];ys[y].s*=1+2*(Q[k]/Q[k-1]-1)-(S.c+S.irx[k-1]/100)/252;}
  console.log('해 · 실제 QLD · 합성 · 차이(%p)');Object.keys(ys).forEach(y=>console.log(y,((ys[y].r-1)*100).toFixed(1),((ys[y].s-1)*100).toFixed(1),(((ys[y].s-ys[y].r))*100).toFixed(1)));
  const dd=a=>{let pk=0,m=0;a.forEach(v=>{if(v>pk)pk=v;else m=Math.max(m,1-v/pk);});return (m*100).toFixed(1);};
  const seg=(d0,d1)=>{const i0=dates.findIndex(d=>d>=d0),i1=dates.findLastIndex(d=>d<=d1);return {q:Q.slice(i0,i1+1),l:L.slice(i0,i1+1),n:N.slice(i0,i1+1)};};
  for(const [a,b] of [['2000-03-10','2002-10-09'],['2007-10-31','2009-03-09'],['2020-02-19','2020-03-23'],['2021-11-19','2022-12-28']]){const s=seg(a,b);console.log(a,'~',b,'NDX',dd(s.n),'QQQ',dd(s.q),'QLD',dd(s.l));}
  console.log('합성 QLD 1985~ 최대낙폭',dd(L),'· 2000-03 고점 → 2002 저점',(Math.min(...seg('2000-03-01','2002-12-31').l)/Math.max(...seg('2000-01-01','2000-04-30').l)).toFixed(4));
}
