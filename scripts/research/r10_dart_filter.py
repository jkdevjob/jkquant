"""R10 (2026-10-15 사전 등록) — ① 시초가 갭하락 과매도에서 '나쁜 공시' 종목을 빼면 나아지는가.

가설: 갭하락 과매도는 '특별한 이유 없이 떨어진 종목이 되돌아오는 것'에 건다. 직전에 나쁜 공시가 있었던 종목의 갭하락은
      이유가 있는 하락이라 되돌림이 약하다(뉴스 있는 하락은 이어지고 없는 하락은 되돌아온다). 그런 종목을 빼면 ① 성적이 좋아진다.
나쁜 공시(보고서명에 아래 말이 있으면 · 결과 보기 전 고정): NEG 목록.
시점(룩어헤드 없음): 신호 날짜 d 의 직전 3일(d−3 ~ d−1, 달력일) 접수분만. OpenDART 는 접수 시각이 없어 d 당일 공시는 쓰지 않는다.
규칙: 지금 ① 메인(통과 7종목 이상 날 · 갭 −3% 이하 · 깊은 3종목 평균)에서 나쁜 공시 종목을 뺀다(대신 넣지 않음 — 신호는 하루 최대 3종목).
판정(결과 보기 전 고정): (a) 거른 쪽 누적 ≥ 메인 (b) MDD 악화 2%p 이내 (c) 나쁜 공시 신호 평균 손익 < 나머지 평균
      (d) 나쁜 공시 신호 30개 이상(모자라면 '표본 부족 — 보류'). 모두 만족해야 통과 — 통과해도 주문 경로가 바뀌므로 사용자 확인 뒤 그림자로.
자료: ① 연구 신호(signals.csv · decisions.csv — scalping-data), 공시: OpenDART(corpCode.xml · list.json).
키는 환경변수 DART_API_KEY 로만 받는다 — 화면 · 기록 · 결과 파일에 남기지 않는다(오류 문구에서도 지운다).
사용: JKQ_DATA=<signals.csv 가 든 data 폴더> DART_API_KEY=… python3 -I scripts/research/r10_dart_filter.py --app . --out r10.json
"""
import argparse, csv, io, json, math, os, statistics, sys, time, urllib.parse, urllib.request, zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta

NEG = ["유상증자결정", "전환사채권발행결정", "신주인수권부사채권발행결정", "교환사채권발행결정", "감자결정", "의견거절", "부적정", "한정",
       "감사범위제한", "횡령", "배임", "소송등의제기", "소송등의판결", "불성실공시법인", "관리종목", "상장폐지", "매매거래정지", "거래정지",
       "영업정지", "회생절차", "파산", "부도", "최대주주변경", "공급계약해지", "손상차손", "자본잠식", "투자주의환기"]
P = dict(minQ=7, topK=3, gapMax=-3.0)               # 지금 ① 메인(g_open_q7_k3_gap3 · 2026-10-13 부터)
KEY = os.environ.get("DART_API_KEY", "").strip()
API = "https://opendart.fss.or.kr/api/"


def clean(msg):
    return str(msg).replace(KEY, "***") if KEY else str(msg)


def get(path, params, binary=False, tries=4):
    url = API + path + "?" + urllib.parse.urlencode(dict(params, crtfc_key=KEY))
    err = None
    for a in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "jkquant-research/1.0"}), timeout=60) as r:
                b = r.read()
                return b if binary else json.loads(b.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 + 2 * a)
    raise RuntimeError(clean(err))


def corp_codes():
    z = zipfile.ZipFile(io.BytesIO(get("corpCode.xml", {}, binary=True)))
    root = ET.fromstring(z.read(z.namelist()[0]))
    return {(x.findtext("stock_code") or "").strip(): x.findtext("corp_code") for x in root.findall("list") if (x.findtext("stock_code") or "").strip()}


def is_negative(report_nm):
    return any(k in (report_nm or "") for k in NEG)


def window(d):
    x = date.fromisoformat(d)
    return (x - timedelta(days=3)).strftime("%Y%m%d"), (x - timedelta(days=1)).strftime("%Y%m%d")


def disclosures(corp, d):
    bgn, end = window(d)
    out, page, limited = [], 1, 0
    while True:
        j = get("list.json", dict(corp_code=corp, bgn_de=bgn, end_de=end, page_no=page, page_count=100))
        st = j.get("status")
        if st == "013":                                  # 조회된 자료 없음
            return out
        if st == "020":                                  # 요청 제한 — 잠깐 쉬고 다시(5번까지, 하루 한도면 멈춤)
            limited += 1
            if limited > 5:
                raise RuntimeError("OpenDART 요청 제한(020)이 계속됨 — 하루 한도일 수 있어 멈춤")
            time.sleep(30)
            continue
        if st != "000":
            raise RuntimeError(f"OpenDART status {st}: {j.get('message')}")
        out += [dict(rcept_dt=x.get("rcept_dt"), report_nm=x.get("report_nm")) for x in j.get("list") or []]
        if page >= int(j.get("total_page") or 1):
            return out
        page += 1


