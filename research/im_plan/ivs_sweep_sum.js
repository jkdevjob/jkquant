// ivs_sweep.js 판정 — 사전 등록(RESEARCH_LOG 11-09) 기준 1~5 그대로. 사용: node ivs_sweep_sum.js ivs_sweep_out.json
const R=require(require('path').resolve(process.argv[2]||'ivs_sweep_out.json'));
const B=R.meta.base, V=R.meta.vars, qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qq(a,.5);
const f3=x=>x.toFixed(3), p0=x=>x.toFixed(0)+'%';
const st=(lab,cl,k,flt=()=>true)=>{ const rows=R[lab][cl].filter(r=>flt(r.s)); const rat=rows.map(r=>r.v[k].held/r.v[B].held);
  return {n:rows.length,rat:med(rat),win:rows.filter(r=>r.v[k].held>r.v[B].held).length/rows.length*100,
    mddW:Math.max(...rows.map(r=>r.v[k].mdd)),mddM:med(rows.map(r=>r.v[k].mdd)),half:rows.filter(r=>r.v[k].held<r.inflow*.5).length,
    liq:med(rows.map(r=>r.v[k].liq/r.v[B].liq)),leg:med(rows.map(r=>r.v[k].leg/r.v[B].leg)),legMdd:med(rows.map(r=>r.v[k].legMdd))}; };
const CAPS=R.meta.caps.map(c=>c[0]);
const S={}; for(const k of V){ S[k]={}; for(const lab of ['real','syn']) for(const cl of CAPS){ S[k][lab+cl]=st(lab,cl,k);
    if(lab==='real'){ S[k][lab+cl+'a']=st(lab,cl,k,s=>s<'2016-01-01'); S[k][lab+cl+'b']=st(lab,cl,k,s=>s>='2016-01-01'); } } }
const c1=k=>CAPS.every(c=>S[k]['real'+c].rat>=1.005&&S[k]['real'+c].win>=60);
const c2=k=>CAPS.every(c=>S[k]['real'+c+'a'].rat>=1&&S[k]['real'+c+'b'].rat>=1);
const c3=k=>CAPS.every(c=>S[k]['syn'+c].rat>=1&&S[k]['syn'+c].mddW<=S[B]['syn'+c].mddW+1&&S[k]['syn'+c].half<=S[B]['syn'+c].half);
const c4=k=>CAPS.every(c=>S[k]['real'+c].mddW<=S[B]['real'+c].mddW+1);
const parse=k=>{ const m=k.match(/^iv s(\d+) L(\d+) b(\d+) (\S+)$/); if(m) return {mode:'iv',s0:+m[1],L:+m[2],b:+m[3],p:m[4]}; const g=k.match(/^고정5:5 b(\d+) (\S+)$/); return {mode:'fix',b:+g[1],p:g[2]}; };
const SS=[35,40,45,50,55,60], LL=[20,40,60,90], BB=[5,10,15,20];
const nb=k=>{ const x=parse(k), out=[], adj=(arr,v)=>[arr[arr.indexOf(v)-1],arr[arr.indexOf(v)+1]].filter(z=>z!=null);
  if(x.mode==='iv'){ for(const s of adj(SS,x.s0)) out.push(`iv s${s} L${x.L} b${x.b} ${x.p}`); for(const l of adj(LL,x.L)) out.push(`iv s${x.s0} L${l} b${x.b} ${x.p}`); for(const b of adj(BB,x.b)) out.push(`iv s${x.s0} L${x.L} b${b} ${x.p}`); }
  else for(const b of adj(BB,x.b)) out.push(`고정5:5 b${b} ${x.p}`);
  return out.filter(z=>S[z]); };
