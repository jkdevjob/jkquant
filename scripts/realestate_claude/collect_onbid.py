#!/usr/bin/env python3
"""부동산(클로드) 대전·세종 온비드 공매 수집 — 한국자산관리공사 차세대 온비드 공식 API(공공데이터포털).

쓰는 API(사용자가 활용신청한 셋)
  ① 공고목록   OnbidPbancListSrvc2/getPbancList2        — 개찰일 기간 · 부동산 · 재산유형으로 공고 목록
  ② 물건정보   OnbidPbancCltrDtlSrvc2/getPbancCltrInf2   — 공고 안의 물건(주소 · 용도 · 감정가 · 최저가 · 유찰 횟수 · 입찰 기간)
  ③ 입찰결과   OnbidPbancBidRsltDtlSrvc2/getPbancBidRsltDtl2 — 끝난 공고의 물건별 낙찰가 · 유효 입찰자 수
공고 목록에는 지역 칸이 없다 → 물건 주소(cltrAdr)가 '대전'·'세종'으로 시작하는 물건만 남긴다.
②는 공고마다 한 번 부른다 — 하루 호출 한도를 넘지 않게 지역 힌트(담당부점·기관·공고명)가 있는 공고부터, 정해 둔 수까지만.
결과는 data/realestate/claude/onbid.json 에 쌓는다(끝난 물건 결과는 지우지 않고 남겨 낙찰가율 통계로 쓴다).

인증키는 환경변수 DATA_GO_KR_KEY(GitHub Secrets) — 화면·로그·파일 어디에도 쓰지 않는다. 없으면 아무것도 안 하고 끝낸다.
쓰는 법:  DATA_GO_KR_KEY=... python scripts/realestate_claude/collect_onbid.py
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "data", "realestate", "claude", "onbid.json")
API = "https://apis.data.go.kr/B010003/"
LIST_URL = API + "OnbidPbancListSrvc2/getPbancList2"
ITEM_URL = API + "OnbidPbancCltrDtlSrvc2/getPbancCltrInf2"
RSLT_URL = API + "OnbidPbancBidRsltDtlSrvc2/getPbancBidRsltDtl2"
PRPT = "0007,0010,0005,0002,0003,0006,0008,0011,0013"   # 재산유형: 불용품(0004)만 뺀 전부
AREAS = ("대전", "세종")
HINT = re.compile(r"대전|세종|충남|충청")                 # 공고 단계 지역 힌트(담당부점 · 기관 · 공고명)
BACK_DAYS, AHEAD_DAYS = 45, 60                            # 개찰일 기간: 오늘 −45일 ~ +60일(한국 날짜)
ITEM_BUDGET, RSLT_BUDGET = 400, 200                       # 하루 호출 한도 안에서
PAUSE = 0.15
EXIT_PARTIAL = 2


class ApiError(RuntimeError):
    """인증키·요청 오류 — 다시 해도 같다(재시도 안 함)."""


class LimitError(ApiError):
    """하루 호출 한도를 넘음(코드 22) — 여기서 멈추고 받은 만큼 저장한다."""


class Forbidden(ApiError):
    """HTTP 403 — 이 API 는 활용신청이 승인되지 않았다(키는 다른 API 에서 동작할 수 있음)."""


STAT = {"0001": "입찰준비중", "0002": "입찰진행중", "0003": "입찰마감", "0006": "개찰중"}   # 이름 대신 코드가 올 때


def key_from_env():
    k = (os.environ.get("DATA_GO_KR_KEY") or "").strip()
    return urllib.parse.unquote(k) if "%" in k else k        # 인코딩된 키를 넣어도 한 번만 인코딩되게


def get_json(url, params, tries=3):
    """공공데이터포털 호출. 인증 오류(XML OpenAPI_ServiceResponse)·결과코드 오류는 ApiError(재시도 안 함)."""
    last = None
    for a in range(tries):
        try:
            req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "jkquant-realestate/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8", "replace")
            time.sleep(PAUSE)
            return parse(text)
        except ApiError:
            raise
        except urllib.error.HTTPError as e:
            if e.code == 403:   # 권한 없음은 다시 해도 같다 — 바로 알린다
                raise Forbidden("%s: HTTP 403 — 공공데이터포털에서 이 API 활용신청 승인을 확인하세요" % url.rsplit("/", 1)[-1])
            last = e
            time.sleep(2 ** a)
        except Exception as e:  # 네트워크·일시 오류만 재시도
            last = e
            time.sleep(2 ** a)
    raise RuntimeError("요청 실패: %s (%s)" % (url.rsplit("/", 1)[-1], last))


EMPTY = {"body": {"items": None, "totalCount": 0}}


def parse(text):
    """응답 → dict. 자료 없음(03)은 빈 목록, 한도 초과(22)는 LimitError, 그 밖의 오류(인증키 등)는 ApiError."""
    t = text.lstrip()
    if t.startswith("<"):
        code = re.search(r"<returnReasonCode>(\w+)</returnReasonCode>", t) or re.search(r"<resultCode>(\w+)</resultCode>", t)
        msg = re.search(r"<returnAuthMsg>(.*?)</returnAuthMsg>", t) or re.search(r"<errMsg>(.*?)</errMsg>", t) or re.search(r"<resultMsg>(.*?)</resultMsg>", t)
        c, m = (code.group(1) if code else ""), (msg.group(1) if msg else t[:120])
        if c in ("03",):
            return EMPTY
        raise (LimitError if c == "22" else ApiError)("공공데이터포털 오류 %s: %s" % (c, m))
    d = json.loads(t)
    if "response" in d and isinstance(d["response"], dict):
        d = d["response"]
    head = d.get("header") or {}
    code = str(head.get("resultCode", "00"))
    if code in ("03",):
        return EMPTY
    if code == "22":
        raise LimitError("하루 호출 한도 초과: %s" % head.get("resultMsg"))
    if code not in ("00", "0", "000", "INFO-000"):
        raise ApiError("결과코드 %s: %s" % (code, head.get("resultMsg")))
    return d


def items_of(d):
    """body.items.item 이 목록·한 건(dict)·빈 문자열 어느 쪽이어도 목록으로."""
    body = d.get("body") or {}
    its = body.get("items")
    if isinstance(its, dict):
        its = its.get("item")
    if its in (None, "", []):
        return [], int(body.get("totalCount") or 0)
    if isinstance(its, dict):
        its = [its]
    return its, int(body.get("totalCount") or len(its))


def man(won):
    """원 → 만원(반올림). 비공개·빈 값은 None."""
    try:
        v = float(str(won).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return int(round(v / 10000)) if v > 0 else None


def when(s):
    """yyyyMMddHHmm → 'YYYY-MM-DD HH:MM'(한국 시각 그대로)."""
    s = re.sub(r"\D", "", str(s or ""))
    if len(s) >= 12:
        return "%s-%s-%s %s:%s" % (s[:4], s[4:6], s[6:8], s[8:10], s[10:12])
    if len(s) == 8:
        return "%s-%s-%s" % (s[:4], s[4:6], s[6:8])
    return None


def in_area(addr):
    a = re.sub(r"\s+", "", str(addr or ""))
    return a.startswith(AREAS) or a.startswith(("대전광역시", "세종특별자치시"))


def list_notices(key, start, end, getj=get_json):
    out, page = [], 1
    while True:
        d = getj(LIST_URL, {"serviceKey": key, "pageNo": page, "numOfRows": 100, "resultType": "json", "cltrTypeCd": "0001",
                            "prptDivCd": PRPT, "opbdDtStart": start, "opbdDtEnd": end})
        its, total = items_of(d)
        out += its
        if not its or len(out) >= total or page >= 300:   # 전국 공고가 1만 줄을 넘는다(2026-11: 13,078줄) — 끝까지 읽는다
            return out, total
        page += 1


def pick_notices(notices, budget):
    """지역 힌트가 있는 공고 먼저, 그다음 개찰이 가까운 순으로 budget 개까지."""
    seen, uniq = set(), []
    for n in notices:
        k = n.get("pbancMngNo")
        if k and k not in seen:
            seen.add(k)
            uniq.append(n)
    hint = lambda n: bool(HINT.search(" ".join(str(n.get(x) or "") for x in ("rspbSbrNm", "orgNm", "onbidPbancNm"))))
    uniq.sort(key=lambda n: (not hint(n), str(n.get("cltrOpbdDt") or "")))
    return uniq[:budget], len(uniq), sum(1 for n in uniq if hint(n))


def stat_name(nm, cd):
    """입찰결과 이름 — 이름 칸에 코드(0001 등)가 오면 이름으로 바꾼다."""
    v = str(nm or "").strip()
    if re.fullmatch(r"\d{4}", v):
        return STAT.get(v, "상태 " + v)
    if v:
        return v
    c = str(cd or "").strip()
    return STAT.get(c, ("상태 " + c) if c else None)


def norm_item(it, notice):
    return {
        "id": "%s-%s-%s" % (it.get("cltrMngNo"), it.get("pbctNsq") or notice.get("pbctNsq") or "", it.get("pbctCdtnNo") or ""),
        "pbancMngNo": it.get("pbancMngNo") or notice.get("pbancMngNo"), "cltrMngNo": it.get("cltrMngNo"), "onbidCltrno": it.get("onbidCltrno"),
        "name": it.get("onbidCltrNm"), "addr": it.get("cltrAdr"),
        "usage": " > ".join(x for x in (it.get("cltrUsgLclsCtgrNm"), it.get("cltrUsgMclsCtgrNm"), it.get("cltrUsgSclsCtgrNm")) if x),
        "prpt": it.get("prptDivNm") or notice.get("prptDivNm"), "dsps": it.get("dspsMthodNm") or notice.get("dspsMthodNm"),
        "org": notice.get("orgNm"), "branch": notice.get("rspbSbrNm"), "notice": notice.get("onbidPbancNm"), "bidDiv": notice.get("bidDivNm"),
        "round": it.get("pbctNsq") or notice.get("pbctNsq"), "fails": it.get("usbdNft"), "batch": it.get("batcBidYn") == "Y",
        "appraisal": man(it.get("apslEvlAmt")), "minPrice": man(it.get("lowstBidPrcIndctCont")),
        "minRatio": it.get("apslPrcCtrsLowstBidRto"), "bidStart": when(it.get("cltrBidBgngDt")), "bidEnd": when(it.get("cltrBidEndDt")),
        "opbd": when(notice.get("cltrOpbdDt")), "status": stat_name(it.get("pbctStatNm"), it.get("pbctStatCd")), "result": None,
    }


def attach_results(items, rows):
    """③ 결과(물건별)를 같은 물건관리번호·회차 물건에 붙인다."""
    by = {}
    for r in rows:
        for c in r.get("cltrBidRsltClgList") or []:
            by[(c.get("cltrMngNo"), str(c.get("pbctNsq") or r.get("pbctNsq") or ""))] = c
    n = 0
    for it in items:
        c = by.get((it["cltrMngNo"], str(it["round"] or "")))
        if not c:
            continue
        it["result"] = {"status": stat_name(c.get("pbctStatNm"), c.get("pbctStatCd")), "win": man(c.get("scfbAmt")), "bidders": c.get("vldBddrNope"),
                        "invalid": c.get("nfctBddrNope"), "winOverMin": c.get("lowstBidCtrsScfbPrcRto"), "opbd": when(c.get("cltrOpbdDt"))}
        if it["appraisal"] and it["result"]["win"]:
            it["result"]["winApp"] = round(it["result"]["win"] / it["appraisal"], 4)
        n += 1
    return n


def merge(old_items, new_items):
    """같은 물건·회차는 새 값으로, 결과는 한 번 들어오면 지우지 않는다. 이번에 안 보인 끝난 물건도 남긴다(통계용)."""
    keep = {x["id"]: x for x in old_items or []}
    for x in keep.values():   # 지난 수집이 남긴 상태 코드(0001 등)도 이름으로 — 이번에 안 보인 물건은 다시 안 받는다
        x["status"] = stat_name(x.get("status"), None)
    for it in new_items:
        prev = keep.get(it["id"])
        if prev and prev.get("result") and not it.get("result"):
            it["result"] = prev["result"]
        keep[it["id"]] = it
    return sorted(keep.values(), key=lambda x: (x.get("bidEnd") or "", x["id"]), reverse=True)


def kst_today():
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=9)).date()


def main(getj=get_json, out=OUT, today=None):
    key = key_from_env()
    if not key:
        print("DATA_GO_KR_KEY 없음 — 온비드 수집을 건너뜁니다", file=sys.stderr)
        return 0
    day = today or kst_today()
    start, end = (day - dt.timedelta(days=BACK_DAYS)).strftime("%Y%m%d"), (day + dt.timedelta(days=AHEAD_DAYS)).strftime("%Y%m%d")
    notices, total = list_notices(key, start, end, getj)
    picked, uniq, hinted = pick_notices(notices, ITEM_BUDGET)
    print("공고 %d건(중복 뺀 %d · 지역 힌트 %d) → 물건 조회 %d건" % (total, uniq, hinted, len(picked)), file=sys.stderr)
    items, failed, closed, limited = [], [], [], False
    now = day.strftime("%Y%m%d") + "9999"
    for n in picked:
        try:
            its, _ = items_of(getj(ITEM_URL, {"serviceKey": key, "pageNo": 1, "numOfRows": 100, "resultType": "json", "pbancMngNo": n["pbancMngNo"]}))
        except LimitError as e:  # 한도 초과 — 받은 만큼만
            print(str(e), file=sys.stderr)
            limited = True
            break
        except ApiError:   # 인증키·권한 오류(403 포함)는 멈춘다
            raise
        except Exception as e:  # 한 공고 실패는 그 공고만
            failed.append(n.get("pbancMngNo"))
            print("물건정보 실패:", n.get("pbancMngNo"), str(e)[:120], file=sys.stderr)
            continue
        mine = [norm_item(it, n) for it in its if in_area(it.get("cltrAdr"))]
        items += mine
        if mine and str(n.get("cltrOpbdDt") or "") <= now:
            closed.append(n)
    rows, warnings = [], []
    for n in ([] if limited else closed[:RSLT_BUDGET]):
        try:
            rows += items_of(getj(RSLT_URL, {"serviceKey": key, "pageNo": 1, "numOfRows": 100, "resultType": "json", "pbancMngNo": n["pbancMngNo"]}))[0]
        except Forbidden as e:   # ③ 만 승인이 안 됨 — 한 번 알고 그만 부른다(나머지 자료는 그대로)
            print(str(e), file=sys.stderr)
            warnings.append("rsltForbidden")
            break
        except LimitError as e:
            print(str(e), file=sys.stderr)
            limited = True
            break
        except ApiError as e:
            print("입찰결과 없음:", n.get("pbancMngNo"), str(e)[:120], file=sys.stderr)
        except Exception as e:
            failed.append(n.get("pbancMngNo"))
            print("입찰결과 실패:", n.get("pbancMngNo"), str(e)[:120], file=sys.stderr)
    got = attach_results(items, rows)
    old = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else {}
    merged = merge(old.get("items"), items)
    print("대전·세종 물건 %d건(결과 %d) · 쌓인 것 %d건 · 실패 %d" % (len(items), got, len(merged), len(failed)), file=sys.stderr)
    doc = {"schemaVersion": 1, "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "한국자산관리공사 차세대 온비드 오픈API(공공데이터포털) — 공고목록 · 공고상세 물건정보 · 공고 입찰결과상세",
           "window": {"opbdStart": start, "opbdEnd": end}, "noticeTotal": total, "noticesChecked": len(picked), "warnings": warnings, "items": merged}
    strip = lambda d: json.dumps({k: v for k, v in (d or {}).items() if k != "updated"}, sort_keys=True, ensure_ascii=False)
    if strip(doc) != strip(old):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tmp = out + ".tmp"
        json.dump(doc, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, out)
        print("저장:", out, file=sys.stderr)
    return EXIT_PARTIAL if failed or limited else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ApiError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
