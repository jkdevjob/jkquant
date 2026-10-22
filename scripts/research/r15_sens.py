"""R15 민감도(판정에 쓰지 않음): 슬리피지 0틱 · 고가주(종가 ≥ 1만 원)만.
사용: r15_closebet.py 를 먼저 돌려 JKQ_GAPDOWN_CACHE 에 by.pickle 을 만든 뒤 JKQ_GAPDOWN_CACHE=<캐시> python3 r15_sens.py"""
import json
import os
import pickle
import statistics
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backtest_opening_gapdown as g
import importlib.util
spec = importlib.util.spec_from_file_location("r15", str(Path(__file__).with_name("r15_closebet.py")))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
by, final_last = pickle.loads((Path(os.environ["JKQ_GAPDOWN_CACHE"]) / "by.pickle").read_bytes())
out = {}
for ticks in (0.0, 1.5):
    r.SLIP_TICKS = ticks
    cands = r.candidates(by, g)
    for label, extra in (("all", {}), ("price>=10000", {"minPrice": 10000})):
        for H in (r.H1, r.H2):
            c2 = {d: [x for x in v if x["close"] >= extra.get("minPrice", 0)] for d, v in cands.items()}
            daily, trades = r.run(c2, H)
            t = r.summary(daily, r.TEST_START); d = r.summary(daily, "0000", r.DESIGN_END)
            key = f"{H['name']} · {label} · {ticks}틱"
            out[key] = dict(design=(d.get("days"), round(d.get("meanPct", 0), 3), round(d.get("t") or 0, 2)),
                            test=(t.get("days"), round(t.get("meanPct", 0), 3), round(t.get("t") or 0, 2), round(t.get("mddPct", 0), 1)),
                            gross=round(statistics.fmean(x["gross"] for x in trades), 3) if trades else None,
                            years={y: round(v["meanPct"], 3) for y, v in r.years({k: x for k, x in daily.items() if k >= r.TEST_START}).items()})
            print(key, json.dumps(out[key], ensure_ascii=False))
Path("r15_sens.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
