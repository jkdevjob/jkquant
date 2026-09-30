import json, time, urllib.request
out=[]; to=None
for i in range(140):                                   # 200봉 × 140 ≈ 3.2년
    url="https://api.upbit.com/v1/candles/minutes/60?market=KRW-BTC&count=200"+("&to="+to if to else "")
    for t in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r: j=json.load(r); break
        except Exception: time.sleep(1.5*(t+1))
    else: break
    if not j: break
    out+=j; to=j[-1]['candle_date_time_utc']+"Z"; time.sleep(0.15)
out={x['candle_date_time_kst']:x for x in out}
bars=sorted(({'t':k,'o':v['opening_price'],'h':v['high_price'],'l':v['low_price'],'c':v['trade_price']} for k,v in out.items()), key=lambda x:x['t'])
json.dump(bars,open('data/btc_1h.json','w')); print(len(bars), bars[0]['t'], '~', bars[-1]['t'])
