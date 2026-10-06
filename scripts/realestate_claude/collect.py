#!/usr/bin/env python3
"""부동산(클로드) 원자료 수집 — 한국부동산원 R-ONE · 한국은행 ECOS.

키 없이도 돈다. 키가 없으면 R-ONE 은 한 번에 5행, ECOS 는 10행만 주므로
지역(CLS_ID) · 기간(START/END_WRTTIME) 단위로 잘게 나눠 받는다.
환경변수 RONE_KEY / ECOS_KEY 가 있으면 한 번에 많이 받는다.

결과: data/realestate/claude/series.json
  - 시계열은 {start:"YYYY-MM", v:[...]} (매달 연속, 빠진 달은 null)
  - 평소에는 최근 12개월만 다시 받아 겹치는 달을 비교한다.
    겹치는 달 값이 달라졌으면(기준시점 개편·소급 수정) 그 시계열만 전부 다시 받고 log 에 남긴다.
  - 원자료만 담는다. 분석·전략·장부는 realestate-claude-engine.js 한 곳에서 계산한다.

쓰는 법:
  python scripts/realestate_claude/collect.py            # 증분(없는 시계열은 전체)
  python scripts/realestate_claude/collect.py --full     # 전부 다시
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "realestate", "claude", "series.json")

RONE_URL = "https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do"
ECOS_URL = "https://ecos.bok.or.kr/api/StatisticSearch"
RONE_KEY = os.environ.get("RONE_KEY", "").strip()
ECOS_KEY = os.environ.get("ECOS_KEY", "").strip() or "sample"
PAUSE = 0.12  # 공공 API 예의상 호출 간격(초)

# 지역: 키 → (이름, 묶음, {코드 체계: 코드}, R-ONE 지역 전체이름). 표마다 분류 번호가 다르다.
# 받은 행의 지역 이름이 마지막 값과 다르면 수집을 멈춘다(번호가 밀려 다른 지역을 받는 사고 방지).
#   hp   주택가격동향 매매·전세지수 · 매매수급 — CLS_ID
#   hp2  주택가격동향 전세가율 · 평균가격 — CLS_ID (대전 구·인근 시가 hp 보다 번호가 밀려 있다)
#   deal 매입자거주지별 아파트매매거래현황 — 지역은 GRP_ID, 매입자 거주지는 CLS_ID
#   land 지역별 지가지수 — CLS_ID
REGIONS = {
    "national": ("전국", "비교", {"hp": 500001, "hp2": 500001, "deal": 900001, "land": 500001}, "전국"),
    "seoul": ("서울", "비교", {"hp": 500008, "hp2": 500008, "deal": 900002}, "서울"),
    "daejeon": ("대전", "대전", {"hp": 500014, "hp2": 500014, "deal": 900007, "land": 500012}, "대전"),
    "dj_dong": ("대전 동구", "대전", {"hp": 510048, "hp2": 510049, "deal": 910074, "land": 510079}, "대전>동구"),
    "dj_jung": ("대전 중구", "대전", {"hp": 510049, "hp2": 510050, "deal": 910075, "land": 510080}, "대전>중구"),
    "dj_seo": ("대전 서구", "대전", {"hp": 510050, "hp2": 510051, "deal": 910076, "land": 510081}, "대전>서구"),
    "dj_yuseong": ("대전 유성구", "대전", {"hp": 510051, "hp2": 510052, "deal": 910077, "land": 510082}, "대전>유성구"),
    "dj_daedeok": ("대전 대덕구", "대전", {"hp": 510052, "hp2": 510053, "deal": 910078, "land": 510083}, "대전>대덕구"),
    "sejong": ("세종", "세종", {"hp": 500016, "hp2": 500016, "deal": 900009, "land": 500014}, "세종"),
    "cheongju": ("청주", "인근", {"hp": 510069, "hp2": 510071}, "충북>청주시"),
    "cheonan": ("천안", "인근", {"hp": 510074, "hp2": 510077}, "충남>천안시"),
    "gongju": ("공주", "인근", {"hp": 510075, "hp2": 510078}, "충남>공주시"),
    "gyeryong": ("계룡", "인근", {"hp": 510080, "hp2": 510083}, "충남>계룡시"),
}
DJ_SJ = ["daejeon", "dj_dong", "dj_jung", "dj_seo", "dj_yuseong", "dj_daedeok", "sejong"]

# R-ONE 통계표. regions 가 없으면 그 코드 체계가 있는 모든 지역.
RONE_TABLES = {
    "sale": {"id": "A_2024_00045", "name": "(월) 매매가격지수_아파트", "unit": "지수", "codes": "hp", "from": "200311"},
    "jeonse": {"id": "A_2024_00050", "name": "(월) 전세가격지수_아파트", "unit": "지수", "codes": "hp", "from": "200311"},
    "jratio": {"id": "A_2024_00072", "name": "(월) 평균 매매가격 대비 전세가격_아파트", "unit": "%", "codes": "hp2", "from": "201201"},
    "avgPrice": {"id": "A_2024_00060", "name": "(월) 평균매매가격_아파트", "unit": "천원", "codes": "hp2", "from": "201201"},
    "demand": {"id": "A_2024_00076", "name": "(월) 매매수급동향_아파트", "unit": "지수(100=균형 · 클수록 매수우위)",
               "codes": "hp", "from": "201201", "regions": ["national", "seoul", "daejeon", "sejong"]},
    "volume": {"id": "A_2024_00609", "name": "(월) 매입자거주지별 아파트매매거래현황 — 합계", "unit": "호",
               "codes": "deal", "param": "GRP_ID", "filter": {"CLS_ID": 500001, "ITM_ID": 100001}, "from": "200601"},
    "buyOutSeoul": {"id": "A_2024_00609", "name": "(월) 매입자거주지별 아파트매매거래현황 — 관할시도외(서울)", "unit": "호",
                    "codes": "deal", "param": "GRP_ID", "filter": {"CLS_ID": 500004, "ITM_ID": 100001}, "from": "200601", "regions": DJ_SJ},
    "buyOutOther": {"id": "A_2024_00609", "name": "(월) 매입자거주지별 아파트매매거래현황 — 관할시도외(기타)", "unit": "호",
                    "codes": "deal", "param": "GRP_ID", "filter": {"CLS_ID": 500005, "ITM_ID": 100001}, "from": "200601", "regions": DJ_SJ},
    "land": {"id": "A_2024_00901", "name": "(월) 지역별 지가지수", "unit": "지수", "codes": "land", "from": "198701"},
    # 월간 지가지수는 2005년부터라, 그 전(1994년 4분기~2004년)은 분기 자료를 분기말 달에 놓는다. 지난 자료라 한 번만 받는다.
    "landQ": {"id": "A_2024_00901", "name": "(분기) 지역별 지가지수 — 2004년까지", "unit": "지수", "codes": "land",
              "cycle": "QY", "from": "198701", "to": "200404", "static": True,
              "regions": ["national", "daejeon", "dj_dong", "dj_jung", "dj_seo", "dj_yuseong", "dj_daedeok"]},
}

# ECOS — (통계표, 항목, 이름, 단위)
ECOS_SERIES = {
    "baseRate": ("722Y001", "0101000", "한국은행 기준금리", "연%"),
    "mortgageRate": ("121Y006", "BECBLA0302", "예금은행 주택담보대출 금리(신규취급액)", "연%"),
    "householdRate": ("121Y006", "BECBLA03", "예금은행 가계대출 금리(신규취급액)", "연%"),
    "depositRate": ("121Y002", "BEABAA211", "예금은행 정기예금 금리(신규취급액)", "연%"),
    "cpi": ("901Y009", "0", "소비자물가지수(총지수)", "2020=100"),
}

ECOS_FROM = "198601"

# ECOS 지역 자료 — (통계표, {지역: 항목코드}, 이름, 단위). 받은 행의 항목 이름(ITEM_NAME1)이 지역 이름과 같아야 한다.
ECOS_REGIONAL = {
    "unsold": ("901Y074", {"national": "I410A", "seoul": "I410B", "daejeon": "I410G", "sejong": "I410L"}, "미분양주택(ECOS 8.4.5)", "호"),
    "permits": ("901Y105", {"national": "ALL", "daejeon": "DEJ", "sejong": "SEJ"}, "주택건설 인허가(ECOS 8.4.6) — 그해 1월부터 누계", "호(누계)"),
    "rtIndex": ("901Y089", {"national": "100", "daejeon": "900", "sejong": "B00"}, "아파트 매매 실거래가격지수(ECOS 4.4.4)", "지수"),
}
ECOS_NAMES = {"national": "전국", "seoul": "서울", "daejeon": "대전", "sejong": "세종"}

# KB(국민은행) — data.kbland.kr · kbland.kr 가 로그인 없는 방문자에게 쓰는 공개 통계 API.
# 그 화면이 보내는 인자·머리글 그대로 보낸다(빠지면 400). 한 번에 전체 기간(기간=99)이 온다.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
KB_STAT = "https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/"
KB_LOTS = "https://api.kbland.kr/land-extra/lots/v1/api/aptMovinCnt"
KB_HEAD_STAT = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "osType": "HUB",
                "Origin": "https://data.kbland.kr", "Referer": "https://data.kbland.kr/"}
KB_HEAD_LOTS = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "WebService": "1",
                "Origin": "https://kbland.kr", "Referer": "https://kbland.kr/"}
# 지역: 키 → (KB 지역코드, KB 지역명, 상위코드 — 구는 대전 아래에서 받는다)
KB_REGIONS = {
    "national": ("0000000000", "전국", ""), "seoul": ("1100000000", "서울", ""),
    "daejeon": ("3000000000", "대전", ""), "sejong": ("3600000000", "세종", ""),
    "dj_dong": ("3011000000", "동구", "3000000000"), "dj_jung": ("3014000000", "중구", "3000000000"),
    "dj_seo": ("3017000000", "서구", "3000000000"), "dj_yuseong": ("3020000000", "유성구", "3000000000"),
    "dj_daedeok": ("3023000000", "대덕구", "3000000000"),
}
KB_CITY = ["national", "seoul", "daejeon", "sejong"]
KB_TABLES = {
    "kbSale": {"path": "priceIndex", "name": "KB 월간 아파트 매매가격지수", "unit": "지수",
               "params": {"월간주간구분코드": "01", "매물종별구분": "01", "매매전세코드": "01", "메뉴코드": "1", "type": "false", "기간": "99"}},
    "kbJeonse": {"path": "priceIndex", "name": "KB 월간 아파트 전세가격지수", "unit": "지수",
                 "params": {"월간주간구분코드": "01", "매물종별구분": "01", "매매전세코드": "02", "메뉴코드": "1", "type": "false", "기간": "99"}},
    "kbJr": {"path": "dealCntstTnantRato", "name": "KB 아파트 매매가격 대비 전세가격 비율", "unit": "%", "regions": KB_CITY,
             "params": {"매물종별구분": "01", "메뉴코드": "1", "type": "false", "기간": "99"}},
    "kbMarket": {"path": "maktTrnd", "name": "KB 매수우위지수", "unit": "0~200(100=균형 · 클수록 매수자 많음)", "regions": KB_CITY,
                 "field": "매수우위지수", "params": {"메뉴코드": "01", "월간주간구분코드": "01", "type": "false", "기간": "99"}},
}
# 입주물량(예정 포함) — 세종은 '세종시'(3611000000)로 받는다
KB_MOVEIN = {"daejeon": ("3000000000", "대전"), "dj_dong": ("3011000000", "동구"), "dj_jung": ("3014000000", "중구"),
             "dj_seo": ("3017000000", "서구"), "dj_yuseong": ("3020000000", "유성구"), "dj_daedeok": ("3023000000", "대덕구"),
             "sejong": ("3611000000", "세종시")}


def ym_add(ym, n):
    y, m = int(ym[:4]), int(ym[4:])
    k = y * 12 + (m - 1) + n
    return "%04d%02d" % (k // 12, k % 12 + 1)


def ym_dash(ym):
    return ym[:4] + "-" + ym[4:]


def get_json(url, tries=5, headers=None):
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {"User-Agent": "jkquant-realestate/1.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # 네트워크·일시 오류만 재시도한다
            last = e
            time.sleep(2 ** a)
    raise RuntimeError("요청 실패: %s (%s)" % (url[:120], last))


def q_add(q, n):
    """분기 시점 'YYYY0Q' 더하기."""
    y, k = int(q[:4]), int(q[4:]) - 1 + n
    return "%04d%02d" % (y + k // 4, k % 4 + 1)


def q_to_month(q):
    """'YYYY0Q' → 분기말 달 'YYYYMM'."""
    return "%s%02d" % (q[:4], int(q[4:]) * 3)


def rone_call(stat, where, s, e, out, expect=None, cycle="MM"):
    """[s, e] 구간 한 번 호출 → out 에 채우고 (받은 행 수, 구간 전체 행 수).
    where: 지역·항목 필터(dict) — 한 달에 한 행만 오도록 좁혀야 한다.
    expect: 받은 행의 지역 이름(거래표는 GRP_FULLNM, 그 밖은 CLS_FULLNM)이 이것과 같아야 한다.
            표마다 분류 번호가 달라 같은 번호가 다른 지역일 수 있다(전세가율 표는 대전 구가 한 칸씩 밀려 있다)."""
    q = {"Type": "json", "STATBL_ID": stat, "DTACYCLE_CD": cycle,
         "START_WRTTIME": s, "END_WRTTIME": e, "pIndex": 1, "pSize": 1000}
    q.update(where)
    if RONE_KEY:
        q["KEY"] = RONE_KEY
    d = get_json(RONE_URL + "?" + urllib.parse.urlencode(q))
    time.sleep(PAUSE)
    t = d.get("SttsApiTblData")
    if t and len(t) > 1:
        rows = t[1].get("row", [])
        for r in rows:
            got = r.get("GRP_FULLNM") if "GRP_ID" in where else r.get("CLS_FULLNM")
            if expect is not None and got != expect:
                raise RuntimeError("R-ONE 지역 이름 불일치 %s %s: %r ≠ 기대 %r" % (stat, where, got, expect))
            m = r["WRTTIME_IDTFR_ID"]
            if cycle == "QY":
                m = q_to_month(m)
            if m in out and r.get("DTA_VAL") is not None:
                raise RuntimeError("R-ONE 한 달에 두 행: %s %s %s — 필터를 좁혀야 한다" % (stat, where, m))
            if r.get("DTA_VAL") is not None:
                out[m] = round(float(r["DTA_VAL"]), 4)
        return len(rows), int(t[0]["head"][0]["list_total_count"])
    if (d.get("RESULT") or {}).get("CODE") not in (None, "INFO-200"):
        raise RuntimeError("R-ONE 오류 %s %s: %s" % (stat, where, d.get("RESULT")))
    return 0, 0


def rone_rows(stat, where, start, end, expect=None):
    """한 지역의 [start, end] 월 자료.
    첫 호출은 구간 전체로 보내 가장 이른 달부터의 행과 전체 개수를 받는다.
    키가 없어 5행만 왔으면 그다음 달부터 5개월씩 이어 받는다."""
    out = {}
    got, total = rone_call(stat, where, start, end, out, expect)
    if not out or got >= total:
        return out
    s = ym_add(max(out), 1)
    while s <= end:
        e = min(ym_add(s, 4), end)
        rone_call(stat, where, s, e, out, expect)
        s = ym_add(e, 1)
    return out


def rone_rows_q(stat, where, start, end, expect=None):
    """분기 자료 [start, end] (시점 'YYYY0Q'). 첫 호출 뒤 5분기씩 이어 받는다. 결과 키는 분기말 달."""
    out = {}
    got, total = rone_call(stat, where, start, end, out, expect, "QY")
    if not out or got >= total:
        return out
    last = max(out)
    s = q_add("%s%02d" % (last[:4], int(last[4:]) // 3), 1)
    while s <= end:
        e = min(q_add(s, 4), end)
        rone_call(stat, where, s, e, out, expect, "QY")
        s = q_add(e, 1)
    return out


def ecos_rows(stat, item, start, end, expect=None):
    out, i, step = {}, 1, (1000 if ECOS_KEY != "sample" else 10)
    while True:
        url = "%s/%s/json/kr/%d/%d/%s/M/%s/%s/%s" % (ECOS_URL, ECOS_KEY, i, i + step - 1, stat, start, end, item)
        d = get_json(url)
        v = d.get("StatisticSearch")
        if not v:
            code = (d.get("RESULT") or {}).get("CODE")
            if code == "INFO-200":  # 해당 자료 없음
                break
            raise RuntimeError("ECOS 오류 %s %s: %s" % (stat, item, d.get("RESULT")))
        for r in v["row"]:
            if expect is not None and r.get("ITEM_NAME1") != expect:
                raise RuntimeError("ECOS 항목 이름 불일치 %s %s: %r ≠ 기대 %r" % (stat, item, r.get("ITEM_NAME1"), expect))
            if r.get("DATA_VALUE") not in (None, ""):
                out[r["TIME"]] = float(r["DATA_VALUE"])
        total = int(v["list_total_count"])
        i += step
        time.sleep(PAUSE)
        if i > total:
            break
    return out


_kb_cache = {}


def kb_table(path, params, parent):
    """KB 통계 한 번 호출 → {지역코드: (지역명, {YYYYMM: 값})}. 같은 (표·상위지역)은 한 번만 부른다."""
    key = (path, tuple(sorted(params.items())), parent)
    if key not in _kb_cache:
        q = dict(params)
        q["지역코드"] = parent
        d = get_json(KB_STAT + path + "?" + urllib.parse.urlencode(q), headers=KB_HEAD_STAT)
        time.sleep(PAUSE)
        if (d.get("dataHeader") or {}).get("resultCode") != "10000" or not (d.get("dataBody") or {}).get("data"):
            raise RuntimeError("KB 오류 %s %s: %s" % (path, parent, str(d)[:200]))
        _kb_cache[key] = d["dataBody"]["data"]
    return _kb_cache[key]


def kb_rows(path, params, code, name, parent, field=None):
    """한 지역의 월별 값. dataList 끝에는 변동률 요약이 더 붙어 오므로 날짜 수만큼만 쓴다.
    지역코드·지역명이 기대와 다르면 멈춘다."""
    data = kb_table(path, params, parent)
    dates = data.get("날짜리스트") or []
    row = next((r for r in data.get("데이터리스트") or [] if r.get("지역코드") == code), None)
    if row is None:
        raise RuntimeError("KB 지역 없음 %s %s" % (path, code))
    if row.get("지역명") != name:
        raise RuntimeError("KB 지역 이름 불일치 %s %s: %r ≠ 기대 %r" % (path, code, row.get("지역명"), name))
    out = {}
    for m, v in zip(dates, (row.get("dataList") or [])[:len(dates)]):
        if isinstance(v, dict):
            v = v.get(field)
        if v not in (None, ""):
            out[m] = round(float(v), 4)
    return out


def kb_movein(code, name):
    """월별 아파트 입주 세대수(앞으로 예정분 포함)."""
    q = {"기간구분": "0", "법정동코드": code}
    d = get_json(KB_LOTS + "?" + urllib.parse.urlencode(q), headers=KB_HEAD_LOTS)
    time.sleep(PAUSE)
    data = (d.get("dataBody") or {}).get("data") or {}
    if data.get("지역명") != name:
        raise RuntimeError("KB 입주 지역 이름 불일치 %s: %r ≠ 기대 %r" % (code, data.get("지역명"), name))
    out = {}
    for r in data.get("차트데이터") or []:
        m = str(r.get("일정") or "")
        if len(m) == 6 and r.get("합계") is not None:
            out[m] = out.get(m, 0) + float(r["합계"].get("세대수") or 0)
    return out


def to_series(rows):
    """{YYYYMM: 값} → {start:'YYYY-MM', v:[...]} (빠진 달은 null)."""
    if not rows:
        return None
    keys = sorted(rows)
    s, e = keys[0], keys[-1]
    v, k = [], s
    while k <= e:
        v.append(rows.get(k))
        k = ym_add(k, 1)
    return {"start": ym_dash(s), "v": v}


def from_series(ser):
    if not ser:
        return {}
    k, out = ser["start"].replace("-", ""), {}
    for x in ser["v"]:
        if x is not None:
            out[k] = x
        k = ym_add(k, 1)
    return out


def same(a, b):
    return abs(a - b) <= 1e-4 * max(1.0, abs(a), abs(b))


def refresh(name, old, fetch_range, full, now_ym, log):
    """증분 갱신: 최근 12개월을 받아 겹치는 달이 같으면 이어 붙이고, 다르면 전부 다시 받는다."""
    old_rows = from_series(old)
    if full or not old_rows:
        rows = fetch_range(None, now_ym)
        log.append({"series": name, "event": "full", "months": len(rows)})
        return to_series(rows)
    tail_from = ym_add(max(old_rows), -11)
    fresh = fetch_range(tail_from, now_ym)
    overlap = [k for k in fresh if k in old_rows]
    changed = [k for k in overlap if not same(fresh[k], old_rows[k])]
    if changed:
        rows = fetch_range(None, now_ym)
        log.append({"series": name, "event": "revised", "changedMonths": sorted(changed)[:24], "months": len(rows)})
        return to_series(rows)
    added = sorted(k for k in fresh if k not in old_rows)
    old_rows.update(fresh)
    if added:
        log.append({"series": name, "event": "append", "added": added})
    return to_series(old_rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--only", default="", help="쉼표로 시계열 이름 제한(시험용) 예: sale:daejeon,macro:cpi")
    ap.add_argument("--jobs", type=int, default=4, help="동시에 받을 시계열 수")
    a = ap.parse_args()

    old = {}
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as f:
            old = json.load(f)
    only = set(x for x in a.only.split(",") if x)
    now_ym = dt.datetime.utcnow().strftime("%Y%m")
    log = []
    series = old.get("series") or {}

    tasks = []  # (이름, 담을 곳, 키, 받는 함수)
    for tkey, tinfo in RONE_TABLES.items():
        bucket = series.setdefault(tkey, {})
        for rkey in tinfo.get("regions") or list(REGIONS):
            code = REGIONS[rkey][2].get(tinfo["codes"])
            name = "%s:%s" % (tkey, rkey)
            if code is None or (only and name not in only):
                continue
            where = dict(tinfo.get("filter") or {})
            where[tinfo.get("param", "CLS_ID")] = code
            want = REGIONS[rkey][3]
            if tinfo.get("static") and bucket.get(rkey) and not a.full:
                continue  # 지난 자료 — 한 번 받았으면 다시 받지 않는다
            if tinfo.get("cycle") == "QY":
                fr = (lambda s, e, _id=tinfo["id"], _w=where, _f=tinfo["from"], _t=tinfo["to"], _x=want: rone_rows_q(_id, _w, _f, _t, _x))
            else:
                fr = (lambda s, e, _id=tinfo["id"], _w=where, _f=tinfo["from"], _x=want: rone_rows(_id, _w, s or _f, e, _x))
            tasks.append((name, bucket, rkey, fr))
    macro = series.setdefault("macro", {})
    for mkey, (stat, item, _, _) in ECOS_SERIES.items():
        name = "macro:" + mkey
        if only and name not in only:
            continue
        tasks.append((name, macro, mkey, (lambda s, e, _s=stat, _i=item: ecos_rows(_s, _i, s or ECOS_FROM, e))))
    for ekey, (stat, items, _, _) in ECOS_REGIONAL.items():
        bucket = series.setdefault(ekey, {})
        for rkey, item in items.items():
            name = "%s:%s" % (ekey, rkey)
            if only and name not in only:
                continue
            tasks.append((name, bucket, rkey, (lambda s, e, _s=stat, _i=item, _x=ECOS_NAMES[rkey]: ecos_rows(_s, _i, s or "200001", e, _x))))
    for tkey, tinfo in KB_TABLES.items():
        bucket = series.setdefault(tkey, {})
        for rkey in tinfo.get("regions") or list(KB_REGIONS):
            code, kname, parent = KB_REGIONS[rkey]
            name = "%s:%s" % (tkey, rkey)
            if only and name not in only:
                continue
            tasks.append((name, bucket, rkey, (lambda s, e, _p=tinfo["path"], _q=tinfo["params"], _c=code, _n=kname, _par=parent, _f=tinfo.get("field"):
                                              kb_rows(_p, _q, _c, _n, _par, _f))))
    bucket = series.setdefault("movein", {})
    for rkey, (code, kname) in KB_MOVEIN.items():
        name = "movein:" + rkey
        if only and name not in only:
            continue
        tasks.append((name, bucket, rkey, (lambda s, e, _c=code, _n=kname: kb_movein(_c, _n))))
    for bucket_name in list(series):  # 설정에서 빠진 지역(예: 개편된 권역)은 원자료에서도 뺀다
        if bucket_name != "macro" and bucket_name in RONE_TABLES:
            allowed = set(RONE_TABLES[bucket_name].get("regions") or REGIONS)
            for rk in list(series[bucket_name]):
                if rk not in allowed or rk not in REGIONS:
                    del series[bucket_name][rk]
                    log.append({"series": "%s:%s" % (bucket_name, rk), "event": "dropped"})

    def run(t):
        name, bucket, key, fr = t
        ser = refresh(name, bucket.get(key), fr, a.full, now_ym, log)
        if not ser:  # 설정한 시계열인데 자료가 없다 — 코드가 그 표에 없을 수 있다
            log.append({"series": name, "event": "empty"})
        print(name, len(from_series(ser)), "months", file=sys.stderr, flush=True)
        return t, ser

    # 시계열마다 따로 받으므로 동시에 받아도 된다(한 시계열 안에서는 순서대로).
    with cf.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        for (name, bucket, key, _), ser in ex.map(run, tasks):
            if ser:
                bucket[key] = ser

    if old and not log and not a.full:
        print("변경 없음 — 파일을 다시 쓰지 않는다", file=sys.stderr)
        return
    doc = {
        "schema": 1,
        "fetchedAt": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "sources": {
            "rone": {"name": "한국부동산원 부동산통계정보(R-ONE) 오픈API", "url": "https://www.reb.or.kr/r-one/",
                     "tables": RONE_TABLES, "note": "월간 조사 · 다음 달 중순 공표"},
            "ecos": {"name": "한국은행 경제통계시스템(ECOS) 오픈API", "url": "https://ecos.bok.or.kr/",
                     "series": {k: {"stat": v[0], "item": v[1], "name": v[2], "unit": v[3]} for k, v in ECOS_SERIES.items()},
                     "regional": {k: {"stat": v[0], "items": v[1], "name": v[2], "unit": v[3]} for k, v in ECOS_REGIONAL.items()}},
            "kb": {"name": "KB부동산 데이터허브(국민은행) 주택가격동향 · 입주물량", "url": "https://data.kbland.kr/",
                   "tables": {k: {"path": v["path"], "name": v["name"], "unit": v["unit"]} for k, v in KB_TABLES.items()},
                   "movein": {"path": "aptMovinCnt", "name": "KB 아파트 입주물량(월별 세대수 · 예정 포함)", "unit": "세대"},
                   "note": "주택가격동향은 매월 중순 조사 · 다음 달 공표. 입주물량의 미래 달은 예정(분양 때 공개)"},
        },
        "regions": {k: {"label": v[0], "group": v[1], "codes": v[2], "name": v[3]} for k, v in REGIONS.items()},
        "series": series,
        "log": (old.get("log") or [])[-200:] + [dict(x, at=now_ym) for x in log],
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, a.out)
    print("saved", a.out, "changes:", len(log), file=sys.stderr)


if __name__ == "__main__":
    main()