const c5=k=>{ const n=nb(k); return n.length>0&&n.filter(c1).length>=n.length/2; };
const all=V.filter(k=>k!==B), pass={c1:all.filter(c1),c2:all.filter(c2),c3:all.filter(c3),c4:all.filter(c4)};
const fin=all.filter(k=>c1(k)&&c2(k)&&c3(k)&&c4(k)&&c5(k));
console.log(`기준: ${B} — 실제 1만$ 조합 MDD 중앙 ${S[B]['real1만$'].mddM.toFixed(1)} · 최악 ${S[B]['real1만$'].mddW.toFixed(1)} | 합성 1만$ 최악 ${S[B]['syn1만$'].mddW.toFixed(1)} · 반토막 ${S[B]['syn1만$'].half} · 10만$ 최악 ${S[B]['syn10만$'].mddW.toFixed(1)} · 반토막 ${S[B]['syn10만$'].half}`);
console.log(`후보 ${all.length} · 기준1 통과 ${pass.c1.length} · 기준2 ${pass.c2.length} · 기준3 ${pass.c3.length} · 기준4 ${pass.c4.length} · 1~5 모두 ${fin.length}`);
const row=k=>{ const s=S[k]; return `${k.padEnd(22)} 실제 1만$ ×${f3(s['real1만$'].rat)}(${p0(s['real1만$'].win)}) · 10만$ ×${f3(s['real10만$'].rat)}(${p0(s['real10만$'].win)}) | 앞/뒤 ${f3(Math.min(s['real1만$a'].rat,s['real10만$a'].rat))}/${f3(Math.min(s['real1만$b'].rat,s['real10만$b'].rat))} | 합성 ×${f3(s['syn1만$'].rat)} · ×${f3(s['syn10만$'].rat)} · 최악MDD ${s['syn1만$'].mddW.toFixed(1)}/${s['syn10만$'].mddW.toFixed(1)} · 반토막 ${s['syn1만$'].half}/${s['syn10만$'].half} | 실제 최악MDD ${s['real1만$'].mddW.toFixed(1)}/${s['real10만$'].mddW.toFixed(1)} | 다 팔면 ×${f3(s['real1만$'].liq)} | 다리만 ×${f3(s['real1만$'].leg)} · 다리 MDD ${s['real1만$'].legMdd.toFixed(0)} | ${[c1,c2,c3,c4,c5].map((c,i)=>c(k)?'✓':'·').join('')}`; };
console.log('\n■ 1~5 모두 통과'+(fin.length?'':' — 없음')); fin.sort((a,b)=>Math.min(S[b]['real1만$'].rat,S[b]['real10만$'].rat)-Math.min(S[a]['real1만$'].rat,S[a]['real10만$'].rat)).forEach(k=>console.log('  '+row(k)));
console.log('\n■ 실제 수익 상위 12(1만$·10만$ 중 작은 쪽 짝 비 · 기준 판정 ✓·)'); all.slice().sort((a,b)=>Math.min(S[b]['real1만$'].rat,S[b]['real10만$'].rat)-Math.min(S[a]['real1만$'].rat,S[a]['real10만$'].rat)).slice(0,12).forEach(k=>console.log('  '+row(k)));
console.log('\n■ 합성 수익 상위 8'); all.slice().sort((a,b)=>Math.min(S[b]['syn1만$'].rat,S[b]['syn10만$'].rat)-Math.min(S[a]['syn1만$'].rat,S[a]['syn10만$'].rat)).slice(0,8).forEach(k=>console.log('  '+row(k)));
// 축마다 평균 효과(그 값의 후보들 짝 비 중앙의 중앙) — 방향 보기
const ax=(name,vals,get)=>console.log(`  ${name}: `+vals.map(v=>{ const ks=all.concat([B]).filter(k=>{ const x=parse(k); return x.mode==='iv'&&get(x)===v; }); return `${v} 실제 ×${f3(med(ks.map(k=>Math.min(S[k]['real1만$'].rat,S[k]['real10만$'].rat))))} 합성 ×${f3(med(ks.map(k=>Math.min(S[k]['syn1만$'].rat,S[k]['syn10만$'].rat))))}`; }).join(' · '));
console.log('\n■ 축마다(역분산 후보 · 1만$·10만$ 중 작은 쪽 짝 비의 중앙)');
ax('s0',SS,x=>x.s0); ax('룩백',LL,x=>x.L); ax('밴드',BB,x=>x.b); ax('예수금',['국채','1배수'],x=>x.p);
console.log('\n■ 고정 5:5'); all.filter(k=>k.startsWith('고정')).forEach(k=>console.log('  '+row(k)));
