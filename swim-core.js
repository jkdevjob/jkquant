/* JK 투자 — 수영대회 화면 공용 계산(순수 함수 · 브라우저/Node 공용).
   접수 상태 · 필터 · 정렬 · 통계를 한 곳에서 정한다(화면과 시험이 같은 함수를 쓴다). */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SwimCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const ISO=/^\d{4}-\d{2}-\d{2}$/;
  const iso=d=>ISO.test(d||'')?d:'';
  function kstToday(now){
    const d=new Date((now==null?Date.now():+now)+9*36e5);
    return d.toISOString().slice(0,10);
  }
  function addDays(d,n){return new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);}
  function addMonths(d,n){const [y,m]=d.split('-').map(Number);const t=new Date(Date.UTC(y,m-1+n,1));return t.toISOString().slice(0,10);}
  function monthStart(d){return d.slice(0,8)+'01';}

  /* 접수 상태: cancelled · postponed · ended · closed · open · soon · unknown */
  function applyStatus(e,t){
    if(e.status==='cancelled')return 'cancelled';
    if(e.status==='postponed')return 'postponed';
    const end=iso(e.end_date)||iso(e.start_date);
    if(end&&end<t)return 'ended';
    const ao=iso(e.apply_open),ac=iso(e.apply_close);
    if(e.apply_closed)return 'closed';
    if(ac&&ac<t)return 'closed';
    if(ao&&ao>t)return 'soon';
    if(ao&&ac&&ao<=t&&t<=ac)return 'open';
    return 'unknown';
  }
  const STATUS_LABEL={open:'접수중',soon:'접수예정',closed:'접수마감',ended:'대회종료',unknown:'접수 미확정',cancelled:'대회 취소',postponed:'대회 연기'};
  const KIND_LABEL={masters:'마스터즈·동호인',elite:'전문선수',student:'학생부',other:'기타·미확정'};
  const VERIFY_LABEL={official:'공식 확인',secondary:'2차 자료',unverified:'미확정'};

  function isNew(e,t,baseline){
    const fs=iso(e.first_seen);
    return !!fs&&(!baseline||fs>baseline)&&fs>=addDays(t,-7);
  }
  function isChanged(e,t){
    const lc=iso(e.last_changed);
    return !!lc&&lc>=addDays(t,-7)&&(e.changes||[]).some(c=>c&&c.type!=='new'&&c.type!=='baseline'&&c.date>=addDays(t,-7));
  }
  function inPeriod(e,period,t){
    const s=iso(e.start_date),end=iso(e.end_date)||s;
    if(!s)return period==='all';
    switch(period){
      case 'all':return true;
      case 'past':return end<t;
      case 'month':{const a=monthStart(t),b=addMonths(t,1);return s<b&&end>=a;}           // 이번 달에 열리는(열린) 대회
      case 'next':{const a=addMonths(t,1),b=addMonths(t,2);return s<b&&end>=a;}
      case '3m':return end>=t&&s<addMonths(t,3);
      default:return end>=t;                       // upcoming(기본): 끝나지 않은 대회
    }
  }
  const text=e=>[e.title,(e.aliases||[]).join(' '),e.region,e.venue,e.eligibility,e.events].join(' ').toLowerCase();

  /* f: {q,sido,sigungu,kind,sport,period,status,elig,free,quick} — 모두 함께 적용 */
  function matches(e,f,t,baseline){
    f=f||{};
    const st=applyStatus(e,t);
    if(f.q){const words=String(f.q).toLowerCase().split(/\s+/).filter(Boolean);const s=text(e);if(!words.every(w=>s.includes(w)))return false;}
    if(f.sido&&e.sido!==f.sido)return false;
    if(f.sigungu&&e.sigungu!==f.sigungu)return false;
    const kinds=e.kinds&&e.kinds.length?e.kinds:[e.kind||'other'];
    if(f.kind&&!kinds.includes(f.kind))return false;
    const sports=e.sports&&e.sports.length?e.sports:[e.sport||'기타'];
    if(f.sport&&!sports.includes(f.sport))return false;
    if(!inPeriod(e,f.period||'upcoming',t))return false;
    if(f.status){
      if(f.status==='cancelled'){if(st!=='cancelled'&&st!=='postponed')return false;}
      else if(st!==f.status)return false;
    }
    if(f.elig==='adult'&&e.adult_ok!==true)return false;
    if(f.elig==='student'&&e.student_ok!==true)return false;
    if(f.elig==='elite'&&!kinds.includes('elite'))return false;
    if(f.elig==='unknown'&&e.adult_ok!=null)return false;
    if(f.free==='50'&&e.free50!==true)return false;
    if(f.free==='100'&&e.free100!==true)return false;
    if(f.free==='both'&&!(e.free50===true&&e.free100===true))return false;
    if(f.free==='unknown'&&!(e.free50==null||e.free100==null))return false;
    switch(f.quick){
      case 'masters':if(!kinds.includes('masters'))return false;break;
      case 'elite':if(!kinds.includes('elite'))return false;break;
      case 'free':if(!(e.free50===true&&e.free100===true))return false;break;
      case 'open':if(st!=='open')return false;break;
      case 'new':if(!(isNew(e,t,baseline)||isChanged(e,t)))return false;break;
    }
    return true;
  }
  const byDate=(a,b)=>(a.start_date||'9999').localeCompare(b.start_date||'9999')||String(a.title).localeCompare(String(b.title),'ko');
  function sortList(list,key,t){
    const L=list.slice();
    switch(key){
      case 'date_desc':return L.sort((a,b)=>byDate(b,a));
      case 'deadline':{
        const k=e=>{const ac=iso(e.apply_close);return ac&&ac>=t&&applyStatus(e,t)!=='closed'?ac:'9999-99';};
        return L.sort((a,b)=>k(a).localeCompare(k(b))||byDate(a,b));
      }
      case 'recent':return L.sort((a,b)=>(b.first_seen||'').localeCompare(a.first_seen||'')||byDate(a,b));
      case 'changed':return L.sort((a,b)=>(b.last_changed||'').localeCompare(a.last_changed||'')||byDate(a,b));
      case 'region':return L.sort((a,b)=>(a.sido||'힣').localeCompare(b.sido||'힣','ko')||(a.sigungu||'').localeCompare(b.sigungu||'','ko')||byDate(a,b));
      case 'name':return L.sort((a,b)=>String(a.title).localeCompare(String(b.title),'ko')||byDate(a,b));
      default:return L.sort(byDate);
    }
  }
  function stats(list,t,baseline){
    let upcoming=0,open=0,fresh=0,changed=0;
    for(const e of list){
      const st=applyStatus(e,t);
      if(st!=='ended')upcoming++;
      if(st==='open')open++;
      if(isNew(e,t,baseline))fresh++;
      if(isChanged(e,t))changed++;
    }
    return {total:list.length,upcoming,open,fresh,changed};
  }
  function regions(list){
    const m={};
    for(const e of list){if(!e.sido)continue;(m[e.sido]=m[e.sido]||new Set());if(e.sigungu)m[e.sido].add(e.sigungu);}
    const out={};Object.keys(m).sort((a,b)=>a.localeCompare(b,'ko')).forEach(k=>out[k]=[...m[k]].sort((a,b)=>a.localeCompare(b,'ko')));
    return out;
  }
  function paginate(list,page,size){
    size=size||20;const pages=Math.max(1,Math.ceil(list.length/size));const p=Math.min(Math.max(1,page|0),pages);
    return {page:p,pages,items:list.slice((p-1)*size,p*size),from:list.length?(p-1)*size+1:0,to:Math.min(p*size,list.length)};
  }
  function freeLabel(v){return v===true?'가능':v===false?'불가':'미확정';}
  return {kstToday,addDays,addMonths,applyStatus,matches,sortList,stats,regions,paginate,inPeriod,isNew,isChanged,freeLabel,
          STATUS_LABEL,KIND_LABEL,VERIFY_LABEL};
});
