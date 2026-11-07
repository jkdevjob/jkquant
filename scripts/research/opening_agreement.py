#!/usr/bin/env python3
"""R31-가 과정 지표 — 실전 ① (메인 · 그림자 calib_e4_p5)이 연구 정의와 얼마나 일치하는가 (2026-11-07).

손익이 아니라 '같은 날 같은 종목을 골랐는가'를 잰다. 연구 정의 = 밤 연구 일봉(실제 시가갭): 통과 = rsiPassed(RSI<30 · 실제 갭 −2~−29%) ≥ 7, 고르기 = 실제 갭 깊은 3.
  날 일치: 연구가 매매한 날(rsiPassed ≥ 7)과 실전(메인: breadth.qualified ≥ 7 / 그림자: shadow.qualified ≥ 7)이 같은 판단인가.
  종목 일치: 매매한 날 고른 종목이 연구 신호(그날 실제 갭 깊은 3)와 겹치는 수 · 고른 종목의 실제 갭 ≤ −3% 비율(시세 캐시가 있을 때).
그림자가 장부에 없는 날(배포 전)은 장부의 08:56 · 08:58 예상가로 같은 규칙을 다시 계산하고 '재구성'으로 표시한다 — 실시간 원본과 구분(단타 데이터 누적 원칙).
사용: python3 scripts/research/opening_agreement.py live_dir research_daily_dir [prices.json]
  live_dir = data/opening-gapdown-live/*.json(장부 archive) · research_daily_dir = data/opening-gapdown-research/daily/*.json · prices.json = r28 시세 캐시(선택).
"""
import glob, json, os, sys

LIVE, RES = sys.argv[1], sys.argv[2]
PRICES = json.load(open(sys.argv[3], encoding="utf-8")) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else {}
SHADOW = dict(breadthGapMax=-4, minQ=7, pickGapMax=-5, picks=3)   # functions/api/opening-gapdown.js SHADOW_CALIB 와 같은 값(시험이 둘을 맞춘다)
MAIN = dict(minQ=7, gapMax=-3, picks=3)                            # 경쟁군 메인(opening_d1v2) — 장부 picks(≤−2 깊은 3) 중 갭 −3 이하가 메인 매매


def picks_by(rows, gap_max, floor, n):
    return sorted([r for r in rows if r["g"] is not None and floor < r["g"] <= gap_max], key=lambda r: (r["g"], r["code"]))[:n]


def live_day(path):
    d = json.load(open(path, encoding="utf-8"))
    ev = {}
    for e in d["ledger"]["events"]:
        p = e["payload"]
        ev[e["stage"] + ":" + str(p.get("part", ""))] = p
    pre = ev.get("preopen:") or {}
    first, fresh = {}, {}
    for k, p in ev.items():
        if k.startswith("quote:") and p.get("part") != "recheck":
            for c in p.get("candidates") or []:
                if c.get("expectedPrice") and c.get("basePrice"):
                    first[c["code"]] = dict(code=c["code"], name=c.get("name"), base=c["basePrice"], g=(c["expectedPrice"] / c["basePrice"] - 1) * 100)
    for c in (ev.get("quote:recheck") or {}).get("candidates") or []:
        if c.get("expectedPrice") and c.get("basePrice"):
            fresh[c["code"]] = dict(code=c["code"], name=c.get("name"), base=c["basePrice"], g=(c["expectedPrice"] / c["basePrice"] - 1) * 100)
    rule = ((pre.get("watchlist") or {}).get("rule")) or {}
    floor = float(rule.get("gapFloor", -29))
    q = (pre.get("breadth") or {}).get("qualified")
    main_picks = [p for p in (pre.get("picks") or []) if p.get("expectedGapPct") is not None and p["expectedGapPct"] <= MAIN["gapMax"]][: MAIN["picks"]]
    sh = pre.get("shadow")
    src = "실시간"
    if not sh and first:
        rows = list(first.values())
        fr = list(fresh.values())
        qual = len(picks_by(rows, SHADOW["breadthGapMax"], floor, 10 ** 9))
        sp = picks_by(fr if fr else rows, SHADOW["pickGapMax"], floor, SHADOW["picks"])
        sh = dict(qualified=qual, signal=qual >= SHADOW["minQ"], picks=[dict(code=r["code"], name=r["name"], expectedGapPct=r["g"]) for r in sp], source="recheck" if fr else "first")
        src = "재구성"
    base = {c: r["base"] for c, r in first.items()}
    return dict(date=d["date"], main_q=q, main_day=(q is not None and q >= MAIN["minQ"]), main_picks=main_picks, shadow=sh, shadow_src=src, base=base, reason=pre.get("decisionReason"))


