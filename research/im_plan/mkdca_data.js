// 11-08 적립 연구용 자료 — SYNROM: ROM(2배 다우존스 미국 기술) 대용 = XLK 2배 − (0.95% + 2%p + T-bill)/252 (2007~2026 실제 22.3% vs 합성 22.8%)
//                         GOLDX: 금 이어붙이기 = GLDM(2018-06~) ← GLD(2004-11~) ← 금 선물 GC=F(2000-08~) · 앞은 첫 값으로 평평
const fs=require('fs'),path=require('path'); const D=path.join(__dirname,'data'); const {synth}=require('./synth');
synth('XLK',2,0.0095+0.02,'SYNROM');
const rd=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series.filter(x=>x.close>0);
const parts=[rd('GLDM'),rd('GLD'),rd('GCF')]; const m={};   // 뒤에서 앞으로 수익률을 이어 붙인다
let cur=parts[0]; cur.forEach(x=>m[x.date]=x.close);
for(const older of parts.slice(1)){ const first=Object.keys(m).sort()[0]; const om={}; older.forEach(x=>om[x.date]=x.close); const ods=Object.keys(om).sort().filter(d=>d<=first);
  if(!ods.length||om[first]==null){ const k=ods[ods.length-1]; if(!k) continue; } const anchor=om[first]!=null?first:ods[ods.length-1]; const f=m[first]/om[anchor];
  for(const d of ods) if(d<first) m[d]=om[d]*f; }
const ds=Object.keys(m).sort(); const series=ds.map(d=>({date:d,close:m[d]}));
fs.writeFileSync(path.join(D,'GOLDX.json'),JSON.stringify({symbol:'GOLDX',src:'splice GLDM←GLD←GC=F',series,ohlc:series,raw:series,dividends:[],splits:[]}));
const c=(a,b)=>{ const ka=ds.find(x=>x>=a), kb=[...ds].reverse().find(x=>x<=b); return ((Math.pow(m[kb]/m[ka],1/((Date.parse(kb)-Date.parse(ka))/(365.25*864e5)))-1)*100).toFixed(1); };
console.log('GOLDX', ds.length, ds[0], '→', ds.at(-1), '| 2000-09~2004-10', c('2000-09-01','2004-10-31'), '| 2005~2017', c('2005-01-01','2017-12-31'), '| 2018-07~', c('2018-07-01','2026-11-06'), '| SYNROM ok', fs.existsSync(path.join(D,'SYNROM.json')));
