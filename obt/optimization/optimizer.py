"""파라미터 최적화 — 그리드 조합을 전부 백테스트하고 결과를 CSV로 저장.

수익률 하나로 줄 세우지 않는다. CAGR·MDD·PF·승률·거래수·최종자산·CAGR/MDD·
평균거래수익률을 함께 저장해 '과최적화 냄새'를 눈으로 확인할 수 있게 한다.
"""
from __future__ import annotations
import itertools
import os
import pandas as pd

from config_loader import with_overrides, get_path
from backtest.engine import BacktestEngine

OBJECTIVES = {
    "cagr_over_mdd": lambda m: m["cagr_over_mdd"],
    "profit_factor": lambda m: (m["profit_factor"] if m["profit_factor"] != float("inf") else 1e9),
    "cagr": lambda m: m["cagr_pct"],
    "total_return": lambda m: m["total_return_pct"],
}


def _combos(grid: dict, axes: list[str]):
    values = [grid[a] for a in axes]
    for combo in itertools.product(*values):
        yield dict(zip(axes, combo))


def run_grid(cfg: dict, market, axes: list[str], grid: dict,
             start=None, end=None) -> pd.DataFrame:
    rows = []
    for overrides in _combos(grid, axes):
        c = with_overrides(cfg, overrides)
        res = BacktestEngine(c, market).run(start=start, end=end)
        m = res.metrics
        row = {a: overrides[a] for a in axes}
        row.update({
            "total_trades": m["total_trades"], "win_rate": m["win_rate"],
            "avg_return_pct": m["avg_return_pct"], "cagr_pct": m["cagr_pct"],
            "mdd_pct": m["mdd_pct"], "cagr_over_mdd": m["cagr_over_mdd"],
            "profit_factor": (None if m["profit_factor"] == float("inf") else m["profit_factor"]),
            "final_equity": m["final_equity"], "total_return_pct": m["total_return_pct"],
        })
        rows.append(row)
    return pd.DataFrame(rows)


def optimize(cfg: dict, market, base_dir=".", start=None, end=None, save=True) -> pd.DataFrame:
    opt = cfg["optimize"]
    axes = opt["grid_axes"]
    grid = {a: opt["grid"][a] for a in axes}
    obj = opt["objective"]
    keyfn = OBJECTIVES[obj]

    df = run_grid(cfg, market, axes, grid, start=start, end=end)
    # 거래가 너무 적은 조합은 신뢰 불가 → 뒤로 정렬(제거하진 않고 표시)
    df["_obj"] = df.apply(lambda r: keyfn({
        "cagr_over_mdd": r["cagr_over_mdd"], "profit_factor": (r["profit_factor"] or 0),
        "cagr_pct": r["cagr_pct"], "total_return_pct": r["total_return_pct"],
    }), axis=1)
    df = df.sort_values(["_obj"], ascending=False).reset_index(drop=True)

    if save:
        out = os.path.join(base_dir, cfg["output"]["reports_dir"])
        os.makedirs(out, exist_ok=True)
        path = os.path.join(out, "optimization.csv")
        df.drop(columns=["_obj"]).to_csv(path, index=False, encoding="utf-8-sig")
        print(f"최적화 결과 {len(df)}조합 → {path}")
    return df


def best_params(df: pd.DataFrame, axes: list[str], min_trades: int = 5) -> dict:
    """거래수 최소 조건을 만족하는 상단 조합의 파라미터(dict)를 돌려준다."""
    ok = df[df["total_trades"] >= min_trades]
    row = (ok if len(ok) else df).iloc[0]
    out = {}
    for a in axes:
        v = row[a]
        v = v.item() if hasattr(v, "item") else v      # numpy → 파이썬 스칼라
        out[a] = int(v) if isinstance(v, float) and v.is_integer() and "window" in a else v
    return out
