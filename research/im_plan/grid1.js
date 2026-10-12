// 무매 후보 비교 — 전체·2015~·2020~ + 5년 롤링(매월 시작) · 1만$·10만$
const {open,stats}=require('./imh'); const fs=require('fs');
const V={
  simple:{cashYield:true,compound:false,savedYield:true}, simpleTp:{cashYield:true,compound:false,savedYield:true,sig:{bearTP:10,bearMA:150}},
  "cx200_20":{cashYield:true,sig:{exitMA:200,exitBand:0.2}},"cx200_20tp":{cashYield:true,sig:{exitMA:200,exitBand:0.2,bearTP:10,bearMA:150}},"cx200_30":{cashYield:true,sig:{exitMA:200,exitBand:0.3}},"cx200_30tp":{cashYield:true,sig:{exitMA:200,exitBand:0.3,bearTP:10,bearMA:150}},"cx200_40":{cashYield:true,sig:{exitMA:200,exitBand:0.4}},"cx200_40tp":{cashYield:true,sig:{exitMA:200,exitBand:0.4,bearTP:10,bearMA:150}},"cx200_50":{cashYield:true,sig:{exitMA:200,exitBand:0.5}},"cx200_50tp":{cashYield:true,sig:{exitMA:200,exitBand:0.5,bearTP:10,bearMA:150}},"cx300_20":{cashYield:true,sig:{exitMA:300,exitBand:0.2}},"cx300_20tp":{cashYield:true,sig:{exitMA:300,exitBand:0.2,bearTP:10,bearMA:150}},"cx300_30":{cashYield:true,sig:{exitMA:300,exitBand:0.3}},"cx300_30tp":{cashYield:true,sig:{exitMA:300,exitBand:0.3,bearTP:10,bearMA:150}},"cx300_40":{cashYield:true,sig:{exitMA:300,exitBand:0.4}},"cx300_40tp":{cashYield:true,sig:{exitMA:300,exitBand:0.4,bearTP:10,bearMA:150}},"cx300_50":{cashYield:true,sig:{exitMA:300,exitBand:0.5}},"cx300_50tp":{cashYield:true,sig:{exitMA:300,exitBand:0.5,bearTP:10,bearMA:150}},
  "tp8m100":{cashYield:true,sig:{bearTP:8,bearMA:100}},"tp10m100":{cashYield:true,sig:{bearTP:10,bearMA:100}},"tp12m100":{cashYield:true,sig:{bearTP:12,bearMA:100}},"tp15m100":{cashYield:true,sig:{bearTP:15,bearMA:100}},"tp8m150":{cashYield:true,sig:{bearTP:8,bearMA:150}},"tp10m150":{cashYield:true,sig:{bearTP:10,bearMA:150}},"tp12m150":{cashYield:true,sig:{bearTP:12,bearMA:150}},"tp15m150":{cashYield:true,sig:{bearTP:15,bearMA:150}},"tp8m200":{cashYield:true,sig:{bearTP:8,bearMA:200}},"tp10m200":{cashYield:true,sig:{bearTP:10,bearMA:200}},"tp12m200":{cashYield:true,sig:{bearTP:12,bearMA:200}},"tp15m200":{cashYield:true,sig:{bearTP:15,bearMA:200}},
  b60:{cashYield:true,sig:{budget:1,bT:0.6}}, b70:{cashYield:true,sig:{budget:1,bT:0.7}}, b80:{cashYield:true,sig:{budget:1,bT:0.8}}, b90:{cashYield:true,sig:{budget:1,bT:0.9}},
  b70p1:{cashYield:true,sig:{budget:1,bT:0.7,bPow:1}}, b70n20:{cashYield:true,sig:{budget:1,bT:0.7,bN:20}},
  b70tp:{cashYield:true,sig:{budget:1,bT:0.7,bearTP:10,bearMA:150}}, b80tp:{cashYield:true,sig:{budget:1,bT:0.8,bearTP:10,bearMA:150}},
  x200:{cashYield:true,sig:{exitMA:200}}, x200b:{cashYield:true,sig:{exitMA:200,exitBand:.05,enterBand:.0}}, x200c:{cashYield:true,sig:{exitMA:200,exitBand:.03,enterBand:.03}},
  x150:{cashYield:true,sig:{exitMA:150}}, x150b:{cashYield:true,sig:{exitMA:150,exitBand:.05}}, x100b:{cashYield:true,sig:{exitMA:100,exitBand:.05}},
  x200tp:{cashYield:true,sig:{exitMA:200,exitBand:.05,bearTP:10,bearMA:150}},
  rev:{cashYield:true,reverse:true},
  dyn40:{cashYield:true,sig:{slowMA:150,slowDivs:40}}, dyn40m200:{cashYield:true,sig:{slowMA:200,slowDivs:40}}, dyn60:{cashYield:true,sig:{slowMA:150,slowDivs:60}},
  dyn40tp:{cashYield:true,sig:{slowMA:150,slowDivs:40,bearTP:10,bearMA:150}},
  bear40tp:{cashYield:true,sig:{bearDivs:40,bearMA:150,bearTP:10}},
  auto40:{cashYield:true,autoTp:true,sig:{bearDivs:40,bearMA:150}},
  autoDyn:{cashYield:true,autoTp:true,sig:{slowMA:150,slowDivs:40}},
  base:{}, yield:{cashYield:true},
  g200:{cashYield:true,sig:{gateMA:200}}, g150:{cashYield:true,sig:{gateMA:150}}, g100:{cashYield:true,sig:{gateMA:100}},
  bear40:{cashYield:true,sig:{bearDivs:40,bearMA:150}}, bear30:{cashYield:true,sig:{bearDivs:30,bearMA:150}},
  bear40m200:{cashYield:true,sig:{bearDivs:40,bearMA:200}},
  vol40:{cashYield:true,sig:{volDivs:40,volN:60,volHi:1.0}}, vol40b:{cashYield:true,sig:{volDivs:40,volN:60,volHi:0.85}},
  bearTP10:{cashYield:true,sig:{bearTP:10,bearMA:150}},
  autoTp:{cashYield:true,autoTp:true},
  div30:{cashYield:true,divs:30}, div40:{cashYield:true,divs:40},
};
const pick=process.argv[2]?process.argv[2].split(','):Object.keys(V);
(async()=>{ const TK=process.env.TK||'SOXL'; const {pg,close}=await open([{sym:TK}]);
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),TK); const Y0=+(process.env.Y0||2010), F0=all[0];
  const starts=[]; for(let y=Y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<all[20]) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>all[all.length-1]) continue; starts.push([s,e]); }
  const out={};
  for(const k of pick){ out[k]={};
    for(const cap of [10000,100000]){ const row={};
      for(const [nm,from] of [['full',F0],['s15',process.env.TK?'2003-01-01':'2015-01-01'],['s20',process.env.TK?'2010-03-11':'2020-01-01']]){ const r=await pg.evaluate(o=>RUN(o),Object.assign({cap,from,tkr:TK},V[k])); row[nm]=stats(r,cap); }
      const roll=[]; for(const [s,e] of starts){ const r=await pg.evaluate(o=>RUN(o),Object.assign({cap,from:s,to:e,tkr:TK},V[k])); const st=stats(r,cap); roll.push(st); }
      const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
      row.roll={n:roll.length, cagrMed:q(roll.map(x=>x.cagr),.5), cagrP10:q(roll.map(x=>x.cagr),.1), cagrMin:Math.min(...roll.map(x=>x.cagr)), mddMed:q(roll.map(x=>x.mdd),.5), mddP90:q(roll.map(x=>x.mdd),.9), mddMax:Math.max(...roll.map(x=>x.mdd))};
      out[k][cap]=row;
      const f=x=>x.toFixed(1);
      console.log(`${k.padEnd(11)} ${String(cap).padStart(6)} | 전체 ${f(row.full.cagr)}/${f(row.full.mdd)} | 15~ ${f(row.s15.cagr)}/${f(row.s15.mdd)} | 20~ ${f(row.s20.cagr)}/${f(row.s20.mdd)} | 5y롤링(${row.roll.n}) CAGR 중앙 ${f(row.roll.cagrMed)} 하위10% ${f(row.roll.cagrP10)} 최악 ${f(row.roll.cagrMin)} · MDD 중앙 ${f(row.roll.mddMed)} 상위10% ${f(row.roll.mddP90)} 최악 ${f(row.roll.mddMax)}`);
    } }
  fs.writeFileSync('grid1_'+(process.argv[3]||'out')+'.json',JSON.stringify(out));
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
