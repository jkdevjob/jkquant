/* 부동산 🤖 클로드 — 🔨 경매 칸 화면. 계산은 경매 엔진(realestate-claude-auction.js)만 한다 — 여기서는 그리기·입력·저장만.
   시세는 아파트 엔진의 KB 자료(대단지 84㎡)에서 고르거나 직접 넣는다. 장부는 내 계정(realestate-claude-account.js)에 저장한다.
   이 파일과 #pane-claude 안만 클로드 작업 영역이다(지피티 칸은 건드리지 않는다). */
(function(){
'use strict';
const U=window.JKREAuction;
const SUBS=[['guide','📖 처음이라면'],['find','🔗 물건 찾기 · 유찰 계산'],['calc','🧮 분석 · 모의입찰'],['book','📒 내 모의입찰 장부'],['onbid','🏛️ 온비드 공매']];
const LINKS=[
  ['대법원 법원경매정보(공식)','https://www.courtauction.go.kr/','물건 검색 → 법원: 대전지방법원 → 용도: 아파트 → 검색. 사건을 누르면 매각물건명세서·현황조사서·감정평가서가 있습니다'],
  ['인터넷등기소(등기부 열람·발급)','https://www.iros.go.kr/','등기부등본(유료 몇백 원)으로 말소기준권리 날짜를 확인합니다'],
  ['온비드(캠코 공매)','https://www.onbid.co.kr/','법원경매가 아닌 공매 — 인터넷으로 입찰합니다'],
  ['KB부동산(시세)','https://kbland.kr/','단지 시세·실거래 확인']
];
const S={sub:'guide',form:null,book:null,bookErr:null,busy:false,msg:null,q:''};
const DRAFT='rec-auc-draft-v1';
const CSS=`
.rec .auc .fg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 10px;margin:6px 0 10px}
.rec .auc label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dim);font-weight:700}
.rec .auc label.ck{flex-direction:row;align-items:center;gap:6px;font-weight:600}
.rec .auc input[type=text],.rec .auc input[type=number],.rec .auc input[type=date],.rec .auc input[type=search],.rec .auc select{background:var(--surf);color:var(--text);border:1px solid var(--border);border-radius:8px;height:38px;padding:0 9px;font-size:16px;width:100%;box-sizing:border-box}
.rec .auc .hint{font-size:11px;color:var(--faint);font-weight:600}
.rec .auc .sec{font-size:13px;font-weight:900;color:var(--text);margin:12px 0 4px}
.rec .auc .pick{display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto;margin:4px 0}
.rec .auc .pick button{text-align:left;background:var(--surf);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:12.5px;cursor:pointer}
.rec .auc .big2{font-size:17px;font-weight:900;line-height:1.4}
.rec .auc .lv{display:inline-block;font-size:11px;font-weight:900;padding:2px 8px;border-radius:999px;border:1px solid var(--border)}
.rec .auc .lv.safe{color:var(--green);border-color:rgba(54,211,153,.5)} .rec .auc .lv.check{color:var(--gold);border-color:rgba(245,196,81,.5)} .rec .auc .lv.danger{color:var(--red);border-color:rgba(248,123,140,.5)} .rec .auc .lv.unknown{color:var(--dim)}
.rec .auc .tn{border:1px dashed var(--border);border-radius:10px;padding:8px;margin:6px 0}
.rec .auc .acts{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.rec .auc .btn.pri{border-color:var(--gold);color:var(--gold)}
.rec .auc .step{display:flex;gap:9px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12.5px;line-height:1.6}
.rec .auc .step b.n{flex:0 0 22px;height:22px;border-radius:50%;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:11px}
`;
let C=null;   // 화면 도우미(realestate-claude.js 가 넘김): A · X · esc · eok · man · pct · pct0 · num · cls · rerender

/* ── 입력 상태 ── */
function blankForm(){ return {court:'대전지방법원',caseNo:'',itemNo:1,saleDate:'',name:'',complexId:null,area:'',appraisal:'',fails:'1',minPrice:'',resale:false,market:'',marketSrc:'',
  base:'',tenants:[{deposit:'',moveIn:'',fixed:'',claimed:false}],flags:{},legal:String(U.DEFAULTS.legal),moveOut:String(U.DEFAULTS.moveOut),repair:'0',arrears:'0',loan:'',loanRate:String(U.DEFAULTS.loanRate),bid:'',memo:''}; }
function loadDraft(){ try{ const s=localStorage.getItem(DRAFT); if(s) return Object.assign(blankForm(),JSON.parse(s)); }catch(e){} return blankForm(); }
function saveDraft(){ try{ localStorage.setItem(DRAFT,JSON.stringify(S.form)); }catch(e){} }
const n=v=>{ if(v==null||v==='') return null; const x=+String(v).replace(/[, ]/g,''); return isFinite(x)?x:null; };
function caseInput(f){
  const tenants=(f.tenants||[]).filter(t=>n(t.deposit)!=null||t.moveIn).map(t=>({deposit:n(t.deposit)||0,moveIn:t.moveIn||'',fixed:t.fixed||'',claimed:!!t.claimed}));
  const flags={}; for(const k of Object.keys(f.flags||{})) if(f.flags[k]) flags[k]=true;
  return {court:f.court,caseNo:(f.caseNo||'').trim(),itemNo:n(f.itemNo)||1,saleDate:f.saleDate||'',name:f.name||'',complexId:f.complexId||null,area:n(f.area),
    appraisal:n(f.appraisal),round:(n(f.fails)||0)+1,minPrice:n(f.minPrice),resale:!!f.resale,market:n(f.market),marketSrc:f.marketSrc||'',
    rights:{base:f.base||'',tenants,flags},loan:n(f.loan),bid:n(f.bid),memo:f.memo||''};
}
function opts(f){ return {legal:n(f.legal)||0,moveOut:n(f.moveOut)||0,repair:n(f.repair)||0,arrears:n(f.arrears)||0,loanRate:n(f.loanRate)==null?U.DEFAULTS.loanRate:n(f.loanRate)}; }
const today=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);   // 한국 날짜

/* ── 장부(내 계정) ── */
async function loadBook(){
  const acc=window.REC_ACCOUNT; if(!acc){ S.book=null; S.bookErr='login'; return; }
  try{ S.book=await acc.load(); S.bookErr=null; }catch(e){ S.book=null; S.bookErr=e.message||String(e); }
}
async function saveBook(mutate){
  const acc=window.REC_ACCOUNT; if(!acc) throw new Error('로그인 뒤 저장할 수 있습니다');
  if(!S.book) await loadBook(); if(!S.book) throw new Error(S.bookErr||'장부를 불러오지 못했습니다');
  const next=Object.assign({},S.book,{cases:mutate((S.book.cases||[]).slice())});
  S.book=await acc.save(next,S.book.revision||0);
}

/* ── 그리기 ── */
function render(el,ctx){
  C=ctx; if(!S.form) S.form=loadDraft();
  if(!document.getElementById('rec-auc-css')){ const s=document.createElement('style'); s.id='rec-auc-css'; s.textContent=CSS; document.head.appendChild(s); }
  let h='<div class="auc"><div class="sub2 ref">'+SUBS.map(t=>'<button class="chip'+(S.sub===t[0]?' on':'')+'" data-as2="'+t[0]+'">'+t[1]+'</button>').join('')+'</div>';
  if(S.msg) h+='<div class="warn">'+C.esc(S.msg)+'</div>';
  h+=({guide:guideHtml,find:findHtml,calc:calcHtml,book:bookHtml,onbid:onbidHtml})[S.sub]()+'</div>';
  el.innerHTML=h;
  el.querySelectorAll('[data-as2]').forEach(b=>b.onclick=()=>{ S.sub=b.getAttribute('data-as2'); S.msg=null; if(S.sub==='book'&&!S.book) loadBook().then(()=>C.rerender()); C.rerender(); });
  bind(el);
}
function guideHtml(){
  const st=(i,t,d)=>'<div class="step"><b class="n">'+i+'</b><div><b>'+t+'</b><div class="note">'+d+'</div></div></div>';
  return '<div class="card"><h3>📖 경매, 처음이라면 — 이것만</h3><p class="lead">경매는 빚을 못 갚은 집을 법원이 대신 팔아 주는 것입니다. 사는 사람은 <b>시세보다 싸게</b> 살 수 있지만, <b>집에 걸린 권리와 사람(임차인)</b>을 내가 정리해야 할 수도 있습니다.</p>'
    +st(1,'물건 고르기','대법원 법원경매정보에서 대전지방법원 · 아파트로 찾습니다. 처음엔 <b>대단지 · 임차인 없는(또는 배당 다 받는) 집</b>만.')
    +st(2,'최저가 보기','처음 나온 집은 감정가 그대로. 아무도 안 사면(유찰) 대전지법은 <b>30%씩</b> 내려갑니다. 🔗 물건 찾기 칸에서 계산해 보세요.')
    +st(3,'권리 확인 — 딱 하나만','등기부에서 <b>가장 먼저 등기된 (근)저당·(가)압류</b> 날짜(말소기준)를 찾습니다. 그 <b>날짜보다 먼저 전입한 임차인</b>이 있으면, 그 보증금을 내가 물어줘야 할 수 있습니다.')
    +st(4,'돈 계산','입찰가 + 취득세 + 법무 + 명도(이사비) + 수리 + 떠안는 돈 = 실제로 드는 돈. 이게 <b>시세보다 충분히 싸야</b> 의미가 있습니다. 🧮 칸이 대신 계산합니다.')
    +st(5,'입찰 날','법원에 가서 최저가의 <b>10%를 보증금</b>으로 내고 입찰. 떨어지면 그 자리에서 돌려받습니다.')
    +st(6,'낙찰 뒤','보통 한 달 안팎에 잔금(경락잔금대출 가능 — 은행·소득에 따라 다름). 그다음 사는 사람을 내보내는 <b>명도</b>(협의 · 안 되면 인도명령).')
    +'<div class="warn">처음 20~30번은 <b>모의입찰</b>로 연습하세요. 🧮 칸에서 사건을 넣고 입찰가를 저장해 두면, 매각기일 뒤 실제 낙찰가와 비교해 줍니다. 돈은 안 듭니다.</div>'
    +'<h4>꼭 알아 둘 것</h4><ul class="f"><li><b>낙찰가율은 감정가 대비</b>입니다. 감정가는 몇 달 전 값이라 시세가 떨어질 땐 실제 할인이 그보다 작습니다.</li>'
    +'<li>1년 안에 팔면 양도세 77%, 2년 안이면 66%(지방세 포함). 경매는 <b>싸게 들어가는 안전마진</b>이지 빨리 버는 수단이 아닙니다.</li>'
    +'<li>유치권 · 법정지상권 · 지분 · 대지권 미등기 · 선순위 가처분은 <b>처음이면 피하기</b>.</li>'
    +'<li>여기 계산은 연습용 근사입니다. 실제 입찰 전에는 매각물건명세서 · 등기부 원문 확인과 법무사 상담을 하세요.</li></ul></div>';
}
function findHtml(){
  const f=S.form,a=n(f.appraisal),sch=a?U.schedule(a):[];
  let h='<div class="card"><h3>🔗 물건 찾기 — 공식 사이트로</h3><p class="lead">아래 링크는 폰·PC에서 바로 열립니다. 마음에 드는 사건을 찾으면 사건번호 · 감정가 · 유찰 횟수를 🧮 칸에 넣으세요.</p>'
    +LINKS.map(l=>'<div class="up1"><a href="'+C.esc(l[1])+'" target="_blank" rel="noopener"><b>'+C.esc(l[0])+'</b></a><div class="note">'+C.esc(l[2])+'</div></div>').join('')+'</div>';
  h+='<div class="card"><h3>🧮 유찰 계산 — 감정가를 넣으면 회차별 최저가</h3><div class="fg"><label>감정가(만원)<input type="number" inputmode="numeric" data-f="appraisal" value="'+C.esc(f.appraisal)+'" placeholder="예: 30000 = 3억"></label></div>'
    +(sch.length?'<div class="tw"><table><tr><th class="l">회차</th><th>최저가</th><th>감정가 대비</th><th>보증금(10%)</th></tr>'+sch.map(r=>'<tr><td class="l">'+(r.round===1?'1회(신건)':r.round+'회 · 유찰 '+(r.round-1)+'번')+'</td><td><b>'+C.eok(r.min)+'</b></td><td>'+C.pct0(r.ratio,0)+'</td><td>'+C.man(r.deposit)+'</td></tr>').join('')+'</table></div>'
      :'<div class="note">감정가를 넣으면 표가 나옵니다.</div>')
    +'<div class="note">대전지방법원은 유찰마다 30%씩 내리는 것으로 알려져 있습니다. 사건마다 매각공고의 최저가가 정답입니다.</div></div>';
  return h;
}
function complexPick(){
  const A=C.A; if(!A||!A.U) return '';
  const q=(S.q||'').trim(); if(!q) return '';
  const hits=A.U.filter(u=>(u.name+u.dong+u.gu).replace(/\s/g,'').indexOf(q.replace(/\s/g,''))>=0).slice(0,8);
  return '<div class="pick">'+(hits.length?hits.map(u=>{ const qv=C.X.quote(A,u.id,A.lastK); return '<button data-cx="'+u.id+'">'+C.esc((u.city==='세종'?'세종 ':u.gu+' ')+u.dong+' '+u.name)+' <span class="note">'+Math.floor(u.excl)+'㎡ · KB '+C.eok(qv.price)+' ('+C.esc(qv.m)+')</span></button>'; }).join('')
    :'<div class="note">우리 자료(대전·세종 1,000세대 이상 대단지 84㎡)에 없는 단지입니다. 시세를 직접 넣으세요.</div>')+'</div>';
}
function calcHtml(){
  const f=S.form,inp=caseInput(f),a=U.analyze(inp,opts(f),today()),R=a.rights||{level:'unknown',items:[],notes:[],red:[]};
  const fld=(k,label,type,ph,hint)=>'<label>'+label+'<input type="'+(type||'text')+'"'+(type==='number'?' inputmode="numeric"':'')+' data-f="'+k+'" value="'+C.esc(f[k]==null?'':f[k])+'"'+(ph?' placeholder="'+C.esc(ph)+'"':'')+'>'+(hint?'<span class="hint">'+hint+'</span>':'')+'</label>';
  const eokHint=k=>n(f[k])?C.eok(n(f[k])):'';
  let h='<div class="card"><h3>🧮 사건 분석 · 모의입찰</h3><p class="lead">사건 정보를 넣으면 실제로 드는 돈 · 시세 대비 할인 · 내 돈 · 2년 뒤 결과를 계산합니다. 단위는 <b>만원</b>(3억 = 30000).</p>';
  h+='<div class="sec">1. 사건</div><div class="fg">'+fld('caseNo','사건번호','text','2026타경12345')+fld('itemNo','물건번호','number','1')+fld('saleDate','매각기일','date')+fld('court','법원','text')+'</div>';
  h+='<div class="sec">2. 집 · 시세</div><div class="fg"><label>우리 자료에서 단지 찾기<input type="search" data-q="1" value="'+C.esc(S.q)+'" placeholder="단지 이름 (예: 크로바)"><span class="hint">대전·세종 1,000세대 이상 84㎡만 있습니다</span></label>'
    +fld('name','단지·주소','text','둔산동 ○○아파트')+fld('area','전용면적(㎡)','number','84.9')+'</div>'+complexPick()
    +'<div class="fg">'+fld('market','시세(만원)','number','28000',eokHint('market')+(f.marketSrc?' · '+C.esc(f.marketSrc):''))+'</div>';
  h+='<div class="sec">3. 가격</div><div class="fg">'+fld('appraisal','감정가(만원)','number','30000',eokHint('appraisal'))
    +'<label>유찰 횟수<select data-f="fails">'+[0,1,2,3,4,5].map(i=>'<option value="'+i+'"'+(String(f.fails)===String(i)?' selected':'')+'>'+(i?i+'번(지금 '+(i+1)+'회차)':'없음(신건)')+'</option>').join('')+'</select></label>'
    +fld('minPrice','최저가(만원, 공고값)','number',a.minPrice?String(a.minPrice):'',a.minPrice?'비우면 자동: '+C.eok(a.minPrice):'')
    +'<label class="ck"><input type="checkbox" data-f="resale"'+(f.resale?' checked':'')+'> 재매각(보증금 20%)</label></div>';
  h+='<div class="sec">4. 권리 연습 <span class="lv '+R.level+'">'+({safe:'안전해 보임',check:'확인 필요',danger:'위험 — 처음이면 피하기',unknown:'판단 전'})[R.level]+'</span></div>'
    +'<div class="fg">'+fld('base','말소기준권리 날짜','date','','등기부에서 가장 먼저 등기된 (근)저당·(가)압류')+'</div>'
    +(f.tenants||[]).map((t,i)=>'<div class="tn"><div class="note">임차인 '+(i+1)+'</div><div class="fg">'
      +'<label>보증금(만원)<input type="number" inputmode="numeric" data-t="'+i+'.deposit" value="'+C.esc(t.deposit)+'"></label>'
      +'<label>전입일<input type="date" data-t="'+i+'.moveIn" value="'+C.esc(t.moveIn)+'"></label>'
      +'<label>확정일자<input type="date" data-t="'+i+'.fixed" value="'+C.esc(t.fixed)+'"></label>'
      +'<label class="ck"><input type="checkbox" data-t="'+i+'.claimed"'+(t.claimed?' checked':'')+'> 배당요구 함</label></div></div>').join('')
    +'<div class="acts"><button class="btn" data-act="addT">+ 임차인</button>'+((f.tenants||[]).length>1?'<button class="btn" data-act="delT">− 임차인</button>':'')+'</div>'
    +'<div class="fg">'+Object.keys(U.FLAGS).map(k=>'<label class="ck"><input type="checkbox" data-fl="'+k+'"'+(f.flags&&f.flags[k]?' checked':'')+'> '+C.esc(U.FLAGS[k])+'</label>').join('')+'</div>'
    +(R.items.length?'<ul class="f">'+R.items.map(x=>'<li>'+C.esc(x.who)+' '+C.man(x.deposit)+' — '+C.esc(x.why)+'</li>').join('')+'</ul>':'')
    +(R.red.length?'<div class="warn">특수 권리: '+C.esc(R.red.join(' · '))+' — 계산하지 않습니다. 처음이면 피하세요.</div>':'')
    +'<div class="note">'+C.esc(R.notes.join(' '))+'</div>';
  h+='<div class="sec">5. 비용 가정 <span class="note">(바꿀 수 있음)</span></div><div class="fg">'+fld('moveOut','명도(이사비 등)','number')+fld('repair','수리비','number')+fld('arrears','미납 관리비(공용)','number')+fld('legal','등기·법무','number')
    +fld('loan','대출(만원)','number',a.loan!=null?String(a.loan):'',a.loan!=null&&n(f.loan)==null?'비우면 추정: '+C.eok(a.loan)+' (은행 상담 필요)':'')+fld('loanRate','대출 금리(연 %)','number')+'</div>';
  h+='<div class="sec">6. 내 입찰가</div><div class="fg">'+fld('bid','입찰가(만원)','number','',eokHint('bid'))+'</div>'
    +(a.maxBid?'<div class="acts"><button class="btn pri" data-act="useMax">시세보다 '+Math.round(U.DEFAULTS.target*100)+'% 싸게 되는 입찰가 쓰기: '+C.eok(a.maxBid)+'</button></div>':'')+'</div>';
  h+=resultCard(a,f);
  return h;
}
function resultCard(a,f){
  const W=a.warn||[];
  if(W.indexOf('noAppraisal')>=0) return '<div class="card"><div class="note">감정가를 넣으면 계산을 시작합니다.</div></div>';
  let h='<div class="card"><h3>📋 결과 — 쉬운 말로</h3>';
  if(a.verdict) h+='<div class="big2 '+(a.verdict==='ok'?'up':a.verdict==='danger'?'dn':'gd')+'">'+({ok:'✅ 해볼 만한 범위가 있어요',wait:'⏳ 지금 최저가로는 비싸요 — 유찰을 기다려 보기',danger:'⛔ 권리가 위험해요 — 처음이면 패스',none:'계산할 수 없어요'})[a.verdict]+'</div>'
    +(a.maxBid?'<div class="note">시세보다 '+Math.round(U.DEFAULTS.target*100)+'% 싸게(비용 포함) 사려면 입찰가 <b>'+C.eok(a.maxBid)+'</b> 이하 · 최저가 '+C.eok(a.minPrice)+'</div>':'');
  if(W.indexOf('noMarket')>=0) h+='<div class="warn">시세를 넣어야 할인·이익을 계산합니다.</div>';
  if(W.indexOf('belowMin')>=0) h+='<div class="warn">입찰가가 최저가('+C.eok(a.minPrice)+')보다 낮으면 무효입니다.</div>';
  if(a.ok){
    const c=a.costs;
    h+='<div class="kv"><span>입찰 날 보증금</span><b>'+C.man(a.deposit)+' <span class="note">(최저가의 '+(f.resale?'20':'10')+'% · 떨어지면 돌려받음)</span></b></div>'
      +'<div class="kv"><span>실제로 드는 돈</span><b>'+C.eok(a.total)+'</b></div>'
      +'<div class="note">입찰가 '+C.eok(a.bid)+' + 취득세 '+C.man(c.acq)+' + 등기·법무 '+C.man(c.legal)+' + 명도 '+C.man(c.moveOut)+(c.repair?' + 수리 '+C.man(c.repair):'')+(c.arrears?' + 관리비 '+C.man(c.arrears):'')+(c.assume?' + <b class="dn">떠안는 돈 '+C.man(c.assume)+'</b>':'')+'</div>'
      +'<div class="kv"><span>시세 '+C.eok(a.market)+'보다</span><b class="'+C.cls(a.disc)+'">'+(a.disc>=0?C.pct0(a.disc)+' 싸게 산 셈':C.pct0(-a.disc)+' 비싸게 산 셈')+'</b></div>'
      +'<div class="kv"><span>낙찰가율(감정가 대비)</span><b>'+C.pct0(a.bidApp)+'</b></div>'
      +'<div class="kv"><span>대출 · 내 돈</span><b>'+C.eok(a.loan)+' · <b>'+C.eok(a.cash)+'</b></b></div>'
      +'<div class="kv"><span>2년 뒤 시세 그대로 팔면</span><b class="'+C.cls(a.y2.profit)+'">'+(a.y2.profit>=0?'+':'')+C.eok(a.y2.profit)+' ('+C.pct(a.y2.roi)+')</b></div>'
      +'<div class="note">대출 갚고 '+C.eok(a.y2.back)+' 남음 · 중개 '+C.man(a.y2.broker)+' · 양도세 '+(a.y2.tax?C.man(a.y2.tax):'0(1주택 비과세)')+' · 이자 '+C.man(a.y2.interest)+' · 보유세 '+C.man(a.y2.hold)+'</div>'
      +'<div class="kv"><span>1년 만에 팔면</span><b class="'+C.cls(a.y1.profit)+'">'+(a.y1.profit>=0?'+':'')+C.eok(a.y1.profit)+' <span class="note">(양도세 '+C.man(a.y1.tax)+')</span></b></div>'
      +(a.rights.level==='unknown'?'<div class="warn">권리 정보를 안 넣어서 떠안는 돈을 0으로 계산했습니다. 말소기준 날짜와 임차인을 넣어 보세요.</div>':'')
      +'<div class="acts"><button class="btn pri" data-act="save"'+(S.busy?' disabled':'')+'>📒 모의입찰 장부에 저장</button><button class="btn" data-act="reset">새 사건</button></div>'
      +'<div class="note">저장하면 지금의 입력·가정·계산이 그대로 남습니다. 매각기일이 지나면 장부에서 실제 낙찰가를 넣어 비교하세요.</div>';
  }
  return h+'</div>';
}
function bookHtml(){
  if(!window.REC_ACCOUNT) return '<div class="card"><div class="warn">로그인(이용 승인) 뒤 내 계정에 장부가 저장됩니다.</div></div>';
  if(S.bookErr&&S.bookErr!=='login') return '<div class="card"><div class="warn">장부를 불러오지 못했습니다: '+C.esc(S.bookErr)+'</div><div class="acts"><button class="btn" data-act="reload">다시 불러오기</button></div></div>';
  if(!S.book) return '<div class="card"><div class="note">장부를 불러오는 중…</div></div>';
  const cs=(S.book.cases||[]).slice().reverse(),sm=U.ledgerSummary(S.book.cases||[]),td=today();
  let h='<div class="card"><h3>📒 내 모의입찰 장부</h3>'
    +'<div class="kv"><span>사건</span><b>'+sm.n+'건 · 결과 들어온 것 '+sm.done+' (낙찰 '+sm.sold+' · 유찰 '+sm.unsold+')</b></div>'
    +(sm.sold?'<div class="kv"><span>내 값이면 이겼을 것</span><b>'+sm.won+'건 / '+sm.sold+'건'+(sm.tie?' · 같은 값 '+sm.tie:'')+'</b></div>'
      +'<div class="kv"><span>평균 낙찰가율 · 시세 대비</span><b>'+C.pct0(sm.avgWinApp)+' · '+C.pct0(sm.avgWinMkt)+'</b></div>'
      +'<div class="kv"><span>내 입찰가는 낙찰가보다 평균</span><b class="'+C.cls(sm.avgMyGap)+'">'+C.pct(sm.avgMyGap)+'</b></div>'
      +(sm.won?'<div class="kv"><span>이겼을 때 시세 대비 할인(비용 포함)</span><b>'+C.pct0(sm.avgWonDisc)+'</b></div>':''):'<div class="note">매각기일이 지난 사건에 실제 결과를 넣으면 여기서 비교가 쌓입니다.</div>')
    +'<div class="acts"><button class="btn" data-act="reload">다시 불러오기</button></div></div>';
  h+=cs.map(c=>{ const i=c.input,s=c.snap,r=c.result,due=i.saleDate&&i.saleDate<=td;
    let x='<div class="card"><div class="note">'+C.esc(i.court||'')+' · 매각기일 '+C.esc(i.saleDate||'–')+' · 저장 '+C.esc(String(c.created).slice(0,10))+'</div><div class="et">'+C.esc(i.caseNo)+(i.itemNo>1?' ('+i.itemNo+')':'')+' · '+C.esc(i.name||'')+'</div>'
      +'<div class="kv"><span>감정가 · 최저가 · 내 입찰가</span><b>'+C.eok(i.appraisal)+' · '+C.eok(s.minPrice)+' · <b>'+C.eok(i.bid)+'</b></b></div>'
      +'<div class="kv"><span>시세 · 그때 계산한 할인 · 내 돈</span><b>'+C.eok(i.market)+' · <span class="'+C.cls(s.disc)+'">'+C.pct0(s.disc)+'</span> · '+C.eok(s.cash)+'</b></div>';
    if(r){ x+=r.status==='sold'?'<div class="kv"><span>결과: 낙찰 '+C.eok(r.win)+(r.bidders?' · '+r.bidders+'명':'')+'</span><b class="'+(r.won===true?'up':'dn')+'">'+(r.won===true?'내 값이면 이겼음':r.won==='tie'?'같은 값':'짐')+' · 내 값 '+C.pct(r.myVsWin)+'</b></div><div class="note">낙찰가율 '+C.pct0(r.winApp)+' · 시세 대비 '+C.pct0(r.winMkt)+'</div>'
        :'<div class="kv"><span>결과</span><b>'+({unsold:'유찰',withdrawn:'취하·변경'})[r.status]+'</b></div>'; }
    else if(due) x+='<div class="fg"><label>결과<select data-rs="'+C.esc(c.id)+'"><option value="sold">낙찰</option><option value="unsold">유찰</option><option value="withdrawn">취하·변경</option></select></label><label>낙찰가(만원)<input type="number" inputmode="numeric" data-rw="'+C.esc(c.id)+'"></label><label>입찰자 수<input type="number" inputmode="numeric" data-rb="'+C.esc(c.id)+'"></label></div><div class="acts"><button class="btn pri" data-res="'+C.esc(c.id)+'">결과 저장</button></div>';
    else x+='<div class="note">매각기일 뒤에 결과를 넣을 수 있습니다.</div><div class="acts"><button class="btn" data-del="'+C.esc(c.id)+'">지우기</button></div>';
    return x+'</div>'; }).join('');
  return h;
}
function onbidHtml(){
  return '<div class="card"><h3>🏛️ 온비드 공매 — 준비 중</h3><p class="lead">캠코(한국자산관리공사) 공매는 공공데이터포털에 공식 API가 있어 대전·세종 물건을 매일 자동으로 모아 여기 띄울 수 있습니다. 인증키가 있어야 합니다.</p>'
    +'<ul class="f"><li>공공데이터포털(data.go.kr) 가입 → <b>‘한국자산관리공사_차세대 온비드 공고목록 조회서비스’</b> 활용신청(무료)</li><li>발급된 인증키를 GitHub 저장소 설정의 Secrets 에 <b>DATA_GO_KR_KEY</b> 이름으로 넣기</li><li>그러면 자동 수집을 켜고 이 칸에 목록을 띄웁니다(키 값은 화면·기록 어디에도 안 남김)</li></ul>'
    +'<div class="note"><a href="https://www.data.go.kr/data/15157216/openapi.do" target="_blank" rel="noopener">공고목록 조회서비스 신청 페이지</a> · <a href="https://www.onbid.co.kr/" target="_blank" rel="noopener">온비드</a></div></div>';
}

/* ── 입력 연결 ── */
function setF(k,v){ S.form[k]=v; saveDraft(); }
function bind(el){
  const live=()=>{ const keep=document.activeElement&&document.activeElement.getAttribute('data-f'); C.rerender(); if(keep){ const x=document.querySelector('[data-f="'+keep+'"]'); if(x){ x.focus(); try{ const L=x.value.length; x.setSelectionRange(L,L); }catch(e){} } } };
  el.querySelectorAll('[data-f]').forEach(x=>{
    const k=x.getAttribute('data-f');
    if(x.type==='checkbox') x.onchange=()=>{ setF(k,x.checked); C.rerender(); };
    else if(x.tagName==='SELECT') x.onchange=()=>{ setF(k,x.value); if(k==='fails') setF('minPrice',''); C.rerender(); };
    else { x.oninput=()=>setF(k,x.value); x.onchange=()=>live(); }
  });
  el.querySelectorAll('[data-t]').forEach(x=>{ const [i,k]=x.getAttribute('data-t').split('.');
    if(x.type==='checkbox') x.onchange=()=>{ S.form.tenants[+i][k]=x.checked; saveDraft(); C.rerender(); };
    else { x.oninput=()=>{ S.form.tenants[+i][k]=x.value; saveDraft(); }; x.onchange=()=>C.rerender(); } });
  el.querySelectorAll('[data-fl]').forEach(x=>x.onchange=()=>{ S.form.flags=Object.assign({},S.form.flags,{[x.getAttribute('data-fl')]:x.checked}); saveDraft(); C.rerender(); });
  const q=el.querySelector('[data-q]'); if(q){ q.oninput=()=>{ S.q=q.value; }; q.onchange=()=>{ C.rerender(); const y=document.querySelector('[data-q]'); if(y) y.focus(); }; q.onkeyup=e=>{ if(e.key==='Enter') q.onchange(); }; }
  el.querySelectorAll('[data-cx]').forEach(b=>b.onclick=()=>{ const id=+b.getAttribute('data-cx'),u=C.A.byId[id],qv=C.X.quote(C.A,id,C.A.lastK);
    Object.assign(S.form,{complexId:id,name:(u.city==='세종'?'세종 ':u.gu+' ')+u.dong+' '+u.name,area:String(u.excl),market:String(qv.price),marketSrc:'KB 일반가 '+qv.m+' · 84㎡'}); S.q=''; saveDraft(); C.rerender(); });
  el.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.getAttribute('data-act')));
  el.querySelectorAll('[data-res]').forEach(b=>b.onclick=()=>result(b));
  el.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>del(b.getAttribute('data-del')));
}
async function act(a){
  const f=S.form;
  if(a==='addT'){ f.tenants.push({deposit:'',moveIn:'',fixed:'',claimed:false}); saveDraft(); return C.rerender(); }
  if(a==='delT'){ f.tenants.pop(); saveDraft(); return C.rerender(); }
  if(a==='useMax'){ const x=U.analyze(caseInput(f),opts(f),today()); if(x.maxBid) setF('bid',String(x.maxBid)); return C.rerender(); }
  if(a==='reset'){ S.form=blankForm(); saveDraft(); S.msg=null; return C.rerender(); }
  if(a==='reload'){ await loadBook(); return C.rerender(); }
  if(a==='save'){
    S.busy=true; S.msg=null; C.rerender();
    try{ const cs=U.newCase(caseInput(f),opts(f),new Date().toISOString()); await saveBook(list=>list.concat([cs])); S.msg='저장했습니다 — 📒 장부 칸에서 볼 수 있습니다.'; }
    catch(e){ S.msg='저장 못 함: '+(e.message||e); }
    S.busy=false; return C.rerender();
  }
}
async function result(b){
  const id=b.getAttribute('data-res'),card=b.closest('.card'),g=s=>card&&card.querySelector('['+s+']');
  const st=g('data-rs'),w=g('data-rw'),bd=g('data-rb');
  try{ const res={status:st&&st.value,win:w&&w.value,bidders:bd&&bd.value},at=new Date().toISOString();
    await saveBook(list=>list.map(c=>c.id===id?U.setResult(c,res,at):c)); S.msg='결과를 저장했습니다.'; }
  catch(e){ S.msg='결과 저장 못 함: '+(e.message||e); }
  C.rerender();
}
async function del(id){
  try{ await saveBook(list=>list.filter(c=>!(c.id===id&&!c.result))); S.msg='지웠습니다.'; }catch(e){ S.msg='지우지 못함: '+(e.message||e); }
  C.rerender();
}
window.addEventListener('rec-account',()=>{ S.book=null; S.bookErr=null; if(S.sub==='book'&&C) loadBook().then(()=>C.rerender()); });
window.JKREAuctionUI={render,state:S};
})();
