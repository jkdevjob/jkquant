// 11-10 사용자: "듀얼 5/6+무매 1/6 · 듀얼 5/6+섀넌 1/6 · 듀얼 100% — 앞으로의 반도체와 미국시장을 전망해서 3가지 경우로 미래를 예측해보자"
// pf_im6.js 결과(B 듀얼5/6+무매1/6 · C 듀얼5/6+섀넌1/6)와 pf_dual.js 섀넌100 결과(D 듀얼100% = W0.0 · 섀넌100% = W100.0)를 같은 창으로 붙여
// 창마다 국면 q = 섀넌100 ÷ 듀얼100(pf_dual_opt.js 와 같은 경계: 강세 >1.10 · 보통 0.90~1.10 · 약세 <0.90)으로 나누고
// 국면 = 시나리오(반도체 강세 / 보통 / 약세)로 보고 세 구성의 5년 분포 · 짝 비교 · 믿음(시나리오 확률)별 기대를 적는다.
// 시장 축(설명용): 그 창의 나스닥100 · SOX 5년 연수익(data/NDX.json · SOX.json · 실제 지수라 합성 창에도 그대로 붙인다).
// 사용: node pf_three_scen.js pf_im6_out.json pf_dual_s100.json data/
const fs=require('fs'),path=require('path');
const I=require(path.resolve(process.argv[2])), S=require(path.resolve(process.argv[3])), DD=process.argv[4]||path.join(__dirname,'data');
const qq=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];}, med=a=>qq(a,.5), mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const f1=x=>(x>=0?'+':'')+x.toFixed(1), p0=x=>(x*100).toFixed(0)+'%';
const r0=I.real['1만$'].rows[0], keys=Object.keys(r0).filter(k=>r0[k]&&typeof r0[k]==='object'&&'held' in r0[k]);
const KB=keys.includes('im')?'im':keys.find(k=>/무매/.test(k)), KC=keys.includes('iv')?'iv':keys.find(k=>/섀넌/.test(k)); if(!KB||!KC) throw Error('구성 이름 '+keys);   // pf_im6: im = 듀얼5/6+무매1/6 · iv = 듀얼5/6+섀넌1/6 · 원금은 줄 단위
const px=f=>{ const j=JSON.parse(fs.readFileSync(path.join(DD,f+'.json'),'utf8')); const a=j.ohlcTrade||j.series; const m={}; for(const x of a) if(+x.close>0) m[x.date]=+x.close; return {m,ds:Object.keys(m).sort()}; };
const NDX=px('NDX'), SOX=px('SOX');
const at=(P,d)=>{ let lo=0,hi=P.ds.length-1,ans=null; while(lo<=hi){ const mid=(lo+hi)>>1; if(P.ds[mid]<=d){ ans=P.ds[mid]; lo=mid+1; } else hi=mid-1; } return ans?P.m[ans]:null; };
const cagr5=(P,s,e)=>{ const a=at(P,s),b=at(P,e); return a&&b?(Math.pow(b/a,1/5)-1)*100:null; };
const REG=[['강세',q=>q>1.10],['보통',q=>q>=0.90&&q<=1.10],['약세',q=>q<0.90]];
const BEL=[['낙관(강세50·보통30·약세20)',[.5,.3,.2]],['기본(30·30·40)',[.3,.3,.4]],['비관(15·25·60)',[.15,.25,.6]]];
console.log(`구성: B = 듀얼5/6+무매1/6(${KB}) · C = 듀얼5/6+섀넌1/6(${KC}) · D = 듀얼 100%(W0.0) · 국면 q = 섀넌100(W100.0) ÷ D (5년 뒤 세후 평가액 · 들고 있음) · 자료 ~${I.real.end}`);
for(const lab of ['real','syn']) for(const cl of ['1만$','10만$']){
  const RI=I[lab][cl].rows, RS=S[lab][cl].rows; if(RI.length!==RS.length) throw Error('창 수 '+lab+cl);
  const W=RI.map((r,i)=>{ const s=RS[i]; if(r.s!==s.s) throw Error('창 어긋남 '+r.s+' '+s.s); const e=`${+r.s.slice(0,4)+5}${r.s.slice(4)}`;
    return {s:r.s,e,inflow:+r.inflow,B:r[KB],C:r[KC],D:s['W0.0'],q:s['W100.0'].held/s['W0.0'].held,ndx:cagr5(NDX,r.s,e),sox:cagr5(SOX,r.s,e)}; });
  console.log(`\n■ ${lab==='real'?'실제 2011-04~':'합성 2000-04~(닷컴·금융위기 포함)'} ${cl} · 5년 창 ${W.length}`);
  const by=REG.map(([n,f])=>[n,W.filter(x=>f(x.q))]);
  console.log('  국면: '+by.map(([n,a])=>`${n} ${a.length}(${p0(a.length/W.length)}) · 시작 ${[...new Set(a.map(x=>x.s.slice(0,4)))].join(',')||'—'}`).join(' | '));
  console.log('  국면별 시장(그 창의 5년 연수익 중앙 · 실제 지수): '+by.map(([n,a])=>{ const nd=a.map(x=>x.ndx).filter(v=>v!=null), sx=a.map(x=>x.sox).filter(v=>v!=null); return a.length?`${n} 나스닥100 ${f1(med(nd))}% · SOX ${f1(med(sx))}%`:`${n} —`; }).join(' | '));
  for(const [n,a] of by){ if(!a.length) continue;
    console.log(`  [${n}] 창 ${a.length}`);
    for(const k of ['B','C','D']){ const inf=x=>k==='D'?x.D.inflow:x.inflow, cg=a.map(x=>x[k].cagrH), md=a.map(x=>x[k].mdd), loss=a.filter(x=>x[k].held<inf(x)).length, half=a.filter(x=>x[k].held<inf(x)/2).length;
      console.log(`    ${k} 세후 연 중앙 ${f1(med(cg))}% · 하위10% ${f1(qq(cg,.1))}% · 최악 ${f1(Math.min(...cg))}% | MDD 중앙 ${med(md).toFixed(1)} · 최악 ${Math.max(...md).toFixed(1)} | 원금 아래 ${loss} · 반토막 ${half}`); }
    const pair=(x,y)=>{ const rat=a.map(w=>w[x].held/w[y].held); return `×${med(rat).toFixed(3)}(${p0(a.filter(w=>w[x].held>w[y].held).length/a.length)})`; };
    console.log(`    짝(앞÷뒤 · 앞이 높은 창): B÷D ${pair('B','D')} · C÷D ${pair('C','D')} · C÷B ${pair('C','B')}`);
    const wins={B:0,C:0,D:0}; for(const w of a){ let b='B'; for(const k of ['C','D']) if(w[k].held>w[b].held) b=k; wins[b]++; } console.log(`    1등: B ${wins.B} · C ${wins.C} · D ${wins.D}`); }
  const g=(a,k)=>a.length?mean(a.map(x=>Math.log(x[k].held/x.D.held))):0, E=(p,k)=>(Math.exp(by.reduce((s,[n,a],i)=>s+p[i]*g(a,k),0))-1)*100;
  console.log('  믿음(시나리오 확률)별 5년 기대 · 듀얼100% 대비(기하): '+BEL.map(([bn,p])=>`${bn} B ${f1(E(p,'B'))}% · C ${f1(E(p,'C'))}%`).join(' | '));
  const hist=by.map(([n,a])=>a.length/W.length); console.log(`  역사 빈도(${hist.map(p0).join('/')}) 기대: B ${f1(E(hist,'B'))}% · C ${f1(E(hist,'C'))}%`);
}
