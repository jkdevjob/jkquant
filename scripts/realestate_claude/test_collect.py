#!/usr/bin/env python3
"""부동산(클로드) 수집기 값 시험 — 네트워크 없이 R-ONE 응답을 흉내 내 확인한다.
python scripts/realestate_claude/test_collect.py"""
import importlib.util
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("collect", os.path.join(HERE, "collect.py"))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)
C.PAUSE = 0
C.RONE_KEY = ""

passed = failed = 0


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✓ " + name)
    else:
        failed += 1
        print("  ✗ " + name + (" — " + str(detail) if detail else ""))


def fake_rone(months, name="대전>동구", per_call=5, grp=False):
    """키 없는 R-ONE 흉내: 구간 안의 행 중 앞 5개만 준다."""
    calls = []

    def get_json(url):
        q = dict(urllib.parse.parse_qsl(url.split("?", 1)[1]))
        calls.append(q)
        s, e = q["START_WRTTIME"], q["END_WRTTIME"]
        inside = [m for m in sorted(months) if s <= m <= e]
        if not inside:
            return {"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}}
        rows = [{"WRTTIME_IDTFR_ID": m, "DTA_VAL": months[m], ("GRP_FULLNM" if grp else "CLS_FULLNM"): name} for m in inside[:per_call]]
        return {"SttsApiTblData": [{"head": [{"list_total_count": len(inside)}]}, {"row": rows}]}
    return get_json, calls


print("[부동산 클로드 수집기]")
# 1) 키 없이 5행씩 이어 받기
months = {"2020%02d" % m: 100.0 + m for m in range(1, 13)}
C.get_json, calls = fake_rone(months)
got = C.rone_rows("T", {"CLS_ID": 1}, "201901", "202012", "대전>동구")
ok("키 없이 5행씩 이어 받아 12개월을 빠짐없이 모은다", got == {k: round(v, 4) for k, v in months.items()}, (len(got), len(calls)))
ok("첫 호출은 구간 전체 → 그다음 달부터 5개월씩", calls[0]["START_WRTTIME"] == "201901" and calls[1]["START_WRTTIME"] == "202006", [c["START_WRTTIME"] for c in calls])

# 2) 지역 이름 검사 — 번호가 밀려 다른 지역이 오면 멈춘다
C.get_json, _ = fake_rone(months, name="대전>동구")
try:
    C.rone_rows("T", {"CLS_ID": 510049}, "202001", "202012", "대전>중구")
    ok("지역 이름이 다르면 멈춘다(대전>동구 ≠ 대전>중구)", False, "예외 없음")
except RuntimeError as e:
    ok("지역 이름이 다르면 멈춘다(대전>동구 ≠ 대전>중구)", "불일치" in str(e), e)
C.get_json, _ = fake_rone(months, name="대전>동구", grp=True)
try:
    C.rone_rows("T", {"GRP_ID": 910074, "CLS_ID": 500001}, "202001", "202012", "대전>동구")
    ok("거래표는 GRP_FULLNM 으로 지역을 확인한다", True)
except RuntimeError as e:
    ok("거래표는 GRP_FULLNM 으로 지역을 확인한다", False, e)

# 3) 한 달에 두 행이면 멈춘다(필터가 덜 좁혀진 경우)
def dup_json(url):
    return {"SttsApiTblData": [{"head": [{"list_total_count": 2}]}, {"row": [
        {"WRTTIME_IDTFR_ID": "202001", "DTA_VAL": 1.0, "CLS_FULLNM": "대전"},
        {"WRTTIME_IDTFR_ID": "202001", "DTA_VAL": 2.0, "CLS_FULLNM": "대전"}]}]}
C.get_json = dup_json
try:
    C.rone_rows("T", {"CLS_ID": 1}, "202001", "202001", "대전")
    ok("한 달에 두 행이면 멈춘다", False, "예외 없음")
except RuntimeError as e:
    ok("한 달에 두 행이면 멈춘다", "두 행" in str(e), e)

# 4) 분기 시점
ok("분기 더하기·분기말 달", C.q_add("199404", 1) == "199501" and C.q_add("200401", 3) == "200404" and C.q_to_month("199404") == "199412" and C.q_to_month("200401") == "200403")
qm = {"1994%02d" % 4: 58.5, "199501": 58.4, "199502": 58.3, "199503": 58.2, "199504": 58.1, "199601": 58.0, "199602": 57.9}
C.get_json, qcalls = fake_rone(qm, name="대전")
gq = C.rone_rows_q("T", {"CLS_ID": 500012}, "198701", "200404", "대전")
ok("분기 자료는 분기말 달에 놓고 5분기씩 이어 받는다", gq == {"199412": 58.5, "199503": 58.4, "199506": 58.3, "199509": 58.2, "199512": 58.1, "199603": 58.0, "199606": 57.9}, gq)

# 5) 증분 갱신 — 겹치는 달이 같으면 덧붙이고, 달라지면 그 시계열만 전부 다시
old = C.to_series({"2020%02d" % m: 100.0 + m for m in range(1, 11)})
full = {"2020%02d" % m: 100.0 + m for m in range(1, 13)}
log = []
new = C.refresh("x", old, lambda s, e: {k: v for k, v in full.items() if (s or "000000") <= k <= e}, False, "202012", log)
ok("새 달만 덧붙인다(겹치는 달 같음)", C.from_series(new) == full and log[-1]["event"] == "append" and log[-1]["added"] == ["202011", "202012"], log)
rev = dict(full)
rev["202005"] = 999.0
log = []
new2 = C.refresh("x", old, lambda s, e: {k: v for k, v in rev.items() if (s or "000000") <= k <= e}, False, "202012", log)
ok("겹치는 달 값이 바뀌면 전체를 다시 받고 기록한다", C.from_series(new2) == rev and log[-1]["event"] == "revised" and "202005" in log[-1]["changedMonths"], log)
log = []
same = C.refresh("x", C.to_series(full), lambda s, e: {k: v for k, v in full.items() if (s or "000000") <= k <= e}, False, "202012", log)
ok("새 자료가 없으면 기록도 없다(파일을 다시 쓰지 않음)", C.from_series(same) == full and log == [], log)

# 6) KB — dataList 끝의 변동률 요약은 버리고, 지역 코드·이름을 확인한다
def fake_kb(rows, dates):
    def get_json(url, headers=None):
        return {"dataHeader": {"resultCode": "10000"}, "dataBody": {"data": {"날짜리스트": dates, "데이터리스트": rows}}}
    return get_json
C._kb_cache.clear()
C.get_json = fake_kb([{"지역코드": "3000000000", "지역명": "대전", "dataList": [10.0, 11.0, 12.0, 5.5, -1.2, 3.3]}], ["202001", "202002", "202003"])
got = C.kb_rows("priceIndex", {"a": "1"}, "3000000000", "대전", "")
ok("KB: 날짜 수만큼만 쓴다(끝의 변동률 요약 버림)", got == {"202001": 10.0, "202002": 11.0, "202003": 12.0}, got)
C._kb_cache.clear()
C.get_json = fake_kb([{"지역코드": "3000000000", "지역명": "대전", "dataList": [{"매수우위지수": 50.0}, {"매수우위지수": 60.0}]}], ["202001", "202002"])
ok("KB 매수우위: 값 묶음에서 지수만 꺼낸다", C.kb_rows("maktTrnd", {"b": "1"}, "3000000000", "대전", "", "매수우위지수") == {"202001": 50.0, "202002": 60.0})
C._kb_cache.clear()
C.get_json = fake_kb([{"지역코드": "3000000000", "지역명": "대구", "dataList": [1.0]}], ["202001"])
try:
    C.kb_rows("priceIndex", {"c": "1"}, "3000000000", "대전", "")
    ok("KB: 지역 이름이 다르면 멈춘다", False, "예외 없음")
except RuntimeError as e:
    ok("KB: 지역 이름이 다르면 멈춘다", "불일치" in str(e), e)

def fake_movein(name, rows):
    def get_json(url, headers=None):
        return {"dataBody": {"data": {"지역명": name, "차트데이터": rows}}}
    return get_json
C.get_json = fake_movein("유성구", [{"일정": "202708", "합계": {"세대수": 1567}}, {"일정": "202709", "합계": {"세대수": 2951}}, {"일정": "2027", "합계": {"세대수": 1}}])
ok("KB 입주: 월(6자리)만 세대수로 모은다(예정 포함)", C.kb_movein("3020000000", "유성구") == {"202708": 1567.0, "202709": 2951.0})
C.get_json = fake_movein("서구", [])
try:
    C.kb_movein("3020000000", "유성구")
    ok("KB 입주: 지역 이름이 다르면 멈춘다", False, "예외 없음")
except RuntimeError as e:
    ok("KB 입주: 지역 이름이 다르면 멈춘다", "불일치" in str(e), e)

def fake_ecos(name):
    def get_json(url, headers=None):
        return {"StatisticSearch": {"list_total_count": 1, "row": [{"TIME": "202001", "DATA_VALUE": "5", "ITEM_NAME1": name}]}}
    return get_json
C.get_json = fake_ecos("대구")
try:
    C.ecos_rows("901Y074", "I410G", "202001", "202001", "대전")
    ok("ECOS: 항목 이름이 다르면 멈춘다", False, "예외 없음")
except RuntimeError as e:
    ok("ECOS: 항목 이름이 다르면 멈춘다", "불일치" in str(e), e)

print("\n결과: %d PASS / %d FAIL" % (passed, failed))
sys.exit(1 if failed else 0)
