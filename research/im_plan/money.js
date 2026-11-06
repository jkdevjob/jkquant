// '이걸로 돈을 빨리 많이 벌 수 있나'(11-07 사용자 질문) — 수익률 대신 돈의 배수로 본다.
// 변형마다(앱 조건 · 실제 2011~ · 1만$·10만$): 1·3·5·10년 창(매월 시작 · 새로 시작) 배수 분포(중앙 · 하10 · 상90 · 손실 창 비율 · 최악) · 두 배 되는 데 걸린 해(중앙 · 상90 · 8년 안에 못 한 비율)
// · 최근 시작(2022-01 · 2020-01 · 2016-01 → 끝) 배수 · 세금 없을 때(비과세 계좌 가정) 전체 CAGR.  사용: VARS='{"이름":{파라미터}}' node money.js
const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const CUR={gsb:1e9,fee:0.001}, NEW={gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001};
const V=Object.assign({'지금 앱':CUR,'새 규칙':NEW,'새+s0.60':{...NEW,s0:.60},'새+s0.65':{...NEW,s0:.65},'새+tw.80':{...NEW,tw:.80,gw:.20}},JSON.parse(process.env.VARS||'{}'));
const P=prep(['TECL','TQQQ']), last=P.dates[P.dates.length-1], f=x=>x.toFixed(1), f2=x=>x.toFixed(2);
const mkO=(p,cap,o2)=>Object.assign({cap,fee:p.fee},mk(P,'TECL','TQQQ',p),o2||{});
const addY=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+n);return d.toISOString().slice(0,10);};
const starts=[];for(let y=2011;y<=2025;y++)for(let m=1;m<=12;m++)starts.push(`${y}-${String(m).padStart(2,'0')}-01`);
for(const cap of [1e4,1e5]){
  console.log(`\n■ 실제 2011~ · ${cap/1e4}만$ · 앱 조건(수수료 0.1% · 양도세 22% 연 정산)`);
  for(const [nm,p] of Object.entries(V)){ const o=mkO(p,cap); const line=[];
    for(const Y of [1,3,5,10]){ const M=[]; for(const s of starts){ const e=addY(s,Y); if(e>last) continue; M.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,cap).fin/cap); }
      if(!M.length) continue; line.push(`${Y}년 ×${f2(q(M,.5))}(하10 ×${f2(q(M,.1))} · 상90 ×${f2(q(M,.9))} · 손실 ${(M.filter(x=>x<1).length/M.length*100).toFixed(0)}% · 최악 ×${f2(Math.min(...M))} · ${M.length}창)`); }
    // 두 배 되는 데 걸린 해(새로 시작 · 8년 안)
    const D=[]; let nodbl=0, n=0; for(const s of starts){ if(s>'2018-12-01') continue; n++; const e=addY(s,8); const eq=sim(P,Object.assign({},o,{from:s,to:e>last?undefined:e,endTax:false})).eq; const hit=eq.find(([d,v])=>v>=cap*2); if(hit) D.push((Date.parse(hit[0])-Date.parse(eq[0][0]))/(365.25*864e5)); else nodbl++; }
    const dbl=D.length?`두 배까지 중앙 ${f(q(D,.5))}년 · 상90 ${f(q(D,.9))}년 · 최장 ${f(Math.max(...D))}년 · 8년 안에 못 함 ${nodbl}/${n}`:'두 배 없음';
    const rec=[['2022-01','2022-01-03'],['2020-01','2020-01-02'],['2016-01','2016-01-04']].map(([l,s])=>{const r=stats(sim(P,Object.assign({},o,{from:s})).eq,cap);return `${l}~ ×${f2(r.fin/cap)}(${f(r.cagr)}%/MDD ${f(r.mdd)})`;}).join(' · ');
    const all=stats(sim(P,Object.assign({},o,{from:'2011-01-01'})).eq,cap), notax=stats(sim(P,Object.assign({},o,{from:'2011-01-01',tax:false})).eq,cap);
    console.log(`  ${nm}: 전체 ×${f(all.fin/cap)} (${f(all.cagr)}/${f(all.mdd)}) · 세금 없으면 ×${f(notax.fin/cap)} (${f(notax.cagr)}) | ${line.join(' | ')} | ${dbl} | ${rec}`); } }
