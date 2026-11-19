"""R50 — 월말·월초 효과(Turn of the Month · 발표 규칙 고정판) · 미국 지수 ETF · 판정표 ① ②.
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-19 R50(커밋 08e3b1f0).
사용: python scripts/research/r50_turn_of_month.py
  - 일봉: FinanceDataReader(R43 load_fdr) · 장부: R43 swing(종가 신호 → 다음 날 시가 체결) · 비용 왕복 0.20%.
  - 산다: 그달 마지막 거래일 시가(전날 종가에 신호 · 거래소 달력은 미리 알려져 있어 자료의 날짜로 정함).
  - 판다: 다음 달 셋째 거래일 종가 뒤 넷째 거래일 시가. 보유 4거래일.
  - 지표: R44 stats(연구실 goal_metrics) · 자금 1배 100% · 3배 50%(100% 참고) · 판정 구간 2010-01-01~."""
import importlib.util
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, str(HERE / file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R44 = _load("r44", "r44_public_invest.py")
R43 = R44.R43
FROM, COST = R44.FROM, R44.COST
SYMS = [("SPY", 1.0, "1993-01-01"), ("QQQ", 1.0, "1999-03-01"), ("TQQQ", 0.5, "2010-01-01"), ("SOXL", 0.5, "2010-01-01")]


def tom_marks(D):
    """nth[i]: 그달 몇째 거래일(1부터) · last[i]: i 가 그달 마지막 거래일(다음 줄이 다른 달)."""
    nth, k = [], 0
    for i in range(len(D)):
        k = 1 if i == 0 or D[i][:7] != D[i - 1][:7] else k + 1
        nth.append(k)
    last = [i + 1 < len(D) and D[i + 1][:7] != D[i][:7] for i in range(len(D))]
    return nth, last


def tom(rows, cost):
    D = [r[0] for r in rows]
    nth, last = tom_marks(D)

    def ent(i, C):
        return i + 1 < len(D) and last[i + 1]

    def ex(i, C):
        return nth[i] == 3
    return R43.swing(rows, cost, ent, ex)


def in_out(rows, frm):
    """월말·월초(−1 ~ +3) 안 · 밖 날의 하루 평균(종가/전일 종가 · 비용 없음)."""
    D = [r[0] for r in rows]
    C = [r[4] for r in rows]
    nth, last = tom_marks(D)
    a, b = [], []
    for i in range(1, len(D)):
        if D[i] < frm:
            continue
        r = (C[i] / C[i - 1] - 1) * 100
        (a if last[i] or nth[i] <= 3 else b).append(r)
    return statistics.fmean(a), statistics.fmean(b), len(a), len(b)


def hold(rows, size, frm):
    dv = {rows[i][0]: (rows[i][4] / rows[i - 1][4] - 1) * 100 for i in range(1, len(rows))}
    return R44.stats(rows, dv, [], size, frm)


def judge(rows, size, frm):
    trades, dv = tom(rows, COST)
    s = R44.stats(rows, dv, trades, size, frm)
    s100 = R44.stats(rows, dv, trades, 1.0, frm)
    tr = [t[2] for t in trades if t[0] >= frm]
    win = sum(1 for x in tr if x > 0) / len(tr) * 100 if tr else 0.0
    cg, mn = [], []
    for x in (0.05, 0.10, 0.20):
        t2, d2 = tom(rows, COST + 2 * x)
        s2 = R44.stats(rows, d2, t2, size, frm)
        cg.append(s2["cagr"])
        mn.append(s2["mean"])
    ok1 = s["n"] >= 60 and s["mean"] > 0 and s["t"] >= 2.0 and s["ny"] and s["pos"] / s["ny"] >= 0.6 and s["mdd"] >= -25
    ok2 = cg[1] > 0 and mn[2] >= 0
    return s, s100, win, cg, mn, ok1, ok2


def main():
    passed = []
    for sym, size, start in SYMS:
        rows = R43.load_fdr(sym, start)
        s, s100, win, cg, mn, ok1, ok2 = judge(rows, size, FROM)
        ia, ib, na, nb = in_out(rows, FROM)
        h = hold(rows, size, FROM)
        if ok1 and ok2:
            passed.append(sym)
        print(f"{sym:>4} 2010~ (자금 {size:.0%}) | 매매 {s['n']} · 매매 평균 {s['mean']:+.2f}% · 승률 {win:.0f}% · t {s['t']:.2f} · 연 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · "
              f"최악일 {s['worst']:.1f}% · 플러스 해 {s['pos']}/{s['ny']} | 비용+ {cg[0]:+.1f}/{cg[1]:+.1f}/{cg[2]:+.1f}% · +0.20% 매매 평균 {mn[2]:+.2f}% | "
              f"① {'O' if ok1 else 'X'} ② {'O' if ok2 else 'X'} → {'통과' if ok1 and ok2 else '미통과'}")
        print(f"      참고: 하루 평균 안 {ia:+.3f}%({na}일) vs 밖 {ib:+.3f}%({nb}일) · 그냥 들고 있기(같은 자금) 연 {h['cagr']:+.1f}% · MDD {h['mdd']:.1f}%"
              + (f" · 100%: 연 {s100['cagr']:+.1f}% · MDD {s100['mdd']:.1f}%" if size < 1 else ""))
        if size == 1.0:
            pre = [r for r in rows if r[0] < FROM]
            p, _, pw, _, _, _, _ = judge(pre, size, start)
            pa, pb, _, _ = in_out(pre, start)
            print(f"      참고 {pre[0][0][:4]}~2009: 매매 {p['n']} · 매매 평균 {p['mean']:+.2f}% · 승률 {pw:.0f}% · t {p['t']:.2f} · 연 {p['cagr']:+.1f}% · MDD {p['mdd']:.1f}% · "
                  f"하루 평균 안 {pa:+.3f}% vs 밖 {pb:+.3f}%")
    print(f"\n== 판정: ① ② 통과 {len(passed)}개({', '.join(passed) or '없음'}) → {'다음 ⓑ' if passed else '기록만'}")


if __name__ == "__main__":
    main()
