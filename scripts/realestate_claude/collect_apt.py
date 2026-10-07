#!/usr/bin/env python3
"""부동산(클로드) 아파트 단지 자료 수집 — KB부동산 공개 API (로그인 없는 방문자용).

대전·세종 대단지(세대수 ≥ MIN_UNITS)의 전용 84㎡ 대표 타입(그 단지에서 세대가 가장 많은 80~86㎡ 타입)에 대해
  - KB 월 시세: 매매 하한·일반·상한, 전세 일반 (2004년~)
  - 매매 실거래: 국토부 신고분을 KB가 보여주는 것 (2006년~) → 월별 건수·중앙값·최저·최고
를 받아 data/realestate/claude/apt.json 에 쓴다. 단위 만원.
대전·세종 단지 전부의 기본정보(준공·세대수·좌표)는 apt-complexes.json 에 둔다(새 단지만 추가로 묻는다).
원자료만 담는다. 전략·장부 계산은 realestate-claude-apt.js 한 곳에서 한다.

받은 단지 이름이 목록의 이름과 다르면 멈춘다(번호가 바뀌어 다른 단지를 받는 사고 방지).
쓰는 법:  python scripts/realestate_claude/collect_apt.py
"""
import concurrent.futures as cf
import datetime as dt
import importlib.util
import json
import os
import re
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("rc_collect", os.path.join(HERE, "collect.py"))
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DIR = os.path.join(ROOT, "data", "realestate", "claude")
OUT = os.path.join(DIR, "apt.json")
OUT_ALL = os.path.join(DIR, "apt-complexes.json")
API = "https://api.kbland.kr"
HEAD = C.KB_HEAD_LOTS
SIDO = ["대전시", "세종시"]
MIN_UNITS = 1000
MIN_LIST = 500  # 대전·세종 단지 목록이 이보다 적으면 목록 API 변경을 의심하고 멈춘다
PAUSE = 0.12
WORKERS = 4  # 단지 시세는 4곳씩 동시에 받는다


class NoData(Exception):
    """KB 가 그 단지·타입 자료가 없다고 답함(시세 미제공 신축 등) — 그 단지만 건너뛴다."""


def kb(path, soft=False, **q):
    """KB 호출 → dataBody.data (없으면 None). 오류 코드면 멈춘다.
    soft=True 면 '서버 오류(10500)' 를 자료 없음(NoData)으로 본다 — 시세가 없는 단지에서 KB 가 그렇게 답한다."""
    d = C.get_json(API + path + "?" + urllib.parse.urlencode(q), headers=HEAD)
    time.sleep(PAUSE)
    body = d.get("dataBody") or {}
    head = d.get("dataHeader") or {}
    if head.get("resultCode") not in ("10000", None):
        if soft and head.get("resultCode") == "10500":
            raise NoData("%s %s" % (path, q))
        raise RuntimeError("KB 오류 %s %s: %s" % (path, q, head))
    return body.get("data")


def norm(s):
    return re.sub(r"[\s·.()\-]", "", str(s or ""))


def list_complexes():
    """시군구 → 법정동 → 단지 목록. 아파트·주상복합(시세 대상)과 아파트분양권·분양 단계 단지(신규 분양 위치 찾기용, kind='분양')."""
    out, seen = [], set()
    for sido in SIDO:
        for g in kb("/land-complex/map/siGunGuAreaNameList", 시도명=sido) or []:
            for d in kb("/land-complex/map/stutDongAreaNameList", 시도명=sido, 시군구명=g["시군구명"]) or []:
                for c in kb("/land-complex/complexComm/hscmList", 법정동코드=d["법정동코드"]) or []:
                    kind = c.get("매물종별구분명")
                    if kind not in ("아파트", "주상복합", "아파트분양권"):
                        continue
                    if c.get("분양진행단계명"):
                        kind = "분양"  # 분양 중·입주 예정(번호 체계가 달라 기본정보는 묻지 않는다)
                    if int(c["단지기본일련번호"]) in seen:  # 두 법정동에 걸친 단지는 한 번만
                        continue
                    seen.add(int(c["단지기본일련번호"]))
                    out.append({"id": int(c["단지기본일련번호"]), "name": c["단지명"], "gu": g["시군구명"], "dong": d.get("법정동명"),
                                "lat": float(c["wgs84위도"]), "lng": float(c["wgs84경도"]), "kind": kind})
    if len(out) < MIN_LIST:
        raise RuntimeError("단지 목록이 너무 적다(%d) — 목록 API 변경 의심" % len(out))
    return out


