/* ══════════════════════════════════════════════════════════════════
   strategy-check.js — 전략 검증 SSOT (UMD: Node + 브라우저 공유)
   · Node(CI): require해서 문서수치·규약·엣지 검증
   · 브라우저(배지): window.StrategyCheck.run() → 앱에서 ?selftest=1 시 오버레이
   원칙: 여기 담긴 건 "문서 기준값"과 "규약 불변식"뿐. 앱 실함수(computeInf 등)와
        차분 대조는 회귀테스트.js(Node 전용, 실데이터 필요)가 담당.
   ══════════════════════════════════════════════════════════════════ */
(function(root, factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.StrategyCheck=factory();
}(typeof self!=='undefined'?self:this, function(){
  'use strict';
  const near=(a,b,tol)=>Math.abs(a-b)<=Math.max(tol??1e-6, Math.abs(b)*1e-9);

  // ── 문서 기준 재현본 (앱과 독립 — 앱이 틀리면 대조에서 갈림) ──
  function starPct(ticker,div,T){
    if(ticker==='TQQQ'){const K={20:1.5,30:1.0,40:0.75};const k=K[div]!==undefined?K[div]:(1.5*20/div);return 15-k*T;}
    const K={20:2.0,30:4/3,40:1.0};const k=K[div]!==undefined?K[div]:(2*20/div);return 20-k*T;
  }
  function reverseT(kind,t,div){
    if(kind==='리버스매도') return div>=40?t*0.95:t*0.9;
    if(kind==='리버스매수') return t+(div-t)*0.25;
    return t;
  }
  // 종목 계열 규약: TQQQ만 TQQQ식, 그 외 전부 SOXL식 (base↔복귀 짝)
  function seriesBase(tkr){ return tkr==='TQQQ'?15:20; }
  function seriesExit(tkr){ return tkr==='TQQQ'?0.85:0.80; }

  // ── 체크 정의 (앱 함수를 넘기면 실함수 대조까지, 안 넘기면 기준값 자체검증) ──
  function run(app){
    app=app||{};
    const R=[]; const ok=(n,c,d)=>R.push({n,pass:!!c,d:d||''});

    // [1] 문서 수치
    ok('별% TQQQ20 T10=0', near(starPct('TQQQ',20,10),0));
    ok('별% TQQQ40 T10=7.5', near(starPct('TQQQ',40,10),7.5));
    ok('별% SOXL20 T10=0', near(starPct('SOXL',20,10),0));
    ok('별% SOXL40 T25=-5', near(starPct('SOXL',40,25),-5));
    ok('1회매수금 19522/39=500.56', near(19522/39,500.56,0.01));
    ok('리버스T 39.5×0.95=37.525', near(reverseT('리버스매도',39.5,40),37.525));
    ok('리버스T →38.14375', near(reverseT('리버스매수',37.525,40),38.14375));
    ok('리버스T 20분할 →18.1625', near(reverseT('리버스매수',reverseT('리버스매도',19.5,20),20),18.1625));
    { let s=200,seq=[s]; for(let i=0;i<4;i++){s-=Math.floor(s/20);seq.push(s);}
      ok('무한매도 200→190→181→172→164', seq.join(',')==='200,190,181,172,164', seq.join(',')); }
    ok('쿼터매수 (400+300)/4=175', (400+300)/4===175);

    // [2] 종목 계열 규약 — 앱 starPct가 있으면 대조, base↔exit 짝
    for(const tkr of ['TQQQ','SOXL','TECL','KORU']){
      for(const div of [20,40]){
        const ref=starPct(tkr,div,3);
        if(app.starPct) ok(`계열 ${tkr}${div}: 앱↔기준`, near(app.starPct(tkr,div,3),ref), `app=${app.starPct?app.starPct(tkr,div,3):'-'} ref=${ref}`);
        else ok(`계열 ${tkr}${div} 기준 유효`, isFinite(ref));
      }
      const wantExit = seriesBase(tkr)===20?0.80:0.85;
      ok(`복귀↔base 짝 ${tkr}`, near(seriesExit(tkr),wantExit));
    }

    // [3] 앱 computeInf 대조 (넘겨준 경우) — float 톨러런스 사이클종료
    if(app.computeInf && app.setHist){
      const st={ticker:'SOXL',div:20,principal:10000};
      // 소수 수량 익절+쿼터로 전량매도 → 사이클종료·T리셋 확인
      app.setHist(st,[
        {kind:'1회매수',price:100,qty:3.3333},
        {kind:'지정가매도',price:120,qty:2.5},
        {kind:'쿼터매도',price:118,qty:0.8333},
      ]);
      const c=app.computeInf();
      ok('float 사이클종료: 보유≈0', Math.abs(c.qty)<1e-6, 'qty='+c.qty);
      ok('float 사이클종료: T리셋', c.T===0, 'T='+c.T);
    }

    // [4] 앱 computeVr 대조 (넘겨준 경우) — 0원시작 Pool 비음수
    if(app.computeVr && app.setVr){
      app.setVr({ticker:'TQQQ',mode:0.75,g:10,startv:0,startpool:0,band:15,formula:'basic'},
                [{type:'buy',price:77,qty:10,cyc:0}]);
      const r=app.computeVr();
      ok('VR 0원시작: Pool≥0', r.pool>=-1e-6, 'pool='+r.pool);
      ok('VR 첫매수=V', near(r.V,770));
    }

    const pass=R.filter(x=>x.pass).length, fail=R.length-pass;
    return {pass, fail, total:R.length, results:R, allGreen:fail===0};
  }

  // 브라우저 배지 오버레이
  function badge(app){
    if(typeof document==='undefined') return;
    const r=run(app);
    const el=document.createElement('div');
    el.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;'+
      'font:600 12px/1.4 system-ui;padding:8px 14px;border-radius:10px;max-width:92vw;'+
      'box-shadow:0 4px 20px rgba(0,0,0,.3);cursor:pointer;'+
      (r.allGreen?'background:#0f3d2e;color:#5eead4;border:1px solid #2dd4bf'
                 :'background:#3d0f14;color:#fda4af;border:1px solid #f43f5e');
    el.textContent=(r.allGreen?'✓ 셀프테스트 '+r.pass+'/'+r.total+' PASS':'✗ '+r.fail+'개 실패 — 탭하여 상세')+' (탭: 닫기)';
    el.onclick=()=>{ if(!r.allGreen) console.table(r.results.filter(x=>!x.pass)); el.remove(); };
    (document.body||document.documentElement).appendChild(el);
    if(!r.allGreen) console.table(r.results.filter(x=>!x.pass));
    return r;
  }

  return {run, badge, _ref:{starPct,reverseT,seriesBase,seriesExit}};
}));
