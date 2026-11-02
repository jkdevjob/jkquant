"""R22 ① 08:58 다시 보기(R12-가)가 08:56 보다 실제 시가를 더 잘 맞히나 — 적용(10/20) 뒤 실측 판정 (2026-10-31 아침 점검).

계기: R12 — 08:56 예상갭이 실제 시가갭보다 평균 5.4%p 깊어 실제로는 갭하락이 아닌 종목을 샀다. 10/20 부터 08:58 에 상위 10종목을 다시 보고 고른다.
R12 기록에 '1~2주 뒤 08:56 대비 정확도 판정'을 약속했다. ① 은 10월 장부 −6.34% · 5일 연속 손실이다.

사전 등록(결과 보기 전):
- 표본: 10/20 이후 Worker 장전 기록(opening-gapdown-live)의 다시 본 종목(하루 최대 10) — 같은 종목의 08:56 · 08:58 예상갭을 실제 시가갭과 비교.
  갭 = 가격 / 기준가(basePrice) − 1. 실제 시가는 FinanceDataReader(네이버 차트) 일봉 시가 — 장부 매수가와 18/18 같다.
  종가는 KRX 공식 종가(= 다음 날 기준가 = 다음 날 종가 − 다음 날 전일비, 네이버 모바일 시세)를 쓴다 — 네이버 · FinanceDataReader 일봉 '종가'는
  15:30 종가 동시호가 가격과 다르다(R22 에서 확인 · 장부 매도가 14/14 = KRX 종가 · 넥스트레이드 시간외 마지막 가격으로 보임 · ETF 는 같음).
  네이버 모바일 시세의 '시가'도 10/30 일부 종목에서 장부 시가와 달라(넥스트레이드 장전 첫 체결로 보임) 쓰지 않는다.
  마지막 날처럼 다음 날 기준가가 아직 없으면 장부 매도가를 쓰고, 장부에도 없으면 시가→종가 비교에서 뺀다.
- (a) 08:58 예상갭의 평균 절대 오차가 08:56 보다 작다.
- (b) 고른 3종목의 실제 시가갭이 규칙(−2% 이하) 안인 비율이 08:56 기준으로 골랐을 때보다 낮지 않다.
- (a)(b) 둘 다면 08:58 유지 · 아니면 되돌림을 사용자에게 묻는다(주문 경로). 시가→종가 손익 비교는 날 수가 적어 참고만.

재현: python3 scripts/research/r22_open_recheck_accuracy.py   (git 의 origin/scalping-data 에서 장전 기록을 읽는다)
"""
import json
import statistics
import subprocess
import sys
import urllib.request

import FinanceDataReader as fdr

DAYS = sys.argv[1:] or ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]


def load(day):
    raw = subprocess.run(["git", "show", f"origin/scalping-data:data/opening-gapdown-live/{day}.json"], capture_output=True, text=True)
    return json.loads(raw.stdout) if raw.returncode == 0 else None


px, ledger_exit = {}, {}


def num(x):
    return float(str(x).replace(",", ""))


def ohlc(code, day):
    """(시가, KRX 공식 종가) — 종가는 다음 날 기준가. 다음 날이 없으면 장부 매도가, 그것도 없으면 None."""
    if code not in px:
        req = urllib.request.Request(f"https://m.stock.naver.com/api/stock/{code}/price?pageSize=30&page=1", headers={"User-Agent": "Mozilla/5.0"})
        rows = sorted(json.load(urllib.request.urlopen(req, timeout=20)), key=lambda r: r["localTradedAt"])
        opens = {str(i)[:10]: float(r["Open"]) for i, r in fdr.DataReader(code, "2026-10-15", "2026-10-31").iterrows()}
        m = {r["localTradedAt"]: [opens.get(r["localTradedAt"]), None] for r in rows}
        for a, b in zip(rows, rows[1:]):
            m[a["localTradedAt"]][1] = num(b["closePrice"]) - num(b["compareToPreviousClosePrice"])
        px[code] = m
    v = px[code].get(day)
    if not v or not v[0]:
        return None
    return v[0], v[1] if v[1] is not None else ledger_exit.get((day, code))