def complex_main(c):
    m = kb("/land-complex/complex/main", 단지기본일련번호=c["id"]) or {}
    if norm(m.get("단지명")) != norm(c["name"]):
        raise RuntimeError("단지 이름 불일치 %s: %r ≠ %r" % (c["id"], m.get("단지명"), c["name"]))
    return {"built": m.get("준공년월"), "units": int(m.get("총세대수") or 0)}


def pick_type(types):
    """전용 80~86㎡ 중 세대가 가장 많은 타입(같으면 면적일련번호 작은 것)."""
    t84 = [t for t in types or [] if t.get("전용면적") and 80 <= float(t["전용면적"]) <= 86]
    if not t84:
        return None
    t84.sort(key=lambda t: (-(t.get("세대수") or 0), t.get("면적일련번호") or 0))
    return t84[0]


def ym(s):
    s = str(s)
    if not re.fullmatch(r"\d{6}", s):
        raise RuntimeError("달 형식 오류: %r" % s)
    return s


def ym_add(s, n):
    y, m = int(s[:4]), int(s[4:]) - 1 + n
    return "%04d%02d" % (y + m // 12, m % 12 + 1)


def to_arrays(rows, keys):
    """{YYYYMM: {k: v}} → {start:'YYYY-MM', k:[...]} (빠진 달 null)."""
    if not rows:
        return None
    ms = sorted(rows)
    out = {"start": ms[0][:4] + "-" + ms[0][4:]}
    for k in keys:
        out[k] = []
    m = ms[0]
    while m <= ms[-1]:
        r = rows.get(m)
        for k in keys:
            out[k].append(None if r is None else r.get(k))
        m = ym_add(m, 1)
    return out


def sise_rows(items):
    rows = {}
    for it in items:
        m = ym(it.get("기준년월"))
        if m in rows:
            raise RuntimeError("시세 같은 달 두 번: %s" % m)
        mid = it.get("매매일반거래가")
        if not mid:
            continue
        rows[m] = {"mid": mid, "low": it.get("매매하한가"), "high": it.get("매매상한가"), "jeonse": it.get("전세일반거래가")}
    return rows


def real_rows(items):
    """실거래 목록 → 월별 건수·중앙값·최저·최고."""
    by = {}
    for it in items:
        p = it.get("매매실거래금액")
        d = str(it.get("계약시작년월일") or "")
        if not p or not re.fullmatch(r"\d{8}", d):
            continue
        by.setdefault(d[:6], []).append(int(p))
    rows = {}
    for m, v in by.items():
        v.sort()
        n = len(v)
        med = v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2
        rows[m] = {"n": n, "med": int(round(med)), "min": v[0], "max": v[-1]}
    return rows


def history(cid):
    t = pick_type(kb("/land-complex/complex/typInfo", 단지기본일련번호=cid))
    if not t:
        return None
    aid = t["면적일련번호"]
    s_items, r_items = [], []
    try:
        years = [y["기준년"] for y in kb("/land-price/price/QuotBaseYear", True, 단지기본일련번호=cid, 면적일련번호=aid) or []]
        if years:
            d = kb("/land-price/price/WholQuotList", True, 단지기본일련번호=cid, 면적일련번호=aid, 기준년=",".join(years)) or {}
            s_items = [it for gr in d.get("시세") or [] for it in gr.get("items") or []]
    except NoData:
        s_items = []
    try:
        ryears = [y["기준년"] for y in kb("/land-price/price/RealPriceBaseYear", True, 단지기본일련번호=cid, 면적일련번호=aid, 거래구분=0, 매물종별구분="01") or []]
        if ryears:
            d = kb("/land-price/price/WholRealPriceList", True, 단지기본일련번호=cid, 면적일련번호=aid, 기준년=",".join(ryears), 거래구분=1, 매물종별구분="01") or {}
            r_items = [it for gr in d.get("실거래가") or [] for it in gr.get("items") or []]
    except NoData:
        r_items = []
    return {"areaId": aid, "excl": float(t["전용면적"]), "supply": float(t.get("공급면적") or 0),
            "sise": to_arrays(sise_rows(s_items), ["mid", "low", "high", "jeonse"]),
            "real": to_arrays(real_rows(r_items), ["n", "med", "min", "max"])}


def load(p):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def main():
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    old_all = {c["id"]: c for c in (load(OUT_ALL) or {}).get("complexes", [])}
    listed = list_complexes()
    allc = []
    for c in listed:
        o = old_all.get(c["id"])
        if c["kind"] == "분양":
            c.update({"built": None, "units": 0})
        elif o and norm(o.get("name")) == norm(c["name"]) and o.get("units"):
            c.update({"built": o.get("built"), "units": o.get("units")})
        else:
            c.update(complex_main(c))
        allc.append(c)
    allc.sort(key=lambda c: c["id"])
    uni, sise, real, skipped = [], {}, {}, []
    big = [c for c in allc if c["kind"] in ("아파트", "주상복합") and (c.get("units") or 0) >= MIN_UNITS]
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        hist = dict(zip([c["id"] for c in big], ex.map(lambda c: history(c["id"]), big)))
    for c in big:
        h = hist[c["id"]]
        if not h or not h["sise"]:
            skipped.append({"id": c["id"], "name": c["name"], "why": "84㎡ 타입 없음" if not h else "KB 시세 없음"})
            continue
        uni.append({"id": c["id"], "name": c["name"], "gu": c["gu"], "dong": c["dong"], "built": c.get("built"), "units": c["units"],
                    "excl": h["excl"], "supply": h["supply"], "areaId": h["areaId"], "lat": c["lat"], "lng": c["lng"]})
        sise[str(c["id"])] = h["sise"]
        if h["real"]:
            real[str(c["id"])] = h["real"]
    if len(uni) < 30 or len(skipped) > len(big) / 2:
        raise RuntimeError("시세 있는 대단지가 너무 적다(%d · 제외 %d) — 저장하지 않는다" % (len(uni), len(skipped)))
    doc = {"schemaVersion": 1, "updated": now, "minUnits": MIN_UNITS,
           "source": {"kb": "KB부동산 공개 API — 단지 목록·기본정보·월 시세(WholQuotList)·매매 실거래(WholRealPriceList)", "unit": "만원"},
           "universe": uni, "sise": sise, "real": real, "skipped": skipped}
    alldoc = {"schemaVersion": 1, "updated": now, "complexes": allc}
    old = load(OUT)

    def same(a, b):
        return a is not None and json.dumps({k: v for k, v in a.items() if k != "updated"}, sort_keys=True) == json.dumps({k: v for k, v in b.items() if k != "updated"}, sort_keys=True)
    os.makedirs(DIR, exist_ok=True)
    wrote = []
    if not same(old, doc):
        json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        wrote.append("apt.json")
    if not same(load(OUT_ALL), alldoc):
        json.dump(alldoc, open(OUT_ALL, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        wrote.append("apt-complexes.json")
    print("단지 %d곳 중 대단지 %d곳(84㎡ 시세) · 제외 %d · 저장 %s" % (len(allc), len(uni), len(skipped), ",".join(wrote) or "변화 없음"))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print("수집 중단:", e, file=sys.stderr)
        sys.exit(2)
