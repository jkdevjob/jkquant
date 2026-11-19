"""R51 — ② 데이트레이딩 모의 손실 점검: 장부 = 백테스트인가 · 과거 분포에서 몇 % 자리인가 · 국면 → 계속 / 멈춤 제안.
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-20 R51(커밋 7e6e4274).
사용: JKQ_DATA=<scalping-data data 사본(claude-paper/daytrading_etf)> python scripts/research/r51_daytrading_check.py
  - 모의 장부: claude-paper/daytrading_etf/*.json(action trade · 줄마다 진입가 · 청산가 · pnlPct).
  - 백테스트: 연구실 etf_bars · etf_trades("233740", th) 그대로(신호일 종가 매수 → 다음 거래일 시가 매도 · 최대 24시간 · 지금 비용표).
  - 비교는 비용을 뺀 가격 손익으로 한다(비용표가 11/19 에 바뀌어 장부 손익과 백테스트 손익의 비용이 다르다)."""
import json
import math
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

CODE, TH, LIVE_FROM, MAIN_FROM = "233740", -4.75, "2026-10-08", "2026-10-26"


def tick(p):
    return 5 if p >= 2000 else 1


def cost_now(p):
    """지금 연구실 비용(etf_trades 와 같은 식): 비용표 왕복 + 호가 2틱."""
    return L.SC.cost_pct("etf") + 2 * tick(p) / p * 100


