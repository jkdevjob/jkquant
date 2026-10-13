// 연구(클로드) 🔟 텐배거 전향 시험 — 화면(claude-tenbagger.js) · 직접 링크 · 자료 API · 매일 실행 workflow 값 시험 + 변이 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {onRequestGet} from '../functions/api/tenbagger-claude.js';
import {onRequestPost as telegramPost,ALERT_HEAD} from '../functions/api/claude-telegram.js';

const SRC=fs.readFileSync(new URL('../claude-tenbagger.js',import.meta.url),'utf8');
const PAGE=fs.readFileSync(new URL('../claude.html',import.meta.url),'utf8');
const WF=fs.readFileSync(new URL('../.github/workflows/tenbagger-claude-forward.yml',import.meta.url),'utf8');
function load(src=SRC){const m={exports:{}};vm.runInNewContext(src,{module:m,Date,Math,JSON,isFinite,isNaN,String,Number});return m.exports;}

const hold=(o)=>({code:'000010',name:'가온',mkt:'코스닥',entryDate:'2026-10-15',entryPrice:1000,shares:6900,lastClose:1100,value:7590000,
  grossPct:10,netPct:9.4,maxMult:1.2,fromHighPct:-8.3,ma200x:1.05,hot:false,sessions:3,holdMax:250,traded:true,pendingExit:null,exitSignalDate:null,...o});
function report(){
  return {ok:true,schemaVersion:1,strategyVersion:'1.0.0',status:'running',asOf:'2026-10-20',registeredDate:'2026-10-13',kickoff:'2026-10-14',firstBuy:'2026-10-15',
    lastIsMonthEnd:false,expectedKickoff:'2026-10-14',
    model:{version:'tb-claude-model-1.0.0',sha256:'726527c7f490dca0',trainedThrough:'2026-10-08',auc:{y3_3:0.556},
      rule:{name:'1년 · 과열(2.0배) 뒤 20% 하락',hold:250,hot:2,hot_trail:0.2},backtest:{cagr:0.3647,mdd:-0.4254,oos_cagr:0.2784,baseP3:0.1762,bench:{KOSPI:{cagr:0.1051}}}},
    source:{provider:'KRX',upstreamCommit:'677c523eb42c',asOf:'2026-10-20',staleDays:1},universe:{asOf:'2026-10-20',n:1722},
    books:{usd100k:{capital:1.4e8,value:141400000,retPct:1.0,mddPct:-2.1,cash:1000000,closedN:1,wins:1,
        holdings:[hold({adjClose:1100}),hold({code:'000020',name:'<img src=x onerror=alert(1)>',hot:true,pendingExit:'hotTrail',exitSignalDate:'2026-10-20'}),
          hold({code:'000040',name:'병합',entryPrice:805,adjClose:939,lastClose:9450,netPct:16.6})],
        closed:[{code:'000030',name:'다솜',entryDate:'2026-10-15',entryPrice:1000,shares:6900,exitDate:'2026-10-19',exitPrice:1300,netPct:29.1,maxMult:1.4,reason:'hotTrail',exitSignalDate:'2026-10-16',sessions:2}],
        curve:[['2026-10-14',1.4e8],['2026-10-15',1.399e8],['2026-10-16',1.41e8],['2026-10-19',1.42e8],['2026-10-20',1.414e8]]},
      usd10k:{capital:1.4e7,value:14130000,retPct:0.93,mddPct:-2.2,holdings:[],closed:[],closedN:1,wins:1,curve:[]}},
    random:{seeds:30,p10:-3.1,p50:-0.4,p90:2.2,beat:0.8,curve:[['2026-10-14',1,1,1],['2026-10-20',0.97,0.996,1.022]]},
    market:{ok:true,KOSPI:-1.5,KOSDAQ:0.7,curve:[['2026-10-14',1,1],['2026-10-20',0.985,1.007]]},
    candidates:[{rank:1,code:'000010',name:'가온',mkt:'코스닥',score:0.469,cap:221,price:2190,A20:1,ret60:12.9,dd3:-53.8,ma200p:0.9,held:true}],
    events:[{id:'signal:2026-10-14',type:'signal',date:'2026-10-14',universe:1700,kickoff:true,picks:[{rank:1,code:'000010',name:'가온',score:0.47}],firstSeenAt:'2026-10-14T22:10:00+00:00',firstSeenAsOf:'2026-10-14'},
      {id:'buy:usd100k:2026-10-15:000010',type:'buy',book:'usd100k',date:'2026-10-15',code:'000010',name:'가온',shares:6900,price:1000,firstSeenAt:'2026-10-15T22:10:00+00:00',firstSeenAsOf:'2026-10-15'},
      {id:'buy:usd10k:2026-10-15:000010',type:'buy',book:'usd10k',date:'2026-10-15',code:'000010',name:'일만',shares:690,price:1000,firstSeenAt:'2026-10-15T22:10:00+00:00',firstSeenAsOf:'2026-10-15'},
      {id:'signal:2026-09-30',type:'signal',date:'2026-09-30',universe:1700,kickoff:false,picks:[],firstSeenAt:'2026-10-16T22:10:00+00:00',firstSeenAsOf:'2026-10-02'}],
    revisions:[{id:'buy:usd100k:2026-10-15:000010',field:'price',stored:1000,recomputed:1010}],
    notes:['고정 모형·규칙으로 등록 뒤 날짜만 모의 매매합니다.']};
}

