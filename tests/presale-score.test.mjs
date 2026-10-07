import test from "node:test";
import assert from "node:assert/strict";
import {
  areaFromType,referenceModel,placeFromAddress,parseRtms,comparablePrices,evaluatePresale,describeEvaluation
} from "../worker/presale-alert/src/presale-score.mjs";

const models=[
 {HOUSE_TY:"084.9361A",LTTOT_TOP_AMOUNT:"76,090",SUPLY_HSHLDCO:"500"},
 {HOUSE_TY:"084.9361B",LTTOT_TOP_AMOUNT:"77,490",SUPLY_HSHLDCO:"200"},
 {HOUSE_TY:"099.6540A",LTTOT_TOP_AMOUNT:"99,000",SUPLY_HSHLDCO:"100"}
];
function monthXml(ym,kind,rows=8,wrongDong=false){
  const year=ym.slice(0,4),month=Number(ym.slice(4));
  let items="";
  for(let i=0;i<rows;i++){
    const apt=i%2?"주변힐스테이트":"주변아이파크";
    const price=kind==="trade"?String(75000+i*500):String(39000+i*200);
    items+='<item><aptNm>'+apt+'</aptNm><umdNm>'+(wrongDong?"장대동":"용계동")+
      '</umdNm><excluUseAr>84.84</excluUseAr><dealYear>'+year+
      '</dealYear><dealMonth>'+month+'</dealMonth><dealDay>'+(i+1)+
      '</dealDay><buildYear>2021</buildYear><dealAmount>'+price+
      '</dealAmount><deposit>'+price+'</deposit><monthlyRent>0</monthlyRent></item>';
  }
  return "<response><items>"+items+"</items></response>";
}
const base={
  category:"apt",houseManageNo:"20260002",pblancNo:"2026-001",
  name:"도안 신규 아파트",region:"대전광역시",
  address:"대전광역시 유성구 용계동 267-3",units:1209
};
function api(wrongDong=false,emptyPrice=false){
  return async q=>{
    if(q.kind==="applyhome")return {payload:{data:emptyPrice?[]:models}};
    return {payload:monthXml(q.ymd,q.kind,q.ymd==="202609"?8:0,wrongDong)};
  };
}
test("주택형 면적은 공급면적이 아닌 HOUSE_TY에서 읽으며 84㎡군으로 묶인다",()=>{
  assert.equal(areaFromType(models[0]),84.9361);
  assert.equal(referenceModel(models).area,84);
  assert.equal(referenceModel(models).price,767900000);
});
test("법정동과 자치구 코드가 없는 주소는 위치 추측하지 않는다",()=>{
  assert.deepEqual(placeFromAddress(base.address,base.region),{city:"대전",lawd:"30200",umd:"용계동"});
  assert.equal(placeFromAddress("대전광역시 유성구 5블록","대전"),null);
  assert.equal(placeFromAddress("대전광역시 용계동","대전"),null);
});
test("국토부 동일 법정동·면적·기간·준공년 필터가 적용된다",()=>{
  const now=new Date("2026-10-08T00:00:00Z"),place={umd:"용계동"},ref={area:84};
  const rows=parseRtms(monthXml("202609","trade"),"trade");
  const good=comparablePrices(rows,place,ref,"신규단지",now,"trade");
  assert.equal(good.ok,true);assert.equal(good.count,8);assert.equal(good.complexes,2);
  const wrong=comparablePrices(rows,{umd:"장대동"},ref,"신규단지",now,"trade");
  assert.equal(wrong.ok,false);
  const small=comparablePrices(rows.slice(0,3),place,ref,"신규단지",now,"trade");
  assert.equal(small.ok,false);
});
test("실거래 충분하면 점수/자료충족률/분양가-인근시세를 같이 생성한다",async()=>{
  const e=await evaluatePresale(base,api(),new Date("2026-10-08T00:00:00Z"));
  assert.equal(e.status,"scored");assert.ok(e.score>=0&&e.score<=100);
  assert.equal(e.coverage,100);
  const txt=describeEvaluation({...base,evaluation:e});
  assert.match(txt,/최고분양가/);assert.match(txt,/인근/);assert.match(txt,/가격차/);
});
test("다른 법정동 시세 또는 분양가가 없으면 점수를 지어내지 않는다",async()=>{
  const wrong=await evaluatePresale(base,api(true),new Date("2026-10-08T00:00:00Z"));
  assert.equal(wrong.score,null);assert.equal(wrong.status,"pending");
  const unknown=await evaluatePresale(base,api(false,true),new Date("2026-10-08T00:00:00Z"));
  assert.equal(unknown.score,null);assert.match(unknown.reason,/분양가/);
});
test("준공 16년 초과 아파트는 비교 시세에서 제외한다",()=>{
  const rows=parseRtms(monthXml("202609","trade"),"trade").map(r=>({...r,yearBuilt:2001}));
  const x=comparablePrices(rows,{umd:"용계동"},{area:84},"신규단지",new Date("2026-10-08T00:00:00Z"),"trade");
  assert.equal(x.ok,false);
});
