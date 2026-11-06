// 플랜 변형의 표본 밖 시험(11-04) — XLK(→SYNTECL)가 없는 1987~1999 를 TECL 대용 SYNTECLN(NDX 3배 + TECL 비용, synth.js)으로 돌린다.
// TECL 대용도 Guard(SYNTQQQ)도 NDX 라 두 다리가 같은 지수 — 규칙의 '구조'를 다른 시대에서 보는 시험이지 플랜 수익 추정이 아니다.
// 1987~1999(표본 밖) · 1987~2026(전체) · 1만$·10만$ · 소수 주 · 5년 롤링(매월) 중앙 · 같은 창 짝(둘 다 나음:둘 다 나쁨)
// 사용: VARS='{"이름":{파라미터},…}' BASES='cur,new' node planoos.js
const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const EXTRA=(process.env.EXTRA||'').split(',').filter(Boolean); const P=prep(['SYNTECLN','SYNTQQQ'].concat(EXTRA.map(x=>'SYN'+x+'_L')));   // EXTRA=IEF → SYNIEF_L(SYNTQQQ 축 · synbond.js)
const fix=p=>{ const q=Object.assign({},p); if(q.offAsset&&!q.offAsset.startsWith('SYN')) q.offAsset='SYN'+q.offAsset+'_L'; return q; };
const BASE={cur:{gsb:1e9,fee:0.001}, new:{gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}};
const VARS=JSON.parse(process.env.VARS||'{}'), BASES=(process.env.BASES||'cur,new').split(','); const f=x=>x.toFixed(1), last=P.dates[P.dates.length-1];
for(const [per,from,to,y0,y1] of [['1987~1999(표본 밖)','1987-01-01','1999-12-31',1987,1994],['1987~2026(전체)','1987-01-01',null,1987,2021]]) for(const cap of [1e4,1e5]) for(const bk of BASES){
  const mkO=(p,o2)=>Object.assign({cap,fee:p.fee,frac:true},mk(P,'SYNTECLN','SYNTQQQ',p),o2||{});
  const wins=p=>{ const o=mkO(p), out=[]; for(let y=y0;y<=y1;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if((to&&e>to)||e>last) continue; out.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,cap)); } return out; };
  const bp=BASE[bk], B=wins(bp), b=stats(sim(P,mkO(bp,{from,to:to||undefined})).eq,cap);
  const line=[`기준 ${f(b.cagr)}/${f(b.mdd)} 롤링 중앙 ${f(q(B.map(x=>x.cagr),.5))}/${f(q(B.map(x=>x.mdd),.5))}`];
  for(const [n,v] of Object.entries(VARS)){ const p=fix(Object.assign({},bp,v)), w=wins(p), s=stats(sim(P,mkO(p,{from,to:to||undefined})).eq,cap); const dc=w.map((x,i)=>x.cagr-B[i].cagr), dm=w.map((x,i)=>x.mdd-B[i].mdd), e=0.05;
    const both=dc.filter((x,i)=>x>=-e&&dm[i]<=e&&(x>e||dm[i]<-e)).length, worse=dc.filter((x,i)=>x<=e&&dm[i]>=-e&&(x<-e||dm[i]>e)).length;
    line.push(`${n} ${f(s.cagr)}/${f(s.mdd)} 롤링 ${f(q(w.map(x=>x.cagr),.5))}/${f(q(w.map(x=>x.mdd),.5))} 짝 ${both}:${worse}/${w.length}`); }
  console.log(`${per} ${cap/1e4}만$ ${bk==='cur'?'지금 앱':'새 플랜'} | ${line.join(' | ')}`); }
