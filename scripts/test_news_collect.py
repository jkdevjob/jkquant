"""연구 R11 헤드라인 · 분봉 수집 값 시험 — python scripts/test_news_collect.py"""
import json, os, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import news_collect as N

n = 0
def ok(name, cond, extra=""):
    global n
    if not cond:
        print("FAIL", name, extra); sys.exit(1)
    n += 1; print("PASS", name)

RSS = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title>
<item><title>하나증권, HL만도 목표가↓</title><link>https://www.yna.co.kr/view/A1</link><guid>https://www.yna.co.kr/view/A1</guid><pubDate>Thu, 15 Oct 2026 08:28:01 +0900</pubDate></item>
<item><title>같은 기사 다시</title><link>https://www.yna.co.kr/view/A1</link><guid>https://www.yna.co.kr/view/A1</guid><pubDate>Thu, 15 Oct 2026 08:28:01 +0900</pubDate></item>
<item><title>Nvidia boss warns</title><link>https://finance.yahoo.com/x</link><guid>uuid-1</guid><pubDate>bad date</pubDate></item>
<item><title></title><link>https://x</link></item></channel></rss>"""
items = N.parse_rss(RSS, "yna_market")
ok("RSS: 제목 · 링크 · 발행 시각(UTC) · 제목 없는 것 버림 · 시각 못 읽으면 None",
   len(items) == 3 and items[0]["publishedAt"] == "2026-10-14T23:28:01+00:00" and items[2]["publishedAt"] is None
   and items[0]["id"] == N.item_id("yna_market", "https://www.yna.co.kr/view/A1") and items[0]["id"] == items[1]["id"], json.dumps(items, ensure_ascii=False)[:200])
now = datetime(2026, 10, 14, 23, 37, 49, tzinfo=timezone.utc)
fresh = N.new_items(items, set(), now)
ok("새 것만: 같은 수집 안 중복은 하나 · 처음 본 시각 · 버전", len(fresh) == 2 and fresh[0]["firstSeenAt"] == "2026-10-14T23:37:49+00:00" and fresh[0]["v"] == N.V)
ok("이미 본 id 는 다시 안 씀", N.new_items(items, {items[0]["id"]}, now) == [dict(items[2], firstSeenAt=fresh[1]["firstSeenAt"], v=N.V)])

with tempfile.TemporaryDirectory() as d:
    nd = Path(d) / "news"; nd.mkdir()
    (nd / "2026-10-13.jsonl").write_text(json.dumps({"id": "old"}) + "\n", encoding="utf-8")
    (nd / "2026-10-10.jsonl").write_text(json.dumps({"id": "too-old"}) + "\n", encoding="utf-8")
    ok("최근 3일 파일의 id 만 본 것으로", N.seen_ids(nd, datetime(2026, 10, 15).date()) == {"old"})
    ok("분봉 한 번 쓰면 덮어쓰지 않음", N.save_day(d, "SOXL", "2026-10-13", "America/New_York", "s", [[1]]) and not N.save_day(d, "SOXL", "2026-10-13", "America/New_York", "s", [[2]])
       and json.loads((Path(d) / "minute/SOXL/2026-10-13.json").read_text())["rows"] == [[1]])

up = [dict(candle_date_time_kst="2026-10-15T00:00:00", opening_price=1, high_price=2, low_price=0.5, trade_price=1.5, candle_acc_trade_volume=3),
      dict(candle_date_time_kst="2026-10-14T23:59:00", opening_price=4, high_price=5, low_price=3, trade_price=4.5, candle_acc_trade_volume=6),
      dict(candle_date_time_kst="2026-10-14T00:00:00", opening_price=7, high_price=8, low_price=6, trade_price=7.5, candle_acc_trade_volume=9)]
ok("업비트: 그 한국 날짜만 · 오래된 순", N.upbit_rows(up, "2026-10-14") == [["00:00", 7, 8, 6, 7.5, 9], ["23:59", 4, 5, 3, 4.5, 6]])

