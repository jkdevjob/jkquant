// 연구(클로드) ⚡ SOXL 탭 '인버스 거래대금 비율' 전향 시험 자료 — 공개 가격·거래대금 연구만(개인 장부·주문·계좌 없음). 읽기 전용.
// 기록은 매일 Actions(soxl-inverse-forward.yml)가 scalping-data 브랜치에 쌓고, 여기서는 최신 묶음을 그대로 전한다.
// 첫 실행 전(404)만 '시작 전'으로 답하고, 그 밖의 오류는 빈 장부로 숨기지 않고 502 로 알린다.
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/soxl-inverse-forward/latest.json";
const HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
export async function onRequestGet(){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12000);
  try{
    const r=await fetch(RAW,{signal:ac.signal,headers:{Accept:"application/json"}});
    if(r.status===404)return new Response(JSON.stringify({ok:true,schemaVersion:1,status:"waiting_first_run"}),{headers:HEADERS});
    if(!r.ok)throw new Error("research source HTTP "+r.status);
    const j=await r.json();
    if(j.schemaVersion!==1||!j.today||!j.state||!j.params||!Array.isArray(j.recent)||!j.forward||!Array.isArray(j.forward.events)||!Array.isArray(j.forward.curve))
      throw new Error("research schema mismatch");
    return new Response(JSON.stringify({...j,ok:true}),{headers:HEADERS});
  }catch(e){return new Response(JSON.stringify({ok:false,error:String(e&&e.message||e)}),{status:502,headers:HEADERS});}
  finally{clearTimeout(timer);}
}
