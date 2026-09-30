// D-1 시초가 갭하락 과매도(opening_gapdown_v1) — 09:00 전 예상체결가로 고르는 공용 규칙.
// RSI·유동성·관리종목 대용 필터는 전날 밤 scripts/backtest_opening_gapdown.py 가 watchlist.json 으로 확정한다.
// 여기서는 그 명단 안에서 예상 갭만 본다. 기준값(gapMax·gapFloor·picks)은 watchlist.rule 을 그대로 쓴다 —
// 같은 숫자를 두 군데 적지 않는다.

export const GAPDOWN_VERSION="opening_gapdown_v1";

// 기준가(stck_sdpr)는 권리락 등이 반영된 조정 전일종가라 연구의 Close-Changes 와 같은 기준이다.
// 기준가를 못 받으면 전날 밤 명단의 종가로 계산한다.
export function expectedGapPct(q,prevClose){
  const px=+(q&&q.expectedPrice)||0;
  const base=+(q&&q.basePrice)>0?+q.basePrice:+prevClose||0;
  if(!(px>0)||!(base>0))return null;
  return (px/base-1)*100;
}

export function gapdownPicks(rows,rule){
  const gapMax=+rule.gapMax,gapFloor=+rule.gapFloor,n=Math.max(0,Math.floor(+rule.picks||0));
  if(!Number.isFinite(gapMax)||!Number.isFinite(gapFloor)||!n)return [];
  return (Array.isArray(rows)?rows:[])
    .filter(r=>r&&Number.isFinite(r.expectedGapPct)&&r.expectedGapPct<=gapMax&&r.expectedGapPct>gapFloor)
    .sort((a,b)=>a.expectedGapPct-b.expectedGapPct||String(a.code).localeCompare(String(b.code)))
    .slice(0,n);
}

export function prevWeekday(today){
  const t=new Date(Date.parse(today+"T00:00:00Z"));
  do{t.setUTCDate(t.getUTCDate()-1);}while(t.getUTCDay()===0||t.getUTCDay()===6);
  return t.toISOString().slice(0,10);
}
// 전날 밤 명단이 오늘 아침에 쓸 수 있는 것인지. 규칙이 '전일 RSI' 라서 직전 평일 종가 기준이어야 한다.
// 공휴일 다음 날은 직전 평일이 휴장이라 명단이 하루 늦어 보이므로 쓰지 않는다(그날은 기록만 남고 주문 없음).
export function watchlistUsable(wl,today){
  if(!wl||wl.strategyVersion!==GAPDOWN_VERSION||!Array.isArray(wl.names))return {ok:false,reason:"watchlist_invalid"};
  const based=String(wl.basedOn||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(based)||based>=today)return {ok:false,reason:"watchlist_not_before_today"};
  if(based<prevWeekday(today))return {ok:false,reason:"watchlist_stale"};
  const r=wl.rule||{};
  if(!Number.isFinite(+r.gapMax)||!Number.isFinite(+r.gapFloor)||!(+r.picks>0))return {ok:false,reason:"watchlist_rule_missing"};
  return {ok:true,reason:""};
}
