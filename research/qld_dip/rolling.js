// 시작 달을 한 달씩 옮기며 H년 적립 — QQQ만 적립 대비 전략의 돈가중 연수익(세후) 차이 · 위험
const {build}=require('./series');const {run,xirr,risk}=require('./dip');
const S=build(); const {dates}=S; const END=dates[dates.length-1];
const P=+process.argv[3]||100000, M=+process.argv[4]||3000;
const add=(d,y)=>{const t=new Date(d+'T00:00:00Z');t.setUTCFullYear(t.getUTCFullYear()+y);return t.toISOString().slice(0,10);};
const H=+process.argv[2]||10;
const RULES=['qqq','idx','hi52','avg','qld','mix'];
const starts=[];for(let y=1986;y<=2026;y++)for(let m=1;m<=12;m++){const d=`${y}-${String(m).padStart(2,'0')}-01`;if(add(d,H)<=END)starts.push(d);}
const res=[];
for(const s of starts){ const to=add(s,H); const row={s};
  for(const r of RULES){ let o={rule:r,from:s,to,P,M};
    if(r==='mix'){ const ref=row.idx; o={...o,w:ref.toL/ref.paid}; }
    const R=run(S,o),k=risk(R.curve); row[r]={irr:xirr(R.flows,R.to,R.after),mult:R.after/R.paid,worst:k.worst,mdd:k.mdd,toL:R.toL,paid:R.paid,ql:R.qlShare}; }
  res.push(row); }
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.max(0,Math.round(p*(b.length-1))))];};
const pp=x=>(x>=0?'+':'')+(x*100).toFixed(1);
function summary(label,rows){
  console.log(`\n■ ${H}년 적립 · 시작 ${rows[0].s.slice(0,7)} ~ ${rows[rows.length-1].s.slice(0,7)} (${rows.length}개) · ${label} · 원금 ${P}$ + 월 ${M}$`);
  console.log('전략 | QQQ만보다 연수익 높은 비율 | 차이 중앙값(%p) | 하위10%(%p) | 가장 나쁜(%p · 시작) | 가장 좋은(%p) | 넣은 돈 대비 최악(중앙 · 최악) | MDD 투입보정(중앙 · 최악)');
  for(const r of RULES){ const diff=rows.map(x=>x[r].irr-x.qqq.irr), win=diff.filter(v=>v>0).length/rows.length;
    const wi=diff.indexOf(Math.min(...diff));
    console.log([r, r==='qqq'?'—':(win*100).toFixed(0)+'%', r==='qqq'?'연 '+pp(q(rows.map(x=>x.qqq.irr),0.5))+'%':pp(q(diff,0.5)), r==='qqq'?'':pp(q(diff,0.1)), r==='qqq'?'':pp(diff[wi])+' ('+rows[wi].s.slice(0,7)+')', r==='qqq'?'':pp(Math.max(...diff)),
      pp(q(rows.map(x=>x[r].worst),0.5))+'% · '+pp(Math.min(...rows.map(x=>x[r].worst)))+'%', '-'+(q(rows.map(x=>x[r].mdd),0.5)*100).toFixed(1)+'% · -'+(Math.max(...rows.map(x=>x[r].mdd))*100).toFixed(1)+'%'].join(' | ')); }
}
summary('전 구간(1999-03 전은 합성 QQQ · 2006-06 전은 합성 QLD)',res);
summary('QQQ 실제(1999-03~)',res.filter(x=>x.s>='1999-04-01'));
if(res.some(x=>x.s>='2006-07-01')) summary('QLD 실제(2006-07~)',res.filter(x=>x.s>='2006-07-01'));
// 시작 해별(1월 시작) 한 줄
console.log('\n시작(1월) | QQQ만 연 | 지수 | 1년고점 | 평단 | QLD만 | 같은비율 섞기 | 지수: 끝 QLD 비중');
for(const x of res.filter(x=>x.s.endsWith('-01-01'))) console.log([x.s.slice(0,4),pp(x.qqq.irr),pp(x.idx.irr),pp(x.hi52.irr),pp(x.avg.irr),pp(x.qld.irr),pp(x.mix.irr),(x.idx.ql*100).toFixed(0)+'%'].join(' | '));
