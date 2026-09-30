"""실데이터 수집 경계 — 전략/백테스트와 분리된 곳.

⚠️ 분봉(1분) 무료 소스는 사실상 없다.
   - pykrx: '일봉'·거래대금·시가총액은 주지만 '분봉'은 제공하지 않는다.
   - 1분봉은 증권사 API(키움 OpenAPI/REST, 대신 크레온, 한국투자 REST 등)나
     유료 데이터 벤더에서 받아 loader 가 읽는 CSV 포맷으로 저장해야 한다.

여기서는 (a) pykrx 로 '일봉' CSV(정확한 전일 종가/거래대금)를 만드는 헬퍼와
(b) 분봉 CSV 템플릿 스펙만 제공한다. 실제 성과 검증은 실분봉을 넣은 뒤에만 가능.
"""
from __future__ import annotations
import os
import pandas as pd

MINUTE_CSV_SPEC = """\
# 분봉 CSV (1분봉) 필수 컬럼:
#   datetime,ticker,open,high,low,close,volume[,value][,name]
#   datetime: 'YYYY-MM-DD HH:MM:SS' (KST), 봉의 '시작시각' (09:00~15:30, 391개/일)
#   value(거래대금): 없으면 close*volume 로 근사됨
#   상장폐지 종목도 데이터에 넣으면 생존자 편향이 줄어든다.
"""


def fetch_daily_pykrx(tickers: list[str], start: str, end: str, out_file: str) -> str:
    """pykrx 로 일봉(close/volume/value) CSV 생성. pykrx 미설치 시 안내 후 예외.
    (분봉이 아니라 '전일 종가/거래대금' 정확도를 위한 보조 데이터다.)"""
    try:
        from pykrx import stock
    except ImportError as e:
        raise ImportError("pykrx 가 필요합니다:  pip install pykrx") from e

    rows = []
    for tk in tickers:
        df = stock.get_market_ohlcv(start, end, tk)   # 일봉
        if df is None or df.empty:
            continue
        df = df.reset_index()
        # 컬럼명은 한글(시가/고가/저가/종가/거래량/거래대금)로 온다
        col = {c: c for c in df.columns}
        for _, r in df.iterrows():
            rows.append({
                "date": pd.Timestamp(r[df.columns[0]]).strftime("%Y-%m-%d"),
                "ticker": tk,
                "close": float(r.get("종가", r.get("close", 0))),
                "volume": float(r.get("거래량", r.get("volume", 0))),
                "value": float(r.get("거래대금", r.get("value", 0))),
            })
    if not rows:
        raise RuntimeError("pykrx 에서 받은 데이터가 없습니다.")
    out = pd.DataFrame(rows)
    os.makedirs(os.path.dirname(out_file) or ".", exist_ok=True)
    out.to_csv(out_file, index=False, encoding="utf-8-sig")
    return out_file


def write_minute_template(path: str) -> str:
    """분봉 CSV 헤더 템플릿 파일을 남긴다(실데이터를 채워 넣는 안내용)."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(MINUTE_CSV_SPEC)
        f.write("datetime,ticker,name,open,high,low,close,volume,value\n")
    return path
