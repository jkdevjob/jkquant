#!/usr/bin/env node
/* 모의 목록 표 — 세션마다 저장 (v3.136.0 · 2026-11-12 사용자: "표를 세션마다 따로 저장하면 새로 만든 세션 하나만 계산" → "어 해")
 *  index.html 의 실제 함수(paperRowKey · paperRowSig · paperRowCut · paperViewPlan · paperViewKeys · paperViewCacheRead ·
 *  paperViewCacheWrite · paperViewCacheFresh · refreshPaperView · paperPrefetchQuotes · paperFillAll)를 떼어 vm 에서 돌린다.
 *   A 처음(옛 판 캐시) — 전부 센다 · 표지(keys)를 세션마다 남긴다
 *   B 그대로 다시 열기 — 하나도 안 센다(채우기 0번)
 *   C 새 세션 — 그 세션 하나만 센다 · 나머지 줄은 값 그대로 다시 쓴다 · 재생이 기록을 늘려도 다음 열기는 안 센다
 *   D 한 세션 기록이 바뀜 — 그 세션만 · E 이름 바꿈 — 그 세션만
 *   F 미국 종가 확정(기준일 +1 평일) — 달러 세션 전부 · 원화 세션은 그대로
 *   G 주말(토·일 기준일) — 금요일로 당겨 안 센다
 *   H 시세 못 받은 줄 — 표지가 같아도 다시 · I 지운 세션 — 줄만 빼고 안 센다 · J 줄이 안 나온 세션 — 표지가 같으면 다시 안 셈
 *   K 공통 원화 원금 바뀜 — 전부 · L 듀얼가드 엔진 판 바뀜 — 듀얼가드 세션만 · M 강제(전체 적용·오늘 갱신) — 전부
 *   N 시세 선취 · 채우기가 고른 세션 것만(진행 n / N 의 N 도 고른 수)
 *  변이(옛 코드 · 빠뜨림)마다 값 단언이 빨간불인지 본다.
 */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const IDX=process.argv[2]||path.join(__dirname,'..','index.html');
