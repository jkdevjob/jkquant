"""전체 유니버스 일봉 수집 — 상폐 종목 포함(생존편향 제거).
FDR 일봉은 수정주가. OHLC=0 행(거래정지)은 플래그만 달고 남긴다(거르는 건 엔진에서)."""
import warnings, json, time, os, sys, re, threading, queue
warnings.filterwarnings('ignore')
import FinanceDataReader as fdr, pandas as pd

START, END = '2018-06-01', '2026-09-15'
OUT = 'data/daily'
os.makedirs(OUT, exist_ok=True)

def is_common(name: str) -> bool:
    """보통주만. 우선주·스팩·리츠·펀드성 제외."""
    n = str(name)
    if re.search(r'(우|우B|\dうB)$', n): return False
    if re.search(r'\d+우B?$', n): return False
    if n.endswith('우'): return False
    for bad in ('스팩', '리츠', '홀딩스스팩'):
        if bad in n: return False
    if re.search(r'제\d+호', n): return False
    return True

# ── 유니버스: 현재 상장 + 2018-06 이후 상폐 ────────────────────────────
live = fdr.StockListing('KRX')
live = live[~live.Market.isin(['KONEX'])]
live = live[live.Name.map(is_common)]
live_rows = [{'code': r.Code, 'name': r.Name, 'market': r.Market, 'delisted': None}
             for r in live.itertuples()]

dl = fdr.StockListing('KRX-DELISTING')
dl = dl[dl.SecuGroup == '주권'].copy()
dl['DelistingDate'] = pd.to_datetime(dl.DelistingDate, errors='coerce')
dl = dl[dl.DelistingDate >= START]
dl = dl[~dl.Market.isin(['KONEX'])]
dl = dl[dl.Name.map(is_common)]
dead_rows = [{'code': r.Symbol, 'name': r.Name, 'market': r.Market,
              'delisted': r.DelistingDate.strftime('%Y-%m-%d')} for r in dl.itertuples()]

seen, uni = set(), []
for r in live_rows + dead_rows:
    if r['code'] in seen: continue
    seen.add(r['code']); uni.append(r)
json.dump(uni, open('data/universe.json', 'w'), ensure_ascii=False)
print(f"유니버스 {len(uni)}종목 (현재상장 {len(live_rows)} + 상폐 {len(dead_rows)})", flush=True)

done_file = 'data/done.txt'
done = set(open(done_file).read().split()) if os.path.exists(done_file) else set()
todo = [u for u in uni if u['code'] not in done]
print(f"남은 {len(todo)}종목", flush=True)

q = queue.Queue()
for u in todo: q.put(u)
lock = threading.Lock()
cnt = {'ok': 0, 'empty': 0, 'fail': 0}
t0 = time.time()

def worker():
    while True:
        try: u = q.get_nowait()
        except queue.Empty: return
        code = u['code']
        try:
            df = fdr.DataReader(code, START, END)
            if df is None or len(df) < 60:
                with lock: cnt['empty'] += 1
            else:
                df = df.reset_index()
                df['halt'] = ((df.Open == 0) | (df.Volume == 0)).astype(int)
                rec = {'code': code, 'name': u['name'], 'market': u['market'],
                       'delisted': u['delisted'],
                       'ohlc': [{'date': str(r.Date)[:10], 'o': int(r.Open), 'h': int(r.High),
                                 'l': int(r.Low), 'c': int(r.Close), 'v': int(r.Volume),
                                 'halt': int(r.halt)} for r in df.itertuples()]}
                json.dump(rec, open(f'{OUT}/{code}.json', 'w'))
                with lock: cnt['ok'] += 1
        except Exception:
            with lock: cnt['fail'] += 1
        with lock:
            open(done_file, 'a').write(code + '\n')
            n = cnt['ok'] + cnt['empty'] + cnt['fail']
            if n % 50 == 0:
                el = time.time() - t0
                rate = n / max(el, 1)
                eta = (len(todo) - n) / max(rate, 1e-9) / 60
                print(f"  {n}/{len(todo)}  ok={cnt['ok']} empty={cnt['empty']} fail={cnt['fail']}"
                      f"  {rate:.1f}종목/s  남은 {eta:.0f}분", flush=True)

ths = [threading.Thread(target=worker, daemon=True) for _ in range(6)]
[t.start() for t in ths]; [t.join() for t in ths]
print(f"완료 ok={cnt['ok']} empty={cnt['empty']} fail={cnt['fail']}  {(time.time()-t0)/60:.1f}분", flush=True)