test('연구(클로드) 이름 · 🔟 텐배거 탭 · 직접 링크(?tab=tenbagger · #tenbagger)',()=>{
  assert.match(PAGE,/<title>JK 투자 — 연구\(클로드\)<\/title>/);
  assert.match(PAGE,/<div class="kicker">Claude Research<\/div><h1>JK <span class="v">투자<\/span> 연구 <span class="ver" id="clVer">v\d+\.\d+\.\d+<\/span>/);
  assert.match(PAGE,/<button class="tab" data-tab="tenbagger" onclick="showTab\('tenbagger'\)">🔟 텐배거<\/button>/);
  assert.match(PAGE,/<script src="\/claude-tenbagger\.js\?v=1\.0\.0" defer><\/script>/);
  assert.match(fs.readFileSync(new URL('../jk-access.js',import.meta.url),'utf8'),/\{path:'\/claude',label:'연구\(클로드\)',mode:'admin',order:50\}/);
  const iife=PAGE.match(/\(function\(\)\{try\{var q=new URLSearchParams[\s\S]*?\}\)\(\);/)[0];
  const tab=(search,hash)=>{const c={location:{search,hash},URLSearchParams,TAB:'today'};vm.runInNewContext('var TAB="today";'+iife,c);return c.TAB;};
  assert.equal(tab('?tab=tenbagger',''),'tenbagger');assert.equal(tab('','#tenbagger'),'tenbagger');
  assert.equal(tab('?tab=soxl',''),'soxl');assert.equal(tab('?tab=<x>',''),'today','모르는 탭은 오늘');
  // 텐배거 탭은 단타 자료(J) 없이도 그린다 — render 첫머리에서 갈라진다
  const r=PAGE.slice(PAGE.indexOf('function render(){'),PAGE.indexOf('function render(){')+400);
  assert.ok(r.indexOf('if(TAB==="tenbagger")')>0&&r.indexOf('if(TAB==="tenbagger")')<r.indexOf('if(!J)return;'));
});

function checkView(T){
  const J=report(),h=T.view(J);
  assert.ok(!/NaN|undefined/.test(h),'NaN·undefined 없음');
  assert.ok(!h.includes('<img src=x'),'종목 이름은 이스케이프');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(h.includes('+1.0%')&&h.includes('+0.9%'),'10만$ · 1만$ 수익률 둘 다');
  assert.ok(h.includes('코스피 -1.5%')&&h.includes('코스닥 +0.7%')&&h.includes('모형이 80% 앞섬'));
  assert.ok(h.includes('10/20 조건 → 다음 거래일 종가 매도(과열 뒤 20% 하락)'),'매도 예정 표시');
  assert.ok(h.includes("<div class='s'>과열 뒤 20% 하락 · 최고 1.40배</div>"),'매도 이유 한글 · 최고 배수');
  assert.ok(h.includes("<span class='tag'>보유</span>"),'후보 표에 보유 표시');
  assert.ok(h.includes('수정 감지 1건'));
  assert.ok(h.includes('805원 → 939원')&&h.includes('실제 종가 9,450원'),'주식 병합 종목은 매수가 기준 환산가 + 실제 종가 따로');
  assert.ok(h.includes('1,000원 → 1,100원 · ')&&!h.includes('1,100원 · 6,900주 · 759만원<br>'),'보통 종목엔 환산 설명 없음');
  assert.ok(!h.includes('일만'),'기록은 10만$ 장부만(1만$ 사건은 숨김)');
  const rows=h.split('<div><b>').map(r=>r.split('</div></div>')[0]);      // 기록 한 줄씩(뒤따르는 설명 문단 제외)
  assert.ok(rows.find(r=>r.startsWith('09/30</b>')).includes('늦게 잡힘'),'월말을 다음 달에 늦게 잡은 신호 표시');
  assert.ok(!rows.find(r=>r.startsWith('10/14</b>')).includes('늦게 잡힘'),'제때 잡은 신호엔 표시 없음');
  assert.ok(rows.find(r=>r.startsWith('10/15</b>')).includes('🟢 매수 · 1종목 · 가온 1,000원'),'같은 날 매수는 한 줄로');
  assert.ok(h.includes('기록 10/15 07:10'),'기록 시각은 한국 시각');
  assert.equal((h.match(/<polyline/g)||[]).length,4,'전략 · 코스피 · 코스닥 · 무작위 중앙');
  assert.ok(h.includes("href='/tenbagger'"),'30년 분석으로 연결');
  assert.ok(h.includes('실제 매수·매도 때만'),'알림 규칙 안내');
  const a=load().view({...report(),alert:{stage:'buy',body:'10/21 종가 매수 예정 1종목: <b>가온</b>',text:'x'}});
  assert.ok(a.includes('🔔 10/20 자료 알림 · <b>🟢 매수</b> — 10/21 종가 매수 예정 1종목: &lt;b&gt;가온&lt;/b&gt;'),'이번 알림 표시(이스케이프)');
}
test('화면: 상태 · 두 장부 · 시장/무작위 비교 · 보유(매도 예정) · 매도 이유 · 후보 · 기록(10만$만) · 수정 감지 · 이스케이프',()=>{
  checkView(load());
});

test('화면: 첫 실행 전 · 등록 뒤 시작 전 · 오류는 숨기지 않는다',()=>{
  const T=load();
  assert.match(T.view({ok:true,schemaVersion:1,status:'waiting_first_run'}),/아직 첫 실행 전/);
  const w=T.view({...report(),status:'waiting_kickoff',books:{},kickoff:null});
  assert.match(w,/첫 신호 <b>10\/14 종가<\/b>/);assert.ok(!w.includes('💼 보유'));assert.ok(!/NaN|undefined/.test(w));
  assert.match(T.view({ok:false,error:'research source HTTP 503'}),/못 불러왔습니다: research source HTTP 503/);
  assert.match(T.chart({books:{usd100k:{curve:[['2026-10-14',1]]}}}),/첫 매수 다음 거래일부터/);
  const k=T.view({...report(),asOf:'2026-10-14',lastIsSignal:true,freeSlots:20,books:{usd100k:{curve:[['2026-10-14',1.4e8]],holdings:[],closed:[]},usd10k:{}}});
  assert.match(k,/10\/14 종가가 신호 — 다음 거래일 종가에 빈 칸 20개를/,'첫 신호 날: 다음 거래일 매수 안내');
  assert.ok(!/NaN|undefined/.test(k));
});

test('변이: 이스케이프 빼기 · 1만$ 기록 섞기 · 매도 예정 숨기기 · 기록 시각 UTC 표시는 값 시험이 잡는다',()=>{
  const muts=[["<b>\"+esc(x.name)+\"</b> <span class='sub'>\"+esc(x.code)+\" · \"+esc(x.mkt)","<b>\"+x.name+\"</b> <span class='sub'>\"+esc(x.code)+\" · \"+esc(x.mkt)"],
    ['return !e.book||e.book==="usd100k"','return true'],
    ['var st=x.pendingExit?','var st=false?'],
    ['var k=new Date(d.getTime()+9*3600e3)','var k=new Date(d.getTime())']];
  for(const [a,b] of muts){
    const m=SRC.replace(a,b);
    assert.notEqual(m,SRC,'변이 대상 문자열이 있어야 한다: '+a);
    assert.throws(()=>checkView(load(m)),assert.AssertionError,'변이를 못 잡음: '+a);
  }
});

test('API: 첫 실행 전(404)만 시작 전 · 오류·모양 틀림은 502 로 숨기지 않음 · 장부 그대로 전달',async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('',{status:404});
    let r=await onRequestGet();assert.equal(r.status,200);assert.equal((await r.json()).status,'waiting_first_run');
    globalThis.fetch=async()=>Response.json(report());
    r=await onRequestGet();const j=await r.json();assert.equal(r.status,200);assert.equal(j.ok,true);assert.equal(j.books.usd100k.value,141400000);
    assert.equal(r.headers.get('cache-control'),'no-store');
    globalThis.fetch=async()=>new Response('',{status:503});
    r=await onRequestGet();assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
    globalThis.fetch=async()=>Response.json({schemaVersion:1,events:'x',candidates:[],books:{}});
    r=await onRequestGet();assert.equal(r.status,502);
    globalThis.fetch=async()=>{throw new Error('network');};
    r=await onRequestGet();assert.equal(r.status,502);
  }finally{globalThis.fetch=old;}
  const api=fs.readFileSync(new URL('../functions/api/tenbagger-claude.js',import.meta.url),'utf8');
  assert.match(api,/scalping-data\/data\/tenbagger-claude-forward\/latest\.json/);
  assert.ok(!/kis|order|token|Authorization/i.test(api),'주문·계좌·토큰 경로 없음');
});

