const {pair,q}=require('./inv_lib');const [INV,LNG,IDX]=(process.argv[2]||'SOXS,SOXL,SOXX').split(',');
const R=pair(INV,LNG,IDX,'2017-08-01'),n=R.length,f=(x,d=1)=>(x*100).toFixed(d);
console.log(`■ ${INV}/${LNG} 최근:`,R.slice(-8).map(z=>`${z.date.slice(5)} ${f(z.r,0)}%`).join(' · '));
// ① 겹치지 않는 60거래일 묶음: 이번 묶음의 비율 평균 ↔ 다음 묶음의 롱 수익 (순위 상관)
const B=[];for(let i=0;i+60<=n;i+=60){const a=R.slice(i,i+60);B.push({d:a[0].date,r:a.reduce((s,z)=>s+z.r,0)/60,ret:a[59].L/a[0].L-1,dd:Math.min(...a.map(z=>z.ddX))});}
const rk=a=>{const s=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]),o=[];s.forEach(([,i],k)=>o[i]=k);return o;};
const sp=(x,y)=>{const a=rk(x),b=rk(y),m=a.length,ma=(m-1)/2;let c=0,va=0,vb=0;for(let i=0;i<m;i++){c+=(a[i]-ma)*(b[i]-ma);va+=(a[i]-ma)**2;vb+=(b[i]-ma)**2;}return c/Math.sqrt(va*vb);};
const X=B.slice(0,-1).map(b=>b.r),Y=B.slice(1).map(b=>b.ret),Y2=B.slice(0,-2).map((b,i)=>(1+B[i+1].ret)*(1+B[i+2].ret)-1);
console.log(`  ① 60일 묶음 ${B.length}개 — 비율 평균 ↔ 다음 60일 ${LNG} 수익 순위상관 ${sp(X,Y).toFixed(2)} · 다음 120일 ${sp(B.slice(0,-2).map(b=>b.r),Y2).toFixed(2)} · (참고) 그 묶음 최대낙폭 ↔ 다음 60일 ${sp(B.slice(0,-1).map(b=>-b.dd),Y).toFixed(2)}`);
const hi=B.slice(0,-1).map((b,i)=>[b.r,B[i+1].ret,b.d]).sort((a,b)=>b[0]-a[0]);const third=Math.floor(hi.length/3);
const med=a=>q(a,.5);console.log(`     비율 높은 1/3 묶음 뒤 60일 중앙 ${f(med(hi.slice(0,third).map(x=>x[1])))}% (오른 ${hi.slice(0,third).filter(x=>x[1]>0).length}/${third}) · 가운데 ${f(med(hi.slice(third,2*third).map(x=>x[1])))}% · 낮은 1/3 ${f(med(hi.slice(2*third).map(x=>x[1])))}% (오른 ${hi.slice(2*third).filter(x=>x[1]>0).length}/${hi.length-2*third})`);
// ② 단순 규칙(전일 비율까지로 판정 → 그날 종가 체결 · 수수료 0.1% · 세금 없음 · 현금 이자 없음): 롱을 들거나 현금
const ma=(k,m)=>{let s=0;for(let j=k-m+1;j<=k;j++)s+=R[j].r;return s/m;};
function run(rule,from=60){let eq=1,pk=1,mdd=0,pos=0,days=0,tr=0;const yrs=(Date.parse(R[n-1].date)-Date.parse(R[from].date))/(365.25*864e5);
  for(let i=from;i<n;i++){eq*=1+pos*(R[i].L/R[i-1].L-1);const w=rule(i-1,pos);if(w!==pos){eq*=1-0.001*Math.abs(w-pos);tr++;pos=w;}days+=pos;pk=Math.max(pk,eq);mdd=Math.max(mdd,1-eq/pk);}   // 전일(i-1)까지의 비율로 오늘 종가 비중
  return {cagr:(Math.pow(eq,1/yrs)-1)*100,mdd:mdd*100,exp:days/(n-from)*100,tr,mult:eq};}
const pr=(nm,o)=>console.log(`     ${nm.padEnd(34)} 연 ${o.cagr.toFixed(1).padStart(6)}% · 낙폭 ${o.mdd.toFixed(1)}% · 배수 ×${o.mult.toFixed(1)} · 든 날 ${o.exp.toFixed(0)}% · 전환 ${o.tr}회`);
console.log('  ② 규칙 시험('+LNG+' · '+R[60].date+'~):');
pr('그냥 들고 있기',run(()=>1));
for(const m of [5,20,60])for(const T of [.3,.4,.5,.7])pr(`${m}일 평균 비율 ≥ ${T*100}% 일 때만 든다`,run(k=>ma(k,m)>=T?1:0));
for(const T of [.2,.25,.3])pr(`60일 평균 비율 < ${T*100}% 면 판다(안일할 때 빠짐)`,run(k=>ma(k,60)<T?0:1));
pr('한 번 ≥100% 뒤 250일 든다',run((()=>{let last=-1e9;return k=>{if(R[k].r>1)last=k;return k-last<250?1:0;};})()));
pr('한 번 ≥70% 뒤 250일 든다',run((()=>{let last=-1e9;return k=>{if(R[k].r>=.7)last=k;return k-last<250?1:0;};})()));
pr('한 번 ≥70% 뒤 120일 든다',run((()=>{let last=-1e9;return k=>{if(R[k].r>=.7)last=k;return k-last<120?1:0;};})()));
