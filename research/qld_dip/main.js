const {build}=require('./series');const {run,xirr,risk}=require('./dip');
const S=build();
const pct=(x,d=1)=>(x>=0?'+':'')+(x*100).toFixed(d)+'%';
const RULES=[['qqq','QQQ만 적립'],['idx','전략: 지수 −15%'],['avg','전략: 평단 −15%'],['or','전략: 둘 중 하나'],['qld','QLD만 적립']];
function table(from,to,P,M,frac,extra=[]){
  const rows=[];
  for(const [r,name] of RULES.concat(extra)){
    const o=typeof r==='object'?{...r,from,to,P,M,frac}:{rule:r,from,to,P,M,frac};
    const R=run(S,o), k=risk(R.curve), irr=xirr(R.flows,R.to,R.after);
    rows.push({name,R,k,irr});
  }
  const base=rows[0];
  console.log(`\n■ ${rows[0].R.from} ~ ${rows[0].R.to} · 원금 ${P.toLocaleString()}$ + 월 ${M.toLocaleString()}$ · ${frac?'소수 주':'정수 주'} · 낸 돈 ${Math.round(rows[0].R.paid).toLocaleString()}$`);
  console.log('전략 | 세후 최종 | 배수 | 연(돈가중·세후) | QQQ만 대비 | 넣은 돈 대비 최악 | MDD(투입 보정) | 끝 QLD 비중 | 새 돈 중 QLD');
  for(const x of rows){ const R=x.R;
    console.log([x.name, Math.round(R.after).toLocaleString()+'$', (R.after/R.paid).toFixed(2)+'배', pct(x.irr,2), (x===base?'—':((R.after/base.R.after-1)>=0?'+':'')+((R.after/base.R.after-1)*100).toFixed(0)+'%'),
      pct(x.k.worst)+' ('+x.k.worstAt+')', '-'+(x.k.mdd*100).toFixed(1)+'% ('+x.k.mddAt+')', (R.qlShare*100).toFixed(0)+'%', (R.toL/R.paid*100).toFixed(0)+'%'+(R.conv?` · 되돌림 ${R.conv}번`:'')].join(' | ')); }
  return rows;
}
const END=null;
for(const [P,M] of [[10000,300],[100000,3000]]){
  table('2006-06-21',END,P,M,false,[[{rule:'idx',back:true},'확장: 지수 −15% + 회복 때 QLD→QQQ']]);
}
for(const [P,M] of [[10000,300],[100000,3000]]){
  table('1999-03-10',END,P,M,false,[[{rule:'idx',back:true},'확장: 지수 −15% + 회복 때 QLD→QQQ']]);
}
for(const [P,M] of [[10000,300],[100000,3000]]){
  table('1986-01-01',END,P,M,false,[[{rule:'idx',back:true},'확장: 지수 −15% + 회복 때 QLD→QQQ']]);
}