def actual_gap(code, day, base):
    b = (PRICES.get(code) or {}).get(day) or {}
    return (b["o"] / base - 1) * 100 if b.get("o") and base else None


research = {}
for f in sorted(glob.glob(os.path.join(RES, "*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    research[d["date"]] = dict(rsi=int((d.get("decision") or {}).get("rsiPassed") or 0), codes=[s["code"] for s in d.get("signals") or []])
agree = dict(main=[0, 0, 0, 0], shadow=[0, 0, 0, 0])   # 둘 다 매매 · 둘 다 쉼 · 실전만 · 연구만
ov = dict(main=[0, 0], shadow=[0, 0])                  # 겹친 종목 · 고른 종목 수(연구도 매매한 날만)
deep = dict(main=[0, 0], shadow=[0, 0])                # 실제 갭 ≤−3 종목 · 실제 갭 있는 고른 종목(매매한 날)
print("날짜 · 연구 통과(≥7 매매?) · 메인 통과(매매?) · 그림자 통과(매매? · 출처) · 겹침(메인/그림자) · 고른 종목 실제 갭 ≤−3(메인/그림자)")
for f in sorted(glob.glob(os.path.join(LIVE, "*.json"))):
    L = live_day(f)
    R = research.get(L["date"])
    if R is None:
        print(f"  {L['date']} 연구 일봉 없음 — 건너뜀")
        continue
    rday = R["rsi"] >= MAIN["minQ"]
    sh = L["shadow"] or {}
    sday = bool(sh.get("signal")) and bool(sh.get("picks"))
    mday = L["main_day"] and bool(L["main_picks"])
    cells = {}
    for nm, day, pk in (("main", mday, L["main_picks"]), ("shadow", sday, sh.get("picks") or [])):
        k = 0 if (day and rday) else 1 if (not day and not rday) else 2 if day else 3
        agree[nm][k] += 1
        codes = [p["code"] for p in pk]
        hit = len(set(codes) & set(R["codes"])) if (day and rday) else None
        if hit is not None:
            ov[nm][0] += hit
            ov[nm][1] += len(codes)
        ga = [actual_gap(c, L["date"], L["base"].get(c)) for c in codes] if day else []
        ga = [g for g in ga if g is not None]
        if ga:
            deep[nm][0] += sum(1 for g in ga if g <= -3)
            deep[nm][1] += len(ga)
        cells[nm] = (hit, (sum(1 for g in ga if g <= -3), len(ga)) if ga else None)
    print(f"  {L['date']} 연구 {R['rsi']:>3}({'매매' if rday else '쉼'}) · 메인 {str(L['main_q']):>4}({'매매' if mday else '쉼'}) · 그림자 {str(sh.get('qualified')):>4}({'매매' if sday else '쉼'} · {L['shadow_src']}) · 겹침 {cells['main'][0]}/{cells['shadow'][0]} · ≤−3 {cells['main'][1]}/{cells['shadow'][1]}")
for nm, lab in (("main", "메인(통과 ≥7 · 갭 ≤−3 · 예상갭)"), ("shadow", "그림자 calib_e4_p5(통과 = 예상 ≤−4 수 ≥7 · 예상 ≤−5 깊은 3)")):
    a = agree[nm]
    n = sum(a)
    print(f"═ {lab}: 날 일치 {(a[0] + a[1]) / n * 100:.0f}% ({a[0]} 둘 다 매매 · {a[1]} 둘 다 쉼 · {a[2]} 실전만 · {a[3]} 연구만) · "
          f"둘 다 매매한 날 종목 겹침 {ov[nm][0]}/{ov[nm][1]} · 고른 종목 실제 갭 ≤−3 {deep[nm][0]}/{deep[nm][1]}" + (f" ({deep[nm][0] / deep[nm][1] * 100:.0f}%)" if deep[nm][1] else ""))