rows, picks = [], []
for day in DAYS:
    d = load(day)
    if not d:
        print("no file", day)
        continue
    lv = subprocess.run(["git", "show", f"origin/scalping-data:data/claude-live/{day}.json"], capture_output=True, text=True)
    for e in (json.loads(lv.stdout)["ledger"]["events"] if lv.returncode == 0 else []):
        for t in e["payload"].get("trades") or [] if e["payload"].get("strategy") == "opening" else []:
            if t.get("exitPrice"):
                ledger_exit[(day, t["code"])] = float(t["exitPrice"])
    ev = {e["stage"] + ":" + str(e["payload"].get("part", "")): e["payload"] for e in d["ledger"]["events"]}
    q56 = {}
    for k, p in ev.items():
        if k.startswith("quote:") and p.get("part") != "recheck":
            for c in p.get("candidates") or []:
                if c.get("expectedPrice") and c.get("basePrice"):
                    q56[c["code"]] = c
    rc = ev.get("quote:recheck")
    pre = ev.get("preopen:")
    if not rc:
        print(day, "recheck 없음")
        continue
    for c in rc.get("candidates") or []:
        a = q56.get(c["code"])
        if not (a and c.get("expectedPrice") and c.get("basePrice")):
            continue
        oc = ohlc(c["code"], day)
        if not oc:
            continue
        base = c["basePrice"]
        rows.append(dict(day=day, code=c["code"], name=c["name"], g56=(a["expectedPrice"] / a["basePrice"] - 1) * 100,
                         g58=(c["expectedPrice"] / base - 1) * 100, gact=(oc[0] / base - 1) * 100))
    # 고른 3종목: 08:56 기준(그날 08:56 예상갭 깊은 순 · −2% 이하 · −29% 위 · RSI 전일 < 30) vs 실제(08:58 다시 본 뒤)
    rule = (pre or {}).get("watchlist", {}).get("rule") or {"gapMax": -2, "gapFloor": -29, "picks": 3}
    elig56 = sorted([c for c in q56.values() if rule["gapFloor"] <= c["expectedGapPct"] <= rule["gapMax"]], key=lambda c: c["expectedGapPct"])[:rule["picks"]]
    live = [p["code"] for p in (pre or {}).get("picks") or []]
    for tag, codes in (("p56", [c["code"] for c in elig56]), ("p58", live)):
        for code in codes:
            base = (q56.get(code) or {}).get("basePrice")
            oc = ohlc(code, day)
            if base and oc:
                picks.append(dict(day=day, tag=tag, code=code, gact=(oc[0] / base - 1) * 100, oc=(oc[1] / oc[0] - 1) * 100 - 0.25 if oc[1] else None))

n = len(rows)
mae56 = statistics.fmean(abs(r["g56"] - r["gact"]) for r in rows)
mae58 = statistics.fmean(abs(r["g58"] - r["gact"]) for r in rows)
bias56 = statistics.fmean(r["g56"] - r["gact"] for r in rows)
bias58 = statistics.fmean(r["g58"] - r["gact"] for r in rows)
better = sum(1 for r in rows if abs(r["g58"] - r["gact"]) < abs(r["g56"] - r["gact"]))
same = sum(1 for r in rows if abs(r["g58"] - r["gact"]) == abs(r["g56"] - r["gact"]))
print(f"다시 본 종목 {n}개 · {len({r['day'] for r in rows})}일")
print(f"(a) 평균 절대 오차 08:56 {mae56:.2f}%p · 08:58 {mae58:.2f}%p · 치우침(예상−실제) 08:56 {bias56:+.2f} · 08:58 {bias58:+.2f} · 08:58 이 더 가까움 {better} · 같음 {same}")
for tag in ("p56", "p58"):
    ps = [p for p in picks if p["tag"] == tag]
    pc = [p for p in ps if p["oc"] is not None]
    inrule = sum(1 for p in ps if p["gact"] <= -2)
    print(f"(b) {tag}: 고른 {len(ps)} · 실제 시가갭 −2% 이하 {inrule} ({inrule / len(ps) * 100:.0f}%) · 평균 시가갭 {statistics.fmean(p['gact'] for p in ps):+.2f}% · "
          f"시가→KRX 종가(비용 0.25% 뺌 · {len(pc)}건) 평균 {statistics.fmean(p['oc'] for p in pc):+.2f}% · 이긴 비율 {sum(1 for p in pc if p['oc'] > 0) / len(pc) * 100:.0f}%")
same_days = sum(1 for day in DAYS if sorted(p["code"] for p in picks if p["day"] == day and p["tag"] == "p56") == sorted(p["code"] for p in picks if p["day"] == day and p["tag"] == "p58"))
print("두 기준 고른 종목이 같은 날", same_days, "/", len({p['day'] for p in picks}))
for day in DAYS:
    f = lambda p: f"{p['code']} {p['gact']:+.1f}/" + (f"{p['oc']:+.1f}" if p["oc"] is not None else "?")
    a = [f(p) for p in picks if p["day"] == day and p["tag"] == "p56"]
    b = [f(p) for p in picks if p["day"] == day and p["tag"] == "p58"]
    print(day, "56:", a, "| 58:", b)
