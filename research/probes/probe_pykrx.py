import warnings, traceback, time
warnings.filterwarnings('ignore')
from pykrx import stock
def t(label, fn):
    t0=time.time()
    try:
        r=fn()
        n = len(r) if hasattr(r,'__len__') else '?'
        head = ''
        try:
            head = str(r.head(2))[:220].replace('\n',' | ') if hasattr(r,'head') else str(r[:5])[:220]
        except Exception: head=str(r)[:200]
        print(f"[OK  ] {label}  n={n}  ({time.time()-t0:.1f}s)\n        {head}")
    except Exception as e:
        print(f"[FAIL] {label}  {type(e).__name__}: {str(e)[:160]}")
print("=== pykrx 1.2.8 · 인증 없이 되는 것 ===\n")
t("① 오늘 상장종목(KOSPI)", lambda: stock.get_market_ticker_list("20260911", market="KOSPI"))
t("② 과거 시점 상장종목(2019-01-02 KOSPI)", lambda: stock.get_market_ticker_list("20190102", market="KOSPI"))
t("③ 과거 시점 상장종목(2019-01-02 KOSDAQ)", lambda: stock.get_market_ticker_list("20190102", market="KOSDAQ"))
t("④ 일봉 OHLCV (삼성전자 2024)", lambda: stock.get_market_ohlcv("20240102","20240131","005930"))
t("⑤ 전종목 일봉 (특정일)", lambda: stock.get_market_ohlcv("20240102", market="ALL"))
t("⑥ 시가총액", lambda: stock.get_market_cap("20240102","20240131","005930"))
t("⑦ 수정주가 여부 확인 (adjusted 인자)", lambda: stock.get_market_ohlcv("20200101","20200201","005930", adjusted=True))
t("⑧ 투자자별 거래실적", lambda: stock.get_market_trading_value_by_date("20240102","20240131","005930"))
t("⑨ 관리종목/투자주의 (get_market_ticker_name)", lambda: stock.get_market_ticker_name("005930"))
