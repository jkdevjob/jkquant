// 2~3 전략 조합 탐색(11-08) — 비중을 촘촘히 바꿔도 같은 결론인가(trio_legs 선형 곡선). 12칸(실제 전체·앞·뒤 · 합성 2000~05·2006~10·2011~ × 1만·10만) 짝 중앙 차의 최소값 · 중앙 MDD 조건
// 사용: node trio_wt.js trio_legs
const fs=require('fs'); const PFX=process.argv[2]||'trio_legs';
const I=JSON.parse(fs.readFileSync(PFX+'.json','utf8')), BIN=fs.readFileSync(PFX+'.bin'); const N=I.names;
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const blocks={}; for(const b of I.blocks){ if(b.kind!=='win') continue; const k=b.set+b.cap; (blocks[k]=blocks[k]||[]).push(b); } for(const k of Object.keys(blocks)) blocks[k].sort((a,b)=>a.s<b.s?-1:1);
const arrOf=b=>b.__a||(b.__a=new Float64Array(BIN.buffer.slice(BIN.byteOffset+b.off,BIN.byteOffset+b.off+b.n*I[b.set].legs.length*8)));
function ev(b,mix){ const legs=I[b.set].legs, n=b.n, a=arrOf(b); const cols=mix.map(([k])=>legs.indexOf(k)); if(cols.some(c=>c<0)) return null;
  let pk=0,md=0,v0=0,vT=0; for(let t=0;t<n;t++){ let v=0; for(let j=0;j<mix.length;j++) v+=mix[j][1]*a[cols[j]*n+t]; if(t===0){ v0=v; pk=v; } if(v>pk) pk=v; else md=Math.max(md,1-v/pk); vT=v; }
  const yrs=(Date.parse(b.dates[n-1])-Date.parse(b.dates[0]))/(365.25*864e5); return {c:(Math.pow(vT/v0,1/yrs)-1)*100,d:md*100,m:vT/v0,s:b.s}; }
const CELLS=[['real','ALL',s=>true],['real','A',s=>s<='2013-10-01'],['real','B',s=>s>='2018-10-01'],['syn','EARLY',s=>s<='2005-10-01'],['syn','MID',s=>s>='2006-01-01'&&s<='2010-10-01'],['syn','LATE',s=>s>='2011-01-01'],['syn','ALL',s=>true,'show']];
const CUR=[['IM',1/3],['P5',2/3]]; const cache={};
const sumOf=mix=>{ const out={}; for(const set of ['real','syn']) for(const cap of [10000,100000]){ const bs=blocks[set+cap]; const xs=bs.map(b=>ev(b,mix)), us=cache[set+cap]||(cache[set+cap]=bs.map(b=>ev(b,CUR)));
    for(const [s0,nm,f,only] of CELLS){ if(s0!==set) continue; const idx=bs.map((b,i)=>f(b.s)?i:-1).filter(i=>i>=0); if(xs.some(x=>!x)){ out[set+cap+nm]=null; continue; }
      const c=idx.map(i=>xs[i].c), d=idx.map(i=>xs[i].d), dc=idx.map(i=>xs[i].c-us[i].c);
      out[set+cap+nm]={show:!!only,cMed:med(c),cMin:Math.min(...c),mMed:med(d),mMax:Math.max(...d),dMed:med(dc),beat:dc.filter(x=>x>0).length/idx.length*100,uM:med(idx.map(i=>us[i].d)),uX:Math.max(...idx.map(i=>us[i].d)),half:idx.filter(i=>xs[i].m<0.5).length/idx.length*100}; } }
  return out; };
const line=(lab,mix)=>{ const S=sumOf(mix); const cells=Object.values(S).filter(x=>!x||!x.show); if(cells.some(x=>!x)) return lab+' 자료 없음'; const mn=Math.min(...cells.map(x=>x.dMed)); const mddOk=cells.every(x=>x.mMed<=x.uM+0.0001), mxOk=cells.every(x=>x.mMax<=x.uX+2);
  const a=S.real10000ALL, b=S.syn10000ALL, c=S.real100000ALL;
  return `${lab.padEnd(44)} 12칸 최소 ${(mn>=0?'+':'')+mn.toFixed(2)} ${mddOk?'MDD중앙OK':'MDD중앙↑'} ${mxOk?'':'최악MDD↑'} | 실제1만 ${a.cMed.toFixed(1)} −${a.mMed.toFixed(0)}/−${a.mMax.toFixed(0)} · 10만 ${c.cMed.toFixed(1)} −${c.mMed.toFixed(0)}/−${c.mMax.toFixed(0)} | 합성1만 ${b.cMed.toFixed(1)} −${b.mMed.toFixed(0)}/−${b.mMax.toFixed(0)} 최악 ${b.cMin.toFixed(1)} 반토막 ${b.half.toFixed(0)}%`; };
console.log(line('지금(무매 1/3 + 플랜 기본 2/3)',CUR));
for(const P of ['P5N','P5X']) for(const S of ['IVS_U','IVS_Uc','H_U','IM']){ console.log(`\n${N[P]} + ${N[S]}`); for(const w of [0.05,0.10,0.125,0.15,1/6,0.20,0.25,0.30,1/3,0.40,0.50]) console.log('  '+line(`${N[S]} ${(w*100).toFixed(1)}%`,[[P,1-w],[S,w]])); }
console.log('\n플랜 규칙 사이(새 ↔ 공격) + 섀넌 USD(현금) 1/6'); for(const x of [0,0.25,0.5,0.75,1]) console.log('  '+line(`새 ${(x*100).toFixed(0)}% : 공격 ${(100-x*100).toFixed(0)}% (플랜 5/6 안)`,[['P5N',5/6*x],['P5X',5/6*(1-x)],['IVS_Uc',1/6]]));
console.log('\n3개: 무매 + 플랜(공격) + 섀넌 USD(현금) 이웃'); for(const [a,c] of [[1/12,1/12],[1/12,1/6],[1/6,1/12],[1/6,1/6],[1/6,1/4],[1/4,1/6],[1/4,1/12],[1/12,1/4]]) console.log('  '+line(`무매 ${(a*100).toFixed(0)}% · 섀넌 ${(c*100).toFixed(0)}% · 플랜 ${((1-a-c)*100).toFixed(0)}%`,[['IM',a],['P5X',1-a-c],['IVS_Uc',c]]));
