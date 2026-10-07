#!/usr/bin/env python3
"""부동산(클로드) 대전·세종 신규 분양 수집 — 청약홈(한국부동산원) APT 분양정보·경쟁률.

청약홈 모집공고 목록(대전·세종)과 공고별 상세(공급위치·공급규모·입주예정·주택형별 공급금액),
청약 경쟁률(1순위 접수·미달·당첨가점)을 받아 data/realestate/claude/presale.json 에 쓴다.
단지 위치는 apt-complexes.json(KB 단지·분양권 좌표)에서 이름으로 찾는다. 주변 시세 비교는 화면 엔진이 한다.
원자료만 담는다. 공공분양(LH) 경쟁률은 청약홈에 없어서 비워 둔다.

쓰는 법:  python scripts/realestate_claude/collect_presale.py
"""
import datetime as dt
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DIR = os.path.join(ROOT, "data", "realestate", "claude")
OUT = os.path.join(DIR, "presale.json")
BASE = "https://www.applyhome.co.kr"
LIST = "/ai/aia/selectAPTLttotPblancListView.do"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
AREAS = ["대전", "세종"]
PAUSE = 0.4
TYPE_RE = re.compile(r"\d{3}\.\d+[A-Z0-9]*")
# 다가오는 분양 — 공고 전이라 청약홈에 없는 것. 기사로 확인한 것만, 출처와 함께.
UPCOMING = [
    {"area": "대전", "name": "도마·변동3구역 재개발 '트리센 자이 더샵 힐스테이트'", "where": "대전 서구 변동 9-4 일원",
     "scale": "3,404세대(임대 237 포함)", "builder": "GS건설·현대건설·포스코이앤씨", "when": "공고 미정 — 기사상 2026년 10~11월 분양 목표",
     "price": "미정", "src": ["https://xi-thesharp-hillstate.com/project", "https://v.daum.net/v/YdkwlMJ6sr"]},
    {"area": "세종", "name": "5-1생활권 꽃나루마을 L6·L7·L8·L11", "where": "세종 합강동(5-1생활권 스마트시티)",
     "scale": "2,191세대(전부 전용 84㎡)", "builder": "BS한양", "when": "2026년 11월 중순 일괄 공급 목표 — 분양가 심사 전",
     "price": "미정", "src": ["https://www.joongdo.co.kr/web/view.php?key=20260917010005987"]},
    {"area": "세종", "name": "5-2생활권 M3·M4·M5·L4 블록", "where": "세종 다솜동(5-2생활권)",
     "scale": "약 1,300세대 이상", "builder": "—", "when": "인허가 중 — 2027년 상반기 청약 가능 전망",
     "price": "미정", "src": ["https://www.joongdo.co.kr/web/view.php?key=20260917010005987"]},
]

_cj = http.cookiejar.CookieJar()
_op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cj))


def fetch(path, data=None, tries=4):
    last = None
    for i in range(tries):
        try:
            body = urllib.parse.urlencode(data).encode() if data is not None else None
            r = urllib.request.Request(BASE + path, data=body, headers={"User-Agent": UA, "Referer": BASE + LIST,
                                                                        "Content-Type": "application/x-www-form-urlencoded"})
            with _op.open(r, timeout=40) as f:
                s = f.read().decode("utf-8", "replace")
            time.sleep(PAUSE)
            return s
        except Exception as e:  # 네트워크·일시 오류만 재시도
            last = e
            time.sleep(2 ** (i + 1))
    raise RuntimeError("청약홈 요청 실패: %s (%s)" % (path, last))


def cells(tr):
    return [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, flags=re.S)]


def tables(s):
    return [[cells(tr) for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S)] for t in re.findall(r"<table[^>]*>(.*?)</table>", s, flags=re.S)]


def num(x):
    x = (x or "").replace(",", "").strip()
    return float(x) if re.fullmatch(r"\d+(\.\d+)?", x) else None


