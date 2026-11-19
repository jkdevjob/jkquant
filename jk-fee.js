/* 공통 수수료 — 한 곳 (2026-11-19 사용자: "수수료는 전부 똑같이 적용하고 기본 공통으로 사용할 수수료를 설정에서 탭하나 더 만들어서
   거기에 기본 0.25로 입력해 그 값을 가져다가 모든 수수료에 적용해 지금 수수료 적용되지 않는 전략들도 전부")
   저장: 사용자 문서 users/{uid}.commonFee = {rate, updated} — rate 는 비율(0.0025 = 0.25%). 없거나 범위 밖이면 기본 0.25%.
   쓰는 곳: 운영 장부 · 기록 · 주문 수량 · 모의 · 포트폴리오 · 세금 점검 · 백테 · 듀얼가드 · 서버 무매 계산(functions/api/_fee.js 가 같은 규칙).
   수수료 = 거래금액 × 율 (매수 · 매도 각각) · 시작 보유 등록(seed)은 매매가 아니라 0.
   설정 화면(settings.html › 💸 수수료)이 쓰고, 다른 화면은 사용자 문서를 읽을 때 fromDoc 으로 받는다. 브라우저 저장소는 쓰지 않는다. */
(function(g){
  'use strict';
  const DEFAULT=0.0025, MAX=0.02, FIELD='commonFee';
  /* 0 이상 2% 이하의 숫자만 — 그 밖(음수 · 문자 · 퍼센트를 그대로 넣은 0.25 등)은 받지 않는다 */
  function valid(r){ const x=+r; return (r!==null&&r!==''&&Number.isFinite(x)&&x>=0&&x<=MAX)?x:null; }
  function fromDoc(d){ const c=d&&d[FIELD]; const x=c&&typeof c==='object'?valid(c.rate):null; return x==null?DEFAULT:x; }
  /* 화면 % 글자 ↔ 비율 — 입력 0.25(%) → 0.0025 */
  function fromPct(p){ const s=String(p==null?'':p).trim(); if(s==='') return null; const x=+s; return Number.isFinite(x)?valid(x/100):null; }
  function pct(r){ const x=(+r)*100; return (Math.round(x*10000)/10000).toString(); }
  function docPatch(rate,now){ const x=valid(rate); if(x==null) throw new Error('수수료율은 0~'+(MAX*100)+'% 사이여야 합니다'); return {[FIELD]:{rate:x,updated:now||Date.now()}}; }
  g.JKFee={DEFAULT,MAX,FIELD,valid,fromDoc,fromPct,pct,docPatch};
})(typeof window!=='undefined'?window:globalThis);
