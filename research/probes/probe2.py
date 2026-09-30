import warnings; warnings.filterwarnings('ignore')
import FinanceDataReader as fdr, pandas as pd
pd.set_option('display.width',200)
print("=== ③ 상폐 목록 상세 ===")
d=fdr.StockListing('KRX-DELISTING')
print("컬럼:", list(d.columns))
print(d.head(3).to_string()[:700])
if 'DelistingDate' in d.columns or 'DelistingDate' in str(d.columns):
    pass
for c in d.columns:
    if '폐' in str(c) or 'eli' in str(c).lower() or 'ate' in str(c):
        print(f"  날짜후보 {c}: {d[c].dropna().head(3).tolist()}")
print("\n  SecuGroup 분포:", d['SecuGroup'].value_counts().head(8).to_dict() if 'SecuGroup' in d else '?')
print("\n=== ④ 관리종목 ===")
try:
    a=fdr.StockListing('KRX-ADMINISTRATIVE')
    print("  n=",len(a)," 컬럼:",list(a.columns)); print(" ",a.head(2).to_string()[:400])
except Exception as e: print("  FAIL",type(e).__name__,str(e)[:150])
print("\n=== ① 전종목 목록 컬럼 (우선주/스팩/리츠 판별 가능한가) ===")
k=fdr.StockListing('KRX')
print("  컬럼:", list(k.columns))
print(k.head(2).to_string()[:600])
for c in ['SecuGroup','Market','Sector','Industry','Name']:
    if c in k.columns: print(f"  {c} 예시:", k[c].dropna().unique()[:8].tolist())
print("\n=== 수정주가 확인 (삼성전자 2018-05 액면분할 50:1) ===")
s=fdr.DataReader('005930','2018-04-25','2018-05-10')
print(s.to_string())
print("\n=== 분봉 지원 여부 ===")
for how in ["DataReader with interval", "fdr.DataReader('005930', '2026-09-01', interval='1m')"]:
    pass
try:
    m=fdr.DataReader('005930','2026-09-01','2026-09-10', interval='1m'); print("  1m OK n=",len(m)); print(m.head(3))
except Exception as e: print("  1m FAIL:",type(e).__name__,str(e)[:180])
