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
  rev:{cashYield:true,reverse:true}, revNoY:{reverse:true}, aRev:{autoTp:true,reverse:true},
  dyn40:{cashYield:true,sig:{slowMA:150,slowDivs:40}}, dyn40m200:{cashYield:true,sig:{slowMA:200,slowDivs:40}}, dyn60:{cashYield:true,sig:{slowMA:150,slowDivs:60}},
  dyn40tp:{cashYield:true,sig:{slowMA:150,slowDivs:40,bearTP:10,bearMA:150}},
  bear40tp:{cashYield:true,sig:{bearDivs:40,bearMA:150,bearTP:10}},
  auto40:{cashYield:true,autoTp:true,sig:{bearDivs:40,bearMA:150}},
  autoDyn:{cashYield:true,autoTp:true,sig:{slowMA:150,slowDivs:40}},
  sgW5:{sgov:{mode:'week',k:5}}, sgW10:{sgov:{mode:'week',k:10}}, sgW20:{sgov:{mode:'week',k:20}}, sgC5:{sgov:{mode:'cyc',k:5}}, sgC10:{sgov:{mode:'cyc',k:10}}, sgC20:{sgov:{mode:'cyc',k:20}},
  sgW10f:{sgov:{mode:'week',k:10,fee:0.0008}}, sgC10f:{sgov:{mode:'cyc',k:10,fee:0.0008}},
  aSgW10:{autoTp:true,sgov:{mode:'week',k:10}}, aSgC10:{autoTp:true,sgov:{mode:'cyc',k:10}}, aSgC10f:{autoTp:true,sgov:{mode:'cyc',k:10,fee:0.0008}},
  aNoWeak:{cashYield:true,autoTp:true,auto:{noWeak:true}}, aNoHot:{cashYield:true,autoTp:true,auto:{A:{retHi:1e9}}}, aNoM1:{cashYield:true,autoTp:true,auto:{M:{below:99}}},
  aR80:{cashYield:true,autoTp:true,auto:{A:{retHi:80}}}, aR120:{cashYield:true,autoTp:true,auto:{A:{retHi:120}}}, aV80:{cashYield:true,autoTp:true,auto:{A:{volHi:80}}}, aV100:{cashYield:true,autoTp:true,auto:{A:{volHi:100}}},
  aM05:{cashYield:true,autoTp:true,auto:{M:{below:0.05}}}, aM15:{cashYield:true,autoTp:true,auto:{M:{below:0.15}}}, aM20:{cashYield:true,autoTp:true,auto:{M:{below:0.20}}}, aMma100:{cashYield:true,autoTp:true,auto:{M:{maLen:100}}}, aMma200:{cashYield:true,autoTp:true,auto:{M:{maLen:200}}},
  aLo8:{cashYield:true,autoTp:true,auto:{A:{lo:8}}}, aLo12:{cashYield:true,autoTp:true,auto:{A:{lo:12}}}, aLo15:{cashYield:true,autoTp:true,auto:{A:{lo:15}}}, aMa100:{cashYield:true,autoTp:true,auto:{A:{maLen:100}}}, aMa200:{cashYield:true,autoTp:true,auto:{A:{maLen:200}}},
  nwM05:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{below:0.05}}}, nwM15:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{below:0.15}}}, nwMma100:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{maLen:100}}}, nwMma200:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{maLen:200}}}, nwNoHot:{cashYield:true,autoTp:true,auto:{noWeak:true,A:{retHi:1e9}}}, nwSgC10f:{autoTp:true,auto:{noWeak:true},sgov:{mode:'cyc',k:10,fee:0.0008}},
  autoNoY:{autoTp:true},
  m1tp:{cashYield:true,autoTp:true,m1:{mode:'tpOnly'}}, m1star:{cashYield:true,autoTp:true,m1:{mode:'starOnly'}}, m1pause:{cashYield:true,autoTp:true,m1:{mode:'pause'}}, m1pauseTp:{cashYield:true,autoTp:true,m1:{mode:'pauseTp'}}, m1age20:{cashYield:true,autoTp:true,m1:{maxAge:20}}, m1age40:{cashYield:true,autoTp:true,m1:{maxAge:40}},
  tpAll:{cashYield:true,autoTp:true,m1:{mode:'tpOnly',all:true}}, tpAllNoM1:{cashYield:true,autoTp:true,auto:{M:{below:99}},m1:{all:true}},
  m1tpM05:{cashYield:true,autoTp:true,m1:{mode:'tpOnly'},auto:{M:{below:0.05}}}, m1tpM15:{cashYield:true,autoTp:true,m1:{mode:'tpOnly'},auto:{M:{below:0.15}}}, m1tpMa100:{cashYield:true,autoTp:true,m1:{mode:'tpOnly'},auto:{M:{maLen:100}}}, m1tpMa200:{cashYield:true,autoTp:true,m1:{mode:'tpOnly'},auto:{M:{maLen:200}}},
  tpAllM05:{cashYield:true,autoTp:true,m1:{mode:'tpOnly',all:true},auto:{M:{below:0.05}}}, tpAllM15:{cashYield:true,autoTp:true,m1:{mode:'tpOnly',all:true},auto:{M:{below:0.15}}}, tpAllMa100:{cashYield:true,autoTp:true,m1:{mode:'tpOnly',all:true},auto:{M:{maLen:100}}}, tpAllMa200:{cashYield:true,autoTp:true,m1:{mode:'tpOnly',all:true},auto:{M:{maLen:200}}},
  m1tpNoY:{autoTp:true,m1:{mode:'tpOnly'}}, tpAllNoY:{autoTp:true,m1:{mode:'tpOnly',all:true}},
  m1slope:{cashYield:true,autoTp:true,m1:{slope20:'m1'}}, slopeAll:{cashYield:true,autoTp:true,m1:{slope20:'all'}}, m1slopeM05:{cashYield:true,autoTp:true,m1:{slope20:'m1'},auto:{M:{below:0.05}}}, m1slopeM15:{cashYield:true,autoTp:true,m1:{slope20:'m1'},auto:{M:{below:0.15}}}, m1slopeMa200:{cashYield:true,autoTp:true,m1:{slope20:'m1'},auto:{M:{maLen:200}}}, slopeAllM15:{cashYield:true,autoTp:true,m1:{slope20:'all'},auto:{M:{below:0.15}}},
  gTp:{sig:{guard:{tp:10}}}, gTpM200:{sig:{guard:{tp:10,ma:200}}}, gTpM250:{sig:{guard:{tp:10,ma:250}}}, gTpB0:{sig:{guard:{tp:10,band:0}}}, gTpB3:{sig:{guard:{tp:10,band:0.03}}}, gTp12:{sig:{guard:{tp:12}}}, gTp8:{sig:{guard:{tp:8}}},
  gBig0:{sig:{guard:{big:0}}}, gBig5:{sig:{guard:{big:5}}}, gBigm5:{sig:{guard:{big:-5}}}, gTpBig0:{sig:{guard:{tp:10,big:0}}},
  bearTp:{sig:{bearTP:10,bearMA:150}}, aGTp:{autoTp:true,sig:{guard:{tp:10}}}, aGBig0:{autoTp:true,sig:{guard:{big:0}}},
  aGTpM200:{autoTp:true,sig:{guard:{tp:10,ma:200}}}, aGTpM250:{autoTp:true,sig:{guard:{tp:10,ma:250}}}, aGTpB3:{autoTp:true,sig:{guard:{tp:10,band:0.03}}}, aGTpB0:{autoTp:true,sig:{guard:{tp:10,band:0}}},
  aGTpS:{autoTp:true,sig:{guard:{tp:10,sym:'SYNTQQQ'}}}, gTpS:{sig:{guard:{tp:10,sym:'SYNTQQQ'}}},
  m1rev40:{autoTp:true,m1:{revertAfter:40}}, m1rev60:{autoTp:true,m1:{revertAfter:60}}, m1rev90:{autoTp:true,m1:{revertAfter:90}}, m1rev120:{autoTp:true,m1:{revertAfter:120}}, m1rev180:{autoTp:true,m1:{revertAfter:180}},
  base:{}, yield:{cashYield:true},
  // 잔금 이자 — 매매 없는 경로(달러 RP·외화 MMF 자동 스윕 가정): 수수료 0 · 금리 = T-bill − cashSpread · 이자소득세 15.4%
  rp50:{autoTp:true,cashYield:true,cashSpread:0.005}, rp75:{autoTp:true,cashYield:true,cashSpread:0.0075}, rp100:{autoTp:true,cashYield:true,cashSpread:0.01}, rp150:{autoTp:true,cashYield:true,cashSpread:0.015},
  bRp50:{cashYield:true,cashSpread:0.005}, bRp100:{cashYield:true,cashSpread:0.01},
  // 위를 '주 1회 손으로 옮김'으로(수시형 달러 RP 가정 · 수수료 0 · 현금은 k일치만 남김 · 모자라면 꺼냄) — sgov 고리에 spread 를 줘서
  rpW5:{autoTp:true,sgov:{mode:'week',k:5,fee:0,spread:0.005}}, rpW7:{autoTp:true,sgov:{mode:'week',k:7,fee:0,spread:0.005}}, rpW10:{autoTp:true,sgov:{mode:'week',k:10,fee:0,spread:0.005}}, rpC10:{autoTp:true,sgov:{mode:'cyc',k:10,fee:0,spread:0.005}},
  rpW5s1:{autoTp:true,sgov:{mode:'week',k:5,fee:0,spread:0.01}}, rpW7s1:{autoTp:true,sgov:{mode:'week',k:7,fee:0,spread:0.01}},
  g200:{cashYield:true,sig:{gateMA:200}}, g150:{cashYield:true,sig:{gateMA:150}}, g100:{cashYield:true,sig:{gateMA:100}},
  bear40:{cashYield:true,sig:{bearDivs:40,bearMA:150}}, bear30:{cashYield:true,sig:{bearDivs:30,bearMA:150}},
  bear40m200:{cashYield:true,sig:{bearDivs:40,bearMA:200}},
  vol40:{cashYield:true,sig:{volDivs:40,volN:60,volHi:1.0}}, vol40b:{cashYield:true,sig:{volDivs:40,volN:60,volHi:0.85}},
  bearTP10:{cashYield:true,sig:{bearTP:10,bearMA:150}},
  autoTp:{cashYield:true,autoTp:true},
  div30:{cashYield:true,divs:30}, div40:{cashYield:true,divs:40},
};
const pick=process.argv[2]?process.argv[2].split(','):Object.keys(V);
(async()=>{ const TK=process.env.TK||'SOXL'; const {pg,close}=await open([{sym:TK}].concat((process.env.EXTRA||'').split(',').filter(Boolean).map(sym=>({sym}))));
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
