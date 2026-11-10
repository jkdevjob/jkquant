// 인버스/롱 거래대금 비율만으로 굴리는 단독 전략 시험(11-10 · 사용자 "저거 자체로만 전략을 쓸수 없을까?")
// 판정은 전일(k)까지의 값 · 체결은 그날 종가 · 수수료 0.1% · 현금 이자 0 · 세금 없음. 비중 w(0~1)만큼 롱(SOXL), 나머지 현금.
// 같은 평균 비중을 '늘 그만큼' 든 고정 혼합(매일 맞춤)을 나란히 둔다 — 시점을 고른 값인지, 그냥 덜 든 값인지 가르려고.
const {series,q}=require('./inv_long');const [INV,LNG,IDX]=(process.argv[2]||'SOXS,SOXL,SOXX').split(',');
const R=series(INV,LNG,IDX),n=R.length;
const cnt=(k,m,fn)=>{let c=0;for(let j=Math.max(0,k-m+1);j<=k;j++)if(fn(R[j]))c++;return c;};
const since=(fn)=>{let last=-1e9;return k=>{if(fn(R[k],k))last=k;return k-last;};};
const med=(k,m)=>{const a=[];for(let j=Math.max(0,k-m+1);j<=k;j++)a.push(R[j].r);return q(a,.5);};
function run(mk,a,b){const rule=mk();let eq=1,pk=1,mdd=0,w=0,sumW=0,tr=0,days=0,mix=null;const i0=R.findIndex(z=>z.date>=a),i1=(()=>{let e=n-1;while(R[e].date>b)e--;return e;})();
  // 규칙 상태(마지막 신호일 등)는 처음부터 걸어 와야 한다 — 구간 앞의 날도 rule 을 부른다
  const ws=[];for(let i=1;i<=i1;i++){const nw=rule(i-1);if(i>i0){eq*=1+w*(R[i].L/R[i-1].L-1);}   // 어제 정한 비중으로 오늘 수익
    if(i>=i0){if(Math.abs(nw-w)>1e-9){eq*=1-0.001*Math.abs(nw-w);tr++;}w=nw;if(i>i0){sumW+=w;days++;ws.push(w);}pk=Math.max(pk,eq);mdd=Math.max(mdd,1-eq/pk);}else w=nw;}
  const yrs=(Date.parse(R[i1].date)-Date.parse(R[i0].date))/(365.25*864e5),avg=sumW/Math.max(1,days);
  let m=1,mp=1,md=0;for(let i=i0+1;i<=i1;i++){m*=1+avg*(R[i].L/R[i-1].L-1);mp=Math.max(mp,m);md=Math.max(md,1-m/mp);}
  return {cagr:(Math.pow(eq,1/yrs)-1)*100,mdd:mdd*100,avg:avg*100,tr,mixC:(Math.pow(m,1/yrs)-1)*100,mixM:md*100};}
const RULES={
 '그냥 들기':()=>()=>1,
 '≥70% 뒤 60일 든다':()=>{const s=since(z=>z.r>=.7);return k=>s(k)<60?1:0;},
 '≥70% 뒤 120일 든다':()=>{const s=since(z=>z.r>=.7);return k=>s(k)<120?1:0;},
 '≥70% 뒤 250일 든다':()=>{const s=since(z=>z.r>=.7);return k=>s(k)<250?1:0;},
 '≥50% 뒤 120일 든다':()=>{const s=since(z=>z.r>=.5);return k=>s(k)<120?1:0;},
 '>100% 뒤 120일 든다':()=>{const s=since(z=>z.r>1);return k=>s(k)<120?1:0;},
 '>100% 뒤 250일 든다':()=>{const s=since(z=>z.r>1);return k=>s(k)<250?1:0;},
 '공포일 쌓기(250일 안 ≥70% 날 ×5%)':()=>k=>Math.min(1,cnt(k,250,z=>z.r>=.7)*.05),
 '공포일 쌓기(250일 안 ≥50% 날 ×2%)':()=>k=>Math.min(1,cnt(k,250,z=>z.r>=.5)*.02),
 '상대 신호(비율 ≥ 1년 중앙×2) 뒤 120일':()=>{const s=since((z,k)=>k>=250&&z.r>=2*med(k,250));return k=>s(k)<120?1:0;},
 '상대 신호(비율 ≥ 1년 중앙×3) 뒤 120일':()=>{const s=since((z,k)=>k>=250&&z.r>=3*med(k,250));return k=>s(k)<120?1:0;},
 '[대조] 지수 낙폭 ≤−15% 뒤 120일':()=>{const s=since(z=>z.ddX<=-.15);return k=>s(k)<120?1:0;},
 '[대조] 지수 낙폭 ≤−20% 뒤 120일':()=>{const s=since(z=>z.ddX<=-.20);return k=>s(k)<120?1:0;},
 '[대조] 지수 낙폭 ≤−20% 뒤 250일':()=>{const s=since(z=>z.ddX<=-.20);return k=>s(k)<250?1:0;},
 '[대조] 롱 하루 ≤−10% 뒤 120일':()=>{const s=since((z,k)=>k>0&&z.L/R[k-1].L-1<=-.10);return k=>s(k)<120?1:0;},
};
const P=[['전체 2010-03~','2010-03-11','2099'],['표본 밖 ~2017-07','2010-03-11','2017-07-31'],['글의 기간 2017-08~','2017-08-01','2099']];
console.log(`■ ${INV}/${LNG} 단독 규칙 — 연 수익/최대 낙폭 [든 비중 · 전환] (같은 평균 비중 고정 혼합의 연/낙폭)`);
for(const [nm,mk] of Object.entries(RULES)){console.log('  '+nm);
  for(const [pn,a,b] of P){const o=run(mk,a,b);console.log(`     ${pn.padEnd(16)} ${o.cagr.toFixed(1).padStart(6)}% / ${o.mdd.toFixed(1).padStart(5)}%  [${o.avg.toFixed(0).padStart(3)}% · ${String(o.tr).padStart(3)}회]  (고정 혼합 ${o.mixC.toFixed(1)}% / ${o.mixM.toFixed(1)}%)`);}}