const HTML=fs.readFileSync(IDX,'utf8');
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw new Error('marker 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw new Error('끝 없음: '+marker);};
const clone=x=>JSON.parse(JSON.stringify(x));

function suite(src){
  const out=[];const t=(name,cond,info)=>out.push({name,ok:!!cond,info});
  const tabsDecl=(src.match(/const PAPER_TABS=\[[\s\S]*?\]\];/)||[])[0], verDecl=(src.match(/const PAPER_VIEW_CACHE_VER=\d+;/)||[])[0], krDecl=(src.match(/const KR_CODE_RE=[^\n]*;/)||[])[0];
  if(!tabsDecl||!verDecl||!krDecl) throw new Error('선언 없음');
  const VER=+verDecl.match(/\d+/)[0];
  // ── 상태: 무매 2 · VR 1 · 섀넌(원화) 1 · 듀얼가드 1 · 실계좌 1(빠져야 함)
  const mkS=()=>({paperCommon:{simStart:'2025-01-02',capitalWon:1e7,addWon:3e5},
    inf:{sessions:[{id:'a',name:'무매 A',paper:true,simStart:'2025-01-02',settings:{ticker:'SOXL',div:20},hist:[{sim:true,date:'2025-01-03',amt:10}]},
                   {id:'b',name:'무매 B',paper:true,simStart:'2025-01-02',settings:{ticker:'TQQQ',div:40},hist:[{sim:true,date:'2025-01-03',amt:20}]},
                   {id:'live',name:'실계좌',paper:false,settings:{ticker:'SOXL'},hist:[{date:'2025-01-03',amt:1}]}]},
    vr:{sessions:[{id:'v',name:'VR',paper:true,simStart:'2025-01-02',settings:{ticker:'TQQQ',band:15},hist:[{sim:true,date:'2025-01-03',amt:30}]}]},
    ivs:{sessions:[{id:'k',name:'섀넌 국내',paper:true,simStart:'2025-01-02',settings:{ticker:'122630',s0:55},hist:[{sim:true,date:'2025-01-03',amt:40}]}]},
    ma:{sessions:[]},dca:{sessions:[]},asap:{sessions:[{id:'z',name:'ASAP',paper:true,settings:{ticker:'SOXL'},hist:[{sim:true,amt:1}]}]},
    plan:{sessions:[{id:'p',name:'듀얼 모의',paper:true,horizon:5,simStart:'2025-01-02',settings:{startCapital:10000,monthlyAdd:300}}]}});
  const ctx={console:{error(){},warn(){},log(){}},JSON,Date,Math,Map,Set,Promise,Array,Object,String,Number,setTimeout,
    S:mkS(),liveFX:1400,window:{JKPlanSessionEngine:{ENGINE_FP:'fp1'}},CUT:{usd:'2026-11-10',krw:'2026-11-10'},
    _paperViewRefreshPromise:null,$:()=>null,paperRepairCommonStarts:async()=>0,loadFX:async()=>{},pushRemoteNow:async()=>true,refreshAll:()=>{},
    paperKstDate:()=>'2026-11-11',FILLS:[],NOROW:new Set(),PRICE0:new Set(),GROW:new Set(),N:0};
  ctx.simCutoff=cur=>ctx.CUT[cur==='krw'?'krw':'usd'];
  // 채우기 가짜 — 고른 세션만 줄을 만든다(재생이 모의 기록을 늘리는 세션은 GROW)
  ctx.paperFillAll=async opt=>{ const only=opt&&opt.only; ctx.FILLS.push(only?[...only].sort():'ALL'); const rows=[];
    for(const [tab,s] of ctx.paperSessions()){ const key=tab+':'+s.id; if(only&&!only.has(key)) continue;
      if(ctx.GROW.has(key)) s.hist=(s.hist||[]).concat([{sim:true,date:'2026-11-10',amt:1}]);
      if(ctx.NOROW.has(key)) continue;
      rows.push({tab,id:s.id,name:s.name,price:ctx.PRICE0.has(key)?0:10,n:++ctx.N}); }
    return rows; };
  vm.createContext(ctx);
  vm.runInContext([tabsDecl,verDecl,krDecl].join('\n').replace(/const /g,'var ')+'\n'+['function isKrCode(t)','function curOf(st)','function paperSessions()','function paperRowKey(tab,x)','function paperRowSig(tab,x)','function paperRowCut(tab,x)',
    'function paperViewPlan(force)','function paperViewKeys(plan)','function paperViewCacheRead()','function paperViewCacheWrite(rows,keys)','function paperViewCacheFresh(x)',
    'async function refreshPaperView(force=false, onRows=null)'].map(m=>fnOf(src,m)).join('\n'),ctx);
  const open=async(force=false)=>{ const n0=ctx.FILLS.length; const rows=await ctx.refreshPaperView(force); return {rows:rows||[],fills:ctx.FILLS.slice(n0)}; };
  const byKey=rows=>Object.fromEntries(rows.map(r=>[r.tab+':'+r.id,r.n]));
  const ALL=['inf:a','inf:b','ivs:k','plan:p','vr:v'];
  return (async()=>{
    // A — 옛 판(한 덩어리) 캐시는 안 쓴다 → 전부
    ctx.S.paperViewCache={ver:VER-1,day:'2026-11-11',sig:'old',rows:[{tab:'inf',id:'a',price:1}]};
    const a=await open();
    t('A 옛 판 캐시 → 전부 센다(실계좌·ASAP 빼고 5개) · 표지 5개',JSON.stringify(a.fills)===JSON.stringify([ALL])&&a.rows.length===5&&Object.keys(ctx.S.paperViewCache.keys||{}).length===5&&ctx.S.paperViewCache.ver===VER,JSON.stringify([a.fills,Object.keys(ctx.S.paperViewCache.keys||{})]));
    const A=byKey(a.rows);
    // B — 그대로
    const b=await open();
    t('B 그대로 다시 열기 — 채우기 0번 · 같은 줄(값 그대로)',b.fills.length===0&&JSON.stringify(byKey(b.rows))===JSON.stringify(A),JSON.stringify(b));
    // C — 새 세션(재생이 기록을 늘림) → 그 하나만 · 다음 열기는 안 셈
    ctx.S.inf.sessions.push({id:'c',name:'무매 새',paper:true,simStart:'2025-01-02',settings:{ticker:'SOXL',div:30},hist:[]}); ctx.GROW.add('inf:c');
    const c=await open(); ctx.GROW.delete('inf:c');
    const C=byKey(c.rows);
    t('C 새 세션 — 그 하나만 센다 · 나머지 줄은 값 그대로',JSON.stringify(c.fills)===JSON.stringify([['inf:c']])&&c.rows.length===6&&ALL.every(k=>C[k]===A[k])&&C['inf:c']>0,JSON.stringify([c.fills,C]));
    const c2=await open();
    t('C 새 세션 재생이 모의 기록을 늘렸어도 다음 열기는 안 센다(표지는 계산 뒤 서명)',c2.fills.length===0,JSON.stringify(c2.fills));
    // D — 한 세션 기록이 바뀜
    ctx.S.vr.sessions[0].hist.push({sim:true,date:'2026-11-10',amt:5});
    const d=await open();
    t('D 한 세션 기록이 바뀜 — 그 세션만',JSON.stringify(d.fills)===JSON.stringify([['vr:v']])&&byKey(d.rows)['inf:a']===A['inf:a'],JSON.stringify(d.fills));
    // E — 이름 바꿈
    ctx.S.inf.sessions[1].name='무매 B2';
    const e=await open();
    t('E 이름 바꿈 — 그 세션만(줄 이름이 옛 글자로 남지 않게)',JSON.stringify(e.fills)===JSON.stringify([['inf:b']])&&e.rows.find(r=>r.id==='b').name==='무매 B2',JSON.stringify(e.fills));
    // F — 미국 종가 확정(화 → 수)
    ctx.CUT.usd='2026-11-11';
    const f=await open();
    t('F 미국 종가 확정 — 달러 세션 전부 · 원화 세션(섀넌 국내)은 그대로',JSON.stringify(f.fills)===JSON.stringify([['inf:a','inf:b','inf:c','plan:p','vr:v']]),JSON.stringify(f.fills));
    // G — 주말: 금(11-13) 확정 뒤 토·일 기준일 → 금요일로 당김
    ctx.CUT.usd='2026-11-13'; ctx.CUT.krw='2026-11-13'; await open();
    ctx.CUT.usd='2026-11-14'; ctx.CUT.krw='2026-11-14'; const g1=await open();
    ctx.CUT.usd='2026-11-15'; ctx.CUT.krw='2026-11-15'; const g2=await open();
    t('G 주말(토·일) — 안 센다',g1.fills.length===0&&g2.fills.length===0,JSON.stringify([g1.fills,g2.fills]));
    ctx.CUT.usd='2026-11-16'; const g3=await open();
    t('G 월요일 미국 종가 확정 — 달러 세션 다시',g3.fills.length===1&&g3.fills[0].length===5&&!g3.fills[0].includes('ivs:k'),JSON.stringify(g3.fills));
    ctx.CUT.krw='2026-11-16'; await open();
    // H — 시세 못 받은 줄
    ctx.PRICE0.add('inf:a'); ctx.S.inf.sessions[0].hist.push({sim:true,date:'2026-11-16',amt:2});
    const h1=await open(); ctx.PRICE0.delete('inf:a');
    const h2=await open();
    t('H 시세 못 받은 줄 — 표지가 같아도 다음 열기에 다시(그 세션만)',JSON.stringify(h1.fills)===JSON.stringify([['inf:a']])&&JSON.stringify(h2.fills)===JSON.stringify([['inf:a']])&&h2.rows.find(r=>r.id==='a').price===10,JSON.stringify([h1.fills,h2.fills]));
    // I — 지운 세션
    ctx.S.inf.sessions=ctx.S.inf.sessions.filter(x=>x.id!=='c');
    const i1=await open();
    t('I 지운 세션 — 줄만 빼고 안 센다',i1.fills.length===0&&!i1.rows.some(r=>r.id==='c')&&i1.rows.length===5,JSON.stringify([i1.fills,i1.rows.map(r=>r.id)]));
    // J — 줄이 안 나오는 세션(기록 0건 등)
    ctx.S.dca.sessions.push({id:'d',name:'적립 빈',paper:true,simStart:'2025-01-02',settings:{ticker:'SPY'},hist:[]}); ctx.NOROW.add('dca:d');
    const j1=await open(), j2=await open();
    t('J 줄이 안 나온 세션 — 한 번 센 뒤 표지가 같으면 다시 안 셈(예전 한 덩어리 캐시와 같음)',JSON.stringify(j1.fills)===JSON.stringify([['dca:d']])&&j2.fills.length===0,JSON.stringify([j1.fills,j2.fills]));
    // K — 공통 원화 원금
    ctx.S.paperCommon.capitalWon=2e7;
    const k1=await open();
    t('K 공통 원화 원금 바뀜 — 전부(원화 투입이 그 값을 본다)',k1.fills.length===1&&k1.fills[0].length===6,JSON.stringify(k1.fills));
    // L — 듀얼가드 엔진 판
    ctx.window.JKPlanSessionEngine.ENGINE_FP='fp2';
    const l1=await open();
    t('L 듀얼가드 엔진 판 바뀜 — 듀얼가드 세션만',JSON.stringify(l1.fills)===JSON.stringify([['plan:p']]),JSON.stringify(l1.fills));
    // M — 강제
    const m1=await open(true);
    t('M 강제(전체 적용·오늘 갱신) — 전부',m1.fills.length===1&&m1.fills[0].length===6,JSON.stringify(m1.fills));
    // 읽기 · 신선 판정
    t('읽기 — 다시 셀 세션이 없으면 그대로 · 있으면 null',!!ctx.paperViewCacheRead()&&(ctx.S.vr.sessions[0].settings.band=20,ctx.paperViewCacheRead()===null),'');
    t('신선 — 시세 없는 줄이 섞이면 아님',ctx.paperViewCacheFresh({rows:[{price:1}]})===true&&ctx.paperViewCacheFresh({rows:[{price:1},{price:0}]})===false&&ctx.paperViewCacheFresh(null)===false,'');
    // N — 시세 선취 · 채우기가 고른 세션만
    {
      const got=[]; const S2=mkS();
      const c2x={S:S2,PAPER_TABS:null,pfWanted:()=>true,planPaperRetired:()=>false,divCashOn:()=>false,ivsX1Of:()=>'',planPaperNeedQuotes:async l=>l.length>0,
        fetchDaily:async s=>{got.push(s);return null;},fetchDailyDiv:async()=>null,Promise,Set};
      vm.createContext(c2x); vm.runInContext(tabsDecl.replace('const ','var ')+'\n'+fnOf(src,'function paperRowKey(tab,x)')+'\n'+fnOf(src,'async function paperPrefetchQuotes(opt)'),c2x);
      await c2x.paperPrefetchQuotes({only:new Set(['inf:b'])}); const one=got.slice().sort().join(); got.length=0;
      await c2x.paperPrefetchQuotes(); const all=got.slice().sort().join();
      t('N 시세 선취 — 고른 세션(무매 B=TQQQ) 것만 · 안 고르면 전부',one==='TQQQ'&&all==='122630,SGOV,SOXL,TECL,TQQQ',JSON.stringify([one,all]));
      const S3=mkS(), prog=[], seen=[];
      const c3={S:S3,PAPER_TABS:null,console:{error(){},warn(){}},Math,Set,Promise,performance:{now:()=>0},document:{hidden:true},
        _paperFilling:false,_paperSliceAt:0,_fillQuoteCache:null,_pfSeriesSink:null,lastQuote:{},infQuoteCache:null,maQuoteData:null,ivsQuoteData:null,ivsQuote1:null,dcaQuoteData:null,asapQuoteData:null,infChartData:undefined,vrChartData:undefined,
        PAPER_LOADERS:{inf:async()=>{},vr:async()=>{},ivs:async()=>{},ma:async()=>{},dca:async()=>{},asap:async()=>{}},PAPER_CACHESYM:{inf:()=>'',vr:()=>'',ivs:()=>'',ma:()=>'',dca:()=>'',asap:()=>''},
        paperPrefetchQuotes:async o=>{seen.push(o&&o.only?[...o.only].join():'ALL');},paperLoadingProgress:(d,n)=>prog.push(d+'/'+n),
        divCashOn:()=>false,warmDiv:async()=>{},paperAuto:()=>{},vrSimForward:()=>{},infSimForward:()=>{},paperStart:()=>'2025-01-02',pfWanted:()=>true,stratStatusHtml:()=>'',
        planPaperRetired:()=>false,planPaperRun:async()=>{},paperStatPlan:s=>({tab:'plan',id:s.id,price:1}),paperStat:(tab,s)=>({tab,id:s.id,price:1})};
      vm.createContext(c3); vm.runInContext(tabsDecl.replace('const ','var ')+'\n'+fnOf(src,'function paperRowKey(tab,x)')+'\n'+fnOf(src,'async function paperBreathe()')+'\n'+fnOf(src,'async function paperFillAll(opt)'),c3);
      const r1=await c3.paperFillAll({only:new Set(['vr:v','plan:p'])});
      t('N 채우기 — 고른 세션(VR · 듀얼가드)만 줄 · 진행 n / 2 · 선취에도 그 모음',JSON.stringify((r1||[]).map(r=>r.tab+':'+r.id).sort())==='["plan:p","vr:v"]'&&prog.join()==='1/2,2/2'&&seen[0]==='vr:v,plan:p',JSON.stringify([r1,prog,seen]));
      prog.length=0; const r2=await c3.paperFillAll();
      t('N 채우기 — 안 고르면 전부(모의 5개 · 실계좌·ASAP 빼고)',(r2||[]).length===5&&prog[prog.length-1]==='5/5',JSON.stringify([(r2||[]).length,prog]));
    }
    return out;
  })();
}

