"""데이터 로더 — 공급원(수집)과 전략을 분리하는 경계.

전략/백테스트 코드는 오직 MarketData 인터페이스만 본다. CSV든 pykrx든
공급원이 바뀌어도 여기만 고치면 된다.

CSV 포맷 (분봉, 1분):
    datetime,ticker,open,high,low,close,volume[,value]
    - datetime: 'YYYY-MM-DD HH:MM:SS' (KST), 봉의 '시작시각'
    - value(거래대금): 없으면 close*volume 으로 근사
(선택) 일봉 CSV:
    date,ticker,close,volume,value   # 정확한 전일 종가/거래대금 override

──── 룩어헤드 방지 원칙 ────
* 특정 날짜 d 의 매매 판단에는 d 이전 거래일(daily)만, 그리고 당일에는
  '이미 완료된 봉'만 쓴다. MarketData 는 데이터를 담기만 하고, '언제
  이용 가능한가'는 엔진이 봉 인덱스로 통제한다(engine.py 참조).
"""
from __future__ import annotations
import bisect
import glob
import os
from dataclasses import dataclass, field
import pandas as pd

REQUIRED_COLS = ["datetime", "ticker", "open", "high", "low", "close", "volume"]


@dataclass
class MarketData:
    # minute[ticker][date(str 'YYYY-MM-DD')] -> DataFrame(index=Timestamp, cols o/h/l/c/volume/value)
    minute: dict = field(default_factory=dict)
    # daily[ticker] -> DataFrame(index=date str, cols close/volume/value), 오름차순
    daily: dict = field(default_factory=dict)
    names: dict = field(default_factory=dict)   # ticker -> 표시명(없으면 ticker)
    # 아래는 __post_init__ 에서 만드는 조회 캐시(성능용). 룩어헤드에는 영향 없음.
    _min_dates: dict = field(default_factory=dict, repr=False)   # ticker -> 정렬된 date 리스트
    _fbvol: dict = field(default_factory=dict, repr=False)       # ticker -> [첫봉 거래량] (날짜순)
    _daily_dates: dict = field(default_factory=dict, repr=False) # ticker -> 정렬된 일봉 date 리스트

    def __post_init__(self):
        self.rebuild_cache()

    def rebuild_cache(self):
        self._min_dates, self._fbvol, self._daily_dates = {}, {}, {}
        for t, days in self.minute.items():
            ds = sorted(days.keys())
            self._min_dates[t] = ds
            vols = []
            for d in ds:
                bars = days[d]
                vols.append(float(bars.iloc[0]["volume"]) if bars is not None and len(bars) else float("nan"))
            self._fbvol[t] = vols
        for t, df in self.daily.items():
            self._daily_dates[t] = list(df.index)

    def tickers(self) -> list[str]:
        return sorted(self.minute.keys())

    def all_dates(self) -> list[str]:
        s = set()
        for t in self.minute:
            s.update(self.minute[t].keys())
        return sorted(s)

    def day_minutes(self, ticker: str, date: str):
        return self.minute.get(ticker, {}).get(date)

    def prev_daily_row(self, ticker: str, date: str):
        """date '직전' 거래일의 일봉 행(과거만, strictly < date). 없으면 None."""
        df = self.daily.get(ticker)
        dates = self._daily_dates.get(ticker)
        if df is None or not dates:
            return None
        pos = bisect.bisect_left(dates, date)   # 첫 >= date 위치 → pos-1 이 마지막 < date
        if pos == 0:
            return None
        return df.iloc[pos - 1]

    def prev_first_bar_volumes(self, ticker: str, date: str, lookback: int) -> list[float]:
        """date 이전 거래일들의 첫봉 거래량(최신 lookback개, 과거만). 캐시 기반 O(lookback)."""
        dates = self._min_dates.get(ticker)
        if not dates:
            return []
        pos = bisect.bisect_left(dates, date)   # 과거 = [0:pos)
        lo = max(0, pos - lookback)
        vols = self._fbvol[ticker][lo:pos]
        return [v for v in vols if v == v]      # NaN 제외


def _prep_minute_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["datetime"] = pd.to_datetime(df["datetime"])
    if "value" not in df.columns:
        df["value"] = df["close"] * df["volume"]
    df = df.sort_values("datetime").set_index("datetime")
    return df[["open", "high", "low", "close", "volume", "value"]]


def _build_daily_from_minute(minute: dict) -> dict:
    """분봉에서 일봉(종가=마지막봉 종가, 거래량/거래대금=합)을 유도.
    실제 종가는 종가단일가로 약간 다를 수 있음 — daily_file 로 override 가능."""
    daily = {}
    for ticker, days in minute.items():
        rows = []
        for date in sorted(days):
            bars = days[date]
            if bars is None or not len(bars):
                continue
            rows.append({
                "date": date,
                "close": float(bars.iloc[-1]["close"]),
                "volume": float(bars["volume"].sum()),
                "value": float(bars["value"].sum()),
            })
        if rows:
            daily[ticker] = pd.DataFrame(rows).set_index("date").sort_index()
    return daily


def load_from_csv(minute_dir: str, minute_glob: str = "*.csv",
                  daily_file: str | None = None, base_dir: str = ".") -> MarketData:
    minute_dir = os.path.join(base_dir, minute_dir)
    files = sorted(glob.glob(os.path.join(minute_dir, minute_glob)))
    if not files:
        raise FileNotFoundError(f"분봉 CSV 없음: {os.path.join(minute_dir, minute_glob)}")

    frames = []
    for fp in files:
        df = pd.read_csv(fp, dtype={"ticker": str})
        missing = [c for c in REQUIRED_COLS if c not in df.columns]
        if missing:
            raise ValueError(f"{fp}: 필수 컬럼 누락 {missing}")
        frames.append(df)
    raw = pd.concat(frames, ignore_index=True)

    minute: dict = {}
    names: dict = {}
    if "name" in raw.columns:
        for t, n in raw.dropna(subset=["name"]).groupby("ticker")["name"].first().items():
            names[str(t)] = str(n)

    raw["ticker"] = raw["ticker"].astype(str)
    for ticker, g in raw.groupby("ticker"):
        g = _prep_minute_df(g)
        by_date: dict = {}
        for date, day in g.groupby(g.index.normalize()):
            by_date[date.strftime("%Y-%m-%d")] = day
        minute[ticker] = by_date

    if daily_file:
        dpath = os.path.join(base_dir, daily_file)
        d = pd.read_csv(dpath, dtype={"ticker": str})
        d["ticker"] = d["ticker"].astype(str)
        if "value" not in d.columns:
            d["value"] = d["close"] * d["volume"]
        daily = {}
        for ticker, g in d.groupby("ticker"):
            g = g.copy()
            g["date"] = pd.to_datetime(g["date"]).dt.strftime("%Y-%m-%d")
            daily[ticker] = g.set_index("date")[["close", "volume", "value"]].sort_index()
    else:
        daily = _build_daily_from_minute(minute)

    return MarketData(minute=minute, daily=daily, names=names)
