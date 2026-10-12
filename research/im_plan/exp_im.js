// 무매 변형들의 일별 자산을 파일로 (조합 연구용)
const {open}=require('./imh'); const fs=require('fs');
const V=JSON.parse(process.argv[2]); const TK=process.env.TK||'SOXL';
(async()=>{ const {pg,close}=await open([{sym:TK}]); const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const out={}; for(const [k,o] of Object.entries(V)) for(const cap of [10000,100000]){ const r=await pg.evaluate(o=>RUN(o),Object.assign({cap,tkr:TK},o)); const eq=r.eqs.slice(); eq.push([r.last+'~',r.final]); out[k+'_'+cap]=eq; }
  fs.writeFileSync(process.argv[3],JSON.stringify(out)); await close(); })();
