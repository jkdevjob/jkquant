#!/usr/bin/env node
'use strict';
/* 섀넌 기록 시트 (index v3.127.2 · 2026-11-09 사용자: "섀넌 매수 입력이 안돼")
 * 섀넌 탭에서 FAB 을 누르면 VR 양식(Pool 추가·차감)이 열렸고, 저장은 VR 함수(computeVr · cyc)로 가서 섀넌 기록이 안 됐다.
 * 실제 index.html 함수를 떼어 가짜 화면에서 돌린다(재구현 없음). 값 시험 + 변이.
 *   V1 양식 — 다섯 유형 · 예수금 국채면 종목 글자 · 1배수 짝이면 종목 고르기 · 수수료 안내
 *   V2 저장 — 매수·매도는 _ivsPush(수수료 0.25% 자동 · leg · sym) · 1배수 짝 매도 · 입금·출금·배당은 amt 기록 · 날짜순 정렬 · 저장→갱신→클라우드→닫기
 *   V3 검증 — 단가·수량·금액·날짜 없으면 알림만, 기록·저장 없음
 *   V4 배선 — openSheet 가 탭마다 제 양식 · 다른 탭은 알림 · FAB 은 무매·VR·섀넌(탭 클릭·시작 같게) · 닫을 때 초기화
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={idx:rd('index.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const near=(a,b,e=1e-9)=>Math.abs(a-b)<=e;
function harness(S,sess){
  const V={shi_date:{value:'2026-11-09'},shi_price:{value:''},shi_qty:{value:''},shi_amt:{value:''},sheet_iform:{style:{},scrollIntoView(){}},shi_stock:{style:{}},shi_amtwrap:{style:{}}};
  const log=[]; const fee=+((S.idx.match(/const IVS_FEE=([\d.]+)/)||[])[1]);
  const c={$:id=>V[id],V,log,IVS_FEE:fee,curStrat:()=>sess,ivsX1Of:s=>s==='USD'?'SMH':'X1OF_'+s,save(){ log.push('save'); },refreshIvs(){ log.push('refresh'); },pushRemote(){ log.push('push'); },closeSheet(){ log.push('close'); },
    alert(m){ log.push('alert:'+m); },document:{querySelectorAll:()=>[]},Date,Math,String,Number};
  vm.createContext(c);
  vm.runInContext(((S.idx.match(/let shIvsType='buy', shIvsLeg='lev';/)||[''])[0]).replace('let ','var ')+'\n'+['function sheetIvsHTML(today)','function sheetSelIvs(t)','function sheetSelIvsLeg(l)','function sheetSaveIvs()','function _ivsPush(leg,side,q,price,date,sym)','function sortHist(arr)','function unComma(s)'].map(m=>fnOf(S.idx,m)).join('\n'),c);
  return c;
}
async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  // ── V1 양식
  { const a=harness(S,{settings:{ticker:'USD',park:'bill'},hist:[]}), b=harness(S,{settings:{ticker:'USD',park:'x1'},hist:[]});
    const ha=a.sheetIvsHTML('2026-11-09'), hb=b.sheetIvsHTML('2026-11-09');
    t('V1 양식 — 다섯 유형(매수·매도·입금·출금·배당) · 국채면 종목 글자(USD) · 1배수 짝이면 USD/SMH 고르기(seg 아님 · 시트 선택지와 같은 줄) · 수수료 0.25% 안내 · 기록하기 → sheetSaveIvs',
      (ha.match(/class="kindopt"/g)||[]).length===5&&/data-it="buy"/.test(ha)&&/data-it="div"/.test(ha)&&/id="shi_sym">USD</.test(ha)&&!/id="shi_leg"/.test(ha)
      &&/id="shi_legs"/.test(hb)&&/data-leg="x1"[^>]*><span class="kn">SMH<\/span><span class="kt cx">1배수 짝</.test(hb)&&!/class="seg"/.test(hb)&&!/id="shi_leg"/.test(ha)&&/수수료 0\.25%는 자동으로 붙습니다/.test(ha)&&/onclick="sheetSaveIvs\(\)"/.test(ha)&&/value="2026-11-09"/.test(ha),ha.slice(0,200)); }
  // ── V2 저장
  { const sess={settings:{ticker:'USD',park:'bill'},hist:[{type:'add',date:'2026-11-10',amt:1,ts:1}]}, c=harness(S,sess);
    c.sheetSelIvs('buy'); c.V.shi_price.value='53.83'; c.V.shi_qty.value='13'; c.sheetSaveIvs();
    const r=sess.hist[0];
    t('V2 매수 13주 × 53.83 → {buy · lev · USD · 2026-11-09 · 699.79 · 수수료 699.79×0.25%} · 날짜순 정렬(11-10 입금 뒤가 아니라 앞) · 저장→갱신→클라우드→닫기',
      r&&r.type==='buy'&&r.leg==='lev'&&r.sym==='USD'&&r.date==='2026-11-09'&&r.price===53.83&&r.qty===13&&near(r.amt,699.79,1e-9)&&near(r.fee,699.79*c.IVS_FEE,1e-9)&&typeof r.ts==='number'
      &&sess.hist[1].type==='add'&&c.log.join()==='save,refresh,push,close',JSON.stringify([r,c.log]));
    const s2={settings:{ticker:'USD',park:'x1'},hist:[]}, d=harness(S,s2);
    d.sheetSelIvs('sell'); d.sheetSelIvsLeg('x1'); d.V.shi_price.value='250'; d.V.shi_qty.value='2'; d.sheetSaveIvs();
    t('V2 1배수 짝 매도 → leg x1 · sym SMH(ivsX1Of) · 수수료 자동',s2.hist.length===1&&s2.hist[0].type==='sell'&&s2.hist[0].leg==='x1'&&s2.hist[0].sym==='SMH'&&near(s2.hist[0].fee,500*d.IVS_FEE,1e-9),JSON.stringify(s2.hist));
    const s3={settings:{ticker:'USD',park:'bill'},hist:[]}, e=harness(S,s3);
    e.sheetSelIvsLeg('x1'); e.sheetSelIvs('buy'); e.V.shi_price.value='50'; e.V.shi_qty.value='1'; e.sheetSaveIvs();
    t('V2 국채(1배수 아님)면 x1 을 골라도 lev · 주 종목',s3.hist[0]&&s3.hist[0].leg==='lev'&&s3.hist[0].sym==='USD',JSON.stringify(s3.hist));
    const s4={settings:{ticker:'USD',park:'bill'},hist:[]}, f=harness(S,s4);
    for(const [tp,amt] of [['add','1,000'],['wd','200'],['div','3.5']]){ f.sheetSelIvs(tp); f.V.shi_amt.value=amt; f.V.shi_date.value='2026-11-0'+(tp==='add'?'3':tp==='wd'?'2':'1'); f.sheetSaveIvs(); }
    t('V2 입금·출금·배당 → {type · date · amt}(쉼표 숫자 풀기) · 날짜순(배당 11-01 → 출금 11-02 → 입금 11-03) · leg/sym 없음',
      s4.hist.map(x=>x.type).join()==='div,wd,add'&&s4.hist[2].amt===1000&&s4.hist[1].amt===200&&s4.hist[0].amt===3.5&&s4.hist.every(x=>x.leg===undefined&&x.sym===undefined&&typeof x.ts==='number'),JSON.stringify(s4.hist)); }
  // ── V3 검증
  { const s={settings:{ticker:'USD',park:'bill'},hist:[]}, c=harness(S,s);
    c.sheetSelIvs('buy'); c.V.shi_price.value=''; c.V.shi_qty.value='13'; c.sheetSaveIvs();
    c.V.shi_price.value='53.83'; c.V.shi_qty.value='0'; c.sheetSaveIvs();
    c.sheetSelIvs('add'); c.V.shi_amt.value=''; c.sheetSaveIvs();
    c.V.shi_date.value=''; c.V.shi_amt.value='10'; c.sheetSaveIvs();
    t('V3 단가 없음 · 수량 0 · 금액 없음 · 날짜 없음 → 알림만 · 기록·저장·닫기 없음',s.hist.length===0&&c.log.filter(x=>x.startsWith('alert:')).length===4&&!c.log.includes('save')&&!c.log.includes('close'),JSON.stringify(c.log)); }
  // ── V4 배선
  { const op=fnOf(S.idx,'function openSheet()'), sa=fnOf(S.idx,'function startApp()'), st=fnOf(S.idx,'function setupTabs()');
    t('V4 openSheet — 무매·VR·섀넌 아니면 알림 · 섀넌은 섀넌 양식·제목 · VR 바인딩은 VR 만',
      /if\(tab!=='inf'&&tab!=='vr'&&tab!=='ivs'\)\{ alert\(/.test(op)&&/tab==='ivs'\?sheetIvsHTML\(today\):sheetVrHTML\(today\)/.test(op)&&/tab==='ivs'\?'섀넌 거래 기록'/.test(op)&&/else if\(tab==='vr'\)bindSheetVr\(\);/.test(op));
    t('V4 FAB — 탭 클릭: 섀넌도 보임 · 시작: 무매·VR·섀넌만 보임(적립·로테·ASAP 숨김) · 닫을 때 유형·종목 초기화',
      /t\.dataset\.t==='ivs'\)\{ refreshIvs\(\); try\{ loadIvsData\(\); \}catch\(e\)\{console\.error\(e\)\} showFab\(\); \}/.test(st)
      &&/if\(S\.activeTab==='inf'\|\|S\.activeTab==='vr'\|\|S\.activeTab==='ivs'\)showFab\(\); else hideFab\(\);/.test(sa)
      &&/shIvsType='buy';shIvsLeg='lev';\}/.test(fnOf(S.idx,'function closeSheet()'))); }
  return bad;
}
const MUT=[
  ['저장: 수수료 안 붙음(_ivsPush fee 0)','idx',s=>s.replace("const amt=q*price, fee=amt*IVS_FEE;","const amt=q*price, fee=0;")],
  ['저장: 1배수 짝을 골라도 주 종목으로','idx',s=>s.replace("const leg=(X1&&shIvsLeg==='x1')?'x1':'lev';","const leg='lev';")],
  ['저장: 검증 없이 기록','idx',s=>s.replace("if(!(price>0)||!(qty>0)){ alert('단가와 수량을 입력하세요'); return; }\n    const leg=","if(false){ alert('단가와 수량을 입력하세요'); return; }\n    const leg=")],
  ['저장: 입금·출금·배당 유형을 안 적음','idx',s=>s.replace("c.hist.push({type:shIvsType,date,amt:+amt,ts:Date.now()});","c.hist.push({type:'add',date,amt:+amt,ts:Date.now()});")],
  ['라우팅: 섀넌에 VR 양식(옛 코드)','idx',s=>s.replace("tab==='inf'?sheetInfHTML(today):tab==='ivs'?sheetIvsHTML(today):sheetVrHTML(today);","tab==='inf'?sheetInfHTML(today):sheetVrHTML(today);")],
  ['FAB: 시작 규칙 옛 코드(로테·ASAP 만 숨김)','idx',s=>s.replace("if(S.activeTab==='inf'||S.activeTab==='vr'||S.activeTab==='ivs')showFab(); else hideFab();","if(S.activeTab==='ma'||S.activeTab==='asap')hideFab(); else showFab();")],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 섀넌 기록 시트: 양식 5종(1배수 짝 선택) · 저장은 주문대로 체결 기록과 같은 길(수수료·leg·sym) · 입금·출금·배당 · 날짜순 · 검증 · 라우팅 · FAB 규칙');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS ivs sheet · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