const MUT=[
  ['서명 안 봄(설정·기록이 바뀌어도 옛 줄)', s=>s.replace('if(k&&k.s===sig&&k.c===cut&&(!r||+r.price>0)){','if(k&&k.c===cut&&(!r||+r.price>0)){')],
  ['기준 종가일 안 봄(새 종가가 와도 옛 줄)', s=>s.replace('if(k&&k.s===sig&&k.c===cut&&(!r||+r.price>0)){','if(k&&k.s===sig&&(!r||+r.price>0)){')],
  ['시세 없는 줄도 다시 씀', s=>s.replace('if(k&&k.s===sig&&k.c===cut&&(!r||+r.price>0)){','if(k&&k.s===sig&&k.c===cut){')],
  ['채우기가 고른 세션을 무시(전부 셈)', s=>s.replace('&&(!only||only.has(paperRowKey(t,x)));','&&true;')],
  ['주말을 금요일로 안 당김', s=>s.replace('  while(t.getUTCDay()===0||t.getUTCDay()===6) t.setUTCDate(t.getUTCDate()-1);\n  return t.toISOString().slice(0,10);\n}','  return t.toISOString().slice(0,10);\n}')],
  ['지운 세션 줄을 안 뺌', s=>s.replace('return p.keep.length===x.rows.length?x:{...x,rows:p.keep};','return x;')],
  ['표지에 계산 전 서명(재생이 기록을 늘린 세션을 다음에 또 셈)', s=>s.replace('s:plan.only.has(key)?paperRowSig(tab,s):plan.sigs[key]','s:plan.sigs[key]')],
  ['시세 선취가 고른 세션을 무시', s=>s.replace("      if(only&&!only.has(paperRowKey(tab,sess)))continue;   // 모의 목록 — 이번에 다시 셀 세션 것만 받는다(세션마다 저장 · paperViewPlan)\n","")],
  ['서명에 이름 없음(이름 바꿔도 옛 글자)', s=>s.replace('x&&x.id,x&&x.name,x&&x.simStart','x&&x.id,x&&x.simStart')],
  ['서명에 공통 원화 원금 없음', s=>s.replace(',pc.simStart,pc.capitalWon,pc.addWon,',',')],
  ['듀얼가드 줄 서명에 엔진 판 없음', s=>s.replace("tab==='plan'?((E&&E.ENGINE_FP)||''):''","''")],
  ['옛 코드: 갱신이 늘 전부 셈', s=>s.replace('const got=plan.only.size?await paperFillAll({only:plan.only}):[];','const got=await paperFillAll();').replace('const rows=got?plan.keep.concat(got):null;','const rows=got;')],
];

(async()=>{
  const base=await suite(HTML); const bad=base.filter(x=>!x.ok);
  for(const x of base) console.log((x.ok?'PASS ':'FAIL ')+x.name+(x.ok?'':' · '+x.info));
  if(bad.length){ console.log('FAIL '+bad.length+'건'); process.exit(1); }
  let red=0;
  for(const [name,f] of MUT){ const m=f(HTML); if(m===HTML){ console.log('FAIL 변이가 원본과 같음: '+name); process.exit(1); }
    let r; try{ r=await suite(m); }catch(e){ r=[{ok:false,name:'실행 오류 '+e.message}]; }
    const hit=r.some(x=>!x.ok); if(hit) red++; console.log((hit?'PASS 변이 빨간불: ':'FAIL 변이가 통과함: ')+name); }
  if(red!==MUT.length){ console.log('FAIL 변이 '+red+'/'+MUT.length); process.exit(1); }
  console.log('ALL PASS paper row cache · 값 '+base.length+'개 · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{ console.error(e); process.exit(1); });
