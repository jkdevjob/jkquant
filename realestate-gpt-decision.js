/* GPT 투자판단 화면 v1.0.0 — 공개 원천 + 승인된 본인의 계획/계약 기록 */
(function(){
  "use strict";
  const root=document.getElementById("gpt-re-root"),E=window.REDecision;
  if(!root||!E)return;
  const nav=root.querySelector("#gptReNav"),views=root.querySelector("#gptReViews");
  if(!nav||!views)return;
  root.classList.add("rd-compact");
  const button=document.createElement("button");
  button.dataset.v="decision";button.textContent="투자판단";nav.prepend(button);
  const research=document.createElement("button");
  research.textContent="연구·데이터";research.setAttribute("aria-expanded","false");nav.append(research);
  research.addEventListener("click",()=>{const open=root.classList.toggle("rd-research");research.setAttribute("aria-expanded",String(open));});
  const view=document.createElement("div");view.className="gpt-view";view.dataset.v="decision";views.prepend(view);
  const st=document.createElement("style");
  st.textContent='.rd-compact:not(.rd-research) #gptReNav>button[data-v]:not([data-v="decision"]):not([data-v="presale"]):not([data-v="strategy"]){display:none}.rd-nav{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 14px}.rd-nav button,.rd-btn{border:1px solid var(--border);border-radius:9px;background:var(--surf2);color:var(--text);padding:10px 12px;font-size:12px;font-weight:800;min-height:44px;cursor:pointer}.rd-nav button.on,.rd-btn.primary{background:#414680;border-color:var(--accent);color:#fff}.rd-btn:disabled{opacity:.45;cursor:wait}.rd-box{border:1px solid var(--border);border-radius:13px;background:var(--surf2);padding:15px;margin-bottom:12px;min-width:0}.rd-box h3{font-size:17px;margin:0 0 9px}.rd-box h4{font-size:14px;margin:0 0 8px}.rd-muted{font-size:12px;line-height:1.65;color:var(--dim);overflow-wrap:anywhere}.rd-lead{font-size:24px;font-weight:900;line-height:1.3;margin:5px 0 9px}.rd-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.rd-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.rd-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}.rd-kpi{border:1px solid var(--border);border-radius:9px;padding:10px;min-width:0}.rd-kpi small{display:block;color:var(--dim);font-size:11px;line-height:1.5}.rd-kpi b{display:block;font-size:17px;margin-top:4px;overflow-wrap:anywhere}.rd-pill{display:inline-block;border-radius:99px;background:#2a3049;color:var(--dim);padding:4px 9px;font-size:11px;font-weight:800;margin:0 4px 6px 0}.rd-pill.good{color:var(--green);background:#143c32}.rd-pill.warn{color:var(--gold);background:#3a3220}.rd-pill.bad{color:var(--red);background:#40232c}.rd-card h4{font-size:16px;margin:5px 0}.rd-card .rd-why{font-size:13px;line-height:1.6;margin:9px 0}.rd-form{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.rd-form label{display:grid;gap:5px;font-size:12px;color:var(--dim)}.rd-form input,.rd-form select{width:100%;min-width:0;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;font-size:16px;min-height:44px}.rd-form .rd-check{display:flex;align-items:center;gap:8px;line-height:1.5;color:var(--text)}.rd-check input{width:20px;min-height:20px;flex-shrink:0}.rd-full{grid-column:1/-1}.rd-empty{border:1px dashed var(--border);border-radius:10px;padding:18px;line-height:1.6;color:var(--dim);font-size:13px}.rd-steps{margin:12px 0;padding-left:20px;font-size:13px;line-height:1.9;color:var(--dim)}.rd-msg{padding:10px;border:1px solid var(--border);border-radius:9px;font-size:12px;margin:9px 0;line-height:1.6;overflow-wrap:anywhere}.rd-msg.error{border-color:var(--red);color:var(--red)}.rd-source{color:var(--accent);font-size:12px;display:inline-block;margin:5px 10px 5px 0}.rd-detail{scroll-margin-top:150px}.rd-trade{border-bottom:1px solid var(--border);padding:9px 0;font-size:12px;line-height:1.6}.rd-form details{border:1px solid var(--border);padding:10px;border-radius:9px}.rd-form details summary{cursor:pointer;font-size:13px;font-weight:800;min-height:28px}.rd-form details .rd-form{margin-top:12px}.rd-task{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--border);padding:12px 0}.rd-task:first-child{border-top:0}.rd-task b{font-size:13px}.rd-task .rd-btn{flex-shrink:0}@media(min-width:760px){.rd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rd-form{grid-template-columns:repeat(2,minmax(0,1fr))}.rd-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:380px){.rd-kpis{grid-template-columns:minmax(0,1fr)}.rd-nav{gap:4px}.rd-nav button{padding:9px}.rd-task{flex-wrap:wrap}}';
  root.append(st);
  st.textContent+='.rd-card .rd-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}';
  let page="home",selected=null,mode="plan",searchResults=[],searchInfo="",searchBusy=false;
  let notebook={schemaVersion:1,revision:0,settings:{...E.DEFAULTS},items:[]},loaded=false,busy=false,accountUid=null,epoch=0,message="";
  let draft={},formDrafts={},filter="open",searchParams={lawd:"30200",query:"",area:84};
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=v=>Number.isFinite(v)?(Math.abs(v)>=1e8?(v/1e8).toFixed(2).replace(/\.?0+$/,"")+"억":Math.round(v/1e4).toLocaleString("ko-KR")+"만"):"미확인";
  const val=v=>v===null||v===undefined?"":String(v);
  const safeUrl=s=>{try{const u=new URL(s);return /^https?:$/.test(u.protocol)?u.href:"#";}catch{return "#";}};
  const field=(label,name,value,extra="")=>'<label>'+label+'<input name="'+name+'" type="number" min="0" step="any" value="'+esc(val(value))+'" '+extra+'></label>';
  const moneyField=(label,name,value,extra="")=>field(label+" (만원)",name,Number.isFinite(value)?Math.round(value/100)/100:null,extra);
  const dateField=(label,name,value)=>'<label>'+label+'<input name="'+name+'" type="date" max="'+E.today()+'" value="'+esc(value||"")+'" required></label>';
  const kpi=(label,value,note="")=>'<div class="rd-kpi"><small>'+esc(label)+'</small><b>'+money(value)+'</b><small>'+esc(note)+'</small></div>';
  const btn=(label,action,id="",primary=false)=>'<button type="button" class="rd-btn'+(primary?" primary":"")+'" data-act="'+action+'"'+(id?' data-id="'+esc(id)+'"':"")+'>'+esc(label)+'</button>';
  const empty=s=>'<div class="rd-empty">'+esc(s)+'</div>';
  function markets(city){
    const data=window.__REGPT_DATA__,row=city==="세종"?data?.sejong:data?.daejeon;
    const m=row&&window.REGPT?.metrics(row.points),a=m?E.age(m.date):null;
    return {metrics:m,stale:!m||a===null||a<0||a>75,entry:!!(m&&window.RESTRAT?.buyMarket(m)),exit:!!(m&&window.RESTRAT?.sellMarket(m))};
  }
  function properties(){
    const data=window.__REGPT_PRESALES__;
    const known=(data?.projects||[]).map(p=>({...p,kind:"presale",asOf:data.asOf,officialIncomplete:!!window.__REGPT_OFFICIAL__?.errors?.length}));
    const feed=window.__REGPT_OFFICIAL__,official=(feed?.rows||[]).filter(a=>!known.some(p=>p.official?.key===a.key||p.name===a.name)).map(a=>{
      const model=(a.models||[]).find(m=>{const ar=parseFloat(m.HOUSE_TY);return ar>=80&&ar<90;});
      const price=model?E.positive(String(model.LTTOT_TOP_AMOUNT||"").replace(/,/g,"")):null;
      return {id:"official-"+a.key,kind:"presale",city:a.region,district:"",name:a.name,address:a.address,asOf:feed.date,moveIn:a.moveIn,
        offer:{status:a.status,applyStart:a.start,applyEnd:a.end},featured:{area:model?parseFloat(model.HOUSE_TY):null,price:price===null?null:price*10000,expansion:null},
        benchmarks:{conservative:{price:null,date:null},jeonse:{price:null,date:null}},recentComparables:[],
        sources:[{label:"청약 공고 확인",url:a.raw?.PBLANC_URL||"https://www.applyhome.co.kr/"}]};
    });
    return [...known,...official,...searchResults];
  }
  function getItem(id){return notebook.items.find(i=>i.id===id);}
  function getProperty(id){return properties().find(p=>p.id===id)||getItem(id)?.property;}
  function result(p,item){return E.evaluate(p,notebook.settings,item?.plan||{},item?.review||{},markets(p.city));}
  function badge(x){return '<span class="rd-pill '+(x.code==="review"?"good":["price","cash","sell"].includes(x.code)?"bad":"warn")+'">'+esc(x.label)+'</span>';}
  function reason(x){
    if(x.code==="closed")return "이번 접수는 종료됐습니다. 다음 공고가 있는지 확인하세요.";
    if(x.code==="price")return "입력한 가격 여유를 확보하려면 약 "+money(x.priceGap)+" 낮은 가격이 필요합니다.";
    if(x.code==="cash")return x.cashShortfall>0?"비상자금 제외 후 자기자금이 약 "+money(x.cashShortfall)+" 부족합니다.":"금리 +2%p 가정의 월 상환액이 입력한 한도를 넘습니다.";
    if(x.code==="review")return "입력한 가격·자금 조건을 통과했습니다. 최신 매물과 계약 조건을 확인할 후보입니다.";
    if(x.code==="wait")return "가격·자금 조건은 통과했지만 시장 진입 조건은 충족하지 않았습니다.";
    return (x.missing.slice(0,3).join(" · ")||"조건 확인")+"이 필요합니다.";
  }
  function card(p){
    const item=getItem(p.id),x=result(p,item);
    return '<article class="rd-box rd-card">'+badge(x)+'<span class="rd-pill">'+esc(p.city+" "+(p.district||""))+'</span><h4>'+esc(p.name)+'</h4><div class="rd-muted">전용 '+esc(p.featured?.area)+'㎡ · '+esc(x.status)+' · 자료 '+esc(p.asOf||"미확인")+'</div>'+
      '<div class="rd-kpis">'+kpi("매물·공급 가격",x.ask,p.kind==="apt"?"실제 매물가격 별도 입력":"확장비·부대비용 별도")+kpi("최근 비교 실거래",x.reference,p.benchmarks?.conservative?.date||"기준일 미확인")+kpi("가격 기준 검토한도",x.referenceLimit,"내가 정한 가격 여유·비용 가정")+kpi("필요 자기자금",x.own,"가정 대출을 뺀 총 투입금")+'</div>'+
      '<div class="rd-why">'+esc(reason(x))+'</div><div class="rd-actions">'+btn(item?.stage==="held"?"보유 상세":"가격·자금 확인","plan",p.id,true)+btn("근거 보기","evidence",p.id)+'</div></article>';
  }
  function marketCard(city){
    const m=markets(city),metric=m.metrics;
    const label=m.stale?"시장자료 확인 필요":m.entry?"후보 검토 구간":m.exit?"시장 약화 · 보유 점검":"추세 확인 중";
    return '<div class="rd-box"><span class="rd-pill">'+city+'</span><h4>'+label+'</h4><div class="rd-muted">'+(metric?"3개월 "+(metric.m3*100).toFixed(1)+"% · 12개월 "+(metric.m12*100).toFixed(1)+"% · 기준 "+esc(metric.date):esc(window.__REGPT_MARKET_ERROR__||"시장자료를 불러오는 중입니다."))+'</div></div>';
  }
  function sourceNote(){
    const messages=[];
    if(window.__REGPT_OFFICIAL__?.errors?.length)messages.push("청약 공고 조회에 실패했습니다. 분양 목록은 저장된 공고 기준이며, 새 공고가 없는 것으로 판단하지 마세요.");
    const missing=[...new Set((window.__REGPT_PRESALES__?.projects||[]).flatMap(p=>(p.liveErrors||[]).map(e=>e.kind)))];
    if(missing.length)messages.push(missing.map(k=>k==="rent"?"전세":"매매").join("·")+" 비교자료를 모두 가져오지 못했습니다. 확인된 거래를 표시하고 조건 판정은 보류합니다.");
    return messages.length?'<div class="rd-msg">'+esc(messages.join(" "))+'</div>':"";
  }
  function home(){
    const held=notebook.items.filter(i=>i.stage==="held"),open=properties().filter(p=>E.offerStatus(p)!=="접수 마감");
    const checks=held.map(i=>({i,x:E.holding(i,markets(i.property.city))})).filter(a=>a.x.code!=="hold");
    let tasks=checks.map(({i,x})=>'<div class="rd-task"><div><b>'+esc(x.label+" · "+i.property.name)+'</b><div class="rd-muted">'+esc(x.reasons.join(" · ")||"최근 시세와 비용을 갱신하세요.")+'</div></div>'+btn("확인","holding",i.id)+'</div>').join("");
    if(E.number(notebook.settings.cash)===null||E.number(notebook.settings.reserve)===null)tasks+='<div class="rd-task"><div><b>내 자금부터 입력하세요</b><div class="rd-muted">투자 가능 금액·비상자금·월 상환 한도를 정하면 자금 부족 후보가 바로 보입니다.</div></div>'+btn("입력","page-money")+'</div>';
    tasks+='<div class="rd-task"><div><b>확인된 후보 '+open.length+'개 · 관심 '+notebook.items.filter(i=>i.stage==="watch").length+'개 · 보유 '+held.length+'개</b><div class="rd-muted">접수 마감 분양은 기본 후보 목록에서 제외합니다.</div></div>'+btn("후보 보기","page-candidates")+'</div>';
    return '<div class="rd-box"><div class="rd-muted">'+E.today()+' · 오늘 확인할 일</div><div class="rd-lead">'+(checks.some(a=>a.x.code==="sell")?"보유 단지의 매도 조건부터 확인하세요":"가격과 자금을 먼저 확인하세요")+'</div>'+tasks+'</div>'+
      sourceNote()+'<div class="rd-grid">'+marketCard("대전")+marketCard("세종")+'</div>'+
      '<div class="rd-box"><h3>이 순서로 확인하면 됩니다</h3><ol class="rd-steps"><li>내 자금과 감당할 월 상환액을 입력합니다.</li><li>후보에서 가격·필요자금·보류 이유를 확인합니다.</li><li>근거를 확인한 단지는 관심에 저장하고 매수 계획을 정합니다.</li><li>실제 계약 후 보유로 등록합니다.</li><li>보유에서 목표가·손익분기 매도가·시장 약화를 점검합니다.</li></ol><div class="rd-muted">가격 한도는 입력한 가정에 따른 계산입니다. 시장신호는 기존 연구 규칙이며, 계약 전 검토에 사용합니다.</div></div>';
  }
  function candidates(){
    const rows=properties().filter(p=>filter==="all"||E.offerStatus(p)!=="접수 마감");
    return '<div class="rd-box"><h3>투자 후보</h3><div class="rd-muted">실제 매물가격이 없는 기존 아파트는 매물가격을 입력한 뒤 비교합니다.</div><div class="rd-actions">'+btn(filter==="all"?"마감 포함 표시 중":"접수 가능한 후보","filter")+'</div></div>'+sourceNote()+
      '<div class="rd-box"><h4>기존 아파트 실거래로 찾기</h4><form id="rdSearch" class="rd-form"><label>지역<select name="lawd">'+Object.entries({"30200":"대전 유성구","30170":"대전 서구","30110":"대전 동구","30140":"대전 중구","30230":"대전 대덕구","36110":"세종"}).map(([k,v])=>'<option value="'+k+'" '+(searchParams.lawd===k?"selected":"")+'>'+v+'</option>').join("")+'</select></label><label>단지명 일부<input name="query" type="search" placeholder="예: 아이파크" maxlength="80" value="'+esc(searchParams.query)+'" required></label>'+field("전용면적 (㎡)","area",searchParams.area,'max="200" required')+'<button class="rd-btn primary" type="submit" '+(searchBusy?"disabled":"")+'>'+(searchBusy?"최근 거래를 조회하는 중…":"최근 90일 실거래 찾기")+'</button></form><div class="rd-muted">'+esc(searchInfo||"국토부 매매·순수전세를 함께 조회합니다. 현재 매물 호가는 별도로 확인합니다.")+'</div></div>'+
      '<div class="rd-grid">'+(rows.map(card).join("")||empty("접수 가능한 분양 후보가 없습니다. 기존 아파트를 검색하거나 마감 포함을 눌러 비교자료를 확인하세요."))+'</div>';
  }
  function settingsForm(){
    const s=notebook.settings;
    return '<div class="rd-box"><h3>내 자금</h3><div class="rd-muted">한 번 저장하면 모든 후보에 적용합니다. 대출비율·금리·부대비율은 개인별로 확인할 가정입니다.</div><form id="rdMoney" class="rd-form">'+
      moneyField("전체 투자 가능 현금","cash",s.cash,"required")+moneyField("남겨 둘 비상자금","reserve",s.reserve,"required")+
      moneyField("월 상환 한도","monthlyLimit",s.monthlyLimit)+field("가정 대출비율 (%)","ltvPct",s.ltvPct,'max="90" required')+
      field("대출금리 가정 (%)","ratePct",s.ratePct,"required")+field("상환기간 (년)","years",s.years,'min="1" max="50" required')+
      '<details class="rd-full"><summary>가격 여유와 비용 가정</summary><div class="rd-form">'+field("주변 비교가격 대비 원하는 여유 (%)","targetMarginPct",s.targetMarginPct,'max="90" required')+
      field("취득세·중개·등기 등 합산 가정 (%)","buyCostPct",s.buyCostPct,'max="30" required')+field("매도 중개 등 가정 (%)","sellCostPct",s.sellCostPct,'max="30" required')+
      moneyField("옵션·중도금 이자 등 추가 총비용","extraCost",s.extraCost,"required")+'</div></details>'+
      '<div class="rd-muted rd-full">금리 +2%p의 상환액도 함께 확인합니다. 기본 2% 부대비율은 법정 세율이 아닌 임시 가정입니다. 확장비와 추가비용을 합산하고 대출은 매물·공급 가격에만 적용합니다. 전세보증금을 매수 당시 현금처럼 차감하지 않습니다.</div>'+
      '<button type="submit" class="rd-btn primary rd-full" '+(!loaded||busy?"disabled":"")+'>내 자금 저장</button></form></div>';
  }
  function planMetrics(p,d){
    const x=E.evaluate(p,notebook.settings,d.plan,d.review,markets(p.city));
    return badge(x)+'<div class="rd-why">'+esc(reason(x))+'</div><div class="rd-kpis">'+
      kpi("가격 기준 검토한도",x.referenceLimit,"주변가격 − 원하는 여유 − 비용")+
      kpi("내 자금 기준 한도",x.affordabilityLimit,"비상자금 제외 · 금리 +2%p")+
      kpi("두 조건을 합친 한도",x.maxPrice,"매물·공급 가격 기준")+
      kpi("총 매수 투입금",x.total,"가격 + 확장비 + 부대·추가비용")+
      kpi("필요 자기자금",x.own,"총 투입금 − 가정 대출")+
      kpi("월 상환액",x.monthly,"원리금균등 가정")+kpi("금리 +2%p 월 상환",x.stressedMonthly)+
      kpi("비용 후 주변가격 차이",x.comparisonRoom,"미래 매도차익과 다릅니다")+
      kpi("집값 20% 하락 시 가격손실",x.priceDownside,"거래비용·이자 추가")+'</div>'+
      (x.lease!==null?'<div class="rd-muted">전세 기준 '+money(x.lease)+' · 전세 20% 하락 시 추가 반환 부담 '+money(x.leaseDownside)+'. 입주 시점의 전세와 대출 가능 여부는 별도 확인합니다.</div>':"")+
      '<div class="rd-muted">'+esc(x.missing.join(" · "))+'</div>';
  }
  function evidence(p){
    const comps=(p.recentComparables||[]).slice(0,10).map(t=>'<div class="rd-trade"><b>'+esc(t.name||p.name)+'</b> · '+money(t.price)+'<br>'+esc(t.date)+' · '+esc(t.area)+'㎡ · '+esc(t.floor||"미확인")+'층</div>').join("");
    return '<details class="rd-full" '+(mode==="evidence"?"open":"")+'><summary>주변 실거래·출처·계약 조건</summary><div class="rd-muted">비교가격: '+esc(p.benchmarks?.conservative?.label||"미확인")+' · 기준 '+esc(p.benchmarks?.conservative?.date||"미확인")+'</div>'+
      (comps||empty("비교 거래가 없습니다."))+'<div class="rd-muted">'+esc((p.rules||[]).join(" · "))+'</div>'+
      (p.sources||[]).map(s=>'<a class="rd-source" target="_blank" rel="noopener" href="'+esc(safeUrl(s.url))+'">'+esc(s.label)+'</a>').join("")+'</details>';
  }
  function planForm(p){
    const item=getItem(p.id);
    if(item&&mode==="buy")return buyForm(item);
    if(item&&item.stage!=="watch")return holdingDetail(item);
    const d=draft[p.id]||(draft[p.id]={plan:{askPrice:item?.plan?.askPrice??p.featured?.price??null,expansion:item?.plan?.expansion??p.featured?.expansion??null},review:{...(item?.review||{})}});
    return '<div class="rd-box rd-detail" id="rdDetail"><h3>'+esc(p.name)+' · 매수 계획</h3><div class="rd-muted">신호보다 가격·자금·비용을 먼저 확인하세요. 입력 금액으로만 계산합니다.</div><form id="rdPlan" class="rd-form" data-id="'+esc(p.id)+'">'+
      moneyField("실제 매물·공급 가격","askPrice",d.plan.askPrice)+moneyField("확장비 (없으면 0)","expansion",d.plan.expansion)+
      '<div class="rd-full" id="rdPlanMetrics">'+planMetrics(p,d)+'</div>'+evidence(p)+
      ['comparables','supply','conditions'].map((k,i)=>'<label class="rd-check rd-full"><input type="checkbox" name="'+k+'" '+(d.review[k]?"checked":"")+'>'+["비교단지의 면적·층·연식·입지를 확인했습니다","주변 입주 예정과 미분양을 확인했습니다","개인별 세금·대출·전매 조건을 확인했습니다"][i]+'</label>').join("")+
      '<button type="submit" class="rd-btn primary rd-full" '+(!loaded||busy?"disabled":"")+'>'+(item?"관심 계획 저장":"관심에 저장")+'</button>'+
      (item?btn("실제 계약 후 보유 등록","buy",item.id):"")+'</form></div>';
  }
  function holdingCard(item){
    if(item.stage==="sold")return '<div class="rd-box"><span class="rd-pill">매도 기록</span><h4>'+esc(item.property.name)+'</h4><div class="rd-kpis">'+kpi("실제 매수가",item.purchase.price)+kpi("실제 매도가",item.sale.price)+kpi("입력 비용 후 실현손익",item.sale.profit)+'</div><div class="rd-muted">'+esc(item.purchase.date)+' → '+esc(item.sale.date)+'</div>'+btn("계약·비용 기록","holding",item.id)+'</div>';
    const x=E.holding(item,markets(item.property.city));
    return '<div class="rd-box">'+badge(x)+'<h4>'+esc(item.property.name)+'</h4><div class="rd-kpis">'+kpi("매수가",item.purchase.price)+kpi("참고 시세",x.price,item.quote?.date||"시세 입력 필요")+kpi("손익분기 매도가",x.breakeven,"입력 비용·세금 가정")+'</div><div class="rd-muted">'+esc(x.reasons.join(" · ")||"목표가와 최근 시세를 확인하세요.")+'</div>'+btn("보유·매도 확인","holding",item.id,true)+'</div>';
  }
  function positions(){
    return '<div class="rd-box"><h3>관심·보유·매도 기록</h3><div class="rd-muted">실제 계약 기록은 직접 등록합니다. 매수·매도 기록과 당시 계획은 계속 남깁니다.</div></div>'+
      '<div class="rd-grid">'+(notebook.items.map(i=>i.stage==="watch"?card(i.property):holdingCard(i)).join("")||empty(loaded?"관심 단지를 저장하면 여기에 모입니다.":"로그인한 본인의 기록을 불러오는 중입니다."))+'</div>';
  }
  function holdingDetail(item){
    if(mode==="buy")return buyForm(item);
    if(mode==="sale")return saleForm(item);
    const x=item.stage==="held"?E.holding(item,markets(item.property.city)):null;
    const records=(item.events||[]).slice().reverse().map(ev=>'<div class="rd-trade"><b>'+esc(({watch:"관심 저장",plan:"매수 계획 변경",buy:"매수 계약 등록",valuation:"시세·매도 계획 갱신",sell:"매도 계약 등록"})[ev.type]||ev.type)+'</b> · '+esc(ev.at.slice(0,10))+
      (ev.type==="buy"||ev.type==="sell"?" · "+money(ev.details.price):"")+'</div>').join("");
    if(item.stage==="sold")return '<div class="rd-box rd-detail" id="rdDetail"><h3>'+esc(item.property.name)+' · 매도 완료 기록</h3><div class="rd-kpis">'+kpi("실현손익",item.sale.profit)+kpi("취득 총비용",item.purchase.expenses)+kpi("매도 비용·세금",item.sale.expenses+item.sale.tax)+kpi("이자·보유 총비용",item.sale.holdingCosts)+'</div>'+records+'</div>';
    if(item.stage==="watch")return planForm(item.property);
    return '<div class="rd-box rd-detail" id="rdDetail"><h3>'+esc(item.property.name)+' · 보유 관리</h3>'+badge(x)+'<div class="rd-kpis">'+kpi("실제 매수가",item.purchase.price)+kpi("기록한 목표가",item.targetPrice)+kpi("손익분기 매도가",x.breakeven,"입력 비용·세금 가정")+kpi("참고 시세 기준 손익",x.profit,"확정 이익이 아닙니다")+'</div>'+
      '<div class="rd-muted">'+esc(x.reasons.join(" · ")||"목표가·하방 점검가와 시장신호를 확인하세요.")+'</div>'+
      '<form id="rdQuote" class="rd-form" data-id="'+esc(item.id)+'">'+moneyField("최근 확인한 시세","price",item.quote?.price,"required")+dateField("시세 확인 기준일","date",item.quote?.date||E.today())+
      moneyField("목표 매도가","targetPrice",item.targetPrice)+moneyField("하방 점검가","defensePrice",item.defensePrice)+
      field("매도 중개 등 가정 (%)","sellCostPct",item.sellCostPct,'max="30" required')+
      moneyField("예상 양도세 (없으면 0)","estimatedTax",item.estimatedTax,"required")+
      moneyField("누적 이자·보유비용 (없으면 0)","holdingCosts",item.holdingCosts,"required")+
      '<div class="rd-muted rd-full">시세는 실제 매도 체결가와 다릅니다. 대출 원금은 비용에 넣지 않으며, 이자만 보유비용에 넣습니다. 목표가·하방 점검가는 내가 정한 조건입니다.</div>'+
      '<button class="rd-btn primary rd-full" type="submit" '+(!loaded||busy?"disabled":"")+'>시세·매도 계획 저장</button></form><div class="rd-actions">'+btn("실제 매도 계약 기록","sale",item.id)+'</div><details><summary>매수 계약과 변경 기록</summary><div class="rd-muted">매수 '+esc(item.purchase.date)+' · 취득비용 '+money(item.purchase.expenses)+' · 초기 대출 '+money(item.purchase.loan)+'</div>'+records+'</details></div>';
  }
  function buyForm(item){
    const x=result(item.property,item);
    return '<div class="rd-box rd-detail" id="rdDetail"><h3>'+esc(item.property.name)+' · 보유 등록</h3><div class="rd-muted">실제 계약한 가격과 총 취득비용을 기록합니다.</div><form id="rdBuy" class="rd-form" data-id="'+esc(item.id)+'">'+
      moneyField("실제 매수가","price",x.ask,"required")+dateField("실제 매수 계약일","date",E.today())+
      moneyField("확장·옵션·세금·중개 등 총 취득비용","expenses",x.total!==null&&x.ask!==null?x.total-x.ask:null,"required")+
      moneyField("초기 대출 원금 (없으면 0)","loan",x.loan,"required")+moneyField("목표 매도가","targetPrice",null)+moneyField("하방 점검가","defensePrice",null)+
      '<label class="rd-check rd-full"><input name="confirmed" type="checkbox" required>실제 매수 계약 내용을 확인하고 기록합니다</label><button class="rd-btn primary rd-full" type="submit" '+(!loaded||busy?"disabled":"")+'>보유로 등록</button></form></div>';
  }
  function saleForm(item){
    return '<div class="rd-box rd-detail" id="rdDetail"><h3>'+esc(item.property.name)+' · 매도 기록</h3><form id="rdSale" class="rd-form" data-id="'+esc(item.id)+'">'+
      moneyField("실제 매도가","price",null,"required")+dateField("실제 매도 계약일","date",E.today())+
      moneyField("매도 중개 등 실제 비용","expenses",null,"required")+moneyField("실제 양도세 (없으면 0)","tax",null,"required")+
      moneyField("전체 보유기간 이자·보유비용 (없으면 0)","holdingCosts",null,"required")+
      '<div class="rd-muted rd-full">실현손익 = 매도가 − 매수가 − 총 취득비용 − 매도비용 − 양도세 − 전체 이자·보유비용. 대출 원금 상환은 비용으로 중복 차감하지 않습니다.</div>'+
      '<label class="rd-check rd-full"><input name="confirmed" type="checkbox" required>실제 매도 계약과 비용을 확인하고 기록합니다</label><button class="rd-btn primary rd-full" type="submit" '+(!loaded||busy?"disabled":"")+'>매도 기록 저장</button></form></div>';
  }
  function render(){
    const p=selected&&getProperty(selected),item=selected&&getItem(selected);
    view.innerHTML='<div class="rd-nav">'+[["home","오늘"],["candidates","후보"],["positions","관심·보유"],["money","내 자금"]].map(([id,label])=>'<button type="button" class="'+(page===id?"on":"")+'" data-act="page-'+id+'">'+label+'</button>').join("")+'</div>'+
      '<div role="status" aria-live="polite" class="rd-msg'+(message.includes("실패")?" error":"")+'">'+esc(message||(loaded?"내 계정의 계획·기록이 연결됐습니다.":"로그인·승인 확인 후 개인 기록을 불러옵니다."))+(accountUid&&(!loaded||message.startsWith("저장 실패"))?btn("다시 불러오기","reload"):"")+'</div>'+
      (page==="home"?home():page==="candidates"?candidates():page==="money"?settingsForm():positions())+
      (selected&&(p||item)?(item&&item.stage!=="watch"?holdingDetail(item):planForm(p)):"");
    for(const form of view.querySelectorAll("form")){
      const saved=formDrafts[form.id+":"+(form.dataset.id||"")];
      if(saved)for(const input of form.elements)if(saved[input.name]){
        input.value=saved[input.name].value;
        if(input.type==="checkbox")input.checked=saved[input.name].checked;
      }
    }
  }
  async function loadAccount(){
    const api=window.REGPT_ACCOUNT,ticket=++epoch;
    notebook={schemaVersion:1,revision:0,settings:{...E.DEFAULTS},items:[]};loaded=false;busy=false;accountUid=api?.uid||null;selected=null;draft={};formDrafts={};
    message=api?"개인 계획·기록을 불러오는 중입니다.":"";render();if(!api)return;
    try{
      const data=await api.load();if(ticket!==epoch||window.REGPT_ACCOUNT!==api)return;
      if(data.schemaVersion!==1||!Array.isArray(data.items)||!Number.isInteger(data.revision)||data.revision<0)throw new Error("기록 형식을 확인하지 못했습니다. 기존 기록은 변경하지 않았습니다.");
      notebook={...data,settings:{...E.DEFAULTS,...data.settings}};loaded=true;message="개인 기록을 불러왔습니다.";render();
    }catch(e){if(ticket===epoch){message="개인 기록을 불러오지 못했습니다: "+String(e.message||e);render();}}
  }
  async function save(next,onSaved){
    const api=window.REGPT_ACCOUNT,ticket=epoch;
    if(!loaded||!api||api.uid!==accountUid||busy){message="개인 기록 로딩이 끝난 뒤 다시 저장하세요.";render();return false;}
    busy=true;view.querySelectorAll("button").forEach(b=>b.disabled=true);
    try{
      const saved=await api.save(next,notebook.revision);
      if(ticket!==epoch||window.REGPT_ACCOUNT!==api)return false;
      notebook=saved;if(onSaved)onSaved();message="저장했습니다.";return true;
    }catch(e){if(ticket===epoch)message="저장 실패: "+String(e.message||e);return false;}
    finally{if(ticket===epoch){busy=false;render();}}
  }
  function readMoney(form,name){const v=form.elements[name]?.value;const n=E.number(v);return n===null?null:n*10000;}
  function rememberForm(form){
    if(!form||form.id==="rdPlan"||form.id==="rdSearch")return;
    formDrafts[form.id+":"+(form.dataset.id||"")]=Object.fromEntries([...form.elements].filter(i=>i.name).map(i=>[i.name,{value:i.value,checked:i.checked}]));
  }
  function readPlan(form){
    const id=form.dataset.id;
    draft[id]={plan:{askPrice:readMoney(form,"askPrice"),expansion:readMoney(form,"expansion")},
      review:Object.fromEntries(["comparables","supply","conditions"].map(k=>[k,form.elements[k].checked]))};
    return draft[id];
  }
  function updatePlan(form){
    const d=readPlan(form),p=getProperty(form.dataset.id),metrics=form.querySelector("#rdPlanMetrics");
    if(p&&metrics)metrics.innerHTML=planMetrics(p,d);
  }
  async function apiGet(query){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),22000);
    try{const r=await fetch("/api/realestate-gpt-live?"+new URLSearchParams(query),{cache:"no-store",signal:ac.signal}),j=await r.json();
      if(!r.ok||!j.ok)throw new Error(String(j.error||"").includes("not configured")?"공식 실거래 연결이 준비되지 않았습니다.":"거래 조회 실패: "+(j.error||"응답 오류"));return j;
    }finally{clearTimeout(timer);}
  }
  function parse(xml,kind){
    const d=new DOMParser().parseFromString(xml,"application/xml");
    if(d.querySelector("parsererror"))throw new Error("실거래 응답 형식 오류");
    const text=(n,k)=>(n.querySelector(k)?.textContent||"").trim();
    const code=text(d,"resultCode");if(code&&!["00","000","0"].includes(code))throw new Error(text(d,"resultMsg")||"실거래 조회 오류");
    return [...d.querySelectorAll("item")].map(n=>E.normaliseRtms(Object.fromEntries(
      ["aptNm","aptName","umdNm","excluUseAr","dealYear","dealMonth","dealDay","dealAmount","deposit","monthlyRent","floor","cdealType","cdealDay","cdealDe","dealingGbn"].map(k=>[k,text(n,k)])),kind))
      .filter(t=>t&&(kind==="rent"?t.monthly===0:true));
  }
  async function search(form){
    const lawd=form.elements.lawd.value,query=form.elements.query.value.trim(),area=E.number(form.elements.area.value);
    if(!query||area===null||area<=0)return;
    searchParams={lawd,query,area};
    const district={"30200":"유성구","30170":"서구","30110":"동구","30140":"중구","30230":"대덕구","36110":"세종"}[lawd];
    searchBusy=true;searchInfo="최근 거래를 조회 중입니다. 현재 달 거래는 신고 시차로 더 추가될 수 있습니다.";render();
    const base=E.today().slice(0,7),[y,m]=base.split("-").map(Number),jobs=[];
    for(let back=0;back<4;back++){
      const date=new Date(Date.UTC(y,m-1-back,1)),ymd=date.getUTCFullYear()+String(date.getUTCMonth()+1).padStart(2,"0");
      for(const kind of ["trade","rent"])jobs.push({kind,ymd});
    }
    try{
      const results=await Promise.allSettled(jobs.map(j=>apiGet({kind:j.kind,lawd,ymd:j.ymd}).then(r=>({kind:j.kind,rows:parse(r.payload,j.kind)}))));
      const failed=results.filter(r=>r.status==="rejected"),trades=[],rents=[];
      for(const r of results)if(r.status==="fulfilled")(r.value.kind==="trade"?trades:rents).push(...r.value.rows);
      if(!trades.length&&failed.length)throw new Error(failed[0].reason.message||"매매 거래 조회 실패");
      searchResults=E.apartmentCandidates(trades,rents,{lawd,city:lawd==="36110"?"세종":"대전",district,area,query});
      if(failed.length)for(const p of searchResults)p.collectionIncomplete=true;
      searchInfo=searchResults.length+"개 단지 · 최근 90일 확인 거래 기준"+(failed.length?" · "+failed.length+"개 요청 누락: 전체 확인 전 검토 보류":"")+" · 매물 호가는 별도로 확인하세요.";
    }catch(e){searchResults=[];searchInfo="조회 실패: "+String(e.message||e);}
    finally{searchBusy=false;render();}
  }
  view.addEventListener("input",e=>{rememberForm(e.target.closest("form"));const form=e.target.closest("#rdPlan");if(form)updatePlan(form);});
  view.addEventListener("change",e=>{rememberForm(e.target.closest("form"));const form=e.target.closest("#rdPlan");if(form)updatePlan(form);});
  view.addEventListener("click",e=>{
    const b=e.target.closest("button[data-act]");if(!b)return;
    const action=b.dataset.act,id=b.dataset.id;
    if(action.startsWith("page-")){page=action.slice(5);selected=null;render();return;}
    if(action==="filter"){filter=filter==="all"?"open":"all";render();return;}
    if(action==="reload"){loadAccount();return;}
    if(["plan","evidence","holding","buy","sale"].includes(action)){
      selected=id;mode=action==="holding"?"hold":action;render();
      view.querySelector("#rdDetail")?.scrollIntoView({behavior:"smooth",block:"start"});
    }
  });
  view.addEventListener("submit",async e=>{
    e.preventDefault();const form=e.target,id=form.dataset.id,item=id&&getItem(id);
    rememberForm(form);const clearDraft=()=>{delete formDrafts[form.id+":"+(id||"")];};
    try{
      if(form.id==="rdSearch"){await search(form);return;}
      if(form.id==="rdMoney"){
        const s={};for(const k of Object.keys(E.DEFAULTS))s[k]=["cash","reserve","monthlyLimit","extraCost"].includes(k)?readMoney(form,k):E.number(form.elements[k]?.value);
        if(s.cash===null||s.reserve===null||s.reserve>s.cash||s.ltvPct>0&&s.monthlyLimit===null)throw new Error("현금·비상자금과 대출 사용 시 월 상환 한도를 확인하세요.");
        const checked=E.settings(s);if(Object.keys(s).some(k=>k!=="monthlyLimit"&&checked[k]===null))throw new Error("비용·금리·대출비율·기간을 확인하세요.");
        await save({...notebook,settings:s},clearDraft);return;
      }
      if(form.id==="rdPlan"){
        const d=readPlan(form),p=getProperty(id),prior=item||{id,stage:"watch",events:[]};
        const entry={...prior,property:JSON.parse(JSON.stringify(p)),plan:d.plan,review:d.review,events:[...prior.events,E.event(item?"plan":"watch",{plan:d.plan,review:d.review,settings:notebook.settings,property:p})]};
        await save({...notebook,items:item?notebook.items.map(i=>i.id===id?entry:i):[...notebook.items,entry]});return;
      }
      if(!item)throw new Error("관심에 저장한 단지를 먼저 선택하세요.");
      let next;
      if(form.id==="rdBuy"){
        if(!form.elements.confirmed.checked)throw new Error("실제 계약을 확인하세요.");
        next=E.registerPurchase(item,{price:readMoney(form,"price"),expenses:readMoney(form,"expenses"),loan:readMoney(form,"loan"),date:form.elements.date.value,
          targetPrice:readMoney(form,"targetPrice"),defensePrice:readMoney(form,"defensePrice")});
        next.sellCostPct=notebook.settings.sellCostPct;next.holdingCosts=null;next.estimatedTax=null;next.quote=null;
      }else if(form.id==="rdQuote"){
        const price=readMoney(form,"price"),date=form.elements.date.value,tax=readMoney(form,"estimatedTax"),cost=readMoney(form,"holdingCosts"),fee=E.number(form.elements.sellCostPct.value);
        if(price===null||price<=0||!E.validDate(date)||date>E.today()||date<item.purchase.date||tax===null||cost===null||fee===null||fee<0||fee>=100)throw new Error("시세 기준일·금액·비용을 확인하세요.");
        next={...item,quote:{price,date},targetPrice:readMoney(form,"targetPrice"),defensePrice:readMoney(form,"defensePrice"),estimatedTax:tax,holdingCosts:cost,sellCostPct:fee};
        next.events=[...item.events,E.event("valuation",{quote:next.quote,targetPrice:next.targetPrice,defensePrice:next.defensePrice,estimatedTax:tax,holdingCosts:cost,sellCostPct:fee})];
      }else if(form.id==="rdSale"){
        if(!form.elements.confirmed.checked)throw new Error("실제 계약을 확인하세요.");
        next=E.registerSale(item,{price:readMoney(form,"price"),expenses:readMoney(form,"expenses"),tax:readMoney(form,"tax"),holdingCosts:readMoney(form,"holdingCosts"),date:form.elements.date.value});
      }
      if(next)await save({...notebook,items:notebook.items.map(i=>i.id===id?next:i)},()=>{clearDraft();if(form.id==="rdBuy"||form.id==="rdSale"){mode="hold";page="positions";}});
    }catch(err){message=String(err.message||err);render();}
  });
  function publicChanged(){if(!document.activeElement?.closest("#gpt-re-root form"))render();}
  window.addEventListener("regpt-market",publicChanged);window.addEventListener("regpt-presales",publicChanged);
  window.addEventListener("regpt-account",loadAccount);
  const deep=new URLSearchParams(location.search).get("gpt");
  if(!deep||deep==="decision")button.click();
  else if(deep==="presale")nav.querySelector('[data-v="presale"]')?.click();
  else if(deep==="strategy")nav.querySelector('[data-v="strategy"]')?.click();
  loadAccount();
})();
