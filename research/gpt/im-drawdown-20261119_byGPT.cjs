'use strict';
// Reuse the audited native-engine harness, changing only the preregistered signal.
const fs=require('node:fs'),path=require('node:path');
const p=path.join(__dirname,'im-speed-20261116_byGPT.cjs');
let s=fs.readFileSync(p,'utf8');
s=s.replace("const V={base:null,K7:.07,K6:.06,K8:.08,PL3:null},END='2026-11-13';",
  "const V={base:null,D10:.10,D8:.08,D12:.12,PL3:null},END='2026-11-18';");
s=s.replace("date:'2026-11-16'","date:'2026-11-19'");
const old="window.__ndxShock=d=>{let lo=0,hi=ndx.length;while(lo<hi){const m=(lo+hi)>>1;if(ndx[m].date<d)lo=m+1;else hi=m;}const i=lo-1;return i>=20?ndx[i].close/ndx[i-20].close-1:0;};";
const neu="window.__ndxShock=d=>{let lo=0,hi=ndx.length;while(lo<hi){const m=(lo+hi)>>1;if(ndx[m].date<d)lo=m+1;else hi=m;}const i=lo-1;if(i<20)return 0;let peak=0;for(let j=i-19;j<=i;j++)peak=Math.max(peak,ndx[j].close);return ndx[i].close/peak-1;};";
if(!s.includes(old))throw Error('audited harness shape changed');
s=s.replace(old,neu);
new Function('require','__dirname','process',s)(require,__dirname,process);
