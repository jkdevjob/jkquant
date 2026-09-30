"""Train / Validation / Test 분할 검증 — 과최적화 방지.

과거 60% 로 최적 파라미터를 찾고, 그 파라미터를 '고정'한 채 다음 20%(검증)와
마지막 20%(테스트)에 그대로 적용해 성과를 비교한다. Train 만 좋고 Val/Test 가
무너지면 과최적화 신호다.
"""
from __future__ import annotations
import os
import pandas as pd

from config_loader import with_overrides
from backtest.engine import BacktestEngine
from optimization.optimizer import run_grid, OBJECTIVES, best_params


def split_dates(all_dates: list[str], train=0.6, val=0.2):
    n = len(all_dates)
    i_tr = int(n * train)
    i_va = int(n * (train + val))
    return all_dates[:i_tr], all_dates[i_tr:i_va], all_dates[i_va:]


def run(cfg: dict, market, base_dir=".") -> dict:
    all_dates = market.all_dates()
    tr, va, te = split_dates(all_dates, cfg["split"]["train"], cfg["split"]["validation"])
    if not tr or not va or not te:
        raise ValueError("데이터가 짧아 Train/Val/Test 분할 불가")

    axes = cfg["optimize"]["grid_axes"]
    grid = {a: cfg["optimize"]["grid"][a] for a in axes}
    obj = cfg["optimize"]["objective"]
    keyfn = OBJECTIVES[obj]

    # 1) Train 에서만 최적화
    df = run_grid(cfg, market, axes, grid, start=tr[0], end=tr[-1])
    df["_obj"] = df.apply(lambda r: keyfn({
        "cagr_over_mdd": r["cagr_over_mdd"], "profit_factor": (r["profit_factor"] or 0),
        "cagr_pct": r["cagr_pct"], "total_return_pct": r["total_return_pct"]}), axis=1)
    df = df.sort_values("_obj", ascending=False).reset_index(drop=True)
    params = best_params(df, axes)

    # 2) 고정된 파라미터로 세 구간 평가
    c = with_overrides(cfg, params)

    def seg(a, b):
        return BacktestEngine(c, market).run(start=a, end=b).metrics

    result = {
        "objective": obj,
        "best_params": params,
        "train": seg(tr[0], tr[-1]),
        "validation": seg(va[0], va[-1]),
        "test": seg(te[0], te[-1]),
        "ranges": {"train": (tr[0], tr[-1]), "validation": (va[0], va[-1]), "test": (te[0], te[-1])},
    }

    out = os.path.join(base_dir, cfg["output"]["reports_dir"])
    os.makedirs(out, exist_ok=True)
    rows = []
    for seg_name in ("train", "validation", "test"):
        m = result[seg_name]
        rows.append({"segment": seg_name, "range": "~".join(result["ranges"][seg_name]),
                     **{k: params[k] for k in axes},
                     "cagr_pct": m["cagr_pct"], "mdd_pct": m["mdd_pct"],
                     "cagr_over_mdd": m["cagr_over_mdd"],
                     "profit_factor": (None if m["profit_factor"] == float("inf") else m["profit_factor"]),
                     "win_rate": m["win_rate"], "total_trades": m["total_trades"],
                     "total_return_pct": m["total_return_pct"]})
    pd.DataFrame(rows).to_csv(os.path.join(out, "walkforward.csv"), index=False, encoding="utf-8-sig")
    return result


def print_result(r: dict):
    print("=" * 60)
    print(f"Walk-Forward (Train→Val→Test)  objective={r['objective']}")
    print("=" * 60)
    print(f"  Train 최적 파라미터: {r['best_params']}")
    for seg in ("train", "validation", "test"):
        m = r[seg]
        pf = "inf" if m["profit_factor"] == float("inf") else m["profit_factor"]
        a, b = r["ranges"][seg]
        print(f"  [{seg:<10}] {a}~{b}  CAGR {m['cagr_pct']:>7}%  MDD {m['mdd_pct']:>7}%  "
              f"PF {str(pf):>6}  승률 {m['win_rate']:>5}%  거래 {m['total_trades']:>4}  "
              f"총 {m['total_return_pct']:>7}%")
    print("  ⓘ Train 만 좋고 Val/Test 가 나쁘면 과최적화 신호입니다.")
