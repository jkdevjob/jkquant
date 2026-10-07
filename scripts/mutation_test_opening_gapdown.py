"""Mutations for D-1 opening_gapdown_v1 (Python research + JS live path) and D-3 btc_dip24_v1.
Each mutant must make test_opening_gapdown.py or test_opening_gapdown.mjs fail. Working files are not edited."""
from pathlib import Path
import os
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
    ("arena promote after 6 days", "claude_lab.py", "if days >= PROMOTE_DAYS and gate_ok(top) and main_row:", "if days >= PROMOTE_DAYS - 1 and gate_ok(top) and main_row:"),
    ("arena promote same day", "claude_lab.py", "    eff = (date.fromisoformat(today) + timedelta(days=1)).isoformat()", "    eff = today"),
    ("arena admits gate fail", "claude_lab.py", 'why = (m or {}).get("error") or gate_reason(m or {}) if m else "변수 오류"', 'why = ""'),
    ("arena bottom streak ignored", "claude_lab.py", "            if n and _span_days(s0, today) >= PROMOTE_DAYS - 1:", "            if False:"),
    ("arena no key still posts", "claude_lab.py", "    if not key:\n        return dict(ok=False, due=True", "    if False:\n        return dict(ok=False, due=True"),
    ("week kr overlap not split", "claude_lab.py", '"opening_d1v2": lambda d: a["krWeight"] * (0.5 if d in both else 1.0),', '"opening_d1v2": lambda d: a["krWeight"],'),
    ("coin level lookahead", "claude_lab.py", 'level = max(Dd[days[i - j]][1] for j in range(1, hn + 1)) if p["level"] == "prevhigh"', 'level = max(Dd[days[i - j]][1] for j in range(0, hn)) if p["level"] == "prevhigh"'),
    ("coin hiN ignored", "claude_lab.py", 'hn = int(p.get("hiN") or 1) if p["level"] == "prevhigh" else 1', "hn = 1"),
    ("soxl ibs ignored", "claude_lab.py", ' and ibs <= float(p.get("ibsMax", 1.0))', ""),
    ("soxl down days ignored", "claude_lab.py", '            and down >= int(p.get("downDays") or 0))', "            )"),
    ("soxl rsi off not off", "claude_lab.py", '(p["rsiMax"] >= 100 or r2 < p["rsiMax"])', '(r2 < p["rsiMax"])'),
    ("soxl no-condition allowed", "claude_lab.py", 'if out["rsiMax"] >= 100 and out["ibsMax"] >= 1 and not out["downDays"]:', "if False:"),
    ("arena no shrink", "claude_lab.py", "adj = statistics.fmean([wf, shr(year), shr(d90)])", "adj = raw"),
    ("arena no plateau", "claude_lab.py", 'out["score"] = m["adj"] if pl is None or m.get("adj") is None else min(m["adj"], pl)', 'out["score"] = m["adj"]'),
    ("arena min trades off", "claude_lab.py", 'if (f.get("tradeDays") or 0) < MIN_TRADE_DAYS:', "if False:"),
    ("arena year consistency off", "claude_lab.py", 'if y.get("n") and y["pos"] / y["n"] < YEAR_POS_MIN:', "if False:"),
    ("arena thin years counted", "claude_lab.py", "if sum(1 for d in ds if d in dv) >= 5:", "if True:"),
    ("arena duplicates kept", "claude_lab.py", "                if c is not None and c >= DUP_CORR:", "                if False:"),
    ("arena main margin off", "claude_lab.py", '+ (MAIN_MARGIN if r["version"] == cur["version"] else 0.0)', "+ 0.0"),
    ("arena replace unlimited", "claude_lab.py", "elif replaced < MAX_REPLACE and nonmain and", "elif nonmain and"),
    ("arena op credit off", "claude_lab.py", 'ops_state[c["op"]]["accepted"] += 1', "pass"),
    ("arena reproposes seen", "claude_lab.py", "if not k or k in seen:", "if not k:"),
    ("arena op weight unlearned", "claude_lab.py", 'w[op] = (s.get("accepted", 0) + 1) / (s.get("tried", 0) + 2)', "w[op] = 1.0"),
    ("coin trend lookahead", "claude_lab.py", "        trend = C[i - 1] > ma\n", "        trend = C[i] > ma\n"),
    ("coin stop removed", "claude_lab.py", "if any(x[2] <= stop for x in bars[k:]):", "if False:"),
    ("soxl buy signal off", "claude_lab.py", "        elif sig and (ma is None or C[i] > ma):", "        elif sig and (ma is None or C[i] > ma) and False:"),
    ("soxl ma filter ignored", "claude_lab.py", "        elif sig and (ma is None or C[i] > ma):", "        elif sig:"),
    ("soxl max hold ignored", "claude_lab.py", 'if C[i] > C[i - 1] or pos["days"] >= p["maxHoldDays"]:', 'if C[i] > C[i - 1]:'),
    ("ledger pending as no-trade", "claude_lab.py", 'for d in kr_days if d > final_kr and d >= st("opening_d1v2") and d1_live_status(d) == "no_trade"]', 'for d in kr_days if d > final_kr and d >= st("opening_d1v2")]'),
    ("account ignores kr settle", "claude_lab.py", "    ends = [kr_settled_through(final_kr, etf_to, kr_days, st(\"account\")),", "    ends = [\"9999\","),
    ("fair gpt cost differs", "claude_lab.py", "gpt=_side_summary(days, gby, cost), days=rows)", "gpt=_side_summary(days, gby, cost - 0.14), days=rows)"),
    ("fair window not gpt", "claude_lab.py", "    days = [d for d in cal if start <= d <= min(end, c_last)]\n", "    days = [d for d in cal if d <= min(end, c_last)]\n"),
    ("fair coin slot ignored", "claude_lab.py", "    if all(s is not None for _, s in nets):", "    if False:"),
    ("json nan kept", "claude_lab.py", "        return o if math.isfinite(o) else None", "        return o"),
    ("board us not shifted to kst", "claude_lab.py", "    nd = (date.fromisoformat(d) - timedelta(days=1)).isoformat()\n", "    nd = d\n"),
    ("board kr holiday as no-trade", "claude_lab.py", "    if krx_closed(d):\n        return \"holiday\"\n", ""),
    ("board coin open day as no-trade", "claude_lab.py", '    return "pending" if not cal or d > max(cal) else None', '    return "no_trade"'),
    ("us blank close kept", "claude_lab.py", "if all(math.isfinite(x) and x > 0 for x in v):", "if v[0] > 0:"),
    ("us open bar kept", "claude_lab.py", "    return {d: v for d, v in bars.items() if d < today or (d == today and closed)}", "    return dict(bars)"),
    ("duel before start", "claude_lab.py", 'if r.get("status") != "closed" or d < start:', 'if r.get("status") != "closed":'),
    ("duel one-sided days", "claude_lab.py", "    days = sorted(mine & theirs)\n", "    days = sorted(mine | theirs)\n"),
    ("duel gpt cost differs", "claude_lab.py", "        g = _side_day(gby.get(d, []), cost_g) if gby.get(d) else 0.0", "        g = _side_day(gby.get(d, []), 0.0) if gby.get(d) else 0.0"),
    ("duel total not equal weight", "claude_lab.py", '        c = sum(0.25 * by[t][d]["claude"]["pnlPct"] for t in DUEL_TABS if d in by[t])', '        c = sum(by[t][d]["claude"]["pnlPct"] for t in DUEL_TABS if d in by[t])'),
    ("kr calendar today intraday", "claude_lab.py", 'return [d for d in days if d < today or (d == today and now.hour >= 16)]', "return list(days)"),
    ("coin night filter off", "claude_lab.py", 'if p.get("lastEntryHour") is not None and (s0 + timedelta(hours=k)).hour >= p["lastEntryHour"] and k < 15:', "if False:"),
    ("curves include future", "claude_lab.py", "            if d < start or d > today:\n", "            if d < start:\n"),
    ("dip hit minutes", "backtest_crypto_orb.py", "int((hit - entry_t).total_seconds() // 60) + 5", "int((hit - entry_t).total_seconds() // 60)"),
    ("gpt blank date crashes", "claude_lab.py", "        try:\n            v = float(r[col])", "        by.setdefault(r.get(\"date\"), [])\n        try:\n            v = float(r[col])"),
    ("review holiday ignored", "claude_lab.py", " and not led and not krx_closed(today):", " and not led:"),
]
JS = [
    ("base price first", "_gapdown.js", "const base=+(q&&q.basePrice)>0?+q.basePrice:+prevClose||0;", "const base=+prevClose||0;"),
    ("gap floor", "_gapdown.js", "r.expectedGapPct<=gapMax&&r.expectedGapPct>gapFloor", "r.expectedGapPct<=gapMax"),
    ("deepest first", "_gapdown.js", ".sort((a,b)=>a.expectedGapPct-b.expectedGapPct||", ".sort((a,b)=>b.expectedGapPct-a.expectedGapPct||"),
    ("stale watchlist", "_gapdown.js", 'if(based<prevKrxDay(today))return {ok:false,reason:"watchlist_stale"};', ""),
    ("stale watchlist ignores holidays", "_gapdown.js", "while(krxDay(t.toISOString().slice(0,10)).closed);", "while(t.getUTCDay()===0||t.getUTCDay()===6);"),
    ("buy deadline", "opening-gapdown.js", 'if(stage==="preopen")return hms>=85000&&hms<ORDER_DEADLINE;', 'if(stage==="preopen")return hms>=85000&&hms<93000;'),
    ("close window", "opening-gapdown.js", 'if(stage==="close")return hms>=152000&&hms<152800;', 'if(stage==="close")return hms>=150000&&hms<152800;'),
    ("fill split", "opening-gapdown.js", 'buy:agg(fills("02",83000,90000))', 'buy:agg(fills("02",83000,240000))'),
    ("etf drop sign", "opening-gapdown.js", "if(dropPct>th)return", "if(dropPct<th)return"),
    ("etf main threshold ignored", "opening-gapdown.js", "return {dropPct,...etfDecision(dropPct,R.rule.dropMaxPct)};", "return {dropPct,...etfDecision(dropPct)};"),
    ("etf rule other code allowed", "opening-gapdown.js", "const ok=!!(cfg&&cfg.ok)&&m.params.code===ETF_RULE.code;", "const ok=!!(cfg&&cfg.ok);"),
    ("etf buy window", "opening-gapdown.js", 'if(stage==="etf_buy")return hms>=152000&&hms<152800;', 'if(stage==="etf_buy")return hms>=150000&&hms<152800;'),
    ("etf fill split", "opening-gapdown.js", 'return {closeBuy:agg(f("02",151500,240000)),openSell:agg(f("01",83000,90000))};', 'return {closeBuy:agg(f("02",0,240000)),openSell:agg(f("01",0,240000))};'),
    ("live fill over expected", "claude-live.js", "const buy=bf||p.expectedPrice||null", "const buy=p.expectedPrice||bf||null"),
    ("live coin ma lookahead", "claude-live.js", "slice(1,1+ma)", "slice(0,ma)"),
    ("live coin stop", "claude-live.js", "const stopped=bars.slice(i).some(x=>+x.low_price<=stop);", "const stopped=false;"),
    ("live coin level today high", "claude-live.js", "const highs=c.slice(1,1+hn)", "const highs=c.slice(0,hn)"),
    ("live coin vb range today", "claude-live.js", "const avg=done.reduce((a,b)=>a+b,0)/ma,y=c[1],hn=", "const avg=done.reduce((a,b)=>a+b,0)/ma,y=c[0],hn="),
    ("live coin hiN ignored", "claude-live.js", 'hn=p.level==="vb"?1:Math.max(1,+p.hiN||1);', "hn=1;"),
    ("live soxl why ignored", "claude-live.js", "(nx.why?nx.why:above?", "(above?"),
    ("day soxl entry rule ignored", "_claude_day.js", '"전날 확정 종가 " + (nx.entryRule || "RSI("', '"전날 확정 종가 " + ("RSI("'),
    ("main hiN unbounded", "_claude_main.js", "hiN: int(p.hiN ?? 1, 1, 20)", "hiN: int(p.hiN ?? 1, 1, 200)"),
    ("main soxl no-condition allowed", "_claude_main.js", "if (o.rsiMax >= 100 && o.ibsMax >= 1 && !o.downDays) throw", "if (false) throw"),
    ("soxl live same-session", "claude-live.js", "const started=!!(sess&&sess.date>nx.basedOn&&sess.open>0);", "const started=!!(sess&&sess.open>0);"),
    ("telegram no-trade hidden", "claude-telegram.js", 'else L.push(dec.reason==="krx_holiday"?"🔒 국내 휴장일 — ①② 시세 조회·주문 없음":"① 갭하락 과매도 — 매매 없음 ("+(dec.reason||"조건 맞는 종목 없음")+")");', ''),
    ("telegram weekly stale shown", "claude-telegram.js", "||(extra.weekStart&&w.weekStart!==extra.weekStart)", ""),
    ("telegram weekly keep as candidate", "claude-telegram.js", 'if(x.promotion&&x.promotion.code==="candidate")cand.push', 'if(x.promotion)cand.push'),
    ("today tab return is sum", "claude-live.js", "tabPct=uv.length?us/uv.length:0;", "tabPct=us;"),
    ("today kr not split", "claude-live.js", "if(o&&d&&!o.noTrade&&!d.noTrade)for", "if(false)for"),
    ("today failed order counted", "claude-live.js", 'const ok=use.filter(r=>r.status!=="주문 실패");', "const ok=use;"),
    ("today measurement counted", "claude-live.js", "    if(rows.length&&b&&!counts){", "    if(false){"),
    ("today main topK ignored", "claude-live.js", "use=counts?rows.filter(r=>keep.has(String(r.code))):rows;", "use=rows;"),
    ("coin night breakout allowed", "claude-live.js", "    if(p.lastEntryHour!=null&&hh>=p.lastEntryHour&&kk<15)break;", ""),
    ("coin vb level ignored", "claude-live.js", 'const level=p.level==="vb"?+c[0].opening_price+p.k*(+y.high_price-+y.low_price):Math.max(...highs);', "const level=Math.max(...highs);"),
    ("coin main stop ignored", "claude-live.js", "stop=entry*(1-stopPct/100);", "stop=entry*(1-5/100);"),
    ("main hold over 5 allowed", "_claude_main.js", "maxHoldDays: int(p.maxHoldDays, 1, 5)", "maxHoldDays: int(p.maxHoldDays, 1, 50)"),
    ("main other etf allowed", "_claude_main.js", 'if (String(p.code) !== "233740") throw new Error', 'if (false) throw new Error'),
    ("main future event used", "_claude_main.js", "if (e.tab === tab && (!date || e.effectiveFrom <= date)) best = e;", "if (e.tab === tab) best = e;"),
    ("main invalid record kept", "_claude_main.js", "    } catch (err) { /* 검사에 떨어진 기록은 쓰지 않는다 */ }", "    } catch (err) { out.push({ tab: e.tab, version: String(e.version), effectiveFrom: e.effectiveFrom, promotedAt: \"\", params: e.params || {} }); }"),
    ("day coin uses bars after close", "_claude_day.js", "hourly = (c.hourly || []).filter(b => t(b) + 36e5 <= dayEnd);", "hourly = (c.hourly || []);"),
    ("day coin realized before day", "_claude_day.js", "if (exitMs >= dayStart && exitMs < dayEnd && (stopBar || bars.length === 24)) {", "if (exitMs < dayEnd && (stopBar || bars.length === 24)) {"),
    ("day opening measurement counted", "_claude_day.js", "v2 = b.qualified == null ? !!b.v2Signal : openingCounts(P, b.qualified);", "v2 = true;"),
    ("day opening main topK ignored", "_claude_day.js", "const mine = rows.filter(x => keep.has(String(x.code))), extra = rows.filter(x => !keep.has(String(x.code)));", "const mine = rows, extra = [];"),
    ("day coin market not in main", "_claude_day.js", "      if (!P.markets.includes(c.market)) continue;", ""),
    ("day opening no cost", "_claude_day.js", "const net = pct(sell.avgPrice, buy.avgPrice) - COST.kr;", "const net = pct(sell.avgPrice, buy.avgPrice);"),
    ("day soxl holiday ignored", "_claude_day.js", "if (!sess || sess.date !== nyDate) return", "if (!sess) return"),
    ("day no-trade message skipped", "_claude_day.js", '  } else L.push("거래 없음");', "  }"),
    ("auth live open", "claude-live.js", 'if(!(await claudeAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);', ""),
    ("auth lab open", "claude-lab.js", 'if(!(await claudeAuthorized(request,env)))return new Response', 'if(false)return new Response'),
    ("auth any token", "_claude_auth.js", "return !!email && ownersOf(env).includes(String(email).toLowerCase());", "return !!email;"),
    ("auth empty key", "_claude_auth.js", "return !!want && got === want;", "return got === want;"),
    ("watchlist whitelist", "opening-gapdown.js", "    if(!w)continue;\n", "    if(!w){out.push({...r});continue;}\n"),
    ("token signature unchecked", "_firebase_token.js", '    if (!ok) return { ok: false, reason: "서명 불일치" };\n', ""),
    ("token audience unchecked", "_firebase_token.js", 'if (p.aud !== projectId || p.iss !== "https://securetoken.google.com/" + projectId)', "if (false)"),
    ("token expiry unchecked", "_firebase_token.js", "if (!(p.exp > nowSec) ||", "if (false &&"),
    ("auth any verified email", "_claude_auth.js", "      if (v.ok) return v.email;", '      if (v.ok) return "jk82investing@gmail.com";'),
    ("krx holiday list ignored", "_krx_calendar.js", '  if (SET.has(d)) return { closed: true, reason: "krx_holiday", known: true };\n', ""),
    ("krx holiday telegram says order", "claude-telegram.js", 'L.push(dec.reason==="krx_holiday"?', 'L.push(false?'),
    ("push failed order counted", "_claude_push.js", 'const ob = o.filter(r => r.status && r.status !== "주문 실패");', "const ob = o.filter(r => r.status);"),
    ("push stopped coin sold again", "_claude_push.js", ' || sent["coin:" + pud + ":" + mm[2] + ":stop"]', ""),
    ("push coin sell wrong day", "_claude_push.js", "if (!mm || mm[1] !== pud ||", "if (!mm ||"),
    ("push nonce label", "_claude_push.js", 'te.encode("Content-Encoding: nonce\\0")', 'te.encode("Content-Encoding: nonce")'),
    ("push record delimiter", "_claude_push.js", "cat(te.encode(payload), new Uint8Array([2]))", "cat(te.encode(payload), new Uint8Array([1]))"),
    ("push vapid audience", "_claude_push.js", "const aud = new URL(endpoint).origin;", "const aud = endpoint;"),
    ("coin candles ignore hiN", "_claude_main.js", 'return Math.max(+p.ma || 1, p.level === "vb" ? 1 : (+p.hiN || 1));', "return +p.ma || 1;"),
    ("krx holiday etf note", "claude-live.js", '}else if(buy.decisionReason==="krx_holiday")', '}else if(false)'),
]


def run_py(folder):
    r = subprocess.run([sys.executable, str(folder / "test_opening_gapdown.py")], capture_output=True, text=True, encoding="utf-8",
                       env=dict(os.environ, JKQ_API_DIR=str(API)))
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
        for name in ("_gapdown.js", "opening-gapdown.js", "claude-live.js", "claude-telegram.js", "_claude_day.js", "_claude_auth.js", "claude-lab.js", "_krx_calendar.js", "_claude_main.js", "_firebase_token.js", "_claude_push.js"):
            shutil.copy(API / name, folder / name)
        path = folder / filename
        src = path.read_text(encoding="utf-8")
        assert before in src, label + ": target missing"
        path.write_text(src.replace(before, after, 1), encoding="utf-8")
        killed, log = run_js(folder)
        assert killed, label + ": survived\n" + log
        print("PASS killed:", label)
print("D-1/D-3 mutations: ALL PASS")
