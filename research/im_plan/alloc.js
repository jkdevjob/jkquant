// 3만$ 배분 비교(사용자 질문 10-20): 무매 100% · 무매 1만 + 플랜 2만(따로 · 연 1회 리밸) · 플랜 100% — 실제 엔진(runIM) + 플랜(px) · 비용·세금 포함 · node alloc.js
// 10-28: 플랜은 앱 조건으로(OLDPLAN 기본 = 지금 앱 · NEWPLAN 기본 = Guard −3% + TECL 비대칭 + TQQQ 연 1회 맞춤 · 둘 다 수수료 0.1%) · 합성 무매는 SYNSOXL_S · 합성 플랜은 소수 주(10-21 고침)
const path=__dirname+'/';
const {open}=require(path+'imh'); const {prep,sim,stats}=require(path+'px'); const {mk}=require(path+'plan_rules');
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }; const f=x=>x.toFixed(1);
const IMO={autoTp:true};   // 앱 '익절 자동' · 20분할 · 복리 · 리버스 OFF · 이자 없음
function mixYear(a,b,w){ // a,b: {d:v} 두 계좌, 매년 첫 거래일 비중 w 로 맞춤(옮긴 금액 0.25%)
  const ds=Object.keys(b).filter(d=>a[d]!=null).sort(); let x=w, y=1-w, yr=ds[0].slice(0,4); const out=[[ds[0],1]];
  for(let k=1;k<ds.length;k++){ const d=ds[k], p=ds[k-1]; x*=a[p]>0?a[d]/a[p]:1; y*=b[p]>0?b[d]/b[p]:1;
    if(d.slice(0,4)!==yr){ yr=d.slice(0,4); const t=x+y, m=x-t*w; x-=m; y+=m-Math.abs(m)*0.0025; } out.push([d,x+y]); }
  return out; }
const sum=(a,b)=>Object.keys(b).filter(d=>a[d]!=null).sort().map(d=>[d,a[d]+b[d]]);
const toMap=eq=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); return m; };
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  const runIM=(o)=>pg.evaluate(o=>{ const r=RUN(o); return r.eqs.map(x=>[x[0],x[1]]); },o);
  for(const [lab,TK,P,R,G,starts,winY0] of [['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ',[['2011~(전체)','2011-01-01'],['2022-01~(화면과 같은 4.8년)','2022-01-03']],2011],['합성','SYNSOXL_S',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ',[['2000~(닷컴·2008 포함)','2000-01-03']],2000]]){
    const planOf=(cap,from,to,p)=>{ p=p||{}; const o=Object.assign({cap,from,to},mk(P,R,G,p)); if(p.fee!=null) o.fee=p.fee; if(lab==='합성') o.frac=true; return toMap(sim(P,o).eq); };
    const OP=JSON.parse(process.env.OLDPLAN||'{"gsb":1e9,"fee":0.001}');   // 지금 플랜(기본: 앱 그대로 — TQQQ 는 Guard 바뀔 때만 · 수수료 0.1%)
    const NP=JSON.parse(process.env.NEWPLAN||'{"gbOn":0.01,"gbOff":0.03,"sbDn":0,"sbUp":0.15,"gReb":"y","fee":0.001}');   // 새 플랜(기본: Guard −3% + TECL 비대칭 + TQQQ 연 1회 · 앱 조건)
    const cases=async(from,to)=>{ const pl0=planOf(20000,from,to,OP), pl0b=planOf(30000,from,to,OP), plg=planOf(20000,from,to,NP), plgb=planOf(30000,from,to,NP);
      const d0=Object.keys(pl0).sort()[0]; const im10=toMap(await runIM(Object.assign({cap:10000,tkr:TK,from:d0,to},IMO))), im30=toMap(await runIM(Object.assign({cap:30000,tkr:TK,from:d0,to},IMO)));
      const norm=m=>Object.keys(m).sort().map(d=>[d,m[d]]);
      return { '무매 100% (3만)':norm(im30), '무매1만+플랜2만 따로':sum(im10,pl0), '무매1만+플랜2만 연1회':mixYear(im10,pl0,1/3), '플랜 100% (3만)':norm(pl0b), '무매1만+새플랜2만 따로':sum(im10,plg), '무매1만+새플랜2만 연1회':mixYear(im10,plg,1/3), '새플랜 100%':norm(plgb) }; };
    for(const [nm,from] of starts){ const C=await cases(from); console.log(`\n■ ${lab} ${nm}`);
      for(const [k,eq] of Object.entries(C)){ const s=stats(eq,eq[0][1]); console.log(`  ${k.padEnd(22)} CAGR ${f(s.cagr)}% · MDD ${f(s.mdd)}% · 최종 ${f(eq[eq.length-1][1]/eq[0][1])}배`); } }
    // 5년 롤링(창마다 새로 시작)
    const last=Object.keys(planOf(20000,'1990-01-01',undefined,OP)).sort().pop(); const R5={};
    for(let y=winY0;y<=2021;y++) for(let m=1;m<=12;m+=3){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue;
      const C=await cases(s,e); for(const [k,eq] of Object.entries(C)){ if(eq.length<100) continue; (R5[k]=R5[k]||[]).push(stats(eq,eq[0][1])); } }
    console.log(`  — 5년 롤링(분기마다 시작, ${Object.values(R5)[0].length}개 창)`);
    for(const [k,a] of Object.entries(R5)) console.log(`  ${k.padEnd(22)} CAGR 중앙 ${f(q(a.map(x=>x.cagr),.5))} 하위10% ${f(q(a.map(x=>x.cagr),.1))} 최악 ${f(Math.min(...a.map(x=>x.cagr)))} · MDD 중앙 ${f(q(a.map(x=>x.mdd),.5))} 최악 ${f(Math.max(...a.map(x=>x.mdd)))} · 손실 창 ${a.filter(x=>x.cagr<0).length}개`); }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