def live_trades():
    out = []
    for f in sorted((L.DATA / "claude-paper" / "daytrading_etf").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("action") != "trade" or d["date"] < LIVE_FROM:
            continue
        t = (d.get("trades") or [{}])[0]
        out.append(dict(date=d["date"], pnl=float(d["pnlPct"]), th=(d.get("params") or {}).get("th"), ver=d.get("strategyVersion"),
                        entry=t.get("entryPrice"), exit=t.get("exitPrice"), entryDay=(t.get("entryTime") or "")[:10] or None))
    return out


def pct_rank(vals, x):
    return sum(1 for v in vals if v <= x) / len(vals) * 100


def windows(seq, n):
    return [sum(seq[i:i + n]) for i in range(len(seq) - n + 1)]


def boot(seq, n, k=10000, seed=51):
    rnd = random.Random(seed)
    return [sum(rnd.choice(seq) for _ in range(n)) for _ in range(k)]


def tstat(v):
    return statistics.fmean(v) / (statistics.stdev(v) / math.sqrt(len(v))) if len(v) > 1 and statistics.stdev(v) > 0 else 0.0


def main():
    bars = L.etf_bars(CODE)
    D = [b[0] for b in bars]
    idx = {d: i for i, d in enumerate(D)}
    C = [b[2] for b in bars]
    ma60 = [statistics.fmean(C[i - 59:i + 1]) if i >= 59 else None for i in range(len(C))]
    bt, _ = L.etf_trades(CODE, TH)
    bt_by_sell = {t["sellDate"]: t for t in bt}
    print(f"자료: {CODE} 일봉 {D[0]}~{D[-1]} · 백테스트(−4.75% · 최대 24시간) 매매 {len(bt)}번 · 지금 비용표 왕복 {L.SC.cost_pct('etf'):.2f}% + 호가 2틱")

    # 1) 같은 날 장부 = 백테스트
    lv = live_trades()
    print(f"\n== 1. 모의 장부 {LIVE_FROM}~ 매매 {len(lv)}번 — 같은 날 가격 · 지금 규칙(−4.75% · 최대 24시간)이면 샀나")
    rows, bad = [], 0
    for x in lv:
        i = idx.get(x["date"])
        if i is None or i == 0:
            print(f"   {x['date']}: 일봉 없음")
            bad += 1
            continue
        e = D[i - 1]
        g_fdr = (bars[i][1] / C[i - 1] - 1) * 100
        chg = (C[i - 1] / C[i - 2] - 1) * 100
        g_live = (x["exit"] / x["entry"] - 1) * 100 if x["entry"] and x["exit"] else None
        diff = None if g_live is None else g_live - g_fdr
        if x["entryDay"] and x["entryDay"] != e:
            bad += 1
        if diff is not None and abs(diff) > 0.3:
            bad += 1
        now_rule = x["date"] in bt_by_sell
        why = "" if now_rule else ("주말 · 휴일 넘김(지금은 안 삼)" if not L.etf_24h(e, x["date"]) else f"신호일 {chg:+.2f}% > −4.75%(옛 기준 {x['th']})")
        rows.append(dict(x, e=e, g=g_fdr, bp=C[i - 1], chg=chg, now=now_rule, below=ma60[i - 1] is not None and C[i - 1] < ma60[i - 1]))
        print(f"   {e} → {x['date']} · 신호일 {chg:+.2f}% · 가격 손익 {g_fdr:+.2f}%" + (f"(장부 {g_live:+.2f}% · 차이 {diff:+.2f}%p)" if diff is not None else "")
              + f" · 장부 손익 {x['pnl']:+.2f}% · {x['ver']} · 지금 규칙 {'샀음' if now_rule else '안 삼 — ' + why} · 60일 평균 {'아래' if rows[-1]['below'] else '위'}")
    miss = [t for t in bt if LIVE_FROM <= t["sellDate"] and t["sellDate"] not in {x['date'] for x in lv}]
    print(f"   날짜 · 가격 어긋남 {bad}건 · 백테스트엔 있고 장부엔 없는 날 {len(miss)}건" + (": " + ", ".join(t["sellDate"] for t in miss) if miss else ""))

    # 2) 과거 분포에서 몇 % 자리
    hist = [t for t in bt if t["sellDate"] < LIVE_FROM]
    hv = [t["pnl"] for t in hist]
    print(f"\n== 2. 과거(2016~{LIVE_FROM} 전) 매매 {len(hv)}번 · 매매 평균 {statistics.fmean(hv):+.2f}% · t {tstat(hv):.2f} · 이긴 비율 {sum(1 for v in hv if v > 0) / len(hv) * 100:.0f}%(지금 비용표)")
    sets = [("(가) 지금 메인 판 10/26~ 장부 매매", [r for r in rows if r["date"] >= MAIN_FROM]),
            ("(나) 10/08~ 장부 매매 전부", rows),
            ("(다) 지금 규칙이었다면(같은 기간 백테스트 매매)", [dict(g=(t["sellPrice"] / t["buyPrice"] - 1) * 100, bp=t["buyPrice"]) for t in bt if t["sellDate"] >= LIVE_FROM])]
    verdict = None
    for tag, rs in sets:
        if not rs:
            print(f"   {tag}: 매매 없음")
            continue
        n = len(rs)
        real = sum(r["g"] - cost_now(r["bp"]) for r in rs)
        w, b = windows(hv, n), boot(hv, n)
        pw, pb = pct_rank(w, real), pct_rank(b, real)
        print(f"   {tag}: {n}번 · 합계 {real:+.1f}%p(지금 비용표) · 겹치는 {n}번 묶음 {len(w)}개 중 아래 {pw:.1f}% · 부트스트랩 아래 {pb:.1f}% · "
              f"묶음 중앙값 {statistics.median(w):+.1f}%p · 하위 5% {sorted(w)[max(0, int(len(w) * 0.05) - 1)]:+.1f}%p")
        if tag.startswith("(가)"):
            p = max(pw, pb)
            verdict = "멈춤 제안" if p < 5 else ("계속 · 경고" if p < 20 else "계속")

    # 3) 국면
    below = [t["pnl"] for t in hist if ma60[idx[t["buyDate"]]] is not None and C[idx[t["buyDate"]]] < ma60[idx[t["buyDate"]]]]
    above = [t["pnl"] for t in hist if ma60[idx[t["buyDate"]]] is not None and C[idx[t["buyDate"]]] >= ma60[idx[t["buyDate"]]]]
    print(f"\n== 3. 국면(매수일 종가 vs 60일 평균 · 과거 매매 · 지금 비용표)")
    print(f"   아래(하락장): {len(below)}번 · 평균 {statistics.fmean(below):+.2f}% · t {tstat(below):.2f} · 이긴 비율 {sum(1 for v in below if v > 0) / len(below) * 100:.0f}%")
    print(f"   위: {len(above)}번 · 평균 {statistics.fmean(above):+.2f}% · t {tstat(above):.2f} · 이긴 비율 {sum(1 for v in above if v > 0) / len(above) * 100:.0f}%")
    print(f"   지금 장부 매매 {len(rows)}번 중 60일 평균 아래에서 산 것 {sum(1 for r in rows if r['below'])}번")
    print(f"\n== 판정(사전 등록 기준): 장부 = 백테스트 {'예' if bad == 0 else '아니오 — 원인 먼저'} · 지금 메인 판 → {verdict}"
          + (" · 하락장 매매 과거 평균 − → '하락장에서는 안 사는 규칙' 새 후보(따로 사전 등록)" if statistics.fmean(below) < 0 else ""))


if __name__ == "__main__":
    main()
