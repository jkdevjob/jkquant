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


def ym_add(ym, n):
    y, m = int(ym[:4]), int(ym[4:])
    k = y * 12 + (m - 1) + n
    return "%04d%02d" % (k // 12, k % 12 + 1)


def ym_dash(ym):
    return ym[:4] + "-" + ym[4:]


def get_json(url, tries=5):
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "jkquant-realestate/1.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # 네트워크·일시 오류만 재시도한다
            last = e
            time.sleep(2 ** a)
    raise RuntimeError("요청 실패: %s (%s)" % (url[:120], last))


def rone_call(stat, where, s, e, out, expect=None):
    """[s, e] 구간 한 번 호출 → out 에 채우고 (받은 행 수, 구간 전체 행 수).
    where: 지역·항목 필터(dict) — 한 달에 한 행만 오도록 좁혀야 한다.
    expect: 받은 행의 지역 이름(거래표는 GRP_FULLNM, 그 밖은 CLS_FULLNM)이 이것과 같아야 한다.
            표마다 분류 번호가 달라 같은 번호가 다른 지역일 수 있다(전세가율 표는 대전 구가 한 칸씩 밀려 있다)."""
    q = {"Type": "json", "STATBL_ID": stat, "DTACYCLE_CD": "MM",
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


def ecos_rows(stat, item, start, end):
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
            if r.get("DATA_VALUE") not in (None, ""):
                out[r["TIME"]] = float(r["DATA_VALUE"])
        total = int(v["list_total_count"])
        i += step
        time.sleep(PAUSE)
        if i > total:
            break
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
            tasks.append((name, bucket, rkey, (lambda s, e, _id=tinfo["id"], _w=where, _f=tinfo["from"], _x=want: rone_rows(_id, _w, s or _f, e, _x))))
    macro = series.setdefault("macro", {})
    for mkey, (stat, item, _, _) in ECOS_SERIES.items():
        name = "macro:" + mkey
        if only and name not in only:
            continue
        tasks.append((name, macro, mkey, (lambda s, e, _s=stat, _i=item: ecos_rows(_s, _i, s or ECOS_FROM, e))))
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
                     "series": {k: {"stat": v[0], "item": v[1], "name": v[2], "unit": v[3]} for k, v in ECOS_SERIES.items()}},
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
