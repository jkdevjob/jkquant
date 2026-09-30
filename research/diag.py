import json, glob, numpy as np
from config import tick_size
rows={}
for f in glob.glob('data/daily/*.json'):
    r=json.load(open(f)); o=r['ohlc']
    if len(o)<80: continue
    tv=np.array([b['c']*b['v']/1e8 for b in o])
    for i in range(61,len(o)):
        p,c=o[i-1],o[i]
        if p['halt'] or c['halt'] or c['o']<=0 or p['c']<10000: continue
        rows.setdefault(c['date'],[]).append(dict(
            prevTurn=tv[i-1], avgTurn=tv[i-61:i-1].mean(), prevChg=(p['c']/o[i-2]['c']-1)*100,
            gap=(c['o']/p['c']-1)*100, ret=(c['c']/c['o']-1)*100,
            cost=0.23+3*tick_size(c['o'],r['market'])/c['o']*100))
def basket(key,n=20):
    g=[];k=[];pc=[];gp=[]
    for d,u in rows.items():
        b=sorted(u,key=lambda x:-x[key])[:n]
        g.append(np.mean([x['ret'] for x in b])); k.append(np.mean([x['cost'] for x in b]))
        pc.append(np.mean([x['prevChg'] for x in b])); gp.append(np.mean([x['gap'] for x in b]))
    return np.mean(g),np.mean(k),np.mean(pc),np.mean(gp),len(g)
print("1만원 이상 종목, 날마다 상위 20개 바스켓 — 시가 매수 → 종가\n")
print(f"  {'고르는 기준':<24}{'장중(비용 전)':>13}{'비용':>8}{'그 종목들 전일 등락':>18}{'당일 갭':>9}")
for key,lab in [('prevTurn','전일 거래대금 상위'),('avgTurn','60일 평균 거래대금 상위')]:
    g,k,pc,gp,n=basket(key); print(f"  {lab:<24}{g:>+12.3f}%{k:>7.2f}%{pc:>+17.2f}%{gp:>+8.2f}%")
allr=[x['ret'] for u in rows.values() for x in u]; allc=[x['cost'] for u in rows.values() for x in u]
print(f"  {'전체 평균(1만원↑)':<24}{np.mean(allr):>+12.3f}%{np.mean(allc):>7.2f}%")
