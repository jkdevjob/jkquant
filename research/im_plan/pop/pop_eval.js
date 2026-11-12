// 시중 매매법 5년 창 비교(11-12) — sim.js(앱과 같은 체결·세후 규약) · 듀얼 가드 v1.1/v1.0 짝은 planrule/reentry_eval.js 출력(같은 창 · 같은 규모 · 같은 세후)에서 읽는다.
// 실제: 2011-04~2021-11 매달 시작 5년 창(128) · 합성(레버리지 규칙만 · SYN* · 창마다 시작가 100): 2000-06~ 시작(듀얼 가드 합성 창과 같은 날)
// 사용: REF_REAL=re_real.json REF_SYN=re_syn.json node pop_eval.js [out.json]   env: DS=real,syn · SETS='2.5만,1억,1만,10만' · KEYS=HFEA,LRS_N3,...
const fs=require('fs'); const {run}=require('./sim'); const {S}=require('./strats');
const OUT=process.argv[2]||'pop_out.json', DS=(process.env.DS||'real,syn').split(','), SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
const KEYS=(process.env.KEYS||Object.keys(S).join(',')).split(',').filter(k=>S[k]);
const CFG={'2.5만':[25000,210],'1억':[69244,69.24],'1만':[10000,0],'10만':[100000,0]};
const SYNMAP={HFEA:{UPRO:'SYNUPRO',TMF:'SYNTMF'},LRS_N3:{QQQ:'SYNQQQ',TQQQ:'SYNTQQQ',BIL:'SYNBIL'},LRS_S3:{SPY:'SYNSPY',UPRO:'SYNUPRO',BIL:'SYNBIL'},LRS_S2:{SPY:'SYNSPY',SSO:'SYNSSO',BIL:'SYNBIL'},
  LRS_N2:{QQQ:'SYNQQQ',QLD:'SYNQLD',BIL:'SYNBIL'},BH_TQQQ:{TQQQ:'SYNTQQQ'},BH_QQQ:{QQQ:'SYNQQQ'},BH_SPY:{SPY:'SYNSPY'},BH_UPRO:{UPRO:'SYNUPRO'},NINESIG:{TQQQ:'SYNTQQQ',AGG:'SYNAGG',SPY:'SYNSPY',QQQ:'SYNQQQ'}};
for(const k of Object.keys(S)) if(S[k].syn) SYNMAP[k]=S[k].syn;
const REF={real:process.env.REF_REAL?JSON.parse(fs.readFileSync(process.env.REF_REAL)).real:null, syn:process.env.REF_SYN?JSON.parse(fs.readFileSync(process.env.REF_SYN)).syn:null};
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d), g=(x,d=1)=>x.toFixed(d);
const DSET={real:{s0:'2011-04-01',last:'2026-11-10',half:'2016-04-01',rescale:false},syn:{s0:'2000-06-01',last:'2026-11-10',half:'2011-01-01',rescale:true}};
const res={meta:{made:new Date().toISOString(),keys:KEYS}};
for(const ds of DS){ const X=DSET[ds]; res[ds]={};
  for(const set of SETS){ const [P,M]=CFG[set]; res[ds][set]={}; const ref=REF[ds]&&REF[ds][set]; const rmap={}; if(ref) ref.forEach(r=>rmap[r.s]=r);
    const head=ref?`듀얼 가드 v1.1 세후 연 중앙 ${g(qq(ref.map(r=>r.panic.a),.5))} · 최악 ${g(Math.min(...ref.map(r=>r.panic.a)))} · MDD 중앙 ${g(qq(ref.map(r=>r.panic.m),.5))} · 최악 ${g(Math.max(...ref.map(r=>r.panic.m)))} (v1.0 ${g(qq(ref.map(r=>r.base.a),.5))})`:'(듀얼 가드 짝 없음)';
    console.log(`\n■ ${ds} ${set} · ${head}`);
    for(const k of KEYS){ if(ds==='syn'&&!SYNMAP[k]) continue; const rows=[];
      for(let s=X.s0; addM(s,60)<=X.last; s=addM(s,1)){ const e=addM(s,60); const r=run(S[k],{start:s,end:e,principal:P,monthly:M,rescale:X.rescale,map:ds==='syn'?SYNMAP[k]:null}); if(!r||r.error) continue;
        rows.push({s,a:r.ann,m:r.mdd,n:r.nTr/r.yrs}); }
      res[ds][set][k]=rows; if(!rows.length){ console.log(`  ${k}: 창 없음`); continue; }
      let pair=''; if(ref){ const pr=rows.filter(r=>rmap[r.s]); const d=pr.map(r=>r.a-rmap[r.s].panic.a), h1=pr.filter(r=>r.s<X.half).map(r=>r.a-rmap[r.s].panic.a), h2=pr.filter(r=>r.s>=X.half).map(r=>r.a-rmap[r.s].panic.a);
        const bb=pr.filter(r=>r.a>rmap[r.s].panic.a&&r.m<=rmap[r.s].panic.m).length, bw=pr.filter(r=>r.a<rmap[r.s].panic.a&&r.m>rmap[r.s].panic.m).length;
        pair=` | v1.1 대비 연 차 중앙 ${f(qq(d,.5))} · 높은 창 ${(d.filter(x=>x>0).length/d.length*100).toFixed(0)}% · 앞/뒤 ${f(qq(h1,.5))}/${f(qq(h2,.5))} · 둘다 나음:나쁨 ${bb}:${bw}`; }
      console.log(`  ${k.padEnd(8)} ${S[k].name.padEnd(22)} 창 ${rows.length} · 세후 연 중앙 ${g(qq(rows.map(r=>r.a),.5))} · 하10 ${g(qq(rows.map(r=>r.a),.1))} · 최악 ${g(Math.min(...rows.map(r=>r.a)))} · MDD 중앙 ${g(qq(rows.map(r=>r.m),.5))} · 최악 ${g(Math.max(...rows.map(r=>r.m)))} · 매매 ${g(qq(rows.map(r=>r.n),.5))}/년${pair}`); } }
  fs.writeFileSync(OUT,JSON.stringify(res)); }
console.error('→ '+OUT);
