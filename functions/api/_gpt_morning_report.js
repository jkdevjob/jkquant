// Shared report contract. Research only: no strategy, order or ledger mutation.
export const GPT_REPORT_HEAD='[지피티 연구 리포트]';
export const GPT_REPORT_TABS={today:'오늘 · 전체 현황',opening:'시초가',daytrading:'데이트레이딩',crypto:'비트코인',soxl:'SOXL',tenbagger:'텐배거 연구',duel:'클로드 대결'};
export const gptReportDate=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
export const gptReportDue=date=>Date.parse(date+'T08:00:00+09:00');
const text=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
export function normalizeGptReport(b,now=Date.now()){
  if(!b||b.schema!==1)throw Error('schema 1 required');
  const date=String(b.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||![gptReportDate(now),gptReportDate(now+86400000)].includes(date))throw Error('report must be for today or tomorrow KST');
  const at=Date.parse(b.preparedAt||'');
  if(!Number.isFinite(at)||at>now+90000||at<now-86400000)throw Error('preparedAt missing, future or stale');
  if(!/^[a-f0-9]{40}$/.test(String(b.mainSha||'')))throw Error('mainSha required');
  if(!Array.isArray(b.sections)||b.sections.length!==7)throw Error('all seven research tabs required');
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
  for(const s of report.sections)lines.push('['+s.label+'] '+s.findings.slice(0,210),'다음 검증: '+s.nextTest.slice(0,140),'');
  const prepared=new Date(Date.parse(report.preparedAt)+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
  lines.push('기준 코드 '+(report.mainSha?report.mainSha.slice(0,8):'미확인')+' · 작성 '+prepared,
    '자료 부족·미검증은 성과로 계산하지 않습니다. 운영 규칙·실주문 변경 없음.',
    '전체 보고서: https://jkquant.pages.dev/scalping?strategy=daily&morningReport='+report.date);
  return {id:'gpt-morning:'+report.date,type:'gpt',title,body:report.summary,url:'https://jkquant.pages.dev/scalping?strategy=daily&morningReport='+report.date,text:lines.join('\n').slice(0,3500)};
}