ts = [int(datetime(2026, 10, 13, 13, 30, tzinfo=timezone.utc).timestamp()), int(datetime(2026, 10, 14, 13, 30, tzinfo=timezone.utc).timestamp()), int(datetime(2026, 10, 14, 13, 31, tzinfo=timezone.utc).timestamp())]
ch = {"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"open": [1, 2, 3], "high": [1, 2, 3], "low": [1, 2, 3], "close": [1, 2, None], "volume": [10, 20, 30]}]}}]}}
ses = N.yahoo_sessions(ch)
ok("Yahoo: 뉴욕 날짜별 · 값 빈 분 버림", sorted(ses) == ["2026-10-13", "2026-10-14"] and ses["2026-10-14"] == [["09:30", 2, 2, 2, 2, 20]])

nv = """[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
["202610140900", null, null, null, 8305, 1977880, null],
["202610140901", null, null, null, 8340.5, 3115817, null],
["202610150900", null, null, null, 7000, 5, null]]"""
ns = N.naver_sessions(nv)
ok("네이버: 날짜별 1분 종가 · 거래량", ns["2026-10-14"] == [["09:00", 8305.0, 1977880.0], ["09:01", 8340.5, 3115817.0]] and ns["2026-10-15"] == [["09:00", 7000.0, 5.0]])

days = ["2026-10-14", "2026-10-15"]
k1 = datetime(2026, 10, 14, 23, 40, tzinfo=timezone.utc)          # 한국 10/15 08:40
k2 = datetime(2026, 10, 15, 6, 50, tzinfo=timezone.utc)           # 한국 10/15 15:50
ok("끝난 하루만: 국내 오늘은 15:45 전엔 안 씀 · 뒤엔 씀", N.done_days(days, k1, N.KST, "15:45") == ["2026-10-14"] and N.done_days(days, k2, N.KST, "15:45") == days)
ok("끝난 하루만: 미국 오늘은 20:05(시간외 끝) 전엔 안 씀", N.done_days(["2026-10-13", "2026-10-14"], datetime(2026, 10, 14, 23, 40, tzinfo=timezone.utc), N.NY, "20:05") == ["2026-10-13"])

# ── R32 ① 후보 분봉 ──
def q(code, px, base, name=None):
    return dict(code=code, name=name or code, expectedPrice=px, basePrice=base)
LIVE = {"date": "2026-11-05", "ledger": {"events": [
    {"stage": "quote", "payload": {"part": 0, "candidates": [q("000001", 950, 1000), q("000002", 981, 1000), q("000003", 980, 1000), q("000004", 900, 1000), q("12345", 500, 1000), q("000009", None, 1000)]}},
    {"stage": "quote", "payload": {"part": "recheck", "candidates": [q("000001", 970, 1000), q("000005", 960, 1000)]}},
    {"stage": "preopen", "payload": {"picks": [dict(code="000004", name="D", expectedGapPct=-10.0), dict(code="000001", name="A", expectedGapPct=-3.0), dict(code="000005", name="E", expectedGapPct=-4.0)],
                                     "shadow": {"picks": [dict(code="000004", name="D", expectedGapPct=-10.0)]}}}]}}
RES = {"signals": [dict(code="000006", name="F", gapPct=-6.5), dict(code="000004", name="D", gapPct=-8.0)]}
oc = N.opening_codes(LIVE, RES)
ok("① 후보: 고른 종목 · 그림자 · 밤 연구 신호 먼저 · 나머지는 예상갭 −2% 이하(경계 포함) 깊은 순 · 6자리 코드만 · 예상가 없는 것 버림",
   [r["code"] for r in oc] == ["000004", "000001", "000005", "000006", "000003"], json.dumps(oc, ensure_ascii=False)[:400])
byc = {r["code"]: r for r in oc}
ok("① 후보: 예상갭은 08:56 · 08:58 중 깊은 값 · 이유 표시 · 실제 갭은 밤 연구 값",
   abs(byc["000001"]["expGap"] - (-5.0)) < 1e-9 and byc["000001"]["why"] == ["0856", "0858", "pick"] and byc["000004"]["why"] == ["0856", "pick", "shadow", "research"]
   and byc["000004"]["actGap"] == -8.0 and byc["000006"]["expGap"] is None and byc["000006"]["why"] == ["research"] and abs(byc["000003"]["expGap"] - (-2.0)) < 1e-9)
old_max = N.OPENING_MAX
N.OPENING_MAX = 2
ok("① 후보: 상한을 넘어도 고른 종목 · 연구 신호는 빼지 않는다(나머지만 자른다)", [r["code"] for r in N.opening_codes(LIVE, RES)] == ["000004", "000001", "000005", "000006"])
N.OPENING_MAX = old_max
ok("① 후보: 장부가 비면 없음", N.opening_codes({}, None) == [] and N.opening_codes({"ledger": {"events": []}}, None) == [])

def sess(day):
    return {day: [["08:59", 1.0, 1.0], ["09:00", 10.0, 100.0], ["09:01", 11.0, 150.0], ["15:30", 12.0, 999.0], ["15:41", 13.0, 1000.0], ["19:59", 14.0, 1001.0]], "2026-11-04": [["09:00", 9.0, 1.0]]}
calls = []
def fake(code):
    calls.append(code)
    if code == "000003":
        return {}                                                     # 원천에 그날 분봉이 없는 종목
    return sess("2026-11-05")
with tempfile.TemporaryDirectory() as d:
    lv = Path(d) / "opening-gapdown-live"; lv.mkdir()
    for day in ["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"]:
        (lv / (day + ".json")).write_text(json.dumps({"date": day, "ledger": {"events": []}}), encoding="utf-8")
    (lv / "2026-10-27.json").write_text(json.dumps(dict(LIVE, date="2026-10-27")), encoding="utf-8")   # 후보가 있어도 최근 6일 밖이면 안 봄
    (lv / "2026-11-05.json").write_text(json.dumps(LIVE), encoding="utf-8")
    rd = Path(d) / "opening-gapdown-research" / "daily"; rd.mkdir(parents=True)
    (rd / "2026-11-05.json").write_text(json.dumps(RES), encoding="utf-8")
    t1 = datetime(2026, 11, 5, 18, 7, tzinfo=timezone.utc)            # 한국 11/06 03:07
    N.OPENING_PAUSE = 0
    r1 = N.archive_opening_minutes(d, t1, fetch=fake)
    out = json.loads((Path(d) / "minute-opening/2026-11-05.json").read_text(encoding="utf-8"))
    ok("① 분봉: 정규장(09:00~15:30)만 · 그날만 · 원천에 없으면 missing · 출처 · 장부 경로 · 버전",
       out["codes"]["000004"]["rows"] == [["09:00", 10.0, 100.0], ["09:01", 11.0, 150.0], ["15:30", 12.0, 999.0]] and out["missing"] == ["000003"]
       and sorted(out["codes"]) == ["000001", "000004", "000005", "000006"] and out["session"] == "09:00-15:30" and out["ledger"] == "opening-gapdown-live/2026-11-05.json"
       and "재구성" in out["source"] and out["v"] == N.V and out["codes"]["000004"]["why"] == ["0856", "pick", "shadow", "research"] and r1["saved"] == ["① 2026-11-05 4종목 · 없음 1"], json.dumps(r1, ensure_ascii=False))
    ok("① 분봉: 한 종목 한 번만 받음 · 최근 장부 6일만 봄(10/27 · 10/28 은 안 봄) · 후보 없는 날은 파일 없음",
       sorted(calls) == ["000001", "000003", "000004", "000005", "000006"] and not (Path(d) / "minute-opening/2026-11-04.json").exists() and not (Path(d) / "minute-opening/2026-10-27.json").exists())
    calls.clear()
    r2 = N.archive_opening_minutes(d, t1, fetch=fake)
    ok("① 분봉: 한 번 쓰면 다시 받지도 덮어쓰지도 않음", calls == [] and r2["saved"] == [] and json.loads((Path(d) / "minute-opening/2026-11-05.json").read_text(encoding="utf-8")) == out)
    (Path(d) / "minute-opening/2026-11-05.json").unlink()
    def broken(code):
        if code == "000005":
            raise OSError("net")
        return sess("2026-11-05")
    r3 = N.archive_opening_minutes(d, t1, fetch=broken)
    ok("① 분봉: 받다가 실패하면 그날 파일을 쓰지 않고 오류만 남김(다음 수집에 다시)", not (Path(d) / "minute-opening/2026-11-05.json").exists() and r3["errors"] == ["① 2026-11-05 000005: OSError"] and r3["saved"] == [])
    (lv / "2026-11-06.json").write_text(json.dumps(dict(LIVE, date="2026-11-06")), encoding="utf-8")
    t_early = datetime(2026, 11, 6, 6, 40, tzinfo=timezone.utc)       # 한국 11/06 15:40 — 그날 장부라도 15:45 전엔 안 씀
    r4 = N.archive_opening_minutes(d, t_early, fetch=fake)
    ok("① 분봉: 오늘 장부는 15:45 전엔 받지 않음(어제 것은 받음)", not (Path(d) / "minute-opening/2026-11-06.json").exists() and (Path(d) / "minute-opening/2026-11-05.json").exists() and r4["saved"] == ["① 2026-11-05 4종목 · 없음 1"])
print(f"뉴스 · 분봉 수집 값 시험: {n} PASS / 0 FAIL")
