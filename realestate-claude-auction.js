/* 부동산 🤖 클로드 — 경매 계산 엔진 (공부·모의입찰용)
   화면(realestate-claude-auction-ui.js)과 시험이 이 함수만 쓴다. 단위는 만원.
   세금·중개보수는 아파트 엔진(realestate-claude-apt.js)의 같은 함수를 쓴다(같은 걸 두 군데서 세지 않는다).
   이 계산은 연습용 근사다 — 실제 입찰 전에는 매각물건명세서·등기부 원문과 법무사 확인이 필요하다.
   하는 일
     유찰 계산   감정가 → 회차별 최저가·입찰보증금(대전지방법원 저감 30% — 사건 공고로 꼭 확인)
     권리 연습   말소기준권리 날짜와 임차인 전입·확정일자·배당요구로 '떠안을 수 있는 돈'을 범위로
     비용·내 돈  입찰가 → 취득세·법무·명도·수리·미납관리비·떠안는 돈 → 총비용 · 시세 대비 할인 · 대출 · 내 돈
     2년 뒤      시세 그대로라면 팔았을 때 남는 돈(중개·양도세·이자·보유세 뺀 뒤) · 1년 안에 팔면 세금
     입찰가      '시세보다 목표만큼 싸게'를 지키는 가장 높은 입찰가
     모의입찰    사건마다 내 입찰가와 그때 계산을 저장하고, 매각기일 뒤 실제 낙찰가를 넣어 비교 */
