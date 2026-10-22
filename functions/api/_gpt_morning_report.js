// Shared report contract. Research only: no strategy, order or ledger mutation.
export const GPT_REPORT_HEAD='[지피티 연구 리포트]';
export const GPT_REPORT_TABS={today:'오늘 · 전체 현황',opening:'시초가',daytrading:'데이트레이딩',crypto:'비트코인',soxl:'SOXL',closing30:'종가 30분 · 개별 종목 종가 베팅',tenbagger:'텐배거 연구',duel:'클로드 대결'};
export const gptReportDate=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
export const gptReportDue=date=>Date.parse(date+'T08:00:00+09:00');
export async function enrichClosingReport(report){
  const section=report.sections.find(s=>s.tab==='closing30');
  if(!section||section.evidence.length||!section.findings.startsWith('종가 30분·개별 종목 종가 베팅의 이번 보고 원본'))return report;
  const url='https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/closing30.json';
  try{
    const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw Error('closing research unavailable');
    const data=await r.json(),at=Date.parse(data.generatedAt||''),age=Date.now()-at;
    if(!Number.isFinite(at)||age<0||age>2*86400000)throw Error('closing research stale');
    const base=(data.variants||[]).filter(v=>v.name==='baseline');
    if(!['day','overnight'].every(k=>base.some(v=>v.kind===k)))throw Error('closing research incomplete');
    const count=k=>Number(base.find(v=>v.kind===k)?.summary?.trades||0);
    const added={...section,status:data.errors?.length?'blocked':'collecting',evidence:[url],
      findings:String(data.date||'')+' 누적 원본 '+Number(data.archiveDays||0)+'일 · 종가 30분 '+count('day')+'건 · 개별 종목 종가 베팅 '+count('overnight')+'건. 메인·그림자 비용·위험을 매일 비교합니다.'+(data.errors?.length?' 원본 조회 오류 '+data.errors.length+'건 · 개선 확정 불가.':' 표본·시간순 검증 후 개선 후보를 검토합니다.'),
      nextTest:'원본 매매이력과 비용·위험·시간순 성과를 누적하고 당일 종가/다음 거래일 시가를 대조'};
    return {...report,sections:report.sections.map(s=>s.tab==='closing30'?added:s)};
  }catch{return report;}
}
const text=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
export function normalizeGptReport(b,now=Date.now()){
  if(!b||b.schema!==1)throw Error('schema 1 required');
  const date=String(b.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||![gptReportDate(now),gptReportDate(now+86400000)].includes(date))throw Error('report must be for today or tomorrow KST');
  const at=Date.parse(b.preparedAt||'');
  if(!Number.isFinite(at)||at>now+90000||at<now-86400000)throw Error('preparedAt missing, future or stale');
  if(!/^[a-f0-9]{40}$/.test(String(b.mainSha||'')))throw Error('mainSha required');
  // Reports prepared before the new tab keep the seven existing sections, with
  // the new section explicitly blocked until its own evidence is provided.
  if(Array.isArray(b.sections)&&b.sections.length===7&&!b.sections.some(s=>s?.tab==='closing30')&&Object.keys(GPT_REPORT_TABS).filter(t=>t!=='closing30').every(t=>b.sections.filter(s=>s?.tab===t).length===1))b={...b,sections:[...b.sections,{tab:'closing30',status:'blocked',findings:'종가 30분·개별 종목 종가 베팅의 이번 보고 원본이 제출되지 않았습니다. 야간 누적 연구와 매매장부를 확인해야 합니다.',nextTest:'당일 종가·다음 거래일 시가 원본 및 메인/그림자 비용·위험 검증',evidence:[]}]};
  if(!Array.isArray(b.sections)||b.sections.length!==Object.keys(GPT_REPORT_TABS).length)throw Error('all research tabs required');
  const sections=Object.keys(GPT_REPORT_TABS).map(tab=>{
    const a=b.sections.filter(s=>s&&s.tab===tab);if(a.length!==1)throw Error('missing or duplicate tab: '+tab);
    const s=a[0],findings=text(s.findings,700),nextTest=text(s.nextTest,350);
    if(!findings||!nextTest||!['verified','collecting','blocked','no_change'].includes(s.status))throw Error('findings, nextTest and status required: '+tab);
    const evidence=(Array.isArray(s.evidence)?s.evidence:[]).filter(u=>typeof u==='string'&&/^https:\/\//.test(u)&&u.length<=1000).slice(0,4);
    if(s.status==='verified'&&!evidence.length)throw Error('verified requires evidence: '+tab);
    return {tab,label:GPT_REPORT_TABS[tab],status:s.status,findings,nextTest,evidence};
  });
  const summary=text(b.summary,260);if(!summary)throw Error('summary required');
  return {schema:1,date,preparedAt:new Date(at).toISOString(),mainSha:b.mainSha,summary,sections};
}
export function missingGptReport(date,now=Date.now()){
  return {schema:1,date,preparedAt:new Date(now).toISOString(),mainSha:'',missing:true,
    summary:'아침 연구 보고서가 준비되지 않았습니다. 개선·수익 수치를 확인하지 못했으며 운영 전략은 유지합니다.',
    sections:Object.entries(GPT_REPORT_TABS).map(([tab,label])=>({tab,label,status:'blocked',findings:'제출된 최신 연구·검증 결과 없음 · 미확인',nextTest:'원천·자동화 실행을 확인하고 검증 결과를 누적',evidence:[]}))};
}
export function gptReportMessage(report){
  const title=GPT_REPORT_HEAD+' '+report.date.slice(5).replace('-','/')+(report.missing?' · 연구 준비 미완료':'');
  const lines=[title,report.summary,''];
  for(const s of report.sections)lines.push('['+s.label+'] '+s.findings.slice(0,180),'다음 검증: '+s.nextTest.slice(0,100),'');
  const prepared=new Date(Date.parse(report.preparedAt)+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
  lines.push('기준 코드 '+(report.mainSha?report.mainSha.slice(0,8):'미확인')+' · 작성 '+prepared,
    '자료 부족·미검증은 성과로 계산하지 않습니다. 운영 규칙·실주문 변경 없음.',
    '전체 보고서: https://jkquant.pages.dev/scalping?strategy=daily&morningReport='+report.date);
  return {id:'gpt-morning:'+report.date,type:'gpt',title,body:report.summary,url:'https://jkquant.pages.dev/scalping?strategy=daily&morningReport='+report.date,text:lines.join('\n').slice(0,3500)};
}
