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
print(f"뉴스 · 분봉 수집 값 시험: {n} PASS / 0 FAIL")
