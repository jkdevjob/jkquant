/* 💸 수수료 탭 — 공통 수수료율 읽기 · 저장 (2026-11-19 사용자: "기본 공통으로 사용할 수수료를 설정에서 탭하나 더 만들어서 거기에 기본 0.25로 입력해")
   저장 자리 · 검사 규칙은 jk-fee.js 한 곳(users/{uid}.commonFee = {rate, updated} · 비율). 브라우저 저장소는 쓰지 않는다.
   다른 화면(운영 · 모의 · 포트폴리오 · 백테 · 듀얼가드)은 사용자 문서를 읽을 때 이 값을 받는다 — 바꾼 뒤 그 화면을 다시 열면 새 값. */
(function(){
  'use strict';
  let busy=false;
  const el=id=>document.getElementById(id);
  const msg=t=>{ const m=el('feeMessage'); if(m) m.textContent=t; };
  const ctx=()=>{ const u=window.jkAuth&&window.jkAuth.currentUser, F=window.jkSettingsDb, K=window.JKFee; return (u&&F&&K)?{u,F,K}:null; };
  async function loadFee(){
    const C=ctx(); if(!C){ msg('로그인 후 저장된 값을 불러옵니다.'); return; }
    if(busy) return; busy=true;
    try{
      const s=await C.F.getDoc(C.F.doc(C.F.db,'users',C.u.uid)), d=s.exists()?(s.data()||{}):{}, r=C.K.fromDoc(d);
      const saved=!!(d[C.K.FIELD]&&C.K.valid(d[C.K.FIELD].rate)!=null);
      const inp=el('feeRatePct'); if(inp) inp.value=C.K.pct(r);
      msg(saved?('저장된 수수료 '+C.K.pct(r)+'% — 모든 전략이 이 값을 씁니다.'):('저장된 값이 없어 기본 '+C.K.pct(C.K.DEFAULT)+'% 를 씁니다. 저장하면 이 값이 공통 수수료가 됩니다.'));
    }catch(e){ msg('불러오기 실패: '+((e&&e.message)||e)); }
    finally{ busy=false; }
  }
  async function saveFee(){
    const C=ctx(); if(!C){ msg('로그인 후 저장할 수 있습니다.'); return; }
    const r=C.K.fromPct((el('feeRatePct')||{}).value);
    if(r==null){ msg('0 ~ '+(C.K.MAX*100)+'% 사이 숫자를 넣으세요 (예: 0.25).'); return; }
    if(busy) return; busy=true; const b=el('feeSave'); if(b) b.disabled=true; msg('저장 중…');
    try{
      await C.F.setDoc(C.F.doc(C.F.db,'users',C.u.uid), C.K.docPatch(r), {merge:true});   // 문서의 다른 칸(운영 장부 등)은 그대로
      msg('저장했습니다 — '+C.K.pct(r)+'%. 운영 · 모의 · 포트폴리오 · 백테 · 듀얼가드 화면을 다시 열면 이 값으로 셉니다.');
    }catch(e){ msg('저장 실패: '+((e&&e.message)||e)+' — 다시 시도하세요.'); }
    finally{ busy=false; if(b) b.disabled=false; }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const b=el('feeSave'); if(b) b.addEventListener('click',saveFee);
    for(const t of document.querySelectorAll('[data-settings-tab="fee"]')) t.addEventListener('click',loadFee);
    if(location.hash==='#fee'&&typeof window.showSettingsTab==='function'){ window.showSettingsTab('fee'); loadFee(); }
  });
  window.addEventListener('jk-settings-auth',loadFee);
  window.jkFeeSettings={loadFee,saveFee};
})();
