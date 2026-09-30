"""합성(SYNTHETIC) 샘플 1분봉 생성기.

⚠️ 여기서 만든 데이터는 난수로 생성한 가짜 데이터다. 기능·테스트 검증용일 뿐
   '실제 성과'가 아니다. 실제 판단은 반드시 실데이터(pykrx/증권사/CSV)로 해야 한다.

기하 브라운 운동 + 일간 갭으로 09:00~15:30 1분봉을 만든다. 일부 종목·일자에
2~15% 갭을 섞어 전략이 후보를 잡을 수 있게 한다(전략이 '동작'하는지 보기 위함).
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

SESSION_MINUTES = 391  # 09:00~15:30 (1분봉, 09:00 포함 15:30 포함 = 391개)


def _one_day(rng, prev_close, date, drift_bias=0.0):
    # 일간 갭 (가끔 크게)
    if rng.random() < 0.35:
        gap = rng.uniform(0.02, 0.15)          # 갭상승 후보용
    else:
        gap = rng.normal(0.0, 0.01)
    open_px = max(1.0, prev_close * (1 + gap))
    # 분당 로그수익률
    mu = drift_bias / SESSION_MINUTES
    sigma = 0.0015
    rets = rng.normal(mu, sigma, SESSION_MINUTES)
    price = open_px * np.exp(np.cumsum(rets))
    price[0] = open_px
    ts = pd.date_range(f"{date} 09:00:00", periods=SESSION_MINUTES, freq="1min")
    o = price.copy()
    o[1:] = price[:-1]                          # 각 봉 시가 = 직전 봉 종가(연속)
    o[0] = open_px
    c = price
    hi = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.0008, SESSION_MINUTES)))
    lo = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.0008, SESSION_MINUTES)))
    base_vol = rng.integers(2000, 20000)
    vol = (base_vol * (1 + np.abs(rng.normal(0, 1.2, SESSION_MINUTES)))).astype(int)
    vol[0] = int(vol[0] * rng.uniform(2.0, 6.0))   # 첫 봉 거래량 급증(시초가 특성)
    df = pd.DataFrame({
        "datetime": ts,
        "open": np.round(o, 0), "high": np.round(hi, 0),
        "low": np.round(lo, 0), "close": np.round(c, 0),
        "volume": vol,
    })
    df["value"] = df["close"] * df["volume"]
    return df, float(c[-1])


def generate(out_dir: str, tickers=None, start="2019-01-02", days=260 * 3, seed=7):
    """days 거래일치 합성 분봉을 종목별 CSV로 저장. 반환: 파일 경로 목록."""
    os.makedirs(out_dir, exist_ok=True)
    if tickers is None:
        tickers = {"005930": "샘플전자", "000660": "샘플반도체",
                   "035720": "샘플카카", "247540": "샘플에코", "091990": "샘플셀"}
    bdays = pd.bdate_range(start=start, periods=days).strftime("%Y-%m-%d")
    paths = []
    for i, (tk, nm) in enumerate(tickers.items()):
        rng = np.random.default_rng(seed + i)
        prev_close = float(rng.integers(8000, 80000))
        drift = rng.uniform(-0.02, 0.05)       # 종목마다 다른 장기 추세
        parts = []
        for d in bdays:
            day_df, prev_close = _one_day(rng, prev_close, d, drift_bias=drift)
            day_df.insert(1, "ticker", tk)
            day_df.insert(2, "name", nm)
            parts.append(day_df)
        alldf = pd.concat(parts, ignore_index=True)
        fp = os.path.join(out_dir, f"{tk}.csv")
        alldf.to_csv(fp, index=False)
        paths.append(fp)
    return paths
