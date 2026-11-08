#!/usr/bin/env python3
"""부동산(클로드) 온비드 공매 수집기 값 시험 — 공공데이터포털 응답을 흉내 낸다(네트워크 · 인증키 없음).
python scripts/realestate_claude/test_collect_onbid.py"""
import datetime as dt
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("collect_onbid", os.path.join(HERE, "collect_onbid.py"))
O = importlib.util.module_from_spec(spec)
spec.loader.exec_module(O)
O.PAUSE = 0

passed = failed = 0


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✓ " + name)
    else:
        failed += 1
        print("  ✗ " + name + (" — " + str(detail) if detail else ""))


def resp(items, total=None):
    return {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."}, "body": {"items": {"item": items}, "totalCount": str(len(items) if total is None else total), "numOfRows": "100", "pageNo": "1"}}


print("[부동산 클로드 온비드 수집기]")
# 응답 모양
ok("목록: item 이 한 건(dict)이어도 목록으로", O.items_of(resp({"a": 1}))[0] == [{"a": 1}])
ok("목록: 빈 items('')는 빈 목록", O.items_of({"body": {"items": "", "totalCount": "0"}}) == ([], 0))
ok("예전 모양(response.header/body)도 읽는다", O.items_of(O.parse(json.dumps({"response": resp([{"x": 1}])})))[0] == [{"x": 1}])
try:
    O.parse("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
    ok("인증키 오류(XML)는 멈춘다", False, "예외 없음")
except O.LimitError:
    ok("인증키 오류(XML)는 멈춘다", False, "한도 오류로 봄")
except O.ApiError as e:
    ok("인증키 오류(XML)는 멈춘다 — 원인 그대로", "SERVICE_KEY_IS_NOT_REGISTERED" in str(e), e)
try:
    O.parse("<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
    ok("하루 한도 초과는 LimitError", False, "예외 없음")
except O.LimitError:
    ok("하루 한도 초과는 LimitError", True)
ok("자료 없음(03)은 빈 목록", O.items_of(O.parse(json.dumps({"header": {"resultCode": "03", "resultMsg": "NODATA"}})))[0] == [])
ok("원 → 만원 · 비공개/빈 값은 None", O.man(300000000) == 30000 and O.man("123,456,000") == 12346 and O.man("비공개") is None and O.man(0) is None)
ok("일시 모양", O.when("202611201400") == "2026-11-20 14:00" and O.when("20261120") == "2026-11-20" and O.when("") is None)
ok("대전·세종 주소만(띄어쓰기 · 정식 이름 포함)", O.in_area("대전광역시 서구 둔산동 1") and O.in_area("세종특별자치시 한솔동") and O.in_area("대전 유성구") and not O.in_area("충청남도 공주시 세종로") and not O.in_area("서울 대전로"))
os.environ.pop("DATA_GO_KR_KEY", None)
ok("인증키가 없으면 아무것도 안 하고 0", O.main(getj=lambda u, p: 1 / 0, out=os.path.join(tempfile.mkdtemp(), "x.json")) == 0)
os.environ["DATA_GO_KR_KEY"] = "abc%2Bdef%3D%3D"
ok("인코딩된 키를 넣어도 한 번만 인코딩되게(풀어서 쓴다)", O.key_from_env() == "abc+def==")

# 공고 고르기 — 지역 힌트 먼저 · 중복 제거 · 한도
ns = [{"pbancMngNo": "A", "orgNm": "한국자산관리공사", "rspbSbrNm": "부산지역본부", "cltrOpbdDt": "202611010900"},
      {"pbancMngNo": "B", "orgNm": "한국자산관리공사", "rspbSbrNm": "대전충남지역본부", "cltrOpbdDt": "202611200900"},
      {"pbancMngNo": "B", "orgNm": "한국자산관리공사", "rspbSbrNm": "대전충남지역본부", "cltrOpbdDt": "202611200900"},
      {"pbancMngNo": "C", "orgNm": "세종특별자치시", "rspbSbrNm": "", "cltrOpbdDt": "202612010900"}]
pk, uniq, hinted = O.pick_notices(ns, 2)
ok("공고 고르기: 중복 빼고 · 지역 힌트(대전·세종·충남) 먼저 · 한도까지", [n["pbancMngNo"] for n in pk] == ["B", "C"] and uniq == 3 and hinted == 2, [n["pbancMngNo"] for n in pk])

# 전체 흐름 — 가짜 API
NOTICES = [{"pbancMngNo": "N1", "pbctNsq": "3", "orgNm": "한국자산관리공사", "rspbSbrNm": "대전충남지역본부", "onbidPbancNm": "압류재산 공매", "prptDivNm": "압류재산", "dspsMthodNm": "매각", "cltrOpbdDt": "202611021100", "bidDivNm": "인터넷"},
           {"pbancMngNo": "N2", "pbctNsq": "1", "orgNm": "한국자산관리공사", "rspbSbrNm": "대전충남지역본부", "onbidPbancNm": "국유재산", "prptDivNm": "국유재산", "dspsMthodNm": "매각", "cltrOpbdDt": "202612011100"}]
ITEMS = {"N1": [{"pbancMngNo": "N1", "cltrMngNo": "C1", "onbidCltrno": "2026-0001-001", "onbidCltrNm": "둔산동 ○○아파트 101동", "cltrAdr": "대전광역시 서구 둔산동 1", "cltrUsgLclsCtgrNm": "토지/건물", "cltrUsgMclsCtgrNm": "주거용건물", "cltrUsgSclsCtgrNm": "아파트",
                 "usbdNft": 2, "pbctNsq": "3", "apslEvlAmt": 500000000, "lowstBidPrcIndctCont": 400000000, "apslPrcCtrsLowstBidRto": 80, "cltrBidBgngDt": "202610271000", "cltrBidEndDt": "202610291700", "pbctStatNm": "입찰마감", "batcBidYn": "N"},
                {"pbancMngNo": "N1", "cltrMngNo": "C9", "onbidCltrNm": "공주 땅", "cltrAdr": "충청남도 공주시 1", "pbctNsq": "3", "apslEvlAmt": 1000000}],
         "N2": {"pbancMngNo": "N2", "cltrMngNo": "C2", "onbidCltrNm": "세종 ○○", "cltrAdr": "세종특별자치시 한솔동 2", "pbctNsq": "1", "usbdNft": 0, "apslEvlAmt": 300000000, "lowstBidPrcIndctCont": "비공개", "cltrBidEndDt": "202611281700", "pbctStatNm": "입찰준비중"}}
RSLT = {"N1": [{"pbctNsq": "3", "cltrBidRsltClgList": [{"cltrMngNo": "C1", "pbctNsq": "3", "scfbAmt": 430000000, "vldBddrNope": 6, "nfctBddrNope": 1, "lowstBidCtrsScfbPrcRto": 107.5, "pbctStatNm": "낙찰", "cltrOpbdDt": "202611021100"}]}]}
calls = []


def fake(url, params):
    calls.append((url.rsplit("/", 1)[-1], params.get("pbancMngNo") or params.get("pageNo")))
    if url == O.LIST_URL:
        return resp(NOTICES)
    if url == O.ITEM_URL:
        v = ITEMS.get(params["pbancMngNo"])
        return resp(v if isinstance(v, list) else v)
    if url == O.RSLT_URL:
        if params["pbancMngNo"] not in RSLT:
            raise O.ApiError("결과코드 99: 마감 전")
        return resp(RSLT[params["pbancMngNo"]])
    raise AssertionError(url)


out = os.path.join(tempfile.mkdtemp(), "onbid.json")
code = O.main(getj=fake, out=out, today=dt.date(2026, 11, 8))
doc = json.load(open(out, encoding="utf-8"))
its = {x["cltrMngNo"]: x for x in doc["items"]}
ok("흐름: 대전·세종 물건만 남긴다(공주 땅은 뺌)", set(its) == {"C1", "C2"} and code == 0, (set(its), code))
c1, c2 = its.get("C1", {}), its.get("C2", {})
ok("물건: 감정가 5억 · 최저가 4억(만원) · 유찰 2 · 회차 3 · 용도 · 입찰 기간 · 개찰", c1.get("appraisal") == 50000 and c1.get("minPrice") == 40000 and c1.get("fails") == 2 and c1.get("round") == "3"
   and c1.get("usage") == "토지/건물 > 주거용건물 > 아파트" and c1.get("bidEnd") == "2026-10-29 17:00" and c1.get("opbd") == "2026-11-02 11:00" and c1.get("branch") == "대전충남지역본부", c1)
ok("한 건짜리 응답(dict) · 최저가 비공개는 None", c2.get("minPrice") is None and c2.get("appraisal") == 30000)
ok("개찰이 지난 공고만 결과를 묻는다(N2 는 안 물음)", ("getPbancBidRsltDtl2", "N1") in calls and ("getPbancBidRsltDtl2", "N2") not in calls, calls)
r = c1.get("result") or {}
ok("결과: 낙찰 4.3억 · 유효 6명 · 최저가 대비 107.5% · 감정가 대비 86%", r.get("status") == "낙찰" and r.get("win") == 43000 and r.get("bidders") == 6 and r.get("winOverMin") == 107.5 and r.get("winApp") == 0.86, r)
ok("저장 파일: 출처 · 기간 · 공고 수(키는 어디에도 없음)", doc["window"] == {"opbdStart": "20260924", "opbdEnd": "20270107"} and doc["noticeTotal"] == 2 and "abc" not in open(out, encoding="utf-8").read())
# 같은 물건이 다시 보였는데 그날 결과를 못 받았으면(결과 API 실패) → 예전 결과를 지킨다
saved = RSLT.pop("N1")
O.main(getj=fake, out=out, today=dt.date(2026, 11, 8))
again = {x["cltrMngNo"]: x for x in json.load(open(out, encoding="utf-8"))["items"]}
ok("다시 보인 물건 · 그날 결과 없음 → 예전 결과(4.3억 낙찰)를 지킨다", (again["C1"].get("result") or {}).get("win") == 43000, again["C1"].get("result"))
RSLT["N1"] = saved
# 다음 날: 결과가 안 오고(마감 뒤 목록에서 빠짐) 새 물건만 → 지난 결과는 남는다
NOTICES[:] = [NOTICES[1]]
O.main(getj=fake, out=out, today=dt.date(2026, 11, 9))
doc2 = json.load(open(out, encoding="utf-8"))
its2 = {x["cltrMngNo"]: x for x in doc2["items"]}
ok("쌓기: 이번에 안 보인 끝난 물건과 그 결과는 지우지 않는다", "C1" in its2 and (its2["C1"].get("result") or {}).get("win") == 43000 and "C2" in its2)
# 한도 초과 — 받은 만큼 저장하고 2
NOTICES[:] = [{"pbancMngNo": "N3", "rspbSbrNm": "대전충남지역본부", "cltrOpbdDt": "202612011100"}, {"pbancMngNo": "N4", "rspbSbrNm": "대전충남지역본부", "cltrOpbdDt": "202612021100"}]
ITEMS["N3"] = [{"pbancMngNo": "N3", "cltrMngNo": "C3", "cltrAdr": "대전 중구 1", "pbctNsq": "1", "apslEvlAmt": 100000000}]


def limited(url, params):
    if url == O.ITEM_URL and params["pbancMngNo"] == "N4":
        raise O.LimitError("한도")
    return fake(url, params)


code3 = O.main(getj=limited, out=out, today=dt.date(2026, 11, 10))
its3 = {x["cltrMngNo"] for x in json.load(open(out, encoding="utf-8"))["items"]}
ok("하루 한도 초과: 받은 만큼 저장하고 종료 코드 2", code3 == 2 and "C3" in its3, (code3, its3))


def auth_fail(url, params):
    raise O.ApiError("공공데이터포털 오류 30: SERVICE_KEY_IS_NOT_REGISTERED_ERROR")


before = open(out, encoding="utf-8").read()
try:
    O.main(getj=auth_fail, out=out, today=dt.date(2026, 11, 11))
    ok("인증키 오류면 멈추고 파일은 그대로", False, "예외 없음")
except O.ApiError:
    ok("인증키 오류면 멈추고 파일은 그대로", open(out, encoding="utf-8").read() == before)

print("\n결과: %d PASS / %d FAIL" % (passed, failed))
sys.exit(1 if failed else 0)