def period_options(s):
    """목록 화면의 조회 기간 선택지 — 가장 이른 시작달·가장 늦은 끝달."""
    def opts(name):
        i = s.find('name="%s"' % name)
        j = s.find("</select>", i)
        return re.findall(r'<option[^>]*value="(\d{6})"', s[i:j]) if i >= 0 else []
    b, e = opts("beginPd"), opts("endPd")
    if not b or not e:
        raise RuntimeError("청약홈 목록 화면 형식이 바뀌었다(조회 기간 선택지 없음)")
    return min(b), max(e)


def parse_list(s, area):
    tb = s[s.find("<tbody"):s.find("</tbody>")]
    rows = []
    for pb, hm, nm, inner in re.findall(r'<tr data-pbno="(\d+)" data-hmno="(\d+)" data-honm="([^"]*)">(.*?)</tr>', tb, flags=re.S):
        c = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip() for t in re.findall(r"<td[^>]*>(.*?)</td>", inner, flags=re.S)]
        if len(c) < 9:
            raise RuntimeError("청약홈 목록 열 개수가 바뀌었다: %s" % c)
        if c[0] != area:
            raise RuntimeError("청약홈 목록 지역 불일치 %s ≠ %s" % (c[0], area))
        rows.append({"area": area, "pblancNo": pb, "houseManageNo": hm, "name": html.unescape(nm), "kind": c[1], "type": c[2],
                     "builder": c[4], "notice": c[6], "period": c[7], "win": c[8]})
    last = max([int(x) for x in re.findall(r"fn_link_page\((\d+)\)", s)] or [1])
    return rows, last


def parse_detail(s):
    """상세: 공급위치·공급규모·입주예정월·주택형별 {공급면적, 일반, 특별, 계, 공급금액(최고가, 만원)}."""
    T = tables(s)
    info = {"types": {}}
    for t in T:
        for c in t:
            for i in range(len(c) - 1):
                if c[i] == "공급위치":
                    info["addr"] = c[i + 1]
                if c[i] == "공급규모":
                    info["scale"] = c[i + 1]
    m = re.search(r"입주예정월\s*:\s*([\d.]+)", s)
    info["movein"] = m.group(1) if m else None
    for t in T:
        for c in t:
            k = next((i for i, x in enumerate(c) if TYPE_RE.fullmatch(x)), None)
            if k is None:
                continue
            rest = c[k + 1:]
            if len(rest) >= 5 and num(rest[0]) and re.search(r"\(\d+\)$", rest[4]):
                info["types"].setdefault(c[k], {}).update({"supply": num(rest[0]), "gen": num(rest[1]), "spc": num(rest[2]), "tot": num(rest[3])})
    i = s.find("공급금액(최고가 기준)")
    if i > 0:
        for t in tables(s[i - 3000:]):
            for c in t:
                if len(c) >= 2 and TYPE_RE.fullmatch(c[0]) and num(c[1]):
                    info["types"].setdefault(c[0], {})["price"] = num(c[1])
    return info


def parse_comp(s):
    """경쟁률 표 첫 번째 — 주택형별 1·2순위 해당·기타 접수, 남은 미달, 1순위 해당지역 당첨가점."""
    T = tables(s)
    rows = [c for c in (T[0] if T else []) if c and TYPE_RE.fullmatch(c[0]) and len(c) >= 7]
    if not rows:
        return None
    sup, r1, last, ga = {}, 0, {}, []
    for c in rows:
        ty, n, rank, reg, cnt = c[0], num(c[1]), c[2], c[3], num(c[4])
        if n is None:
            continue
        sup[ty] = n
        if rank == "1순위":
            r1 += cnt or 0
        last[ty] = c[5]
        if rank == "1순위" and reg == "해당지역" and len(c) >= 11 and num(c[8]) is not None:
            ga.append((num(c[8]), num(c[10])))
    if all("접수중" in c[6] for c in rows):
        return None  # 공공분양(LH)은 청약홈에 결과가 없다
    supply = sum(sup.values())
    short = sum(int(m.group(1).replace(",", "")) for v in last.values() for m in [re.search(r"△\s*([\d,]+)", v or "")] if m)
    return {"supply": supply, "r1": r1, "rate1": round(r1 / supply, 2) if supply else None, "short": short,
            "gaMin": min(g[0] for g in ga) if ga else None, "gaAvg": round(sum(g[1] for g in ga if g[1] is not None) / len(ga), 1) if ga else None}


