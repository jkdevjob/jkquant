"""R41 — ③ + ④ 계좌 비중(투자안 초안). 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-12 R41(커밋 cc8f99d6).
사용: JKQ_DATA=<scalping-data data 사본> python scripts/research/r41_portfolio.py
  - (A) 정직한 판 = R39 · R40 이 해마다 고른 전략(결과 장에 적힌 그대로)을 이어 붙인 일 손익. (B) 지금 판 = ③ 고정 메인 + ④ 11/14 메인 예정.
  - 칸 안은 전액 보유(들고 있는 동안 다시 맞추지 않음) → 칸 일 손익 = 보유 종목 일 손익. 계좌 비중은 매달 첫날 목표로 다시 맞춘다.
  - ④ 미국 거래일 손익은 한국 날짜 다음 날(us_to_kst). 환율 없음."""
import importlib.util
import math
import random
import statistics
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, str(HERE / file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R39 = _load("r39", "r39_soxl_invest.py")
R40 = _load("r40", "r40_coin_invest.py")
L = R40.L

FROM = "2020-01-01"
# R39 결과 장: 해마다 1/1 에 고른 ④ 전략(2016~) · R40 결과 장: 해마다 고른 ③ 전략(2020~)
PICKS4 = [("2019-01-01", "g_soxl_r2lt15_ibs0.2_dn1_ma0_d4"), ("2020-01-01", "g_soxl_r2lt5_ibs0.7_ma0_d1"), ("2021-01-01", "g_soxl_norsi_ibs0.7_ma50_d3"),
          ("2022-01-01", "g_soxl_norsi_ibs0.5_ma50_d5"), ("2023-01-01", "g_soxl_norsi_ibs0.5_ma50_d5"), ("2024-01-01", "g_soxl_norsi_ibs0.5_ma50_d5"),
          ("2025-01-01", "g_soxl_r2lt35_ibs0.6_ma200_d5"), ("2026-01-01", "g_soxl_norsi_ibs0.5_dn1_ma50_d4")]
PICKS3 = [("2020-01-01", "g_coin_ma20_s10_hi2_btc"), ("2021-01-01", "g_coin_ma30_s99_hi_both"), ("2022-01-01", "g_coin_ma30_s99_hi2_both"),
          ("2023-01-01", "g_coin_ma25_s99_hi2_eth"), ("2024-01-01", "g_coin_ma5_s99_hi3_btc"), ("2025-01-01", "g_coin_ma20_s99_hi_both"),
          ("2026-01-01", "g_coin_ma20_s99_hi2_eth")]
NOW3, NOW4 = "g_coin_ma15_s99_hi7_eth", "g_soxl_norsi_ibs0.6_dn1_ma50_d3"
W3 = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8]
W4 = [0, 0.2, 0.3, 0.4, 0.5]

G3, G4 = R40.grid(), R39.grid()


def chain(picks, series):
    out = {}
    for i, (s, v) in enumerate(picks):
        e = picks[i + 1][0] if i + 1 < len(picks) else "9999-12-31"
        out.update({d: x for d, x in series(v).items() if s <= d < e})
    return out


def coin(v, extra=0.0):
    return R40.full_dv(G3[v], R40.HALF + extra)[0]


def soxl_us(v, extra=0.0):
    """④ 칸 전액 일 손익(미국 날짜) — 비용은 한쪽 extra 를 더한다(왕복 2 × extra)."""
    return R39.fast_dv(G4[v], R39.BASE_COST + 2 * extra)[0]


def sleeves(extra=0.0):
    a3 = chain(PICKS3, lambda v: coin(v, extra))
    a4 = L.us_to_kst(chain(PICKS4, lambda v: soxl_us(v, extra)))      # 해마다 고른 경계는 미국 날짜로 자른 뒤 한국 날짜로 옮긴다
    return dict(A=(a3, a4), B=(coin(NOW3, extra), L.us_to_kst(soxl_us(NOW4, extra))))


END = min(R40.CAL[-1], (date.fromisoformat(R39.D[-1]) + timedelta(days=1)).isoformat())
CAL = sorted({d for d in R40.CAL if FROM <= d <= END} | {d for d in L.us_to_kst({x: 0 for x in R39.D}) if FROM <= d <= END})


def account(r3, r4, w3, w4):
    """매달 첫날 목표 비중으로 다시 맞추는 계좌 — 일 손익(%) dict."""
    s3, s4, cash = w3, w4, 1.0 - w3 - w4
    out, month = {}, None
    for d in CAL:
        a0 = s3 + s4 + cash
        if d[:7] != month:
            month = d[:7]
            s3, s4, cash = w3 * a0, w4 * a0, (1.0 - w3 - w4) * a0
        s3 *= 1 + r3.get(d, 0.0) / 100
        s4 *= 1 + r4.get(d, 0.0) / 100
        a1 = s3 + s4 + cash
        if a1 != a0:
            out[d] = (a1 / a0 - 1) * 100
    return out