(function(g){
'use strict';
const APT=(typeof module!=='undefined'&&module.exports)?require('./realestate-claude-apt.js'):g.JKREApt;
const {acqRate,brokerRate,gainTax}=APT;
const BASE=(typeof module!=='undefined'&&module.exports)?require('./realestate-claude-engine.js'):g.JKRealEstateClaude;
const {ymk}=BASE;

const VERSION='1.2.0';
/* 가정 — 화면에서 바꿀 수 있다. 근거 없는 값은 '가정'으로 보이게 한다 */
const DEFAULTS={
  cut:0.30,           // 유찰 1번마다 최저가 저감률 — 대전지방법원 30%(법원·사건마다 다름 · 매각공고 확인)
  depositRate:0.10,   // 입찰보증금 = 최저가 × 10%
  redepositRate:0.20, // 재매각(앞 낙찰자가 잔금을 안 낸 사건) 보증금 20%
  legal:100,          // 등기·법무 비용(만원, 가정)
  moveOut:300,        // 명도 비용(이사비 등, 만원, 가정)
  repair:0,           // 수리비(만원)
  arrears:0,          // 미납 관리비 중 공용부분(낙찰자가 떠안음, 만원)
  loanBidRate:0.7,    // 경락잔금대출 추정 = min(낙찰가 × 70%, 감정가 × 60%) — 은행·규제·소득(DSR)에 따라 다름
  loanAppRate:0.6,
  loanRate:4.5,       // 대출 금리(연 %, 가정)
  holdCostYr:0.0015,  // 보유세(연)
  years:2,            // 1주택 비과세 보유 요건
  target:0.15         // 비용까지 다 넣고 시세보다 이만큼 싸게 사는 것을 목표로(가정)
};

/* ── 날짜·숫자 ── */
const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
const num=v=>{ if(v==null||v==='') return null; const x=+String(v).replace(/[, ]/g,''); return isFinite(x)?x:null; };
function monthKey(iso){ const m=/^(\d{4})-(\d{2})/.exec(String(iso||'')); return m?ymk(m[1]+'-'+m[2]):null; }

/* ── 유찰: 회차(1 = 처음 나온 신건). 유찰될 때마다 '앞 회차 최저가'에서 저감률만큼 내린다(만원 아래 버림) ── */
function minPriceAt(appraisal,round,cut){
  const a=num(appraisal),r=Math.max(1,Math.floor(num(round)||1)),c=cut==null?DEFAULTS.cut:+cut;
  if(a==null||a<=0) return null;
  let p=Math.floor(a);
  for(let i=1;i<r;i++) p=Math.floor(p*(1-c)+1e-9);
  return p;
}
function schedule(appraisal,o){
  o=Object.assign({},DEFAULTS,o||{}); const out=[];
  for(let r=1;r<=6;r++){ const p=minPriceAt(appraisal,r,o.cut); if(p==null) return []; out.push({round:r,min:p,ratio:p/num(appraisal),deposit:Math.round(p*o.depositRate)}); }
  return out;
}

/* ── 권리 연습: '떠안을 수 있는 돈'을 범위(최소~최대)로 ──
   말소기준권리 = 가장 먼저 등기된 (근)저당·(가)압류·담보가등기·경매개시결정 등. 그보다 늦은 권리는 낙찰로 지워진다.
   임차인은 전입한 다음 날 0시에 대항력이 생긴다 → 전입일이 말소기준 날짜보다 '앞'이어야 낙찰자에게 맞설 수 있다(같은 날이면 못 맞섬).
   대항력 있는 임차인:
     배당요구 + 확정일자가 말소기준보다 앞섬 → 배당에서 먼저 받는다. 낙찰가가 보증금 + 경매비용보다 크면 떠안을 돈 0
     배당요구 + 확정일자가 늦음               → 배당에서 다 못 받을 수 있다 → 0 ~ 보증금 전액(배당표 계산 필요)
     배당요구 안 함 · 확정일자 없음           → 보증금 전액을 낙찰자가 돌려줘야 한다
   특수 권리(유치권 · 법정지상권 · 선순위 가처분/가등기/전세권 · 대지권 미등기 · 지분)는 계산하지 않고 '초보는 피하기'로 표시한다. */
const FLAGS={lien:'유치권 신고',superficies:'법정지상권 문제',priorRight:'말소기준보다 앞선 가처분·가등기·전세권 등(떠안음)',landRight:'대지권 미등기',share:'지분 경매(일부만 팖)'};
function rights(input,bid,o){
  o=Object.assign({},DEFAULTS,o||{}); input=input||{};
  const base=input.base,notes=[],red=[],items=[];
  let lo=0,hi=0,level='safe';
  for(const k of Object.keys(FLAGS)) if(input.flags&&input.flags[k]) red.push(FLAGS[k]);
  if(!isDate(base)) return {level:'unknown',assumeMin:0,assumeMax:0,items,notes:['말소기준권리 날짜를 넣어야 판단할 수 있습니다'],red};
  const B=num(bid),cost=Math.round((B||0)*0.01);                       // 경매비용(근사) — 배당에서 먼저 빠진다
  for(const t of input.tenants||[]){
    const dep=num(t.deposit)||0,who=t.name||'임차인';
    if(!isDate(t.moveIn)){ items.push({who,deposit:dep,min:0,max:dep,why:'전입일을 모름 — 확인 전엔 최악(전액)으로 봄'}); hi+=dep; level=level==='danger'?level:'check'; continue; }
    if(t.moveIn>=base){ items.push({who,deposit:dep,min:0,max:0,why:'말소기준 '+(t.moveIn===base?'같은 날':'뒤')+' 전입 → 대항력 없음 · 낙찰로 끝남(보증금은 배당에서만)'}); continue; }
    if(t.claimed&&isDate(t.fixed)&&t.fixed<base){
      const short=B==null?dep:Math.max(0,dep-Math.max(0,B-cost));
      items.push({who,deposit:dep,min:0,max:short,why:'대항력 · 배당요구 · 확정일자도 말소기준보다 앞섬 → 배당에서 먼저 받음'+(short?' — 입찰가가 낮으면 모자란 '+short+'만원을 떠안음':' — 이 입찰가면 다 받아 떠안을 돈 없음')});
      hi+=short; if(short) level=level==='danger'?level:'check';
    } else if(t.claimed&&isDate(t.fixed)){
      items.push({who,deposit:dep,min:0,max:dep,why:'대항력 · 배당요구했지만 확정일자가 말소기준보다 늦음 → 배당 순위가 밀려 못 받은 만큼 떠안음(배당표 계산 필요)'});
      hi+=dep; level=level==='danger'?level:'check';
    } else {
      items.push({who,deposit:dep,min:dep,max:dep,why:'대항력 있는데 '+(t.claimed?'확정일자 없음':'배당요구 안 함')+' → 보증금 '+dep+'만원 전액을 낙찰자가 돌려줘야 함'});
      lo+=dep; hi+=dep; if(dep>0) level='danger';
    }
  }
  if(red.length) level='danger';
  if(level==='safe') notes.push('떠안을 권리·보증금이 없는 것으로 보입니다(입력한 정보 기준)');
  if(level==='check') notes.push('범위로 계산했습니다 — 큰 쪽(최악)으로 비용을 잡습니다');
  if(level==='danger') notes.push('떠안는 돈이 있거나 특수 권리가 있습니다 — 처음이면 피하는 게 좋습니다');
  return {level,assumeMin:lo,assumeMax:hi,items,notes,red};
}

/* ── 비용·내 돈 ── */
function costsAt(B,o,assume){
  const acq=Math.round(B*acqRate(B));
  return {acq,legal:+o.legal||0,moveOut:+o.moveOut||0,repair:+o.repair||0,arrears:+o.arrears||0,assume:assume||0};
}
function sumCosts(c){ return c.acq+c.legal+c.moveOut+c.repair+c.arrears+c.assume; }
/* '시세보다 목표만큼 싸게'(비용까지 넣고)를 지키는 가장 높은 입찰가(만원) — 총비용은 입찰가에 따라 늘기만 한다 */
function maxBidFor(market,target,o,assume){
  const cap=market*(1-target); if(!(cap>0)) return null;
  let lo=0,hi=Math.ceil(market);
  if(hi+sumCosts(costsAt(hi,o,assume))<=cap) return hi;
  while(hi-lo>1){ const mid=Math.floor((lo+hi)/2); if(mid+sumCosts(costsAt(mid,o,assume))<=cap) lo=mid; else hi=mid; }
  return lo+sumCosts(costsAt(lo,o,assume))<=cap&&lo>0?lo:null;
}
/* 팔았을 때: 시세 그대로라고 보고 held 개월 뒤 판 경우 */
function sellAt(total,market,loan,o,held,k){
  const broker=Math.round(market*brokerRate(market)),tax=gainTax(total,market,broker,held,k);
  const years=held/12,interest=Math.round(loan*o.loanRate/100*years),hold=Math.round(market*o.holdCostYr*years);
  const back=market-broker-tax-hold-interest-loan;                   // 대출을 갚고 내 손에 남는 돈
  return {held,broker,tax,interest,hold,back};
}

/* ── 한 사건 분석 ──
   c = {appraisal, round, minPrice?, resale?, bid, market, rights?, assume?(직접 넣은 떠안는 돈), loan?(직접 넣은 대출)}
   now = 'YYYY-MM-DD'(양도세 비과세 기준을 정하는 달) */
function analyze(c,o,now){
  o=Object.assign({},DEFAULTS,o||{}); c=c||{};
  const appraisal=num(c.appraisal),round=Math.max(1,Math.floor(num(c.round)||1)),bid=num(c.bid),market=num(c.market);
  const minPrice=num(c.minPrice)!=null?num(c.minPrice):minPriceAt(appraisal,round,o.cut);
  const out={ok:false,warn:[],appraisal,round,minPrice,bid,market};
  if(appraisal==null||appraisal<=0){ out.warn.push('noAppraisal'); return out; }
  out.deposit=minPrice==null?null:Math.round(minPrice*(c.resale?o.redepositRate:o.depositRate));
  out.rights=rights(c.rights,bid,o);
  const assume=num(c.assume)!=null?num(c.assume):out.rights.assumeMax;
  out.assume=assume;
  if(market==null||market<=0) out.warn.push('noMarket');
  if(bid==null||bid<=0){ out.warn.push('noBid'); }
  else if(minPrice!=null&&bid<minPrice) out.warn.push('belowMin');               // 최저가보다 낮게 쓰면 무효
  if(out.rights.level==='danger') out.warn.push('danger');
  const k=monthKey(now)||monthKey(new Date().toISOString());
  if(market>0){
    out.maxBid=maxBidFor(market,o.target,o,assume);
    out.verdict=out.rights.level==='danger'?'danger':out.maxBid==null||minPrice==null?'none':out.maxBid<minPrice?'wait':'ok';
  }
  if(bid>0){
    const costs=costsAt(bid,o,assume),total=bid+sumCosts(costs);
    const loan=num(c.loan)!=null?num(c.loan):Math.round(Math.min(bid*o.loanBidRate,appraisal*o.loanAppRate));
    Object.assign(out,{costs,total,loan,cash:total-loan,bidApp:bid/appraisal});
    if(market>0){
      out.bidMkt=bid/market; out.disc=1-total/market;
      out.y2=sellAt(total,market,loan,o,o.years*12,k);  out.y2.profit=out.y2.back-out.cash; out.y2.roi=out.cash>0?out.y2.profit/out.cash:null;
      out.y1=sellAt(total,market,loan,o,12,k);           out.y1.profit=out.y1.back-out.cash; out.y1.roi=out.cash>0?out.y1.profit/out.cash:null;
      out.ok=true;
    }
  }
  return out;
}

/* ── 모의입찰 장부 — 사건마다 그때의 입력·계산을 그대로 남긴다(기록이 스스로 말하게) ──
   매각기일이 지나면 실제 결과(낙찰가·입찰자 수 또는 유찰·취하)를 넣는다. 결과를 넣은 뒤엔 내 입찰가를 못 바꾼다. */
const KEYS=['court','caseNo','itemNo','name','address','complexId','area','appraisal','round','minPrice','resale','saleDate','bid','market','marketSrc','rights','assume','loan','memo'];
function pick(input){ const x={}; for(const k of KEYS) if(input[k]!==undefined&&input[k]!=='') x[k]=input[k]; return JSON.parse(JSON.stringify(x)); }
function snapOf(a){ return {minPrice:a.minPrice,deposit:a.deposit,assume:a.assume,level:a.rights&&a.rights.level,total:a.total,disc:a.disc,loan:a.loan,cash:a.cash,maxBid:a.maxBid,verdict:a.verdict,y2:a.y2?{back:a.y2.back,profit:a.y2.profit,roi:a.y2.roi,tax:a.y2.tax}:null}; }
function newCase(input,o,nowIso){
  const c=pick(input||{}),a=analyze(c,o,nowIso);
  if(!c.caseNo) throw new Error('사건번호가 필요합니다');
  if(!a.ok) throw new Error('감정가·시세·입찰가를 넣어야 저장할 수 있습니다');
  if(a.warn.indexOf('belowMin')>=0) throw new Error('입찰가가 최저가보다 낮으면 무효입니다');
  return {id:c.caseNo+'-'+(c.itemNo||1)+'-'+nowIso,engine:VERSION,created:nowIso,params:Object.assign({},DEFAULTS,o||{}),input:c,snap:snapOf(a),result:null};
}
function editBid(cs,bid,o,nowIso){
  if(cs.result) throw new Error('결과를 넣은 사건은 입찰가를 바꿀 수 없습니다');
  const input=Object.assign({},cs.input,{bid}),a=analyze(input,cs.params,nowIso);
  if(!a.ok||a.warn.indexOf('belowMin')>=0) throw new Error('입찰가가 최저가보다 낮거나 계산할 수 없습니다');
  return Object.assign({},cs,{input,snap:snapOf(a),edited:nowIso});
}
function setResult(cs,res,nowIso){
  if(cs.result) throw new Error('이미 결과가 있습니다(지난 기록은 고치지 않음)');
  const status=res&&res.status;
  if(['sold','unsold','withdrawn'].indexOf(status)<0) throw new Error('결과는 낙찰 · 유찰 · 취하 중 하나');
  const r={status,at:nowIso};
  if(status==='sold'){
    const win=num(res.win); if(!(win>0)) throw new Error('낙찰가를 넣어야 합니다');
    const my=num(cs.input.bid),app=num(cs.input.appraisal),mkt=num(cs.input.market);
    Object.assign(r,{win,bidders:num(res.bidders),winApp:win/app,winMkt:mkt?win/mkt:null,won:my>win?true:my===win?'tie':false,myVsWin:my/win-1});
  }
  return Object.assign({},cs,{result:r});
}
function ledgerSummary(cases){
  const cs=cases||[],done=cs.filter(c=>c.result),sold=done.filter(c=>c.result.status==='sold');
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const won=sold.filter(c=>c.result.won===true);
  return {n:cs.length,open:cs.length-done.length,done:done.length,sold:sold.length,unsold:done.filter(c=>c.result.status==='unsold').length,
    won:won.length,tie:sold.filter(c=>c.result.won==='tie').length,
    avgWinApp:avg(sold.map(c=>c.result.winApp)),avgWinMkt:avg(sold.filter(c=>c.result.winMkt!=null).map(c=>c.result.winMkt)),
    avgMyGap:avg(sold.map(c=>c.result.myVsWin)),avgWonDisc:avg(won.map(c=>c.snap.disc))};
}

/* ── 온비드 공매(수집기가 만든 onbid.json) — 끝난 물건 결과 요약 · 🧮 분석 칸으로 넘길 입력 ──
   공매는 경매와 달리 인도명령이 없다(점유자가 안 나가면 명도소송) — 화면 안내에 쓴다. 금액 단위는 만원(수집기가 바꿔 둠). */
function isApt(x){ return /아파트/.test(String(x&&x.usage||'')+' '+String(x&&x.name||'')); }
/* 같은 물건(물건관리번호)의 회차들을 한 물건으로 묶는다 — 공매는 매주 회차가 바뀌며 최저가가 내려간다.
   상태: 마지막 낙찰 뒤에 아직 끝나지 않은(끝난 상태가 아니고 입찰 마감일이 오늘 이후인) 회차가 있으면 open(재공매 포함)
         · 아니고 낙찰된 회차가 있으면 sold · 아니면 done */
const ENDED=/낙찰|유찰|취소|입찰마감|수의계약|개찰중|매각|종결|중지/;
function onbidGroups(items,today){
  const by={},out=[];
  for(const x of items||[]){ const k=x.cltrMngNo||x.id; (by[k]=by[k]||[]).push(x); }
  for(const k of Object.keys(by)){
    const rs=by[k].slice().sort((a,b)=>String(a.bidEnd||'').localeCompare(String(b.bidEnd||''))||((+a.round||0)-(+b.round||0)));
    let ls=-1; rs.forEach((r,i)=>{ if(/낙찰/.test(r.status||'')||(r.result&&r.result.win>0)) ls=i; });
    const latest=rs[rs.length-1],sold=ls>=0?rs[ls]:null;
    const next=rs.find((r,i)=>i>ls&&!ENDED.test(r.status||'')&&(!r.bidEnd||String(r.bidEnd).slice(0,10)>=today))||null;
    const app=Math.max.apply(null,rs.map(r=>+r.appraisal||0))||null,cur=next||sold||latest;
    out.push({key:k,name:latest.name,addr:latest.addr,usage:latest.usage,prpt:latest.prpt,org:latest.org,branch:latest.branch,onbidCltrno:latest.onbidCltrno,
      apt:isApt(latest),appraisal:app,rounds:rs,next,sold,state:next?'open':sold?'sold':'done',minNow:cur.minPrice!=null?cur.minPrice:null,
      win:sold&&sold.result&&sold.result.win>0?sold.result.win:null,bidders:sold&&sold.result?sold.result.bidders:null});
  }
  return out.sort((a,b)=>(a.state==='open'?0:1)-(b.state==='open'?0:1)||(a.state==='open'?String(a.next.bidEnd||'').localeCompare(String(b.next.bidEnd||'')):String(b.rounds[b.rounds.length-1].bidEnd||'').localeCompare(String(a.rounds[a.rounds.length-1].bidEnd||''))));
}
function onbidSummary(groups,onlyApt){
  const gs=(groups||[]).filter(x=>!onlyApt||x.apt),sold=gs.filter(x=>x.state==='sold'),priced=sold.filter(x=>x.win>0&&x.appraisal>0);
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return {n:gs.length,open:gs.filter(x=>x.state==='open').length,sold:sold.length,done:gs.filter(x=>x.state==='done').length,priced:priced.length,
    avgWinApp:avg(priced.map(x=>x.win/x.appraisal)),avgBidders:avg(sold.filter(x=>x.bidders!=null).map(x=>+x.bidders))};
}
function onbidToCase(g){
  const r=g.next||g.sold||g.rounds[g.rounds.length-1];
  return {court:'온비드 공매',caseNo:String(g.onbidCltrno||g.key||''),itemNo:1,name:g.name||'',address:g.addr||'',
    appraisal:g.appraisal,minPrice:r.minPrice,fails:r.fails||0,saleDate:String(r.bidEnd||'').slice(0,10)};
}

const API={VERSION,DEFAULTS,FLAGS,minPriceAt,schedule,rights,costsAt,maxBidFor,analyze,newCase,editBid,setResult,ledgerSummary,isApt,onbidGroups,onbidSummary,onbidToCase};
if(typeof module!=='undefined'&&module.exports) module.exports=API;
g.JKREAuction=API;
})(typeof globalThis!=='undefined'?globalThis:this);