def norm(s):
    s = re.sub(r"[\s·.()\-_,'\"]|\d+단지|\d+블록|아파트", "", str(s or "")).lower()
    return s.replace("view", "뷰").replace("sk", "에스케이")  # 'SK VIEW' · 'SK뷰' · '에스케이뷰' 를 같게


def locate(item, complexes):
    """이름으로 KB 단지·분양권 좌표 찾기 — 같은 구(세종은 세종시) 안에서 이름이 서로 포함되면."""
    gu = "세종시" if item["area"] == "세종" else next((g for g in ["동구", "중구", "서구", "유성구", "대덕구"] if g in (item.get("addr") or "")), None)
    key = norm(re.sub(r"\(.*?\)", "", item["name"]))
    if not gu or len(key) < 3:
        return None
    best = None
    for c in complexes:
        if c.get("gu") != gu:
            continue
        k = norm(c.get("name"))
        if len(k) >= 3 and (k in key or key in k):
            score = min(len(k), len(key))
            if best is None or score > best[0]:
                best = (score, c)
    return {"id": best[1]["id"], "name": best[1]["name"], "lat": best[1]["lat"], "lng": best[1]["lng"]} if best else None


def main():
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    first = fetch(LIST)
    b, e = period_options(first)
    items = []
    for area in AREAS:
        page = 1
        while True:
            s = fetch(LIST, {"beginPd": b, "endPd": e, "houseDetailSecd": "", "suplyAreaCode": area, "houseNm": "", "chk0": "", "pageIndex": str(page)})
            rows, last = parse_list(s, area)
            items += rows
            if page >= last or not rows:
                break
            page += 1
    if not items:
        raise RuntimeError("청약홈 대전·세종 공고가 하나도 없다 — 저장하지 않는다")
    cx = (json.load(open(os.path.join(DIR, "apt-complexes.json"), encoding="utf-8")) if os.path.exists(os.path.join(DIR, "apt-complexes.json")) else {}).get("complexes", [])
    out = []
    for it in items:
        k = {"houseManageNo": it["houseManageNo"], "pblancNo": it["pblancNo"]}
        det = parse_detail(fetch("/ai/aia/selectAPTLttotPblancDetail.do", k))
        comp = parse_comp(fetch("/ai/aia/selectAPTCompetitionPopup.do", dict(k, houseNm=it["name"])))
        types = [{"type": t, "excl": float(re.match(r"\d+\.\d+", t).group()), **v} for t, v in det["types"].items()]
        it.update({"addr": det.get("addr"), "scale": det.get("scale"), "movein": det.get("movein"), "types": types, "comp": comp})
        it["loc"] = locate(it, cx)
        out.append(it)
    doc = {"schemaVersion": 1, "updated": now, "period": [b, e], "source": "청약홈(한국부동산원) APT 분양정보·청약 경쟁률 — 공급금액은 주택형별 최고가(만원)",
           "items": out, "upcoming": UPCOMING}
    old = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else None
    strip = lambda d: json.dumps({k: v for k, v in (d or {}).items() if k != "updated"}, sort_keys=True, ensure_ascii=False)
    if old is None or strip(old) != strip(doc):
        json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("신규 분양 %d건 저장(위치 찾음 %d건)" % (len(out), sum(1 for x in out if x["loc"])))
    else:
        print("신규 분양 변화 없음")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print("분양 수집 중단:", e, file=sys.stderr)
        sys.exit(2)
