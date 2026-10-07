#!/usr/bin/env python3
"""부동산(클로드) 신규 분양 수집기 값 시험 — 청약홈 화면 조각을 흉내 낸다(네트워크 없음).
python scripts/realestate_claude/test_collect_presale.py"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("collect_presale", os.path.join(HERE, "collect_presale.py"))
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

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


def tr(*cs, th=False):
    t = "th" if th else "td"
    return "<tr>" + "".join("<%s>%s</%s>" % (t, c, t) for c in cs) + "</tr>"


print("[부동산 클로드 신규 분양 수집기]")
LIST = ('<select name="beginPd"><option value="202610">x</option><option value="202112">x</option></select>'
        '<select name="endPd"><option value="202611">x</option><option value="202112">x</option></select>'
        '<table><tbody>'
        '<tr data-pbno="2026000202" data-hmno="2026000202" data-honm="대전 경남아너스빌 센텀스카이">'
        '<td>대전</td><td>민영</td><td>분양주택</td><td><a><b>대전 경남아너스빌 센텀스카이</b></a></td><td>경남기업(주)</td>'
        '<td>☎ 1551-5595</td><td>2026-09-03</td><td>2026-09-08 ~ 2026-09-10</td><td>2026-09-16</td><td></td><td></td></tr>'
        '</tbody></table><a onclick="fn_link_page(1)">1</a><a onclick="fn_link_page(3)">3</a>')
ok("조회 기간: 선택지 중 가장 이른 시작달·가장 늦은 끝달", P.period_options(LIST) == ("202112", "202611"))
good, msg = raises(lambda: P.period_options("<html></html>"), "형식")
ok("조회 기간 선택지가 없으면 멈춘다(화면 형식 변경)", good, msg)
rows, last = P.parse_list(LIST, "대전")
ok("목록: 공고번호·이름·공고일·청약기간·발표일과 마지막 쪽", rows[0]["pblancNo"] == "2026000202" and rows[0]["notice"] == "2026-09-03" and rows[0]["win"] == "2026-09-16" and last == 3, (rows, last))
good, msg = raises(lambda: P.parse_list(LIST, "세종"), "불일치")
ok("목록 지역이 요청과 다르면 멈춘다", good, msg)

DET = ("<table>" + tr("공급위치", "대전광역시 중구 대흥동 38-17번지 일원") + tr("공급규모", "142세대") + "</table>"
       "<table>" + tr("민영", "084.2259A", "116.4662", "33", "39", "72", "2026000202(01)") + tr("084.5328B", "116.5674", "25", "29", "54", "2026000202(02)") + "</table>"
       "공급금액(최고가 기준)<table>" + tr("084.2259A", "59,600", "청약통장으로 청약") + tr("084.5328B", "59,900") + "</table>"
       "* 입주예정월 : 2030.01 ")
d = P.parse_detail(DET)
ok("상세: 위치·규모·입주예정월", d["addr"].startswith("대전광역시 중구 대흥동") and d["scale"] == "142세대" and d["movein"] == "2030.01", d)
ok("상세: 주택형별 공급면적·세대수·공급금액(만원)", d["types"]["084.2259A"] == {"supply": 116.4662, "gen": 33.0, "spc": 39.0, "tot": 72.0, "price": 59600.0} and d["types"]["084.5328B"]["price"] == 59900.0, d["types"])

COMP = ("<table>" + tr("084.2259A", "70", "1순위", "해당지역", "9", "(△61)", "청약 접수 종료", "해당지역", "-", "-", "-")
        + tr("084.2259A", "70", "1순위", "기타지역", "8", "(△53)", "청약 접수 종료", "-", "-", "-", "-")
        + tr("084.2259A", "70", "2순위", "기타지역", "1", "(△47)", "청약 접수 종료", "-", "-", "-", "-")
        + tr("084.9900A", "12", "1순위", "해당지역", "11,290", "940.83", "1순위 마감", "해당지역", "74", "79", "75.8") + "</table>")
c = P.parse_comp(COMP)
ok("경쟁률: 1순위 접수 합 ÷ 공급, 마지막 순위의 미달 세대 합", c["supply"] == 82 and c["r1"] == 9 + 8 + 11290 and c["rate1"] == round(11307 / 82, 2) and c["short"] == 47, c)
ok("경쟁률: 1순위 해당지역 당첨가점 최저·평균", c["gaMin"] == 74 and c["gaAvg"] == 75.8, c)
LH = "<table>" + tr("059.8900A", "32", "1순위", "해당지역", "0", "", "청약 접수중", "해당없음") + "</table>"
ok("공공분양(청약홈에 결과 없음)은 비운다", P.parse_comp(LH) is None)

cx = [{"id": 1, "name": "대전경남아너스빌센텀스카이", "gu": "중구", "lat": 36.32, "lng": 127.43},
      {"id": 2, "name": "센텀스카이", "gu": "서구", "lat": 36.3, "lng": 127.3},
      {"id": 3, "name": "세종우미린센터파크", "gu": "세종시", "lat": 36.53, "lng": 127.32}]
it = {"area": "대전", "name": "대전 경남아너스빌 센텀스카이", "addr": "대전광역시 중구 대흥동"}
ok("위치: 같은 구 안에서 이름으로 KB 단지를 찾는다", P.locate(it, cx)["id"] == 1, P.locate(it, cx))
it2 = {"area": "세종", "name": "세종 우미 린 센터파크(행정중심복합도시 5-2생활권 S1블록, 글미마을 9단지)", "addr": "세종특별자치시 다솜동"}
ok("위치: 괄호 설명을 떼고 세종시에서 찾는다", P.locate(it2, cx)["id"] == 3, P.locate(it2, cx))
cx.append({"id": 9, "name": "중촌에스케이뷰", "gu": "중구", "lat": 36.34, "lng": 127.41})
it5 = {"area": "대전", "name": "중촌 SK VIEW", "addr": "대전광역시 중구 중촌동"}
ok("위치: 'SK VIEW' 와 '에스케이뷰' 를 같은 이름으로 본다", (P.locate(it5, cx) or {}).get("id") == 9, P.locate(it5, cx))
it4 = {"area": "대전", "name": "센텀스카이", "addr": "대전광역시 유성구 용계동"}
ok("위치: 이름이 같아도 다른 구 단지는 고르지 않는다", P.locate(it4, cx) is None, P.locate(it4, cx))
it3 = {"area": "대전", "name": "없는 단지", "addr": "대전광역시 유성구"}
ok("위치를 못 찾으면 None", P.locate(it3, cx) is None)

print("\n결과: %d PASS / %d FAIL" % (passed, failed))
sys.exit(1 if failed else 0)
