"""Mutations for D-1 opening_gapdown_v1 (Python research + JS live path) and D-3 btc_dip24_v1.
Each mutant must make test_opening_gapdown.py or test_opening_gapdown.mjs fail. Working files are not edited."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
API = ROOT.parent / "functions" / "api"
PY = [
    ("prev-day RSI (watch)", "backtest_opening_gapdown.py", 'if rsi[i - 1] < PARAMS["rsiMax"]:', 'if rsi[i] < PARAMS["rsiMax"]:'),
    ("prev-day RSI (signal)", "backtest_opening_gapdown.py", "gapPct=gap, rsiPrev=rsi[i - 1]", "gapPct=gap, rsiPrev=rsi[i]"),
    ("gap threshold", "backtest_opening_gapdown.py", 'if gap > PARAMS["gapMax"] or gap <= PARAMS["gapFloor"]:', 'if gap > 0 or gap <= PARAMS["gapFloor"]:'),
    ("limit-down floor", "backtest_opening_gapdown.py", 'if gap > PARAMS["gapMax"] or gap <= PARAMS["gapFloor"]:', 'if gap > PARAMS["gapMax"]:'),
    ("adjusted chain", "backtest_opening_gapdown.py", "r = chg / base_px if base_px > 0 else 0.0", "r = c / rows[i - 1][4] - 1"),
    ("risk dept", "backtest_opening_gapdown.py", 'return any(k in dept for k in ("관리종목", "투자주의환기", "정리매매"))', "return False"),
    ("halt lookback", "backtest_opening_gapdown.py", "if any(rows[j][7] <= 0 for j in", "if False and any(rows[j][7] <= 0 for j in"),
    ("no-limit lookback", "backtest_opening_gapdown.py", "if any(abs(ret[j]) > 0.305 for j in", "if False and any(abs(ret[j]) > 0.305 for j in"),
    ("tick cost", "backtest_opening_gapdown.py", "return PARAMS[\"fixedCostPct\"] + 2 * ticks * tick(price) / price * 100", "return PARAMS[\"fixedCostPct\"]"),
    ("provisional pricing", "backtest_opening_gapdown.py", "if r[0] <= final_last:", "if True:"),
    ("sell slip sign", "backtest_opening_gapdown.py", "sellSlipPct=(-pct(sf, c) if sf and c else None)", "sellSlipPct=(pct(sf, c) if sf and c else None)"),
    ("dip threshold", "backtest_crypto_orb.py", 'if chg > DIP24["dropPct"]:', 'if chg > -4.0:'),
    ("dip overlap", "backtest_crypto_orb.py", "        busy_until = fut[-1] + one\n", "\n"),
    ("dip lookahead", "backtest_crypto_orb.py", 'chg = (hb[h - one]["c"] / hb[h - one * (lb + 1)]["c"] - 1) * 100', 'chg = (hb[h]["c"] / hb[h - one * lb]["c"] - 1) * 100'),
    ("dip contiguity", "backtest_crypto_orb.py", "        if not all(x in hb for x in need):\n", "        if False:\n"),
    ("etf threshold", "backtest_etf_overnight.py", 'if abs(chg) > 35 or chg > RULE["dropMaxPct"]:', 'if abs(chg) > 35 or chg > -2.0:'),
    ("etf exit next open", "backtest_etf_overnight.py", "gross = (nxt[1] / cur[2] - 1) * 100", "gross = (nxt[2] / cur[2] - 1) * 100"),
    ("portfolio double count", "backtest_etf_overnight.py", "out[d] = (a[d] + b[d]) / 2", "out[d] = a[d] + b[d]"),
    ("no-trade days dropped", "claude_lab.py", "    for d in cal:\n        x = daily.get(d, 0.0)", "    for d in [c for c in cal if c in daily]:\n        x = daily[d]"),
    ("btc trend lookahead", "claude_lab.py", "ma = sum(S[i - n:i]) / n", "ma = sum(S[i - n + 1:i + 1]) / n"),
    ("btc trend signal day", "claude_lab.py", "hold = 1 if S[i - 1] > ma else 0", "hold = 1 if S[i] > ma else 0"),
    ("trend stop", "claude_lab.py", 'if (L[i] / ref - 1) * 100 <= -p["stopPct"]:', 'if False:'),
    ("trend sizing", "claude_lab.py", 'dv[D[i]] = ((C[i] / ref - 1) * 100 - cost) * p["size"]', 'dv[D[i]] = ((C[i] / ref - 1) * 100 - cost)'),
    ("basket averages active only", "claude_lab.py", "            out[d] = sum(v) / n", "            out[d] = sum(v) / len(v)"),
    ("board no-trade as zero", "claude_lab.py", 'return series[d] if d in series else "no_trade"', "return series.get(d, 0.0)"),
    ("us not shifted to kst", "claude_lab.py", "(date.fromisoformat(d) + timedelta(days=1)).isoformat(): v", "d: v"),
    ("account weight", "claude_lab.py", '+ a["usWeight"] * a["usSize"] * us_k.get(d, 0.0)', '+ us_k.get(d, 0.0)'),
    ("paper overwrite", "claude_lab.py", "    if path.exists():\n        return False\n", "\n"),
    ("drift too early", "claude_lab.py", "if n < 20 or not exp", "if n < 1 or not exp"),
    ("gpt same window", "claude_lab.py", "window = [d for d in cal if start and d >= start]", "window = list(cal)"),
    ("promotion too early", "claude_lab.py", "    if n < PROMOTE_MIN_TRADE_DAYS:\n", "    if n < 1:\n"),
    ("promotion ignores mdd", "claude_lab.py", "and s_mdd >= o_mdd - 5:", ":"),
    ("week kr overlap not split", "claude_lab.py", '"opening_d1v2": lambda d: a["krWeight"] * (0.5 if d in both else 1.0),', '"opening_d1v2": lambda d: a["krWeight"],'),
    ("coin level lookahead", "claude_lab.py", 'level = Dd[pd][1] if p["level"] == "prevhigh"', 'level = Dd[d][1] if p["level"] == "prevhigh"'),
    ("coin trend lookahead", "claude_lab.py", "        trend = C[i - 1] > ma\n", "        trend = C[i] > ma\n"),
    ("coin stop removed", "claude_lab.py", "if any(x[2] <= stop for x in bars[k:]):", "if False:"),
    ("soxl buy signal off", "claude_lab.py", "        elif r2 < p[\"rsiMax\"] and C[i] > ma:\n            pending = \"buy\"", "        elif r2 < p[\"rsiMax\"] and C[i] > ma and False:\n            pending = \"buy\""),
    ("soxl max hold ignored", "claude_lab.py", 'if C[i] > C[i - 1] or pos["days"] >= p["maxHoldDays"]:', 'if C[i] > C[i - 1]:'),
    ("ledger pending as no-trade", "claude_lab.py", 'for d in kr_days if d > final_kr and d >= st("opening_d1v2") and d1_live_status(d) == "no_trade"]', 'for d in kr_days if d > final_kr and d >= st("opening_d1v2")]'),
    ("account ignores kr settle", "claude_lab.py", "    ends = [kr_settled_through(final_kr, etf_to, kr_days, st(\"account\")),", "    ends = [\"9999\","),
    ("fair gpt cost differs", "claude_lab.py", "gpt=_side_summary(days, gby, cost), days=rows)", "gpt=_side_summary(days, gby, cost - 0.14), days=rows)"),
    ("fair window not gpt", "claude_lab.py", "    days = [d for d in cal if start <= d <= min(end, c_last)]\n", "    days = [d for d in cal if d <= min(end, c_last)]\n"),
    ("fair coin slot ignored", "claude_lab.py", "    if all(s is not None for _, s in nets):", "    if False:"),
    ("us open bar kept", "claude_lab.py", "    return {d: v for d, v in bars.items() if d < today or (d == today and closed)}", "    return dict(bars)"),
    ("dip hit minutes", "backtest_crypto_orb.py", "int((hit - entry_t).total_seconds() // 60) + 5", "int((hit - entry_t).total_seconds() // 60)"),
]
JS = [
    ("base price first", "_gapdown.js", "const base=+(q&&q.basePrice)>0?+q.basePrice:+prevClose||0;", "const base=+prevClose||0;"),
    ("gap floor", "_gapdown.js", "r.expectedGapPct<=gapMax&&r.expectedGapPct>gapFloor", "r.expectedGapPct<=gapMax"),
    ("deepest first", "_gapdown.js", ".sort((a,b)=>a.expectedGapPct-b.expectedGapPct||", ".sort((a,b)=>b.expectedGapPct-a.expectedGapPct||"),
    ("stale watchlist", "_gapdown.js", 'if(based<prevWeekday(today))return {ok:false,reason:"watchlist_stale"};', ""),
    ("buy deadline", "opening-gapdown.js", 'if(stage==="preopen")return hms>=85000&&hms<ORDER_DEADLINE;', 'if(stage==="preopen")return hms>=85000&&hms<93000;'),
    ("close window", "opening-gapdown.js", 'if(stage==="close")return hms>=152000&&hms<152800;', 'if(stage==="close")return hms>=150000&&hms<152800;'),
    ("fill split", "opening-gapdown.js", 'buy:agg(fills("02",83000,90000))', 'buy:agg(fills("02",83000,240000))'),
    ("etf drop sign", "opening-gapdown.js", "if(dropPct>ETF_RULE.dropMaxPct)return", "if(dropPct<ETF_RULE.dropMaxPct)return"),
    ("etf buy window", "opening-gapdown.js", 'if(stage==="etf_buy")return hms>=152000&&hms<152800;', 'if(stage==="etf_buy")return hms>=150000&&hms<152800;'),
    ("etf fill split", "opening-gapdown.js", 'return {closeBuy:agg(f("02",151500,240000)),openSell:agg(f("01",83000,90000))};', 'return {closeBuy:agg(f("02",0,240000)),openSell:agg(f("01",0,240000))};'),
    ("live fill over expected", "claude-live.js", "const buy=bf||p.expectedPrice||null", "const buy=p.expectedPrice||bf||null"),
    ("live coin ma lookahead", "claude-live.js", "slice(1,1+ma)", "slice(0,ma)"),
    ("live coin stop", "claude-live.js", "const stopped=bars.slice(i).some(x=>+x.low_price<=stop);", "const stopped=false;"),
    ("live coin level today high", "claude-live.js", "level:+candles[1].high_price", "level:+candles[0].high_price"),
    ("soxl live same-session", "claude-live.js", "const started=!!(sess&&sess.date>nx.basedOn&&sess.open>0);", "const started=!!(sess&&sess.open>0);"),
    ("telegram no-trade hidden", "claude-telegram.js", 'else L.push("① 갭하락 과매도 — 매매 없음 ("+(dec.reason||"조건 맞는 종목 없음")+")");', ''),
    ("telegram weekly stale shown", "claude-telegram.js", "||(extra.weekStart&&w.weekStart!==extra.weekStart)", ""),
    ("telegram weekly keep as candidate", "claude-telegram.js", 'if(x.promotion&&x.promotion.code==="candidate")cand.push', 'if(x.promotion)cand.push'),
    ("today tab return is sum", "claude-live.js", "tabPct=v.length?sum/v.length:0;", "tabPct=sum;"),
    ("today kr not split", "claude-live.js", "if(o&&d&&!o.noTrade&&!d.noTrade)for", "if(false)for"),
    ("today failed order counted", "claude-live.js", 'const ok=rows.filter(r=>r.status!=="주문 실패");', "const ok=rows;"),
    ("today measurement counted", "claude-live.js", "    if(rows.length&&b&&!b.v2Signal){", "    if(false){"),
    ("day coin uses bars after close", "_claude_day.js", "hourly = (c.hourly || []).filter(b => t(b) + 36e5 <= dayEnd);", "hourly = (c.hourly || []);"),
    ("day coin realized before day", "_claude_day.js", "if (exitMs >= dayStart && exitMs < dayEnd && (stopBar || bars.length === 24)) {", "if (exitMs < dayEnd && (stopBar || bars.length === 24)) {"),
    ("day opening measurement counted", "_claude_day.js", "  if (v2) { r.trades = done; r.open = open; }\n  else r.measure = rows;", "  { r.trades = done; r.open = open; }"),
    ("day opening no cost", "_claude_day.js", "const net = pct(sell.avgPrice, buy.avgPrice) - COST.kr;", "const net = pct(sell.avgPrice, buy.avgPrice);"),
    ("day soxl holiday ignored", "_claude_day.js", "if (!sess || sess.date !== nyDate) return", "if (!sess) return"),
    ("day no-trade message skipped", "_claude_day.js", '  } else L.push("거래 없음");', "  }"),
    ("watchlist whitelist", "opening-gapdown.js", "    if(!w)continue;\n", "    if(!w){out.push({...r});continue;}\n"),
]


def run_py(folder):
    r = subprocess.run([sys.executable, str(folder / "test_opening_gapdown.py")], capture_output=True, text=True, encoding="utf-8")
    return r.returncode != 0 and "FAILED (" in r.stderr, r.stderr[-800:]


def run_js(folder):
    r = subprocess.run(["node", str(ROOT / "test_opening_gapdown.mjs"), str(folder)], capture_output=True, text=True, encoding="utf-8")
    return r.returncode != 0 and "AssertionError" in (r.stderr + r.stdout), (r.stdout + r.stderr)[-800:]


for label, filename, before, after in PY:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for name in ("backtest_opening_gapdown.py", "backtest_crypto_orb.py", "backtest_etf_overnight.py", "claude_lab.py", "test_opening_gapdown.py"):
            shutil.copy(ROOT / name, folder / name)
        path = folder / filename
        src = path.read_text(encoding="utf-8")
        assert before in src, label + ": target missing"
        path.write_text(src.replace(before, after, 1), encoding="utf-8")
        killed, log = run_py(folder)
        assert killed, label + ": survived\n" + log
        print("PASS killed:", label)
for label, filename, before, after in JS:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for name in ("_gapdown.js", "opening-gapdown.js", "claude-live.js", "claude-telegram.js", "_claude_day.js"):
            shutil.copy(API / name, folder / name)
        path = folder / filename
        src = path.read_text(encoding="utf-8")
        assert before in src, label + ": target missing"
        path.write_text(src.replace(before, after, 1), encoding="utf-8")
        killed, log = run_js(folder)
        assert killed, label + ": survived\n" + log
        print("PASS killed:", label)
print("D-1/D-3 mutations: ALL PASS")
