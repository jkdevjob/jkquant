"""리포트 오케스트레이션 — 로드→품질검사→백테스트→저장→그래프→기간별 요약."""
from __future__ import annotations
import os
import pandas as pd

from data_io import loader, quality
from backtest.engine import BacktestEngine
from backtest import metrics as M


def load_market(cfg, base_dir="."):
    d = cfg["data"]
    return loader.load_from_csv(d["minute_dir"], d["minute_glob"], d["daily_file"], base_dir=base_dir)


def save_outputs(res, cfg, base_dir="."):
    out = os.path.join(base_dir, cfg["output"]["reports_dir"])
    os.makedirs(out, exist_ok=True)
    tdf = pd.DataFrame([t.as_row() for t in res.trades])
    ddf = pd.DataFrame(res.daily)
    tpath = os.path.join(out, cfg["output"]["trades_csv"])
    dpath = os.path.join(out, cfg["output"]["daily_csv"])
    mpath = os.path.join(out, cfg["output"]["metrics_csv"])
    tdf.to_csv(tpath, index=False, encoding="utf-8-sig")
    ddf.to_csv(dpath, index=False, encoding="utf-8-sig")
    pd.DataFrame([res.metrics]).to_csv(mpath, index=False, encoding="utf-8-sig")
    return {"trades": tpath, "daily": dpath, "metrics": mpath}


def period_breakdown(market, cfg, base_dir="."):
    """전체/1·3·5·10년 및 연도별 성과를 각각 재백테스트로 계산."""
    all_dates = market.all_dates()
    if not all_dates:
        return {}
    last = pd.Timestamp(all_dates[-1])
    out = {}
    windows = {"전체": None, "1년": 1, "3년": 3, "5년": 5, "10년": 10}
    for label, yrs in windows.items():
        start = None if yrs is None else (last - pd.DateOffset(years=yrs)).strftime("%Y-%m-%d")
        res = BacktestEngine(cfg, market).run(start=start, label=label)
        if res.metrics["total_trades"] > 0 or label == "전체":
            out[label] = res.metrics
    # 연도별
    years = sorted({d[:4] for d in all_dates})
    for y in years:
        res = BacktestEngine(cfg, market).run(start=f"{y}-01-01", end=f"{y}-12-31", label=y)
        if res.metrics["total_trades"] > 0:
            out[y] = res.metrics
    return out


def run_report(cfg, base_dir=".", make_plots=True):
    market = load_market(cfg, base_dir)
    quality.print_report(market)
    res = BacktestEngine(cfg, market).run()
    print("\n" + M.format_report(res.metrics))
    paths = save_outputs(res, cfg, base_dir)
    print(f"\nCSV 저장: {paths['trades']} / {paths['daily']} / {paths['metrics']}")

    if make_plots:
        from reporting import plots
        pngs = plots.generate_all(res.trades, res.daily,
                                  os.path.join(base_dir, cfg["output"]["reports_dir"]),
                                  cfg["capital"]["initial_capital"])
        print(f"그래프 {len(pngs)}개 저장: {os.path.dirname(pngs[0]) if pngs else '-'}")

    # 기간별
    print("\n" + "=" * 46)
    print("기간별 성과 (CAGR / MDD / PF / 승률 / 거래수 / 총수익률)")
    print("=" * 46)
    pb = period_breakdown(market, cfg, base_dir)
    for label, m in pb.items():
        pf = "inf" if m["profit_factor"] == float("inf") else m["profit_factor"]
        print(f"  {label:<6} CAGR {m['cagr_pct']:>7}%  MDD {m['mdd_pct']:>7}%  "
              f"PF {str(pf):>6}  승률 {m['win_rate']:>5}%  "
              f"거래 {m['total_trades']:>4}  총 {m['total_return_pct']:>7}%")
    # 기간별 요약 저장
    out = os.path.join(base_dir, cfg["output"]["reports_dir"])
    pd.DataFrame([{"period": k, **v} for k, v in pb.items()]).to_csv(
        os.path.join(out, "period_breakdown.csv"), index=False, encoding="utf-8-sig")
    return res, pb
