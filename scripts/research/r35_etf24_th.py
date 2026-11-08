"""R35 — ② 최대 24시간 아래 하락 기준(th) 다시 보기. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-09 R35.
사용: python scripts/research/r35_etf24_th.py etf233740.csv   (FinanceDataReader 233740 일봉: Date,Open,Close)
식은 연구실 claude_lab.etf_trades / etf_24h 와 같다(종가 매수 → 다음 거래일 시가 · 비용 0.03% + 2틱 · |변동|>35% 제외)."""
import csv, statistics, sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

TH = [-3.0, -3.5, -4.0, -4.5, -4.75, -5.0, -5.5, -6.0]


def load(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            o, c = float(r["Open"]), float(r["Close"])
            if o > 0 and c > 0:
                out.append((r["Date"][:10], o, c))
    return out


def trades(b, th, max24):
    out = {}
    for i in range(1, len(b) - 1):
        chg = (b[i][2] / b[i - 1][2] - 1) * 100
        if abs(chg) <= 35 and chg <= th and (not max24 or L.etf_24h(b[i][0], b[i + 1][0])):
            tick = 5 if b[i][2] >= 2000 else 1
            out[b[i + 1][0]] = (b[i + 1][1] / b[i][2] - 1) * 100 - (0.03 + 2 * tick / b[i][2] * 100)
    return out


def summ(dv, cal):
    m = L.goal_metrics(dv, cal, 250)
    v = list(dv.values())
    eq = 1.0
    for d in cal:
        eq *= 1 + dv.get(d, 0.0) / 100
    ys = L.year_stats(dv, cal)
    return dict(n=len(v), avg=statistics.fmean(v) if v else None, cum=(eq - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                years=f"{ys.get('pos')}/{ys.get('n')}")


def main(path):
    b = load(path)
    cal = [x[0] for x in b]
    print(f"자료 {cal[0]}~{cal[-1]} · {len(cal)}거래일")
    print("th   | 판      | 매매 | 평균%  | 누적%   | MDD%   | 최악일% | 플러스해 | adj    | 게이트")
    allv = {}
    for th in TH:
        for mx in (True, False):
            dv = trades(b, th, mx)
            allv[(th, mx)] = dv
            s, sc = summ(dv, cal), L.score_metrics(dv, cal, 250)
            g = L.gate_reason(sc)
            print(f"{th:5.2f} | {'24시간' if mx else '제한없음'} | {s['n']:4d} | {s['avg']:+.3f} | {s['cum']:+8.1f} | {s['mdd']:6.1f} | {s['worst']:7.2f} | {s['years']:>7} | {sc['adj']:+.3f} | {'통과' if not g else g[:28]}")
    # 시간순 검증(24시간 후보만): 해마다 그 전 자료로 게이트 통과 · adj 최고 th → 그 해에 적용
    chain, picks = {}, []
    for y in range(2020, int(cal[-1][:4]) + 1):
        tr = [d for d in cal if d < f"{y}-01-01"]
        te = [d for d in cal if f"{y}-01-01" <= d <= f"{y}-12-31"]
        best = None
        for th in TH:
            dv = {d: v for d, v in allv[(th, True)].items() if d in set(tr)}
            sc = L.score_metrics(dv, tr, 250)
            if L.gate_reason(sc):
                continue
            if best is None or sc["adj"] > best[1]:
                best = (th, sc["adj"])
        picks.append((y, best[0] if best else None))
        if best:
            chain.update({d: v for d, v in allv[(best[0], True)].items() if d in set(te)})
    test = [d for d in cal if d >= "2020-01-01"]
    fixed = {d: v for d, v in allv[(-4.75, True)].items() if d >= "2020-01-01"}
    nol = {d: v for d, v in allv[(-4.75, False)].items() if d >= "2020-01-01"}
    print("시간순 선택:", " · ".join(f"{y} {('쉼' if t is None else format(t, 'g'))}" for y, t in picks))
    for name, dv in (("시간순 선택(24시간)", chain), ("고정 −4.75 · 24시간", fixed), ("고정 −4.75 · 제한없음", nol)):
        s = summ(dv, test)
        print(f"{name}: 매매 {s['n']} · 평균 {s['avg']:+.3f}% · 누적 {s['cum']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.2f}% · 플러스 해 {s['years']}")


if __name__ == "__main__":
    main(sys.argv[1])
