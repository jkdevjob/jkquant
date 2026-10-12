// 무매 + 5년 플랜 (+ T-bill) 조합 — 실제(2011~) / 합성(2000~)
const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules'); const fs=require('fs');
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const toMap=eq=>{ const m={}; eq.forEach(([d,v])=>{ if(!d.endsWith('~')) m[d]=v; }); return m; };
function mix(sl,ws,reb){ const ds=Object.keys(sl[0]).filter(d=>sl.every(m=>m[d]>0)).sort(); let v=ws.map(w=>w*10000), yr=ds[0].slice(0,4), out=[];
  for(let k=0;k<ds.length;k++){ const d=ds[k]; if(k>0) v=v.map((x,i)=>x*sl[i][d]/sl[i][ds[k-1]]); if(reb&&d.slice(0,4)!==yr){ const t=v.reduce((a,b)=>a+b,0); v=ws.map(w=>w*t); yr=d.slice(0,4); } out.push([d,v.reduce((a,b)=>a+b,0)]); } return out; }
function roll(eq,y0){ const ds=eq.map(x=>x[0]); const R=[]; for(let y=y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>ds[ds.length-1]||s<ds[0]) continue; const sl=eq.filter(x=>x[0]>=s&&x[0]<e); R.push(stats(sl.map(([d,v])=>[d,v/sl[0][1]*10000]),10000)); } return R; }
const f=x=>x.toFixed(1);
for(const [lab,imf,P,R,G,from,y0] of [['실제',"im_eq.json",prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',2011],['합성',"im_eq_syn.json",prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',2000]]){
  const IM=JSON.parse(fs.readFileSync(imf)); const cap=10000;
  const pl=toMap(sim(P,Object.assign({cap,from},mk(P,R,G,{}))).eq);
  const tb={}; { let v=1, last=0, prev=null; const irx={}; JSON.parse(fs.readFileSync('data/IRX.json')).series.forEach(x=>irx[x.date]=x.close); Object.keys(pl).sort().forEach(d=>{ if(irx[d]!=null) last=irx[d]; if(prev){ const g=Math.round((Date.parse(d)-Date.parse(prev))/864e5); v*=1+Math.max(0,last/100-0.0009)*(1-0.154)*g/365; } prev=d; tb[d]=v; }); }
  for(const imKey of ['yield','tp10']){ const im=toMap(IM[imKey+'_'+cap]);
    console.log(`\n■ ${lab} · 무매 ${imKey} · 1만$`);
    for(const [ws,nm] of [[[1,0,0],'무매 100'],[[0,1,0],'플랜 100'],[[.5,.5,0],'무매50 플랜50'],[[.3,.5,.2],'무매30 플랜50 T빌20'],[[.25,.5,.25],'무매25 플랜50 T빌25'],[[.2,.6,.2],'무매20 플랜60 T빌20'],[[.4,.4,.2],'무매40 플랜40 T빌20']]){
      const eq=mix([im,pl,tb],ws,true), s=stats(eq,10000), Rr=roll(eq,y0);
      console.log(`  ${nm.padEnd(18)} 연리밸 | ${eq[0][0]}~ CAGR ${f(s.cagr)} MDD ${f(s.mdd)} MAR ${(s.cagr/s.mdd).toFixed(2)} | 5y롤링 CAGR 중앙 ${f(q(Rr.map(x=>x.cagr),.5))} 하위10% ${f(q(Rr.map(x=>x.cagr),.1))} 최악 ${f(Math.min(...Rr.map(x=>x.cagr)))} · MDD 중앙 ${f(q(Rr.map(x=>x.mdd),.5))} 최악 ${f(Math.max(...Rr.map(x=>x.mdd)))}`); } } }