test('workflow: 자료 브랜치 저장 뒤에 알림 · 매수·매도 있을 때만 · 웹 알림 + 텔레그램(처음 만든 알림만 · 거절만 재시도) · 실주문 경로 없음',()=>{
  assert.match(WF,/ref: scalping-data/);
  assert.match(WF,/forward\.py --app \.app --out data\/tenbagger-claude-forward --cache \/tmp\/tbc-inputs --note-out \/tmp\/tbc-note\.json/);
  assert.ok(WF.indexOf('push-scalping-data.sh')<WF.indexOf('/research-note'),'기록 저장이 알림보다 먼저');
  assert.match(WF,/\[ -f \/tmp\/tbc-note\.json \] \|\| \{ echo "매수·매도 없음 — 알림 없음"; exit 0; \}/);
  assert.match(WF,/if jq -e '\.fresh == true' \/tmp\/tbc-note\.json/,'텔레그램은 이번에 처음 만든 알림만');
  assert.match(WF,/jq '\{op:"event", text:\.telegram\}'/);assert.match(WF,/"\$BASE\/api\/claude-telegram"/);
  assert.match(WF,/if \[ "\$CODE" = "502" \] && jq -e '\.definite == true'/,'거절(definite)만 다시');
  assert.match(WF,/secrets\.AUTOTRADE_KEY/);assert.match(WF,/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(WF,/cron: "10 22 \* \* 1-5"/);
  assert.match(WF,/- "data\/tenbagger\/claude\/forward-model-1\.0\.0\.json"/);
  assert.ok(!/kis|order|vts/i.test(WF.replace(/actions\/checkout|setup-python/g,'')),'주문 경로 없음');
  const fw=fs.readFileSync(new URL('../scripts/tenbagger_claude/forward.py',import.meta.url),'utf8');
  const sha=fw.match(/MODEL_SHA256 = '([0-9a-f]{64})'/)[1];
  assert.equal(sha.length,64,'고정 모형 sha256 이 코드에 적혀 있다');
  assert.match(fw,/HEAD = '\[클로드 연구 텐배거\]'/,'엔진 알림 머리말');
});

test('텔레그램: [클로드 연구 텐배거] 머리말 매수·매도만 보낸다 · 다른 머리말·요약은 거절',async()=>{
  const old=globalThis.fetch,sent=[];
  globalThis.fetch=async(u,init)=>{if(String(u).includes('api.telegram.org')){sent.push(JSON.parse(init.body).text);return Response.json({ok:true,result:{message_id:9}});}throw new Error('unexpected '+u);};
  const env={OPENING_MONITOR_KEY:'k',TELEGRAM_BOT_TOKEN:'t',TELEGRAM_CHAT_ID:'c'};
  const post=b=>telegramPost({request:new Request('https://p.test/api/claude-telegram',{method:'POST',headers:{'x-monitor-key':'k'},body:JSON.stringify(b)}),env});
  try{
    const text='[클로드 연구 텐배거] 🟢 매수\n다음 거래일(10/15) 종가 매수 예정 20종목\n 1. 벨로크 (424760)';
    let r=await post({op:'event',text});assert.equal(r.status,200);assert.deepEqual(sent,[text]);
    assert.ok(ALERT_HEAD.test(text));
    r=await post({op:'event',text:'[클로드 연구 텐배거요약] 주간'});assert.equal(r.status,400);
    r=await post({op:'event',text:'🔬 텐배거 전향 시험(클로드) 10/15'});assert.equal(r.status,400,'머리말 없이 시작하면 거절');
    assert.equal(sent.length,1);
  }finally{globalThis.fetch=old;}
});
