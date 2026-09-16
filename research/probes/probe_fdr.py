import warnings, time
warnings.filterwarnings('ignore')
import FinanceDataReader as fdr
def t(label, fn):
    t0=time.time()
    try:
        r=fn(); n=len(r) if hasattr(r,'__len__') else '?'
        head=str(r.head(2))[:260].replace('\n',' | ') if hasattr(r,'head') else str(r)[:260]
        print(f"[OK  ] {label}  n={n} ({time.time()-t0:.1f}s)\n        {head}")
    except Exception as e:
        print(f"[FAIL] {label}  {type(e).__name__}: {str(e)[:170]}")
print("=== FinanceDataReader 0.9.202 ===\n")
t("① KRX 전종목 목록", lambda: fdr.StockListing('KRX'))
t("② KOSPI 목록", lambda: fdr.StockListing('KOSPI'))
t("③ 상장폐지 목록 KRX-DELISTING", lambda: fdr.StockListing('KRX-DELISTING'))
t("④ 관리종목 KRX-ADMINISTRATIVE", lambda: fdr.StockListing('KRX-ADMINISTRATIVE'))
t("⑤ 일봉 삼성전자 2018~", lambda: fdr.DataReader('005930','2018-01-01','2026-09-10'))
t("⑥ 일봉 상폐종목(예: 쌍용차 003620)", lambda: fdr.DataReader('003620','2018-01-01','2022-12-31'))
t("⑦ KOSPI 지수", lambda: fdr.DataReader('KS11','2018-01-01','2026-09-10'))