def series(sig, q, flagged=frozenset()):
    """① 메인 하루 손익 — claude_lab.d1_series 와 같은 식(나쁜 공시 신호를 빼는 것만 다름)."""
    by = {}
    for r in sig:
        if (r["date"], r["code"]) in flagged:
            continue
        by.setdefault(r["date"], []).append((float(r.get("gapPct") or 0.0), float(r["pnl"])))
    out = {}
    for d, s in by.items():
        if q.get(d, 0) < P["minQ"]:
            continue
        s = sorted(x for x in s if P["gapMax"] is None or x[0] <= P["gapMax"])[:int(P["topK"])]
        if s:
            out[d] = statistics.fmean(v for _, v in s)
    return out


def stats(dv):
    eq = peak = 1.0; mdd = 0.0; yr = {}
    for d in sorted(dv):
        eq *= 1 + dv[d] / 100; peak = max(peak, eq); mdd = min(mdd, (eq / peak - 1) * 100)
        yr[d[:4]] = yr.get(d[:4], 1.0) * (1 + dv[d] / 100)
    return dict(days=len(dv), total=(eq - 1) * 100, mdd=mdd, mean=statistics.fmean(dv.values()) if dv else 0,
                years={y: round((g - 1) * 100, 2) for y, g in sorted(yr.items())})


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--app", default="."); ap.add_argument("--out", default="r10.json"); a = ap.parse_args()
    if not KEY:
        sys.exit("DART_API_KEY 없음 — opendart.fss.or.kr 인증키를 GitHub 비밀값 DART_API_KEY 로 등록해야 한다")
    sys.path.insert(0, os.path.join(a.app, "scripts"))
    import claude_lab as L
    data = L.DATA / "opening-gapdown-research"
    sig = list(csv.DictReader(open(data / "signals.csv", encoding="utf-8")))
    q = {r["date"]: int(r.get("rsiPassed") or 0) for r in csv.DictReader(open(data / "decisions.csv", encoding="utf-8"))}
    base = series(sig, q)
    ref = L.d1_series(P)[0]
    assert set(base) == set(ref) and all(abs(base[d] - ref[d]) < 1e-9 for d in ref), "운영 d1_series 와 다름"
    print(f"확인: 거르기 없음 = 운영 d1_series (날짜 {len(ref)}개 같음)")
    cc = corp_codes()
    used = {(r["date"], r["code"]) for r in sig if q.get(r["date"], 0) >= P["minQ"] and float(r.get("gapPct") or 0) <= P["gapMax"]}
    flagged, why, missing, calls = set(), {}, 0, 0
    for d, code in sorted(used):
        corp = cc.get(code)
        if not corp:
            missing += 1
            continue
        ds = disclosures(corp, d); calls += 1
        bad = [x for x in ds if is_negative(x["report_nm"])]
        if bad:
            flagged.add((d, code)); why[f"{d} {code}"] = [x["report_nm"] for x in bad][:3]
        time.sleep(0.7)                                 # 분당 약 85건 — OpenDART 분당 요청 한도 안쪽(처음 쓰는 키가 막히지 않게)
    filt = series(sig, q, frozenset(flagged))
    pn = {(r["date"], r["code"]): float(r["pnl"]) for r in sig}
    fl = [pn[k] for k in flagged]; rest = [pn[k] for k in used - flagged]
    sb, sf = stats(base), stats(filt)
    res = dict(rule=P, neg=NEG, window="d-3..d-1", signals=len(used), corpMissing=missing, calls=calls, flagged=len(fl),
               flaggedMean=statistics.fmean(fl) if fl else None, restMean=statistics.fmean(rest) if rest else None,
               main=sb, filtered=sf, examples=dict(list(why.items())[:20]))
    a_ok = sf["total"] >= sb["total"]; b_ok = sf["mdd"] >= sb["mdd"] - 2; c_ok = bool(fl) and res["flaggedMean"] < res["restMean"]; d_ok = len(fl) >= 30
    res["verdict"] = "통과" if (a_ok and b_ok and c_ok and d_ok) else ("표본 부족 — 보류" if not d_ok else "기준 미달")
    res["checks"] = dict(a=a_ok, b=b_ok, c=c_ok, d=d_ok)
    open(a.out, "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"신호 {len(used)}개 · 회사 코드 없음 {missing} · 나쁜 공시 {len(fl)}개(평균 {res['flaggedMean'] if fl else float('nan'):+.2f}%) vs 나머지 {len(rest)}개(평균 {res['restMean']:+.2f}%)")
    print(f"메인: 매매일 {sb['days']} · 누적 {sb['total']:+.1f}% · MDD {sb['mdd']:.1f}% · 연도별 {sb['years']}")
    print(f"거름: 매매일 {sf['days']} · 누적 {sf['total']:+.1f}% · MDD {sf['mdd']:.1f}% · 연도별 {sf['years']}")
    print(f"판정: {res['verdict']} {res['checks']}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        sys.exit("오류: " + clean(e))
