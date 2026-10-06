(function(){
"use strict";

const root=document.getElementById("gpt-re-root");
if(!root)return;

const nav=root.querySelector("#gptReNav");
const views=root.querySelector("#gptReViews");
if(!nav||!views||nav.querySelector('[data-v="presale"]'))return;

const btn=document.createElement("button");
btn.dataset.v="presale";
btn.textContent="신규분양";
const dataBtn=nav.querySelector('[data-v="data"]');
nav.insertBefore(btn,dataBtn||null);

const view=document.createElement("div");
view.className="gpt-view";
view.dataset.v="presale";
view.innerHTML='<div id="gptPresale"><div class="gpt-panel"><div class="note">신규분양 데이터를 불러오는 중…</div></div></div>';
views.insertBefore(view,views.querySelector('[data-v="data"]')||null);

const mount=view.querySelector("#gptPresale");
let DATA=null, city="전체", sort="score";
let LIVE={configured:false,note:"공식 API 확인 중"};
let OFFICIAL=[];
let FIN={id:"",ltv:50,rate:4.0,years:30,costRate:0};

const style=document.createElement("style");
style.textContent=
'.ps-head{display:flex;gap:8px;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.ps-controls{display:flex;gap:6px;flex-wrap:wrap}.ps-controls button,.ps-controls select{border:1px solid var(--border);background:var(--surf2);color:var(--dim);border-radius:7px;padding:6px 9px;font-size:10px;font-weight:800}.ps-controls button.on{color:#fff;border-color:var(--accent);background:#353765}.ps-list{display:grid;gap:10px}.ps-project{background:var(--surf2);border:1px solid var(--border);border-radius:11px;padding:13px}.ps-project-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.ps-name{font-size:14px;font-weight:900}.ps-meta{font-size:10px;color:var(--dim);margin-top:3px}.ps-score{text-align:right;white-space:nowrap}.ps-score .n{font-size:24px;font-weight:900;color:var(--gold)}.ps-score .lab{font-size:9px;color:var(--dim)}.ps-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:10px 0}.ps-kpi{border:1px solid var(--border);border-radius:8px;padding:8px;background:rgba(15,19,32,.35)}.ps-kpi .k{font-size:9px;color:var(--faint);font-weight:800}.ps-kpi .v{font-size:14px;font-weight:900;margin-top:2px}.ps-kpi .s{font-size:9px;color:var(--dim);margin-top:1px;line-height:1.35}.ps-badge{display:inline-block;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:900;background:#2b3151;color:var(--dim);margin-right:4px}.ps-badge.open{color:var(--green);background:rgba(54,211,153,.1)}.ps-badge.closed{color:var(--faint)}.ps-detail{display:grid;grid-template-columns:1.1fr .9fr;gap:8px;margin-top:9px}.ps-box{border-top:1px solid var(--border);padding-top:8px}.ps-box h5{font-size:10px;color:var(--faint);margin:0 0 5px}.ps-mini{font-size:10px;color:var(--dim);line-height:1.55}.ps-mini b{color:var(--text)}.ps-src a{color:var(--accent);text-decoration:none;margin-right:8px}.ps-positive{color:var(--green)}.ps-negative{color:var(--red)}.ps-neutral{color:var(--gold)}@media(max-width:760px){.ps-head{display:block}.ps-controls{margin-top:8px}.ps-kpis{grid-template-columns:1fr 1fr}.ps-detail{grid-template-columns:1fr}.ps-project-top{display:block}.ps-score{text-align:left;margin-top:5px}}';
root.appendChild(style);

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function won(v){
  if(!Number.isFinite(v))return "-";
  const e=v/100000000;
  if(e>=1)return (Math.round(e*100)/100).toFixed(e<10?2:1).replace(/0+$/,"").replace(/.$/,"")+"억";
  return Math.round(v/10000).toLocaleString("ko-KR")+"만";
}
function pct(v){return Number.isFinite(v)?(v*100).toFixed(1)+"%":"-"}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function effective(p){return p.featured.price+(Number.isFinite(p.featured.expansion)?p.featured.expansion:0)}
function calc(p){
  const eff=effective(p), b=p.benchmarks||{}, c=b.conservative||{}, l=b.leader||{}, j=b.jeonse||{};
  const cm=Number.isFinite(c.price)?c.price-eff:null, lm=Number.isFinite(l.price)?l.price-eff:null;
  const cp=Number.isFinite(cm)?cm/eff:null, lp=Number.isFinite(lm)?lm/eff:null;
  const jr=Number.isFinite(j.price)?j.price/eff:null, gap=Number.isFinite(j.price)?eff-j.price:null;
  const priceScore=Number.isFinite(cp)?clamp(20+cp*200,0,35):10;
  const leaderScore=Number.isFinite(lp)?clamp(7.5+lp*75,0,15):6;
  const d=Number(p.competition)||0;
  const demandScore=d>=10?20:d>=3?15:d>=1.5?10:5;
  const leaseScore=Number.isFinite(jr)?(jr>=.55?15:jr>=.48?11:jr>=.40?7:4):5;
  const rem=(p.offer&&p.offer.remainingUnits)||0, total=p.generalSupply||p.households||1, rr=rem/total;
  const supplyScore=rr<=.005?15:rr<=.01?12:rr<=.03?8:4;
  const score=Math.round(priceScore+leaderScore+demandScore+leaseScore+supplyScore);
  return {eff,cm,lm,cp,lp,jr,gap,score,parts:{priceScore,leaderScore,demandScore,leaseScore,supplyScore}};
}
function verdict(x){
  if(x.cp<-.08)return "가격부담";
  if(x.cp>=.03)return "안전마진";
  if(x.lp>=.08)return "중위 상단·대장 하단";
  return "중립";
}
function scoreLabel(n){return n>=75?"우선검토":n>=60?"관심":n>=45?"중립":"보수적"}
function dateKst(d){const x=new Date(Date.now()+d*86400000);return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(x)}
function moneyAmount(v){const n=Number(String(v==null?"":v).replace(/,/g,""));return Number.isFinite(n)&&n>0?n*10000:null}
function normName(s){return String(s||"").replace(/[^0-9A-Za-z가-힣]/g,"").toLowerCase()}
function officialStatus(r){
  const now=dateKst(0),a=String(r.RCEPT_BGNDE||""),b=String(r.RCEPT_ENDDE||"");
  if(b&&b<now)return "마감"; if(a&&a>now)return "예정"; if(a&&b&&a<=now&&b>=now)return "접수중"; return "공고";
}
function annNorm(r,category){
  return {
    key:[r.HOUSE_MANAGE_NO,r.PBLANC_NO,category].join("|"),
    houseManageNo:String(r.HOUSE_MANAGE_NO||""),pblancNo:String(r.PBLANC_NO||""),
    name:String(r.HOUSE_NM||""),region:String(r.SUBSCRPT_AREA_CODE_NM||""),
    address:String(r.HSSPLY_ADRES||""),category,
    announce:String(r.RCRIT_PBLANC_DE||""),start:String(r.RCEPT_BGNDE||""),
    end:String(r.RCEPT_ENDDE||""),winner:String(r.PRZWNER_PRESNATN_DE||""),
    moveIn:String(r.MVN_PREARNGE_YM||""),units:Number(r.TOT_SUPLY_HSHLDCO||0)||null,
    status:officialStatus(r),raw:r,minPrice:null,maxPrice:null,models:[]
  };
}
async function liveJson(q){
  const r=await fetch("/api/realestate-gpt-live?"+new URLSearchParams(q),{cache:"no-store"});
  const j=await r.json(); if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status)); return j;
}
async function loadModels(a){
  try{
    const j=await liveJson({kind:"applyhome",category:a.category,mode:"model",houseManageNo:a.houseManageNo,pblancNo:a.pblancNo,perPage:"100"});
    const rows=(j.payload&&j.payload.data)||[];
    a.models=rows;
    const prices=rows.map(x=>moneyAmount(x.LTTOT_TOP_AMOUNT)).filter(Number.isFinite);
    if(prices.length){a.minPrice=Math.min(...prices);a.maxPrice=Math.max(...prices)}
  }catch(e){}
  return a;
}
async function loadOfficial(){
  try{
    const s=await liveJson({kind:"status"}); LIVE=s;
    if(!s.configured){render();return}
    const cats=["apt","remndr","opt"], regs=["대전","세종"];
    const jobs=[]; for(const category of cats)for(const region of regs)jobs.push(
      liveJson({kind:"applyhome",category,mode:"detail",region,from:dateKst(-75),to:dateKst(60),perPage:"200"}).then(j=>(j.payload&&j.payload.data||[]).map(r=>annNorm(r,category))).catch(()=>[])
    );
    const all=(await Promise.all(jobs)).flat();
    const m=new Map(); for(const a of all)if(a.name)m.set(a.key,a);
    OFFICIAL=[...m.values()].sort((a,b)=>String(b.announce||b.start).localeCompare(String(a.announce||a.start))).slice(0,20);
    await Promise.all(OFFICIAL.slice(0,12).map(loadModels));
    if(DATA){
      for(const p of DATA.projects){
        const pn=normName(p.name);
        const a=OFFICIAL.find(x=>{const n=normName(x.name);return n&&(n.includes(pn)||pn.includes(n))});
        if(a){
          p.official=a;
          if(a.start)p.offer.applyStart=a.start;if(a.end)p.offer.applyEnd=a.end;
          if(a.winner)p.offer.winnerDate=a.winner;if(a.status)p.offer.status=a.status;
          if(Number.isFinite(a.minPrice))p.offer.priceMin=a.minPrice;
          if(Number.isFinite(a.maxPrice))p.offer.priceMax=a.maxPrice;
        }
      }
    }
    render();
  }catch(e){LIVE={configured:false,note:"공식 API 연결 실패: "+String(e&&e.message||e),error:true};render()}
}
function marginClass(v){return !Number.isFinite(v)?"":v>0?"ps-positive":v<0?"ps-negative":"ps-neutral"}
function daysOld(d){
  const t=Date.parse(d+"T00:00:00+09:00"); if(!Number.isFinite(t))return null;
  return Math.max(0,Math.floor((Date.now()-t)/86400000));
}
function typeRows(p){
  return (p.types||[]).map(t=>{
    const ex=Number.isFinite(t.expansion)?t.expansion:null;
    const eMin=t.priceMin+(ex||0), eMax=t.priceMax+(ex||0);
    return '<tr><td>'+esc(t.type)+'</td><td>'+Number(t.area).toFixed(1)+'㎡</td><td>'+esc(t.units)+'</td><td>'+won(t.priceMin)+(t.priceMax!==t.priceMin?'~'+won(t.priceMax):'')+'</td><td>'+ (ex===null?"미반영":won(ex)) +'</td><td>'+won(eMin)+(eMax!==eMin?'~'+won(eMax):'')+'</td></tr>';
  }).join("");
}
function compRows(p){
  return (p.recentComparables||[]).map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+Number(c.area).toFixed(1)+'㎡</td><td>'+esc(c.date)+'</td><td>'+esc(c.floor)+'층</td><td>'+won(c.price)+'</td></tr>').join("");
}
function ymShift(back){
  const d=new Date(); const k=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-back,1));
  return String(k.getUTCFullYear())+String(k.getUTCMonth()+1).padStart(2,"0");
}
function xmlText(node,tag){const x=node.querySelector(tag);return x&&x.textContent?x.textContent.trim():""}
function parseRtms(xml,kind){
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  return [...doc.querySelectorAll("item")].map(it=>{
    const apt=xmlText(it,"aptNm")||xmlText(it,"apartment")||xmlText(it,"aptName");
    const area=Number(xmlText(it,"excluUseAr")||xmlText(it,"exclusiveArea"));
    const year=xmlText(it,"dealYear"),month=xmlText(it,"dealMonth"),day=xmlText(it,"dealDay");
    const date=year&&month?year+"-"+month.padStart(2,"0")+"-"+(day||"1").padStart(2,"0"):"";
    if(kind==="rent"){
      const dep=Number((xmlText(it,"deposit")||"").replace(/,/g,""))*10000;
      const monthly=Number((xmlText(it,"monthlyRent")||"0").replace(/,/g,""));
      return {apt,area,date,deposit:Number.isFinite(dep)?dep:null,monthly};
    }
    const price=Number((xmlText(it,"dealAmount")||"").replace(/,/g,""))*10000;
    return {apt,area,date,price:Number.isFinite(price)?price:null,floor:xmlText(it,"floor")};
  }).filter(x=>x.apt&&Number.isFinite(x.area));
}
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}
function nameHit(name,list){const n=normName(name);return (list||[]).some(x=>{const q=normName(x);return n.includes(q)||q.includes(n)})}
async function loadMarket(){
  if(!LIVE.configured||!DATA)return;
  const configs=[...new Map(DATA.projects.filter(p=>p.liveMarket).map(p=>[p.liveMarket.lawd,p.liveMarket])).values()];
  const cache={};
  for(const c of configs){
    const trades=[],rents=[];
    for(let m=0;m<3;m++){
      const ymd=ymShift(m);
      try{
        const [t,r]=await Promise.all([
          liveJson({kind:"trade",lawd:c.lawd,ymd}),
          liveJson({kind:"rent",lawd:c.lawd,ymd})
        ]);
        trades.push(...parseRtms(t.payload,"trade"));rents.push(...parseRtms(r.payload,"rent"));
      }catch(e){}
    }
    cache[c.lawd]={trades,rents};
  }
  for(const p of DATA.projects){
    const c=p.liveMarket,x=c&&cache[c.lawd]; if(!c||!x)continue;
    const lo=(c.targetArea||84)-5,hi=(c.targetArea||84)+5;
    const sales=x.trades.filter(v=>v.area>=lo&&v.area<=hi&&nameHit(v.apt,c.saleApts)&&Number.isFinite(v.price));
    const rents=x.rents.filter(v=>v.area>=lo&&v.area<=hi&&nameHit(v.apt,c.rentApts)&&Number.isFinite(v.deposit)&&(!v.monthly||v.monthly===0));
    const sm=median(sales.map(v=>v.price)),rm=median(rents.map(v=>v.deposit));
    p.liveStats={saleCount:sales.length,rentCount:rents.length,saleMedian:sm,rentMedian:rm,months:3};
    if(sales.length>=3&&Number.isFinite(sm)){
      p.benchmarks.conservative={label:"국토부 실거래 자동중앙값",price:sm,date:dateKst(0),method:"최근 3개월 지정 비교단지 80~89㎡ "+sales.length+"건 중앙값"};
      p.recentComparables=sales.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6).map(v=>({name:v.apt,area:v.area,date:v.date,floor:v.floor||"-",price:v.price}));
    }
    if(rents.length>=2&&Number.isFinite(rm)){
      p.benchmarks.jeonse={label:"국토부 전세 자동중앙값",price:rm,date:dateKst(0),method:"최근 3개월 지정 비교단지 순수전세 "+rents.length+"건 중앙값"};
    }
  }
  render();
}
function officialFeedHtml(){
  const state=LIVE.configured?'<span class="ps-badge open">공식 API 자동수집 ON</span>':'<span class="ps-badge closed">공식 API 키 필요</span>';
  if(!LIVE.configured)return '<div class="gpt-panel"><h4>공식 자동수집</h4><div class="ps-mini">'+state+' '+esc(LIVE.note||"")+'<br>Cloudflare Pages 환경변수 <b>DATA_GO_KR_API_KEY</b>에 공공데이터포털 키를 넣으면 청약홈 공고가 자동으로 붙습니다. 키 값은 화면/응답에 노출하지 않습니다.</div></div>';
  const rows=OFFICIAL.slice(0,15).map(a=>'<tr><td>'+esc(a.name)+'</td><td>'+esc(a.region)+'</td><td>'+esc(a.category==="apt"?"일반":a.category==="remndr"?"무순위/잔여":"임의공급")+'</td><td>'+esc(a.status)+'</td><td>'+esc(a.start||a.announce)+'</td><td>'+esc(a.end)+'</td><td>'+ (a.minPrice?won(a.minPrice)+(a.maxPrice!==a.minPrice?"~"+won(a.maxPrice):""):"가격형 수집 전") +'</td></tr>').join("");
  return '<div class="gpt-panel"><h4>공식 자동수집 피드</h4><div class="ps-mini">'+state+' · 최근 공고를 청약홈 OpenAPI에서 읽고 주택형별 최고분양가까지 자동 결합합니다.</div><div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>단지</th><th>지역</th><th>구분</th><th>상태</th><th>접수시작</th><th>접수종료</th><th>최고분양가 범위</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7">최근 대전·세종 공고 없음</td></tr>')+'</tbody></table></div></div>';
}
function annuity(principal,annual,years){
  const r=annual/100/12,n=Math.max(1,Math.round(years*12)); if(!principal)return 0;if(!r)return principal/n;
  const x=Math.pow(1+r,n);return principal*r*x/(x-1);
}
function financePanel(){
  if(!DATA||!DATA.projects.length)return "";
  if(!FIN.id)FIN.id=DATA.projects[0].id;
  const p=DATA.projects.find(x=>x.id===FIN.id)||DATA.projects[0],x=calc(p);
  const loan=x.eff*FIN.ltv/100,own=x.eff-loan,extra=x.eff*FIN.costRate/100;
  const monthly=annuity(loan,FIN.rate,FIN.years),interestOnly=loan*FIN.rate/100/12;
  const jeonse=p.benchmarks&&p.benchmarks.jeonse&&p.benchmarks.jeonse.price;
  const moveinGap=Number.isFinite(jeonse)?x.eff+extra-jeonse:null;
  const opts=DATA.projects.map(v=>'<option value="'+esc(v.id)+'" '+(v.id===p.id?'selected':'')+'>'+esc(v.name)+'</option>').join("");
  return '<div class="gpt-panel"><h4>자금·대출 스트레스 계산기</h4><div class="ps-controls"><select id="finProject">'+opts+'</select><label>LTV <input id="finLtv" type="number" min="0" max="100" step="5" value="'+FIN.ltv+'" style="width:58px">%</label><label>금리 <input id="finRate" type="number" min="0" max="20" step=".1" value="'+FIN.rate+'" style="width:58px">%</label><label>기간 <input id="finYears" type="number" min="1" max="50" step="1" value="'+FIN.years+'" style="width:52px">년</label><label>취득·부대비율 <input id="finCost" type="number" min="0" max="20" step=".1" value="'+FIN.costRate+'" style="width:58px">%</label></div>'+
  '<div class="ps-kpis"><div class="ps-kpi"><div class="k">실질비교가</div><div class="v">'+won(x.eff)+'</div><div class="s">분양가+확인된 확장비</div></div><div class="ps-kpi"><div class="k">가정 대출</div><div class="v">'+won(loan)+'</div><div class="s">LTV '+FIN.ltv+'% 단순 가정</div></div><div class="ps-kpi"><div class="k">계약가 기준 자기자금</div><div class="v">'+won(own+extra)+'</div><div class="s">대출 제외 + 입력한 부대비용</div></div><div class="ps-kpi"><div class="k">입주 후 전세 단순갭</div><div class="v">'+won(moveinGap)+'</div><div class="s">전세 '+won(jeonse)+' 가정</div></div></div>'+
  '<div class="ps-mini"><b>원리금균등 월상환 약 '+won(monthly)+'</b> · 이자만 보면 월 '+won(interestOnly)+' · 실제 LTV/DSR·중도금대출·취득세는 계약/입주 시점의 개인 조건과 법령에 따라 달라집니다. 특히 2029년 입주 단지는 현재 세율을 고정 적용하지 않고 부대비율을 직접 넣게 했습니다.</div></div>';
}
function projectHtml(p){
  const x=calc(p), o=p.offer||{}, isOpen=o.status!=="마감";
  const c=p.benchmarks.conservative, l=p.benchmarks.leader, j=p.benchmarks.jeonse;
  const expKnown=Number.isFinite(p.featured.expansion);
  const rules=(p.rules||[]).map(v=>'<span class="ps-badge">'+esc(v)+'</span>').join(" ");
  const notes=(p.notes||[]).map(v=>"• "+esc(v)).join("<br>");
  const catalysts=(p.catalysts||[]).map(v=>'<div style="margin:3px 0"><span class="ps-badge">'+esc(v.stage)+'</span> <b>'+esc(v.title)+'</b> · '+esc(v.detail)+' <a href="'+esc(v.url)+'" target="_blank" rel="noopener" style="color:var(--accent)">근거</a></div>').join("");
  const live=p.liveStats?('<br><b>공식 자동검증</b> 매매 '+p.liveStats.saleCount+'건 · 전세 '+p.liveStats.rentCount+'건'+(p.liveStats.saleMedian?' · 매매중앙 '+won(p.liveStats.saleMedian):'')+(p.liveStats.rentMedian?' · 전세중앙 '+won(p.liveStats.rentMedian):'')):"";
  const src=(p.sources||[]).map(s=>'<a target="_blank" rel="noopener" href="'+esc(s.url)+'">'+esc(s.label)+'</a>').join("");
  return '<div class="ps-project">'+
    '<div class="ps-project-top"><div><div><span class="ps-badge '+(isOpen?'open':'closed')+'">'+esc(o.status)+'</span><span class="ps-badge">'+esc(o.category)+'</span></div>'+
    '<div class="ps-name">'+esc(p.name)+'</div><div class="ps-meta">'+esc(p.city+" "+p.district)+" · "+p.households.toLocaleString()+"세대 · 입주 "+esc(p.moveIn)+" · "+esc(p.builder)+'</div></div>'+
    '<div class="ps-score"><div class="n">'+x.score+'</div><div class="lab">모의점수 · '+scoreLabel(x.score)+'</div></div></div>'+
    '<div class="ps-kpis">'+
      '<div class="ps-kpi"><div class="k">잔여/최근 공급가</div><div class="v">'+won(o.priceMin)+'~'+won(o.priceMax)+'</div><div class="s">'+esc(o.applyStart)+(o.applyStart!==o.applyEnd?'~'+esc(o.applyEnd):'')+' · '+o.remainingUnits+'세대</div></div>'+
      '<div class="ps-kpi"><div class="k">대표 실질비교가</div><div class="v">'+won(x.eff)+'</div><div class="s">'+esc(p.featured.label)+' · '+(expKnown?'확장비 포함':'확장비 미반영')+'</div></div>'+
      '<div class="ps-kpi"><div class="k">보수적 안전마진</div><div class="v '+marginClass(x.cm)+'">'+won(x.cm)+'</div><div class="s">'+esc(c.label)+' '+won(c.price)+' 대비 '+pct(x.cp)+'</div></div>'+
      '<div class="ps-kpi"><div class="k">대장/상단 대비 여유</div><div class="v '+marginClass(x.lm)+'">'+won(x.lm)+'</div><div class="s">'+esc(l.label)+' '+won(l.price)+' 대비 '+pct(x.lp)+'</div></div>'+
    '</div>'+
    '<div class="ps-detail"><div class="ps-box"><h5>분양가 · 옵션</h5><div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>타입</th><th>전용</th><th>세대</th><th>분양가</th><th>확장비</th><th>실질비교가*</th></tr></thead><tbody>'+typeRows(p)+'</tbody></table></div><div class="ps-mini">* 실질비교가 = 분양가 + 확인된 발코니 확장비. 취득세·인지세·유상옵션·중도금 이자는 아직 제외.</div></div>'+
    '<div class="ps-box"><h5>현금흐름 · 수요</h5><div class="ps-mini"><b>전세 기준</b> '+won(j.price)+' → 전세가율 약 <b>'+pct(x.jr)+'</b><br><b>예상 묶이는 돈</b> '+won(x.gap)+' (현재 전세 대표값 단순 차감)<br><b>청약 수요</b> '+esc(p.competitionLabel)+'<br><b>가격판정</b> '+verdict(x)+'</div></div></div>'+
    '<div class="ps-box"><h5>주변 최근 실거래</h5><div class="gpt-table-wrap"><table class="gpt-table"><thead><tr><th>단지</th><th>전용</th><th>계약일</th><th>층</th><th>거래가</th></tr></thead><tbody>'+compRows(p)+'</tbody></table></div></div>'+
    '<div class="ps-box"><h5>조건 · 주의</h5><div class="ps-mini">'+rules+'<br><br>'+notes+live+'</div></div>'+
    (catalysts?'<div class="ps-box"><h5>개발·교통 진행단계</h5><div class="ps-mini">'+catalysts+'</div></div>':'')+
    '<div class="ps-box ps-src"><h5>근거 링크</h5><div class="ps-mini">'+src+'</div></div>'+
  '</div>';
}
function render(){
  if(!DATA)return;
  let rows=DATA.projects.filter(p=>city==="전체"||p.city===city).map(p=>({p,x:calc(p)}));
  rows.sort((a,b)=>{
    if(sort==="price")return a.x.eff-b.x.eff;
    if(sort==="margin")return (b.x.cp??-99)-(a.x.cp??-99);
    if(sort==="date")return String(a.p.offer.applyStart).localeCompare(String(b.p.offer.applyStart));
    return b.x.score-a.x.score;
  });
  const age=daysOld(DATA.asOf);
  const stale=age!==null&&age>7;
  const open=DATA.projects.filter(p=>p.offer.status!=="마감").length;
  const best=rows[0];
  mount.innerHTML=
    '<div class="gpt-warn"><b>신규분양 투자판단판</b> — 분양가만 보지 않고 주변 실거래·전세·잔여물량을 함께 비교합니다. 현재는 <b>검증한 스냅샷</b> 방식이며 기준일 '+esc(DATA.asOf)+(stale?' <b style="color:var(--red)">· 데이터가 오래됐습니다</b>':'')+'. 계약 전 청약홈 원문을 다시 확인하세요.</div>'+
    '<div class="gpt-grid">'+
      '<div class="gpt-card"><div class="k">추적 단지</div><div class="v">'+DATA.projects.length+'</div><div class="s">대전·세종</div></div>'+
      '<div class="gpt-card"><div class="k">접수 예정/진행</div><div class="v">'+open+'</div><div class="s">마감 제외</div></div>'+
      '<div class="gpt-card"><div class="k">현재 1위 모의점수</div><div class="v gold">'+(best?best.x.score:"-")+'</div><div class="s">'+(best?esc(best.p.name):"-")+'</div></div>'+
      '<div class="gpt-card"><div class="k">데이터 기준일</div><div class="v" style="font-size:15px">'+esc(DATA.asOf)+'</div><div class="s">'+esc(DATA.notice||"")+'</div></div>'+
    '</div>'+
    officialFeedHtml()+financePanel()+'<div class="gpt-panel"><div class="ps-head"><div><h4 style="margin:0">신규분양 비교</h4><div class="note">모의점수 = 보수적 가격메리트 35 + 상위단지 대비 여유 15 + 청약수요 20 + 전세지지 15 + 잔여물량 희소성 15. 실제 매수점수가 아니라 조사 우선순위입니다.</div></div>'+
    '<div class="ps-controls"><button data-city="전체" class="'+(city==="전체"?"on":"")+'">전체</button><button data-city="대전" class="'+(city==="대전"?"on":"")+'">대전</button><button data-city="세종" class="'+(city==="세종"?"on":"")+'">세종</button><select id="psSort"><option value="score">모의점수순</option><option value="margin">안전마진순</option><option value="price">실질가격순</option><option value="date">접수일순</option></select><button id="psReload">새로읽기</button></div></div>'+
    '<div class="ps-list">'+(rows.map(v=>projectHtml(v.p)).join("")||'<div class="note">조건에 맞는 단지가 없습니다.</div>')+'</div></div>'+
    '<div class="gpt-panel"><h4>다음 데이터 계층 — 꼭 추가할 것</h4><div class="ps-mini"><b>1.</b> 반경 1·3km 향후 1/2/3년 입주물량과 미분양 · <b>2.</b> 현재 매물 최저/중앙 호가와 매물수 증감 · <b>3.</b> 분양권 실제 프리미엄(P) 추적 · <b>4.</b> 중도금 대출 가능 여부·이자·LTV/DSR · <b>5.</b> 취득세와 보유·양도 비용 · <b>6.</b> 학교/역/트램/도로 호재를 계획·확정·착공·개통으로 구분 · <b>7.</b> 계약률·미계약 반복횟수 · <b>8.</b> 입주 시점 예상 전세 공급까지 붙여야 실제 투자금과 하방위험을 제대로 비교할 수 있습니다.</div></div>';
  const sel=mount.querySelector("#psSort"); if(sel)sel.value=sort;
}
async function load(){
  mount.innerHTML='<div class="gpt-panel"><div class="note">신규분양 데이터를 불러오는 중…</div></div>';
  try{
    const r=await fetch("/data/realestate/gpt/presales.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    DATA=await r.json();
    window.__REGPT_PRESALES__=DATA;
    render();
  }catch(e){
    mount.innerHTML='<div class="gpt-warn">신규분양 데이터를 불러오지 못했습니다: '+esc(e&&e.message||e)+'</div>';
  }
}
mount.addEventListener("click",e=>{
  const c=e.target.closest("button[data-city]"); if(c){city=c.dataset.city;render();return}
  if(e.target.closest("#psReload")){load();return}
});
mount.addEventListener("change",e=>{
  if(!e.target)return;
  if(e.target.id==="psSort"){sort=e.target.value;render();return}
  if(e.target.id==="finProject"){FIN.id=e.target.value;render();return}
});
mount.addEventListener("input",e=>{
  if(!e.target)return;
  if(e.target.id==="finLtv")FIN.ltv=Math.max(0,Math.min(100,Number(e.target.value)||0));
  else if(e.target.id==="finRate")FIN.rate=Math.max(0,Number(e.target.value)||0);
  else if(e.target.id==="finYears")FIN.years=Math.max(1,Number(e.target.value)||1);
  else if(e.target.id==="finCost")FIN.costRate=Math.max(0,Number(e.target.value)||0);
  else return;
  render();
});
load();
})();