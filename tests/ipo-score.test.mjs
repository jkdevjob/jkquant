import test from "node:test";
import assert from "node:assert/strict";
import {ipoScore,buildDailyDigest,dateKst,addDays,normalizeIPO} from "../worker/presale-alert/src/ipo-score.mjs";

const good={
  code:"009990",name:"시험공모",poPrice:18000,
  bandLo:15000,bandHi:18000,instRate:1600,subRate:500,
  subStart:"2026-10-08",subEnd:"2026-10-09",
  listDate:"2026-10-22",leadManager:"테스트증권"
};
test("공모가·기관 경쟁률로 점수 구성·근거·충족률 산출",()=>{
  const r=ipoScore(good);
  assert.equal(r.status,"scored");
  assert.ok(r.score>=0&&r.score<=100);
  assert.equal(r.coverage,100);
  assert.equal(r.components.reduce((s,x)=>s+x.weight,0),100);
  assert.equal(r.components.find(x=>x.weight===35).detail.includes("18,000원"),true);
});
test("공모가가 희망밴드 상단보다 높으면 가격메리트 점수가 떨어짐",()=>{
  const low=ipoScore({...good,poPrice:15000});
  const high=ipoScore({...good,poPrice:24000});
  assert.ok(low.score>high.score);
});
test("확정공모가·기관 수요예측 없으면 점수를 만들어내지 않음",()=>{
  assert.equal(ipoScore({...good,poPrice:null}).score,null);
  assert.equal(ipoScore({...good,instRate:null}).status,"pending");
  assert.equal(ipoScore({...good,bandHi:null}).status,"pending");
});
test("일반청약 경쟁률 없는 종목은 85% 자료충족률로 점수",()=>{
  const r=ipoScore({...good,subRate:null});
  assert.equal(r.status,"scored");
  assert.equal(r.coverage,85);
  assert.ok(r.unknown.includes("일반청약 경쟁률 미발표"));
});
test("날짜 KST 경계 처리 및 7일내 청약/당일 청약/상장 구분",()=>{
  const d=buildDailyDigest([
    good,
    {...good,code:"008881",name:"다음 공모",subStart:"2026-10-14",subEnd:"2026-10-15"},
    {...good,code:"008882",name:"오늘 상장",subStart:"2026-09-28",subEnd:"2026-09-29",listDate:"2026-10-08"},
    {...good,code:"008883",name:"멀리",subStart:"2026-11-03",subEnd:"2026-11-04"}
  ],new Date("2026-10-07T23:10:00Z"));
  assert.equal(d.date,"2026-10-08");
  assert.equal(d.subs,1);
  assert.equal(d.upcoming,1);
  assert.equal(d.listing,1);
  assert.equal(d.items.length,3);
  assert.equal(d.items[0].phase,"청약중");
});
test("공모주 대상이 없으면 0건 브리핑 생성",()=>{
  const d=buildDailyDigest([],new Date("2026-10-08T00:00:00Z"));
  assert.equal(d.items.length,0);
  assert.match(d.body,/없습니다/);
});
test("중복 종목코드는 일일 종목 목록에서 한 번만 표시",()=>{
  const d=buildDailyDigest([good,good],new Date("2026-10-08T00:00:00Z"));
  assert.equal(d.subs,1);
});
