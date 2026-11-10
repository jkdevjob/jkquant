// 인버스/롱 거래대금 비율을 2010-03 까지 늘려 본다(11-10) — Eastmoney 실제 거래대금은 2017-07 부터라, 그 전은 '원 종가 × 원 거래량'(둘 다 분할 반영 전 · 같은 파일)으로 대신한다.
// 2017-08 뒤 겹치는 날에서 두 방식이 얼마나 같은지 먼저 확인하고, 문턱(50·70·100%)은 글에서 온 그대로 두어 2010-03~2017-07 을 표본 밖으로 쓴다.
const fs=require('fs'),path=require('path');const {load,byDate,q}=require('./inv_lib');
function raw(sym){const m=new Map();JSON.parse(fs.readFileSync(path.join(__dirname,'data','e_'+sym+'.json'),'utf8')).data.klines.forEach(l=>{const p=l.split(',');const c=+p[2],v=+p[5],a=+p[6];if(c>0&&v>0)m.set(p[0],{cv:c*v,a:a>0?a:null});});return m;}
function series(inv,lng,idx){const A=raw(inv),B=raw(lng),L=load(lng),X=byDate(load(idx));let pkL=0,pkX=0;const out=[];
  for(const z of L){const x=X.get(z.date);if(!x)continue;pkL=Math.max(pkL,z.ac);pkX=Math.max(pkX,x.ac);const a=A.get(z.date),b=B.get(z.date);if(!a||!b)continue;
    out.push({date:z.date,r:(a.a&&b.a)?a.a/b.a:a.cv/b.cv,rcv:a.cv/b.cv,ra:(a.a&&b.a)?a.a/b.a:null,L:z.ac,X:x.ac,ddX:x.ac/pkX-1,ddL:z.ac/pkL-1});}
  return out;}
module.exports={series,q};
if(require.main===module){const [INV,LNG,IDX]=(process.argv[2]||'SOXS,SOXL,SOXX').split(',');const R=series(INV,LNG,IDX),n=R.length,f=(x,d=1)=>(x*100).toFixed(d);
  const both=R.filter(z=>z.ra!=null);let s=0;both.forEach(z=>s+=Math.abs(Math.log(z.rcv/z.ra)));
  console.log(`■ ${INV}/${LNG} ${R[0].date}~${R[n-1].date} ${n}일 · 겹치는 ${both.length}일에서 (종가×거래량) ÷ (실제 거래대금) 비율 차 중앙 ${f(q(both.map(z=>Math.abs(z.rcv/z.ra-1)),.5))}% · 90% ${f(q(both.map(z=>Math.abs(z.rcv/z.ra-1)),.9))}% · 문턱 70% 판정이 같은 날 ${f(both.filter(z=>(z.rcv>=.7)===(z.ra>=.7)).length/both.length)}%`);
  for(const [nm,a,b] of [['표본 밖 2010-03~2017-07','2010-03-01','2017-07-31'],['글의 기간 2017-08~','2017-08-01','2099']]){
    const idx=R.map((z,i)=>i).filter(i=>R[i].date>=a&&R[i].date<=b),H=[20,60,120,250],fw=(i,h)=>(i+1+h<n)?R[i+1+h].L/R[i+1].L-1:null;
    const st=I=>H.map(h=>{const v=I.map(i=>fw(i,h)).filter(x=>x!=null);return v.length?`${f(q(v,.5))}(${f(v.filter(x=>x>0).length/v.length,0)}%·${v.length})`:'-';}).join('  ');
    console.log(`\n  [${nm}] ${idx.length}일 · ≥50% ${idx.filter(i=>R[i].r>=.5).length} · ≥70% ${idx.filter(i=>R[i].r>=.7).length} · >100% ${idx.filter(i=>R[i].r>1).length} · 비율 중앙 ${f(q(idx.map(i=>R[i].r),.5),0)}%`);
    console.log(`   ${LNG} 다음날 매수 뒤 ${H.join('/')}일 중앙(오른 비율·표본)`);
    console.log('   모든 날   ',st(idx));for(const [t,fn] of [['≥50%',z=>z.r>=.5],['≥70%',z=>z.r>=.7],['>100%',z=>z.r>1],['<30%',z=>z.r<.3]])console.log('   '+t.padEnd(7),st(idx.filter(i=>fn(R[i]))));
    const yr={};idx.forEach(i=>{const y=R[i].date.slice(0,4);(yr[y]=yr[y]||[]).push(R[i].r);});console.log('   연도별 비율 중앙/≥70% 일수:',Object.entries(yr).map(([y,v])=>`${y} ${f(q(v,.5),0)}%/${v.filter(x=>x>=.7).length}`).join(' · '));}
}
