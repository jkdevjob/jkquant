const {get}=require('./lib');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const today=new Date('2026-09-11T00:00:00Z');
  const cases=[['1개월 전',30],['3개월 전',91],['6개월 전',182],['9개월 전',273],['1년 전',365],
               ['13개월 전',396],['15개월 전',456],['1.5년 전',548],['2년 전',730],['3년 전',1095]];
  console.log('KIS 분봉 과거 깊이 (005930, 9:30 기준 요청) — 경로: jkquant.pages.dev/api/kis?op=minhist\n');
  console.log('  '+'요청일'.padEnd(12)+'경과'.padEnd(11)+'봉수'.padStart(6)+'   반환 날짜   비고');
  for(const [lab,d] of cases){
    const dt=new Date(today.getTime()-d*864e5);
    const date=dt.toISOString().slice(0,10).replace(/-/g,'');
    const j=await get(`/api/kis?op=minhist&code=005930&date=${date}&hour=093000`);
    let n='-',got='-',note='';
    if(j.error){ note='실패: '+String(j.error).slice(0,50); }
    else { n=j.n||0; got=(j.bars&&j.bars[0]?j.bars[0].t.slice(0,8):'-');
      note = got===date ? '요청일과 일치' : (n? `← 실제로는 ${got}` : '빈 응답'); }
    console.log('  '+date.padEnd(12)+lab.padEnd(11)+String(n).padStart(6)+'   '+got.padEnd(11)+'  '+note);
    await sleep(900);
  }
})();
