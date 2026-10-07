#!/usr/bin/env python3
"""부동산(클로드) 아파트 단지 수집기 값 시험 — 네트워크 없이 KB 응답을 흉내 낸다.
python scripts/realestate_claude/test_collect_apt.py"""
import importlib.util
import json
import os
import sys
import tempfile
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("collect_apt", os.path.join(HERE, "collect_apt.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
A.PAUSE = 0

passed = failed = 0


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✓ " + name)
    else:
        failed += 1
        print("  ✗ " + name + (" — " + str(detail) if detail else ""))


def raises(fn, word):
    try:
        fn()
        return False, "예외 없음"
    except RuntimeError as e:
        return word in str(e), str(e)


print("[부동산 클로드 단지 수집기]")
# 1) 84㎡ 대표 타입 — 80~86㎡ 중 세대 가장 많은 것
types = [{"전용면적": "59.9", "세대수": 900, "면적일련번호": 1}, {"전용면적": "84.93", "세대수": 96, "면적일련번호": 2},
         {"전용면적": "84.99", "세대수": 456, "면적일련번호": 3}, {"전용면적": "101.8", "세대수": 500, "면적일련번호": 4}]
ok("84㎡ 대표 타입은 80~86㎡ 중 세대가 가장 많은 것", A.pick_type(types)["면적일련번호"] == 3)
ok("84㎡ 타입이 없으면 None", A.pick_type([types[0], types[3]]) is None)

# 2) 시세 — 같은 달 두 번이면 멈추고, 매매가 없는 달은 버린다
items = [{"기준년월": "200401", "매매일반거래가": 27000, "매매하한가": 21500, "매매상한가": 27500, "전세일반거래가": 11000},
         {"기준년월": "200403", "매매일반거래가": 25500, "매매하한가": 22500, "매매상한가": 27150, "전세일반거래가": 11000},
         {"기준년월": "200404", "매매일반거래가": 0}]
rows = A.sise_rows(items)
ok("시세: 매매가 없는 달은 버린다", sorted(rows) == ["200401", "200403"], rows)
arr = A.to_arrays(rows, ["mid", "low", "high", "jeonse"])
ok("시세: 빠진 달은 null 로 채워 매달 이어 붙인다", arr["start"] == "2004-01" and arr["mid"] == [27000, None, 25500] and arr["jeonse"] == [11000, None, 11000], arr)
good, msg = raises(lambda: A.sise_rows(items[:1] + items[:1]), "두 번")
ok("시세: 같은 달이 두 번 오면 멈춘다", good, msg)
good, msg = raises(lambda: A.sise_rows([{"기준년월": "2004-1", "매매일반거래가": 1}]), "형식")
ok("시세: 달 형식이 YYYYMM 이 아니면 멈춘다", good, msg)

# 3) 실거래 — 월별 건수·중앙값·최저·최고
r = A.real_rows([{"계약시작년월일": "20061213", "매매실거래금액": 15500}, {"계약시작년월일": "20061204", "매매실거래금액": 28500},
                 {"계약시작년월일": "20061115", "매매실거래금액": 31450}, {"계약시작년월일": "20061109", "매매실거래금액": 31800},
                 {"계약시작년월일": "20061102", "매매실거래금액": 31300}, {"계약시작년월일": "2006110", "매매실거래금액": 1}])
ok("실거래: 12월(2건) 중앙값은 두 값 평균", r["200612"] == {"n": 2, "med": 22000, "min": 15500, "max": 28500}, r.get("200612"))
ok("실거래: 11월(3건) 중앙값·최저·최고, 날짜 형식 틀린 건 버림", r["200611"] == {"n": 3, "med": 31450, "min": 31300, "max": 31800}, r.get("200611"))


# 4) 단지 이름 검사 · 목록 필터
class Err:
    def __init__(self, code):
        self.code = code


def fake(routes):
    def get_json(url, tries=5, headers=None):
        path, q = url.split("?", 1)
        q = dict(urllib.parse.parse_qsl(q))
        key = path.replace(A.API, "")
        v = routes[key](q) if callable(routes[key]) else routes[key]
        if isinstance(v, Err):
            return {"dataHeader": {"resultCode": v.code, "message": "INTERNAL_SERVER_ERROR"}, "dataBody": {}}
        return {"dataHeader": {"resultCode": "10000"}, "dataBody": {"data": v}}
    return get_json


A.C.get_json = fake({"/land-complex/complex/main": {"단지명": "둔산크로바", "준공년월": "1992.05", "총세대수": 1632}})
good, msg = raises(lambda: A.complex_main({"id": 8333, "name": "크로바"}), "불일치")
ok("단지 기본정보 이름이 목록과 다르면 멈춘다", good, msg)
ok("이름이 같으면(띄어쓰기 무시) 준공·세대수를 돌려준다", A.complex_main({"id": 8333, "name": "둔산 크로바"}) == {"built": "1992.05", "units": 1632})

hscm = [{"단지기본일련번호": i, "단지명": "단지%d" % i, "wgs84위도": "36.3", "wgs84경도": "127.4", "매물종별구분명": k, "분양진행단계명": s}
        for i, (k, s) in enumerate([("아파트", None), ("주상복합", None), ("오피스텔", None), ("아파트분양권", None), ("아파트", "분양중")])]
routes = {"/land-complex/map/siGunGuAreaNameList": lambda q: [{"시군구명": "서구"}],
          "/land-complex/map/stutDongAreaNameList": lambda q: [{"법정동코드": "3017011200", "법정동명": "둔산동"}] * 3,
          "/land-complex/complexComm/hscmList": hscm}
A.C.get_json = fake(routes)
A.MIN_LIST = 1
lst = A.list_complexes()
ok("목록: 아파트·주상복합·분양권·분양 단계(kind 분양)만, 오피스텔 제외 · 두 동에 걸친 같은 단지는 한 번만", [c["kind"] for c in lst] == ["아파트", "주상복합", "아파트분양권", "분양"], [c["kind"] for c in lst])
A.MIN_LIST = 500
good, msg = raises(A.list_complexes, "너무 적다")
ok("목록이 너무 적으면(API 변경 의심) 멈춘다", good, msg)


# 4-2) 시세 없는 단지(10500)는 그 단지만 건너뛰고, 다른 오류 코드는 멈춘다
A.C.get_json = fake({"/land-complex/complex/typInfo": [{"전용면적": "84.9", "세대수": 500, "면적일련번호": 77}],
                     "/land-price/price/QuotBaseYear": Err("10500"), "/land-price/price/RealPriceBaseYear": Err("10500")})
h = A.history(491111)
ok("시세·실거래 모두 없다고(10500) 답하면 빈 자료로 돌려준다", h["sise"] is None and h["real"] is None, h)
A.C.get_json = fake({"/land-complex/complex/typInfo": Err("10400")})
good, msg = raises(lambda: A.history(1), "KB 오류")
ok("자료 없음이 아닌 오류(10400 등)는 멈춘다", good, msg)


# 5) 전체 흐름 — 대단지만, 기존 기본정보 재사용, 바뀐 게 없으면 다시 쓰지 않는다
calls = {"main": 0}
big = [{"단지기본일련번호": i, "단지명": "단지%d" % i, "wgs84위도": "36.3", "wgs84경도": "127.4", "매물종별구분명": "아파트", "분양진행단계명": None} for i in range(1, 601)]


def main_api(q):
    calls["main"] += 1
    i = int(q["단지기본일련번호"])
    return {"단지명": "단지%d" % i, "준공년월": "2010.01", "총세대수": 1200 if i <= 35 else 300}


A.C.get_json = fake({"/land-complex/map/siGunGuAreaNameList": lambda q: [{"시군구명": "서구"}],
                     "/land-complex/map/stutDongAreaNameList": lambda q: [{"법정동코드": "1", "법정동명": "둔산동"}],
                     "/land-complex/complex/typInfoX": None,
                     "/land-complex/complexComm/hscmList": big,
                     "/land-complex/complex/main": main_api,
                     "/land-complex/complex/typInfo": [{"전용면적": "84.9", "세대수": 500, "면적일련번호": 77, "공급면적": "110.1"}],
                     "/land-price/price/QuotBaseYear": lambda q: Err("10500") if q["단지기본일련번호"] == "7" else [{"기준년": "2026"}],
                     "/land-price/price/WholQuotList": {"시세": [{"items": [{"기준년월": "202608", "매매일반거래가": 50000, "매매하한가": 48000, "매매상한가": 52000, "전세일반거래가": 30000}]}]},
                     "/land-price/price/RealPriceBaseYear": [{"기준년": "2026"}],
                     "/land-price/price/WholRealPriceList": {"실거래가": [{"items": [{"계약시작년월일": "20260810", "매매실거래금액": 51000}]}]}})
tmp = tempfile.mkdtemp()
A.DIR, A.OUT, A.OUT_ALL = tmp, os.path.join(tmp, "apt.json"), os.path.join(tmp, "apt-complexes.json")
A.main()
doc = json.load(open(A.OUT, encoding="utf-8"))
ok("대단지(1,000세대 이상)만 시세를 받는다 · KB 가 시세 없다고(10500) 답한 단지는 빼고 기록", len(doc["universe"]) == 34 and all(u["units"] >= 1000 for u in doc["universe"]) and doc["skipped"] == [{"id": 7, "name": "단지7", "why": "KB 시세 없음"}], (len(doc["universe"]), doc.get("skipped")))
ok("단지별 시세·실거래 월 배열", doc["sise"]["1"] == {"start": "2026-08", "mid": [50000], "low": [48000], "high": [52000], "jeonse": [30000]} and doc["real"]["1"]["med"] == [51000])
alld = json.load(open(A.OUT_ALL, encoding="utf-8"))
ok("모든 단지 기본정보(좌표·세대수)는 따로 남긴다", len(alld["complexes"]) == 600 and alld["complexes"][0]["units"] == 1200)
first_main = calls["main"]
mt = os.path.getmtime(A.OUT)
A.main()
ok("두 번째부터는 기본정보를 다시 묻지 않는다(새 단지만)", first_main == 600 and calls["main"] == first_main, (first_main, calls["main"]))
ok("바뀐 게 없으면 파일을 다시 쓰지 않는다", os.path.getmtime(A.OUT) == mt)

print("\n결과: %d PASS / %d FAIL" % (passed, failed))
sys.exit(1 if failed else 0)
