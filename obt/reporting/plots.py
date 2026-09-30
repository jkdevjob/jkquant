"""성과 그래프 10종 → PNG 저장.

한글 폰트가 환경에 없으면 네모(tofu)가 뜨므로 제목은 영문으로 둔다.
(한글 의미는 각 항목 주석 참조. Nanum/Noto CJK KR 등이 설치돼 있으면 자동 사용.)
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update({"figure.autolayout": True, "axes.grid": True, "grid.alpha": 0.3})


def _try_korean_font():
    import matplotlib.font_manager as fm
    for key in ("nanum", "noto sans cjk kr", "noto sans kr", "malgun", "applegothic", "gulim"):
        for f in fm.fontManager.ttflist:
            if key in f.name.lower():
                plt.rcParams["font.family"] = f.name
                plt.rcParams["axes.unicode_minus"] = False
                return True
    return False


_HAS_KR = _try_korean_font()


def _save(fig, out_dir, name):
    path = os.path.join(out_dir, name)
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def generate_all(trades: list, daily: list, out_dir: str, initial_capital: float) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    tdf = pd.DataFrame([t.as_row() for t in trades]) if trades else pd.DataFrame()
    ddf = pd.DataFrame(daily) if daily else pd.DataFrame()
    if not ddf.empty:
        ddf["date"] = pd.to_datetime(ddf["date"])
        ddf = ddf.sort_values("date").reset_index(drop=True)

    if not ddf.empty:
        # 1. 자산곡선
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.plot(ddf["date"], ddf["ending_capital"], color="#2d7dd2")
        ax.set_title("1. Equity Curve")
        ax.set_ylabel("Equity (KRW)")
        paths.append(_save(fig, out_dir, "01_equity_curve.png"))

        # 2. 누적 수익률
        fig, ax = plt.subplots(figsize=(9, 4))
        cum = (ddf["ending_capital"] / initial_capital - 1) * 100
        ax.plot(ddf["date"], cum, color="#20a17a")
        ax.set_title("2. Cumulative Return %")
        ax.set_ylabel("%")
        paths.append(_save(fig, out_dir, "02_cumulative_return.png"))

        # 3. Drawdown
        eq = ddf["ending_capital"]
        dd = (eq / eq.cummax() - 1) * 100
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.fill_between(ddf["date"], dd, 0, color="#e15554", alpha=0.6)
        ax.set_title("3. Drawdown %")
        ax.set_ylabel("%")
        paths.append(_save(fig, out_dir, "03_drawdown.png"))

        # 4. 월별 수익률 / 5. 연도별 수익률 (일수익률 복리)
        r = ddf.set_index("date")["daily_return"]
        monthly = (r.add(1).groupby([r.index.year, r.index.month]).prod() - 1) * 100
        if len(monthly):
            fig, ax = plt.subplots(figsize=(9, 4))
            labels = [f"{y}-{m:02d}" for (y, m) in monthly.index]
            ax.bar(range(len(monthly)), monthly.values,
                   color=["#20a17a" if v >= 0 else "#e15554" for v in monthly.values])
            step = max(1, len(labels) // 12)
            ax.set_xticks(range(0, len(labels), step))
            ax.set_xticklabels(labels[::step], rotation=45, ha="right", fontsize=7)
            ax.set_title("4. Monthly Return %")
            paths.append(_save(fig, out_dir, "04_monthly_return.png"))

        yearly = (r.add(1).groupby(r.index.year).prod() - 1) * 100
        if len(yearly):
            fig, ax = plt.subplots(figsize=(8, 4))
            ax.bar([str(y) for y in yearly.index], yearly.values,
                   color=["#20a17a" if v >= 0 else "#e15554" for v in yearly.values])
            ax.set_title("5. Yearly Return %")
            paths.append(_save(fig, out_dir, "05_yearly_return.png"))

    if not tdf.empty:
        # 6. 승/패 분포
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.hist(tdf["net_return"] * 100, bins=30, color="#2d7dd2", alpha=0.8)
        ax.axvline(0, color="#333", lw=1)
        ax.set_title("6. Trade Return Distribution %")
        ax.set_xlabel("net return %")
        paths.append(_save(fig, out_dir, "06_return_distribution.png"))

        # 7. 시간대별 수익률
        tdf["entry_hm"] = tdf["entry_time"].str.slice(0, 5)
        by_time = tdf.groupby("entry_hm")["net_return"].mean() * 100
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.bar(by_time.index, by_time.values,
               color=["#20a17a" if v >= 0 else "#e15554" for v in by_time.values])
        ax.set_title("7. Return by Entry Time %")
        ax.tick_params(axis="x", rotation=45, labelsize=7)
        paths.append(_save(fig, out_dir, "07_return_by_time.png"))

        # 8. 종목별 수익률(누적 손익)
        by_tk = tdf.groupby("ticker")["profit_loss"].sum().sort_values()
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.barh([str(x) for x in by_tk.index], by_tk.values,
                color=["#20a17a" if v >= 0 else "#e15554" for v in by_tk.values])
        ax.set_title("8. PnL by Ticker (KRW)")
        paths.append(_save(fig, out_dir, "08_pnl_by_ticker.png"))

        # 9. 갭률별 수익률
        bins = [-100, 0, 1, 2, 3, 4, 5, 7, 10, 15, 100]
        tdf["gap_bucket"] = pd.cut(tdf["gap_rate"], bins=bins)
        by_gap = tdf.groupby("gap_bucket", observed=True)["net_return"].mean() * 100
        fig, ax = plt.subplots(figsize=(9, 4))
        ax.bar([str(x) for x in by_gap.index], by_gap.values,
               color=["#20a17a" if v >= 0 else "#e15554" for v in by_gap.values])
        ax.set_title("9. Return by Gap Bucket %")
        ax.tick_params(axis="x", rotation=45, labelsize=7)
        paths.append(_save(fig, out_dir, "09_return_by_gap.png"))

        # 10. 손절/익절 비율(청산 사유)
        reasons = tdf["exit_reason"].value_counts()
        fig, ax = plt.subplots(figsize=(6, 5))
        ax.pie(reasons.values, labels=reasons.index, autopct="%1.0f%%",
               colors=["#20a17a", "#e15554", "#f5a623", "#2d7dd2"][:len(reasons)])
        ax.set_title("10. Exit Reason Ratio")
        paths.append(_save(fig, out_dir, "10_exit_reasons.png"))

    return paths
