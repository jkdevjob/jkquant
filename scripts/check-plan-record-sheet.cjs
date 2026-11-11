#!/usr/bin/env node
'use strict';
/* 듀얼가드 기록 창(plan 2.9.0 · 2026-11-11) — 값 시험 + 변이 시험.
   사용자: "듀얼가드 거래이력에 있는 기록추가를 무한매수법처럼 현재탭으로 옮기고 버튼 똑같이 만들어"
           "듀얼가드 거래이력에 초기자금은 이미 설정에 있으니 삭제해"
   실제 페이지 함수를 뽑아 그대로 돌린다(재구현 없음).
     A 단추 — 운영 무한매수법 #fab 과 같은 글자·모양 · 현재 탭에만(data-asset-view) · 모의 세션엔 없음
     B 추천 칸 — 오늘 주문 n건(종목·방향·주수) / 보류 이유 / 주문 없음
     C 고르기 — 배당·입금·출금은 그 종류로 현금 칸 · 체결은 주문이 있을 때만 · 서로 닫힘
     D 저장 — 저장되면 창 닫음 · 실패면 그대로 · 저장 중 두 번 눌러도 한 번만
     E 저장 함수 그대로 — 현금 기록 · 체결 반영이 성공 여부를 돌려준다(DB 실패면 false · 장부 되돌림)
     F 자리 — 오늘 주문 카드 · 거래이력에 예전 기록 칸 없음 · 거래이력 아래 시작자금 · 초기화 칸 없음 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={plan:rd('plan.html'),idx:rd('index.html'),eng:rd('plan-session-engine.js')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const between=(src,a,b)=>{const i=src.indexOf(a);if(i<0)return '';const j=src.indexOf(b,i+a.length);return j<0?'':src.slice(i,j);};

function el(extra={}){const cls=new Set();return Object.assign({hidden:false,value:'',textContent:'',style:{},dataset:{},scrollTop:5,attrs:{},
  classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c),toggle:(c,on)=>{if(on===undefined)on=!cls.has(c);if(on)cls.add(c);else cls.delete(c);return on;}},
  setAttribute(k,v){this.attrs[k]=v;}},extra);}
function sheetCtx(src,o={}){
  const ids=['dgSheetDate','dgRecoMain','dgRecoSub','dgFillTag','alphaCashRec','alphaFillPanel','alphaCashKind','alphaCashTitle','alphaCashAmtLabel','alphaCashNote','alphaCashDate','dgSheet','dgSheetBg'];
  const E=Object.fromEntries(ids.map(i=>[i,el()]));E.alphaCashRec.hidden=true;E.alphaFillPanel.hidden=true;E.alphaCashKind.value='div';
  const kinds=['fill','div','dep','wd'].map(k=>el({dataset:{dgkind:k}}));
  const body=el(),log={openFill:0,alerts:[]};
  const c={$:id=>E[id],document:{body,querySelectorAll:s=>s==='#dgSheet [data-dgkind]'?kinds:[],querySelector:s=>s==='#dgSheet [data-dgkind="fill"]'?kinds[0]:null},
    todayISO:()=>'2026-11-11',pendingAlphaOrders:o.orders||[],alphaOrderHold:o.hold||'',
    assetPaperMode:()=>!!o.paper,guardAssetPaperEdit:()=>{log.alerts.push('paper');return true;},
    alphaCloseFillEditor:()=>{E.alphaFillPanel.hidden=true;},alphaOpenFillEditor:()=>{log.openFill++;E.alphaFillPanel.hidden=false;},
    setTimeout:()=>0,Date,String,Promise,console};
  vm.createContext(c);
  vm.runInContext(fnOf(src,'const DG_CASH_KIND=')+';\n'+['function dgDateK(iso)','function dgSheetForms(kind)','function dgSheetRender()','function dgSheetOpen()','function dgSheetClose()','function dgSheetPick(kind)','async function dgSheetSave(btn,save)'].map(m=>fnOf(src,m)).join('\n'),c);
  return {c,E,kinds,body,log};
}
/* 엔진 장부 + 저장 함수 두 개 — DB 저장 결과(ok)를 돌려주는지 */
function saveCtx(src,eng,{cloud=true,orders=[]}={}){
  const E={alphaCashDate:{value:'2026-11-10'},alphaCashKind:{value:'div'},alphaCashAmt:{value:'12.34'},alphaFillDate:{value:'2026-11-10'},
    alphaFillRows:{querySelectorAll:()=>orders.map((x,i)=>({dataset:{fillI:String(i)},querySelector:s=>({value:s==='.afQty'?String(x.qty):String(x.price)})}))}};
  const c={console,alert:m=>c._alerts.push(String(m)),_alerts:[],$:id=>E[id],todayISO:()=>'2026-11-11',cloneObj:x=>JSON.parse(JSON.stringify(x)),usd:v=>'$'+v,usd2:v=>'$'+v,
    alphaSyncInputs(){},renderAlphaLedger(){},refreshAlphaFromCache(){},localSave(){},alphaCloseFillEditor(){},cloudSave:async()=>cloud};
  vm.createContext(c);c.window=c;vm.runInContext(eng,c);
  vm.runInContext('var alphaLedger={base:{date:"2026-11-01",tecl:0,tqqq:0,sgov:0,cash:20000,avgTecl:null,avgTqqq:null,avgSgov:null},events:[]};var pendingAlphaOrders='+JSON.stringify(orders)+';\n'
    +[ 'const ALPHA_FEE_RATE=','function alphaFee(q,p)','function alphaEventList(ledger=alphaLedger)','function alphaLedgerCalc(ledger=alphaLedger)','async function alphaAddCashEvent()','async function alphaSaveFills()']
      .map(m=>m.startsWith('const')?src.slice(src.indexOf(m),src.indexOf(';',src.indexOf(m))+1):fnOf(src,m)).join('\n'),c);
  return c;
}

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const P=S.plan;
  // ── A 단추
  { const fab=(P.match(/<button[^>]*id="dgFab"[^>]*>([^<]*)<\/button>/)||[]);
    const idxFab=(S.idx.match(/<button id="fab"[^>]*>([^<]*)<\/button>/)||[])[1];
    const css=(P.match(/\n#dgFab\{[^}]*\}/)||[''])[0],icss=(S.idx.match(/\n#fab\{[^}]*\}/)||[''])[0];   // 줄 첫머리 규칙(숨김 규칙 말고 본 모양)
    const same=['position:fixed','left:50%','transform:translateX(-50%)','bottom:calc(20px + env(safe-area-inset-bottom))','z-index:80','border-radius:30px','padding:15px 28px','font-size:15px','font-weight:800','box-shadow:0 8px 28px rgba(99,102,217,.5)'];
    t('A1 단추 글자 = 운영 무한매수법 단추(＋ 오늘 기록하기) · 같은 모양 값(자리 · 크기 · 둥글기 · 그림자)',!!fab[1]&&fab[1]===idxFab&&same.every(v=>css.includes(v)&&icss.includes(v))&&/linear-gradient\(135deg,#6366d9,#4b4ec9\)/.test(css)&&/linear-gradient\(135deg,var\(--vio2\),#4b4ec9\)/.test(icss),JSON.stringify({fab:fab[1],idxFab}));
    t('A2 현재 탭에만(data-asset-view="current" — 다른 탭에선 숨김) · 모의 세션 · 로그인 전 · 원장 읽는 중엔 숨김',/<button type="button" id="dgFab" data-asset-view="current">/.test(P)
      &&/body\.asset-paper-mode #dgFab/.test(P)&&/html\.plan-hydrating #dgFab,html:not\(\.authed\) #dgFab\{display:none!important\}/.test(P)); }
  // ── B 추천 칸
  { const A=sheetCtx(P,{orders:[{sym:'TECL',side:'buy',qty:18},{sym:'TQQQ',side:'sell',qty:38}]});A.c.dgSheetRender();
    t('B1 주문 2건 — 제목 · 종목/방향/주수 · 매매 칸 표시',A.E.dgRecoMain.textContent==='오늘 주문 체결 반영 · 2건'&&A.E.dgRecoSub.textContent.startsWith('TECL 매수 18주 · TQQQ 매도 38주')
      &&A.E.dgFillTag.textContent==='주문 2건'&&!A.kinds[0].classList.contains('off')&&/11월 11일 \(수\) · 오늘 주문 2건/.test(A.E.dgSheetDate.textContent),A.E.dgRecoSub.textContent+' | '+A.E.dgSheetDate.textContent);
    const H=sheetCtx(P,{hold:'VIX·VXN 시세를 받지 못했습니다'});H.c.dgSheetRender();
    t('B2 보류 — 이유를 그대로 · 매매 칸 흐리게',H.E.dgRecoMain.textContent==='오늘 주문 보류'&&H.E.dgRecoSub.textContent.startsWith('VIX·VXN 시세를 받지 못했습니다')&&H.kinds[0].classList.contains('off'),H.E.dgRecoSub.textContent);
    const N=sheetCtx(P,{});N.c.dgSheetRender();
    t('B3 주문 없음',N.E.dgRecoMain.textContent==='오늘 체결할 주문 없음'&&/^유지 구간/.test(N.E.dgRecoSub.textContent)&&N.E.dgFillTag.textContent==='주문 0건',N.E.dgRecoSub.textContent); }
  // ── C 고르기
  { const A=sheetCtx(P,{orders:[{sym:'SGOV',side:'buy',qty:5}]});A.c.dgSheetOpen();
    const opened=A.E.dgSheet.classList.contains('on')&&A.E.dgSheetBg.classList.contains('on')&&A.E.dgSheet.attrs['aria-hidden']==='false'&&A.E.dgSheet.scrollTop===0&&A.body.classList.contains('dg-sheet-open');
    A.c.dgSheetPick('wd');const wd={kind:A.E.alphaCashKind.value,shown:!A.E.alphaCashRec.hidden,title:A.E.alphaCashTitle.textContent,label:A.E.alphaCashAmtLabel.textContent,sel:A.kinds.filter(k=>k.classList.contains('sel')).map(k=>k.dataset.dgkind).join()};
    A.c.dgSheetPick('dep');const dep=A.E.alphaCashKind.value;
    A.c.dgSheetPick('fill');const fill={open:A.log.openFill,cash:A.E.alphaCashRec.hidden,panel:!A.E.alphaFillPanel.hidden};
    A.c.dgSheetPick('div');const back={kind:A.E.alphaCashKind.value,panel:A.E.alphaFillPanel.hidden};
    A.c.dgSheetClose();const closed=!A.E.dgSheet.classList.contains('on')&&!A.E.dgSheetBg.classList.contains('on')&&A.E.alphaCashRec.hidden&&A.E.alphaFillPanel.hidden&&!A.body.classList.contains('dg-sheet-open')&&A.kinds.every(k=>!k.classList.contains('sel'));
    t('C1 열기 · 출금 → 현금 칸(종류 wd · 제목 · 금액 이름) · 입금 → dep · 체결 → 체결 칸(현금 칸 닫힘) · 배당 → 체결 칸 닫힘 · 닫기는 다 닫음',
      opened&&wd.kind==='wd'&&wd.shown&&wd.title==='● 출금'&&wd.label==='출금액 ($)'&&wd.sel==='wd'&&dep==='dep'&&fill.open===1&&fill.cash&&fill.panel&&back.kind==='div'&&back.panel&&closed,JSON.stringify({opened,wd,dep,fill,back,closed}));
    const N=sheetCtx(P,{});N.c.dgSheetPick('fill');
    t('C2 오늘 주문이 없으면 체결 칸을 안 연다(경고창 없이 추천 칸만 다시 그림)',N.log.openFill===0&&N.E.alphaFillPanel.hidden&&N.E.dgRecoMain.textContent==='오늘 체결할 주문 없음');
    const M=sheetCtx(P,{paper:true});M.c.dgSheetOpen();
    t('C3 모의 세션 — 창을 안 열고 안내',!M.E.dgSheet.classList.contains('on')&&M.log.alerts.join()==='paper'); }
  // ── D 저장
  { const A=sheetCtx(P,{});A.c.dgSheetOpen();let calls=0;const rs=[],btn={disabled:false,textContent:'기록하기'};
    const save=()=>{calls++;return new Promise(r=>rs.push(r));};   // 저장이 끝나기 전에 두 번째 누름
    const p1=A.c.dgSheetSave(btn,save);const mid={dis:btn.disabled,txt:btn.textContent};const p2=A.c.dgSheetSave(btn,save);
    rs.forEach(r=>r(true));await p1;await p2;
    t('D1 저장 중 두 번 눌러도 한 번만 · 저장 중 글자 · 저장되면 창 닫힘 · 단추 원래대로',calls===1&&mid.dis===true&&mid.txt==='저장 중…'&&!A.E.dgSheet.classList.contains('on')&&btn.disabled===false&&btn.textContent==='기록하기',JSON.stringify({calls,mid}));
    const B=sheetCtx(P,{});B.c.dgSheetOpen();const b2={disabled:false,textContent:'기록하기'};await B.c.dgSheetSave(b2,async()=>false);
    t('D2 저장 실패(또는 입력 오류) — 창 그대로 · 단추 다시 누를 수 있음',B.E.dgSheet.classList.contains('on')&&b2.disabled===false);
    const C=sheetCtx(P,{});C.c.dgSheetOpen();const b3={disabled:false,textContent:'기록하기'};let threw=false;try{await C.c.dgSheetSave(b3,async()=>{throw Error('x');});}catch(e){threw=true;}
    t('D3 저장 중 오류가 나도 단추가 잠긴 채 남지 않는다',threw&&b3.disabled===false&&b3.textContent==='기록하기'); }
  // ── E 저장 함수 그대로 — 성공 여부
  { const ok=saveCtx(P,S.eng,{cloud:true});const r1=await ok.alphaAddCashEvent();const L1=vm.runInContext('alphaLedger',ok);
    const bad1=saveCtx(P,S.eng,{cloud:false});const r2=await bad1.alphaAddCashEvent();const L2=vm.runInContext('alphaLedger',bad1);
    t('E1 현금 기록 — DB 저장되면 true(배당 12.34 한 줄) · 실패면 false 이고 장부 되돌림',r1===true&&L1.events.length===1&&L1.events[0].kind==='div'&&L1.events[0].amount===12.34&&r2===false&&L2.events.length===0,JSON.stringify({r1,r2,n1:L1.events.length,n2:L2.events.length}));
    const orders=[{sym:'TECL',side:'buy',qty:10,price:100}];
    const f1=saveCtx(P,S.eng,{cloud:true,orders});const r3=await f1.alphaSaveFills();const f2=saveCtx(P,S.eng,{cloud:false,orders});const r4=await f2.alphaSaveFills();
    t('E2 체결 반영 — DB 저장되면 true(TECL 10주) · 실패면 false 이고 장부 되돌림',r3===true&&vm.runInContext('alphaLedger.events.length',f1)===1&&r4===false&&vm.runInContext('alphaLedger.events.length',f2)===0,JSON.stringify({r3,r4}));
    t('E3 단추 연결 — 기록하기 = 저장 잠금(dgSheetSave) + 예전 저장 함수 · 추천 이대로 기록 = 체결 칸',
      /\$\("alphaCashAdd"\)\.addEventListener\("click",e=>dgSheetSave\(e\.currentTarget,alphaAddCashEvent\)\)/.test(P)&&/\$\("alphaFillSave"\)\.addEventListener\("click",e=>dgSheetSave\(e\.currentTarget,alphaSaveFills\)\)/.test(P)
      &&/\$\("alphaRecordFill"\)\.addEventListener\("click",\(\)=>dgSheetPick\('fill'\)\)/.test(P)&&/\$\("dgFab"\)\.addEventListener\("click",dgSheetOpen\)/.test(P)); }
  // ── F 자리
  { const order=between(P,'id="alphaOrderSection"','id="alphaAccountSection"'),hist=between(P,'id="alphaHistorySection"','id="alphaPerfSection"'),sheet=between(P,'<div id="dgSheet"','id="assetSessionModal"');
    t('F1 오늘 주문 카드 · 거래이력에 예전 기록 칸 없음 — 체결 칸 · 현금 칸은 기록 창 안',!!order&&!!hist&&!!sheet&&!/id="alphaRecordFill"|id="alphaFillPanel"/.test(order)&&!/id="alphaCashRec"|id="alphaCashAdd"/.test(hist)
      &&/id="alphaRecordFill"/.test(sheet)&&/id="alphaFillPanel"/.test(sheet)&&/id="alphaCashRec"/.test(sheet)&&/id="alphaCashAdd"/.test(sheet));
    t('F2 거래이력 아래 시작자금 · 초기화 칸 없음(시작자산은 ⚙️ 설정) · 남은 코드도 없음',!/id="alphaResetSection"|id="alphaCapitalInput"|id="alphaReset"/.test(P)&&!/function alphaResetLedger|alphaCapitalInput/.test(P)
      &&/id="assetSessionCapital"/.test(P)&&/aria-controls="alphaHistorySection">거래이력<\/button>/.test(P));
    t('F3 세션을 바꾸면 기록 창도 닫힌다',/alphaCloseFillEditor\(\);alphaCloseEdit\(\);dgSheetClose\(\);setAssetDetail\('current'\);/.test(fnOf(P,'async function loadActiveAssetSessionView(refresh=true)'))); }
  return bad;
}

const MUT=[
  ['단추: 다른 글자','plan',s=>s.replace('id="dgFab" data-asset-view="current">＋ 오늘 기록하기<','id="dgFab" data-asset-view="current">기록 추가<')],
  ['단추: 모든 탭에 보임','plan',s=>s.replace('<button type="button" id="dgFab" data-asset-view="current">','<button type="button" id="dgFab">')],
  ['단추: 모의 세션에도 보임','plan',s=>s.replace(',body.asset-paper-mode #dgFab,',',')],
  ['추천: 보류 이유 버림','plan',s=>s.replace("(alphaOrderHold?String(alphaOrderHold)+' · ':'유지 구간 · ')","'유지 구간 · '")],
  ['추천: 주문 내용 안 적음','plan',s=>s.replace("pendingAlphaOrders.map(on).join(' · ')+' · 수량·체결가 자동 입력'","'수량·체결가 자동 입력'")],
  ['고르기: 종류를 안 바꿈(늘 배당)','plan',s=>s.replace("$('alphaCashKind').value=kind;","")],
  ['고르기: 주문 없어도 체결 칸 염','plan',s=>s.replace("if(!pendingAlphaOrders.length){dgSheetRender();return;} ","")],
  ['고르기: 현금 칸을 안 닫음','plan',s=>s.replace("const cr=$('alphaCashRec');if(cr)cr.hidden=!DG_CASH_KIND[kind];","const cr=$('alphaCashRec');if(cr&&DG_CASH_KIND[kind])cr.hidden=false;")],
  ['열기: 모의 세션도 염','plan',s=>s.replace("  if(assetPaperMode()){guardAssetPaperEdit();return;}\n  dgSheetRender();","  dgSheetRender();")],
  ['저장: 두 번 누르면 두 번 저장','plan',s=>s.replace("  if(!btn||btn.disabled)return;   // 저장 중","  if(!btn)return;   // 저장 중")],
  ['저장: 실패해도 창 닫음','plan',s=>s.replace("  try{ if(await save())dgSheetClose(); }","  try{ await save();dgSheetClose(); }")],
  ['저장: 오류 나면 단추 잠긴 채','plan',s=>s.replace("  finally{ btn.disabled=false;btn.textContent=label; }","  btn.disabled=false;btn.textContent=label;")],
  ['현금 기록: 성공 여부 안 돌려줌','plan',s=>s.replace("  else{alphaLedger=before;alphaSyncInputs();renderAlphaLedger();refreshAlphaFromCache();alert('현금 기록이 DB에 저장되지 않아 화면을 원래 상태로 되돌렸습니다.');}\n  return ok;","  else{alphaLedger=before;alphaSyncInputs();renderAlphaLedger();refreshAlphaFromCache();alert('현금 기록이 DB에 저장되지 않아 화면을 원래 상태로 되돌렸습니다.');}")],
  ['체결 반영: 성공 여부 안 돌려줌','plan',s=>s.replace("  return ok;   // 기록 창은 저장됐을 때만 닫는다\n}\nfunction alphaCloseEdit(){","}\nfunction alphaCloseEdit(){")],
  ['단추 연결: 기록하기가 잠금 없이 바로 저장(옛 코드)','plan',s=>s.replace('$("alphaCashAdd").addEventListener("click",e=>dgSheetSave(e.currentTarget,alphaAddCashEvent));','$("alphaCashAdd").addEventListener("click",alphaAddCashEvent);')],
  ['자리: 오늘 주문 카드에 예전 체결 단추','plan',s=>s.replace('<!-- 체결 반영 · 배당 · 입금 · 출금 기록은 화면 아래 가운데','<button class="btn gold" id="alphaRecordFill" disabled>✅ 오늘 주문 체결 반영</button><!-- 체결 반영 · 배당 · 입금 · 출금 기록은 화면 아래 가운데')],
  ['자리: 거래이력 초기화 칸 되살림','plan',s=>s.replace('    </div>\n  </div>\n\n\n  <div class="plan-panel" data-ppanel="classic"','      <div class="card" id="alphaResetSection" data-asset-view="history" hidden><input type="number" id="alphaCapitalInput"></div>\n    </div>\n  </div>\n\n\n  <div class="plan-panel" data-ppanel="classic"')],
  ['세션 바꿔도 기록 창 열린 채','plan',s=>s.replace("alphaCloseFillEditor();alphaCloseEdit();dgSheetClose();setAssetDetail('current');","alphaCloseFillEditor();alphaCloseEdit();setAssetDetail('current');")],
];
let finished=false;   // 약속 하나가 안 풀려 시험이 조용히 멈추면(출력 없이 0) 빨간불로 끝낸다
process.on('exit',code=>{if(!finished&&code===0){console.error('FAIL 시험이 끝까지 돌지 않음(풀리지 않은 약속)');process.exitCode=1;}});
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 듀얼가드 기록 창 = 무한매수법 단추 · 현재 탭에만 · 추천(주문/보류/없음) · 배당·입금·출금·체결 고르기 · 저장되면 닫힘 · 두 번 눌러도 한 번 · 예전 칸 · 초기화 칸 없음');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS plan record sheet · 변이 '+red+'/'+MUT.length+' red');
  finished=true;
})().catch(e=>{console.error(e);process.exit(1);});
