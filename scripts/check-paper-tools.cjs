#!/usr/bin/env node
'use strict';
/* 모의투자 도구 칸은 모의 세션에서만 (index v3.132.0 · 2026-11-11)
 * 사용자: "모의투자 세션엔 전부 표시하고 실운영 세션에선 삭제" — 과거부터 자동 채우기(기존 기록을 지운다) · 오늘까지 체결 확인(모의만 돈다)
 * 칸 다섯(무매 체결 확인 · VR 자동 채우기 · VR 체결 확인 · 로테이션 자동 채우기 · 섀넌 자동 채우기)에 .paper-only ·
 * renderStatusline 이 지금 세션으로 body.realsess 를 켜고 끈다 · body.realsess .paper-only 는 숨김.
 * 값 시험(실제 함수를 뽑아 돌림) + 변이(틀린 코드로 바꾸면 빨간불).
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const SRC=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
/* 도구 단추가 든 가장 가까운 칸(<div …>)의 class — 단추 앞에서 아직 안 닫힌 div 를 거슬러 찾는다 */
function boxClassOf(src,marker){
  const at=src.indexOf(marker);if(at<0)throw Error('없음: '+marker);
  const re=/<div\b[^>]*>|<\/div>/g;const open=[];let m;
  while((m=re.exec(src))&&m.index<at){if(m[0]==='</div>')open.pop();else open.push(m[0]);}
  const cls=open.map(t=>((t.match(/class="([^"]*)"/)||[])[1]||''));
  return cls.reverse().find(c=>/\bpaper-only\b/.test(c))||'';
}
const TOOLS=[['무매 체결 확인','onclick="infSimNow()"'],['VR 자동 채우기','onclick="vrReplay()"'],['VR 체결 확인','onclick="vrSimNow()"'],['로테이션 자동 채우기','onclick="maReplay()"'],['섀넌 자동 채우기','onclick="ivsReplay()"']];
function check(src){
  const bad=[],t=(n,c,i)=>{if(!c)bad.push(n+(i?' · '+i:''));};
  // T1 칸 다섯 모두 .paper-only 안 · '모의투자 —' 제목 다섯 = 칸 다섯(빠진 칸 없음)
  const miss=TOOLS.filter(([,m])=>!boxClassOf(src,m)).map(([n])=>n);
  t('T1 모의투자 도구 칸 다섯 모두 .paper-only 안',miss.length===0,miss.join(','));
  t('T1b 화면의 "모의투자 —" 제목 다섯 = 도구 칸 다섯',(src.match(/모의투자 — (과거부터 자동 채우기|오늘까지 체결 확인)/g)||[]).length===5);
  // T2 숨김 규칙
  t('T2 실운영 세션(body.realsess)에선 .paper-only 숨김',/body\.realsess \.paper-only\{display:none!important\}/.test(src));
  // T3 실제 renderStatusline 을 돌려 body 글자 확인
  const cls=new Set(),c={document:{body:{classList:{toggle:(k,on)=>{if(on)cls.add(k);else cls.delete(k);}}}},$:()=>({innerHTML:''}),S:{activeTab:'vr'},stratStatusHtml:()=>'',_paperFilling:false,requestAnimationFrame:()=>{},cur:null};
  vm.createContext(c);vm.runInContext('function sess(){return cur;}\n'+fnOf(src,'function renderStatusline()'),c);
  const run=(s,filling)=>{c.cur=s;c._paperFilling=!!filling;c.renderStatusline();return cls.has('realsess');};
  const real=run({id:'r',paper:false}),paper=run({id:'p',paper:true}),realAgain=run({id:'r'}),during=run({id:'p',paper:true},true),none=run(null);
  t('T3 실운영 세션 → 숨김 켜짐 · 모의 → 꺼짐(전부 보임) · paper 없음 = 실운영 · 모의 성과 백그라운드 재생 중엔 안 바꿈 · 세션 없음 → 꺼짐',
    real===true&&paper===false&&realAgain===true&&during===true&&none===false,JSON.stringify({real,paper,realAgain,during,none}));
  // T4 안전장치는 그대로 — VR 자동 채우기는 모의가 아니면 묻고, 체결 확인은 모의에서만
  t('T4 안전장치 그대로: vrReplay 실계좌 확인창 · vrSimNow 모의만',/if\(!sess\.paper && !confirm\(/.test(fnOf(src,'function vrReplay()'))&&/if\(!sess\.paper\)\{ alert\('모의투자 세션에서만 쓸 수 있습니다/.test(fnOf(src,'function vrSimNow()')));
  return bad;
}
const bad=check(SRC);
if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 모의투자 도구 칸: 다섯 칸 .paper-only · 실운영 세션 숨김 규칙 · renderStatusline 이 세션마다 켜고 끔 · 안전장치 그대로');
const MUT=[
  ['VR 자동 채우기 칸에서 표시 빠짐',s=>s.replace('<div class="card paper-only" style="margin-top:13px">\n        <h3><span class="dot"></span>모의투자 — 과거부터 자동 채우기</h3>\n        <div style="display:flex;gap:8px;align-items:flex-end">\n          <div class="field" style="flex:1;margin:0"><label>시작일</label><input id="rp_vr_from"','<div class="card" style="margin-top:13px">\n        <h3><span class="dot"></span>모의투자 — 과거부터 자동 채우기</h3>\n        <div style="display:flex;gap:8px;align-items:flex-end">\n          <div class="field" style="flex:1;margin:0"><label>시작일</label><input id="rp_vr_from"')],
  ['섀넌 자동 채우기 칸에서 표시 빠짐',s=>s.replace('<div class="paper-only" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">','<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">')],
  ['숨김 규칙 없음',s=>s.replace('body.realsess .paper-only{display:none!important}','body.realsess .paper-only{}')],
  ['거꾸로: 모의 세션에서 숨김',s=>s.replace("document.body.classList.toggle('realsess', !!(s&&!s.paper));","document.body.classList.toggle('realsess', !!(s&&s.paper));")],
  ['세션이 바뀌어도 안 끔(켜기만)',s=>s.replace("document.body.classList.toggle('realsess', !!(s&&!s.paper));","if(s&&!s.paper) document.body.classList.toggle('realsess', true);")],
];
let red=0;
for(const [name,mut] of MUT){
  const m=mut(SRC);assert.notEqual(m,SRC,'변이 대상 없음: '+name);
  let failed=false;try{failed=check(m).length>0;}catch(e){failed=true;}
  if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  red++;console.log('PASS 변이 빨간불: '+name);
}
console.log('ALL PASS paper tools · 변이 '+red+'/'+MUT.length+' red');