def stats(dv):
    m = L.goal_metrics(dv, CAL, 365)
    eq, ys = 1.0, {}
    for d in CAL:
        x = 1 + dv.get(d, 0.0) / 100
        eq *= x
        ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = (date.fromisoformat(CAL[-1]) - date.fromisoformat(CAL[0])).days / 365.25
    return dict(cagr=(eq ** (1 / yrs) - 1) * 100, cum=(eq - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                pos=sum(1 for y in ys.values() if y > 1), n=len(ys), years={y: (v - 1) * 100 for y, v in ys.items()})


def block_boot(dv, n=10000, block=20, seed=41):
    xs = [dv.get(d, 0.0) for d in CAL]
    rnd = random.Random(seed)
    k = math.ceil(365 / block)
    loss = 0
    rets = []
    for _ in range(n):
        eq = 1.0
        for _ in range(k):
            i = rnd.randrange(0, len(xs) - block)
            for x in xs[i:i + block]:
                eq *= 1 + x / 100
        rets.append((eq - 1) * 100)
        loss += eq - 1 < -0.20
    rets.sort()
    return dict(p=loss / n, p05=rets[int(n * 0.05)], p50=rets[n // 2], p95=rets[int(n * 0.95)])


def ok_of(st, bb):
    return st["mdd"] >= -25 and st["worst"] >= -15 and st["pos"] >= 6 and bb["p"] <= 0.10


def main():
    print(f"달력 {CAL[0]}~{CAL[-1]} · {len(CAL)}일")
    base, stress = sleeves(0.0), sleeves(0.05)
    for k in ("A", "B"):
        r3, r4 = base[k]
        s3, s4 = stats(r3), stats(r4)
        print(f"\n[{k}] 칸 단독(칸 전액): ③ 연 {s3['cagr']:+.1f}% · MDD {s3['mdd']:.1f}% · 최악일 {s3['worst']:.1f}% / ④ 연 {s4['cagr']:+.1f}% · MDD {s4['mdd']:.1f}% · 최악일 {s4['worst']:.1f}%")
        both = sorted(set(r3) & set(r4))
        if len(both) > 30:
            x, y = [r3.get(d, 0.0) for d in CAL], [r4.get(d, 0.0) for d in CAL]
            mx, my = statistics.fmean(x), statistics.fmean(y)
            c = sum((a - mx) * (b - my) for a, b in zip(x, y)) / math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y))
            print(f"    일 손익 상관 {c:+.2f}")
    print("\n비중 표 — (A) 정직한 판: 연 복리 · MDD · 최악일 · 플러스 해 · 1년 −20% 손실 확률 · 비용 +0.05% 연 복리/MDD → 기준 / (B) 지금 판 연 복리 · MDD")
    rows = []
    for w3 in W3:
        for w4 in W4:
            if w3 + w4 > 1.0 + 1e-9 or (w3 == 0 and w4 == 0):
                continue
            a = account(*base["A"], w3, w4)
            st, bb = stats(a), block_boot(a)
            sa = account(*stress["A"], w3, w4)
            sst, sbb = stats(sa), block_boot(sa)
            b = stats(account(*base["B"], w3, w4))
            ok = ok_of(st, bb) and ok_of(sst, sbb)
            rows.append((w3, w4, st, bb, sst, b, ok))
            print(f"  ③ {w3:.1f} ④ {w4:.1f} | 연 {st['cagr']:+5.1f}% · MDD {st['mdd']:6.1f}% · 최악일 {st['worst']:6.1f}% · {st['pos']}/{st['n']}해 · 손실20 {bb['p'] * 100:4.1f}% · "
                  f"비용+ {sst['cagr']:+5.1f}%/{sst['mdd']:.1f}% → {'통과' if ok else '미통과'} | (B) 연 {b['cagr']:+5.1f}% · MDD {b['mdd']:6.1f}%")
    passed = [r for r in rows if r[6]]
    print()
    cur = next(r for r in rows if r[0] == 0.3 and r[1] == 0.4)
    print(f"지금 계획(국내 30% → 현금 · 코인 30% · 미국 40%): (A) 연 {cur[2]['cagr']:+.1f}% · MDD {cur[2]['mdd']:.1f}% · 최악일 {cur[2]['worst']:.1f}% · {'통과' if cur[6] else '미통과'} · (B) 연 {cur[5]['cagr']:+.1f}% · MDD {cur[5]['mdd']:.1f}%")
    if not passed:
        print("기준을 넘는 비중 없음")
        return
    top = max(r[2]["cagr"] for r in passed)
    near = [r for r in passed if r[2]["cagr"] >= top - 1.0]
    best = max(near, key=lambda r: r[2]["mdd"])
    w3, w4, st, bb, sst, b, _ = best
    print(f"\n== 고른 비중: ③ {w3:.0%} · ④ {w4:.0%} · 현금 {1 - w3 - w4:.0%}")
    print(f"   (A) 연 복리 {st['cagr']:+.1f}% · 누적 {st['cum']:+.1f}% · MDD {st['mdd']:.1f}% · 최악일 {st['worst']:.1f}% · 플러스 해 {st['pos']}/{st['n']}")
    print("   (A) 해마다:", " · ".join(f"{y} {x:+.1f}" for y, x in sorted(st["years"].items())))
    print(f"   (A) 1년 부트스트랩(20일 묶음): −20% 넘게 잃을 확률 {bb['p'] * 100:.1f}% · 1년 수익 5/50/95% = {bb['p05']:+.1f} / {bb['p50']:+.1f} / {bb['p95']:+.1f}%")
    print(f"   (A) 비용 한쪽 +0.05%: 연 {sst['cagr']:+.1f}% · MDD {sst['mdd']:.1f}%")
    print(f"   (B) 지금 판: 연 {b['cagr']:+.1f}% · 누적 {b['cum']:+.1f}% · MDD {b['mdd']:.1f}% · 최악일 {b['worst']:.1f}% · {b['pos']}/{b['n']}해")
    print("   (B) 해마다:", " · ".join(f"{y} {x:+.1f}" for y, x in sorted(b["years"].items())))


if __name__ == "__main__":
    main()
