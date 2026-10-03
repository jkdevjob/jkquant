#!/usr/bin/env python3
"""Cumulative research backtest for JKQuant bitcoin 00:00 KST ORB.

Baseline v2:
- Upbit KRW-BTC 5-minute candles.
- 00:00~00:05 KST first-bar high is the opening-range high.
- First fresh close breakout after the range, with the next-bar entry no later than 22:00 KST.
- Breakout volume >= opening-range average volume * 1.2.
- Breakout close must be above cumulative session VWAP.
- Enter at the NEXT 5-minute bar open (no same-bar/lookahead entry).
- Stop -0.5%, take-profit +1.0%, max hold 60 minutes.
- If stop and target are both touched in one candle, stop wins.
- Net result subtracts 0.10% round-trip fee plus 0.04% slippage assumption.

Research only. No variant is automatically promoted and no orders are placed.

Shadow D-3 btc_dip24_v1 (separate strategy, not an ORB variant; see SCALPING_IMPROVEMENTS_v2.md D-3):
- Hourly bars built from complete 5m hours (12 bars). At each hour open, look at the trailing
  24h change close[h-1] / close[h-25] - 1 (both already completed).
- If <= -5%: buy at that hour's open, sell at the close of the 24th hourly bar (24h hold).
- Non-overlapping (next check after exit). Any missing hour in the 49h window -> no evaluation.
- Friction: same 0.10% fee + 0.04% slippage as this tab. Designed on 2023-07..2026-09 hourly data;
  only signals from 2026-10-01 KST count for the verdict.
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
DATA = Path("data") / "crypto" / "KRW-BTC" / "5m"
OUT = Path("data") / "crypto-research"


@dataclass(frozen=True)
class Params:
    name: str
    range_bars: int = 1
    volume_mult: float = 1.2
    use_vwap: bool = True
    entry_cutoff_min: int = 21 * 60 + 55  # 21:55 signal -> 22:00 KST next-bar entry
    stop_pct: float = 0.5
    take_profit_pct: float = 1.0
    max_hold_bars: int = 12      # 60 minutes on 5m bars
    fee_round_trip_pct: float = 0.10
    slippage_round_trip_pct: float = 0.04


VARIANTS = [
    Params("baseline"),
    Params("no_vwap", use_vwap=False),
    Params("vol_1.0", volume_mult=1.0),
    Params("vol_1.5", volume_mult=1.5),
    Params("range_15m", range_bars=3),
    Params("range_30m", range_bars=6),
    Params("stop_0.3_tp_0.6", stop_pct=0.3, take_profit_pct=0.6),
    Params("stop_0.7_tp_1.4", stop_pct=0.7, take_profit_pct=1.4),
    Params("hold_30m", max_hold_bars=6),
    Params("hold_120m", max_hold_bars=24),
    Params("entry_by_1800", entry_cutoff_min=17 * 60 + 55),  # 17:55 signal -> 18:00 KST entry
    Params("range_10m", range_bars=2),
    Params("vol_1.3", volume_mult=1.3),
    Params("stop_0.4_tp_0.8", stop_pct=0.4, take_profit_pct=0.8),
    Params("hold_90m", max_hold_bars=18),
    Params("entry_by_2000", entry_cutoff_min=19 * 60 + 55),
]


def minute_of_day(t: str) -> int:
    s = str(t or "")
    try:
        hh = int(s[11:13])
        mm = int(s[14:16])
        return hh * 60 + mm
    except Exception:
        return -1


def kst_hm(t: str) -> str:
    s = str(t or "")
    return s[11:16] if len(s) >= 16 else ""


def load_days():
    """Rebuild complete KST calendar days from the raw UTC-day archive files."""
    by_date = {}
    if not DATA.exists():
        return []
    for p in sorted(DATA.glob("*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            for b in j.get("bars") or []:
                tk = str(b.get("tKst") or "")
                if len(tk) < 16:
                    continue
                by_date.setdefault(tk[:10], {})[str(b.get("tUtc") or tk)] = b
        except Exception as e:
            print("skip", p, e)

    out = []
    for date, rows in sorted(by_date.items()):
        bars = sorted(rows.values(), key=lambda x: x.get("tUtc") or x.get("tKst") or "")
        out.append({"sessionDateKst": date, "bars": bars})
    return out


def valid_day(day, allow_partial=False):
    bars = day.get("bars") or []
    if allow_partial:
        if len(bars) < 2:
            return False, "too_few_bars"
    elif len(bars) < 288:
        return False, "too_few_bars"
    first, last = bars[0], bars[-1]
    if minute_of_day(first.get("tKst")) != 0:
        return False, "missing_kst_0000"
    if not allow_partial and minute_of_day(last.get("tKst")) != 23 * 60 + 55:
        return False, "missing_kst_2355"
    return True, ""


def trade_for_day(day, p: Params, allow_partial=False):
    ok, _ = valid_day(day, allow_partial=allow_partial)
    if not ok:
        return None

    bars = sorted(day.get("bars") or [], key=lambda x: x.get("tUtc") or "")
    if len(bars) < p.range_bars + 2:
        return None

    opening = bars[: p.range_bars]
    if any(minute_of_day(x.get("tKst")) != i * 5 for i, x in enumerate(opening)):
        return None

    or_high = max(float(x.get("h") or 0) for x in opening)
    or_low = min(float(x.get("l") or 0) for x in opening)
    base_vol = statistics.fmean(float(x.get("v") or 0) for x in opening)
    if or_high <= 0 or base_vol <= 0:
        return None

    cum_pv = 0.0
    cum_v = 0.0
    for x in opening:
        v = float(x.get("v") or 0)
        tp = (float(x.get("h") or 0) + float(x.get("l") or 0) + float(x.get("c") or 0)) / 3.0
        cum_pv += tp * v
        cum_v += v

    signal_i = None
    signal_vwap = None
    signal_vol_ratio = None

    for i in range(p.range_bars, len(bars) - 1):
        x = bars[i]
        minute = minute_of_day(x.get("tKst"))
        if minute < 0:
            continue
        if minute > p.entry_cutoff_min:
            break

        v = float(x.get("v") or 0)
        tp = (float(x.get("h") or 0) + float(x.get("l") or 0) + float(x.get("c") or 0)) / 3.0
        cum_pv += tp * v
        cum_v += v
        vwap = cum_pv / cum_v if cum_v > 0 else 0.0
        close = float(x.get("c") or 0)
        prev_close = float(bars[i - 1].get("c") or 0)
        vol_ratio = v / base_vol if base_vol > 0 else 0.0

        fresh_breakout = close > or_high and prev_close <= or_high
        if not fresh_breakout:
            continue
        if vol_ratio < p.volume_mult:
            continue
        if p.use_vwap and not (close > vwap):
            continue

        signal_i = i
        signal_vwap = vwap
        signal_vol_ratio = vol_ratio
        break

    if signal_i is None:
        return None

    entry_i = signal_i + 1
    entry_bar = bars[entry_i]
    entry = float(entry_bar.get("o") or 0)
    if entry <= 0:
        return None

    stop_px = entry * (1.0 - p.stop_pct / 100.0)
    target_px = entry * (1.0 + p.take_profit_pct / 100.0)
    last_i = min(len(bars) - 1, entry_i + p.max_hold_bars - 1)

    exit_px = None
    exit_i = None
    reason = None
    for i in range(entry_i, last_i + 1):
        b = bars[i]
        low = float(b.get("l") or 0)
        high = float(b.get("h") or 0)
        hit_stop = low <= stop_px
        hit_target = high >= target_px
        if hit_stop and hit_target:
            exit_px, exit_i, reason = stop_px, i, "stop_same_bar"
            break
        if hit_stop:
            exit_px, exit_i, reason = stop_px, i, "stop"
            break
        if hit_target:
            exit_px, exit_i, reason = target_px, i, "take_profit"
            break

    if exit_px is None:
        # 장중 스냅샷에서는 아직 최대 보유시간이 지나지 않은 포지션을
        # 임의로 시간청산하지 않는다. UI가 "보유중"으로 구분할 수 있게 반환한다.
        if allow_partial and last_i < entry_i + p.max_hold_bars - 1:
            return {
                "date": day.get("sessionDateKst"), "strategyVersion": "btc_midnight_orb_v2",
                "status": "open", "signalTimeKst": kst_hm(bars[signal_i].get("tKst")),
                "entryTimeKst": kst_hm(entry_bar.get("tKst")), "entryPrice": entry,
                "openingHigh": or_high, "openingLow": or_low, "signalVwap": signal_vwap,
                "volumeRatio": signal_vol_ratio, "variant": p.name
            }
        exit_i = last_i
        exit_px = float(bars[exit_i].get("c") or 0)
        reason = "time_exit"

    gross = (exit_px / entry - 1.0) * 100.0
    friction = p.fee_round_trip_pct + p.slippage_round_trip_pct
    net = gross - friction

    signal_bar = bars[signal_i]
    exit_bar = bars[exit_i]
    signal_close = float(signal_bar.get("c") or 0)
    signal_prev_close = float(bars[signal_i - 1].get("c") or 0)
    return {
        "date": day.get("sessionDateKst"),
        "strategyVersion": "btc_midnight_orb_v2",
        "signalTimeKst": kst_hm(signal_bar.get("tKst")),
        "entryTimeKst": kst_hm(entry_bar.get("tKst")),
        "exitTimeKst": kst_hm(exit_bar.get("tKst")),
        "openingHigh": or_high,
        "openingLow": or_low,
        "signalClose": signal_close,
        "signalVwap": signal_vwap,
        "volumeRatio": signal_vol_ratio,
        "entryPrice": entry,
        "exitPrice": exit_px,
        "reason": reason,
        "grossPnlPct": gross,
        "frictionPct": friction,
        "pnlPct": net,
        "variant": p.name,
        "evidence": {
            "source": "Upbit public 5m OHLCV",
            "rangeBars": p.range_bars,
            "openingHigh": or_high,
            "openingLow": or_low,
            "openingRangeBaseVolume": base_vol,
            "signalClose": signal_close,
            "previousClose": signal_prev_close,
            "freshBreakout": signal_close > or_high and signal_prev_close <= or_high,
            "signalVwap": signal_vwap,
            "closeAboveVwap": (signal_close > signal_vwap) if signal_vwap is not None else None,
            "volumeRatio": signal_vol_ratio,
            "requiredVolumeRatio": p.volume_mult,
            "entryCutoffKstMinute": p.entry_cutoff_min,
            "entryRule": "next_5m_open",
            "stopPct": p.stop_pct,
            "takeProfitPct": p.take_profit_pct,
            "maxHoldBars": p.max_hold_bars,
            "feeRoundTripPct": p.fee_round_trip_pct,
            "slippageRoundTripPct": p.slippage_round_trip_pct,
            "sameBarConflictRule": "stop_first",
        },
    }


def summary(trades, day_labels):
    trades = sorted(trades, key=lambda x: (x["date"], x["entryTimeKst"]))
    pnls = [float(x["pnlPct"]) for x in trades]
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    gp = sum(wins)
    gl = -sum(losses)

    equity = 1.0
    peak = 1.0
    mdd = 0.0
    for pnl in pnls:
        equity *= max(1e-9, 1.0 + pnl / 100.0)
        peak = max(peak, equity)
        if peak > 0:
            mdd = min(mdd, (equity / peak - 1.0) * 100.0)

    traded_dates = {x["date"] for x in trades}
    target1 = sum(1 for x in pnls if x >= 1.0)
    return {
        "days": len(day_labels),
        "trades": len(trades),
        "signalRatePct": (len(trades) / len(day_labels) * 100.0) if day_labels else 0.0,
        "noTradeDays": max(0, len(day_labels) - len(traded_dates)),
        "winRate": (len(wins) / len(pnls) * 100.0) if pnls else 0.0,
        "avgPnl": statistics.fmean(pnls) if pnls else 0.0,
        "avgDailyReturnPct": (sum(pnls) / len(day_labels)) if day_labels else 0.0,
        "positiveDayRatePct": (len(wins) / len(day_labels) * 100.0) if day_labels else 0.0,
        "target1PctDayCount": target1,
        "target1PctDayRatePct": (target1 / len(day_labels) * 100.0) if day_labels else 0.0,
        "medianPnl": statistics.median(pnls) if pnls else 0.0,
        "sumPnl": sum(pnls),
        "compoundReturnPct": (equity - 1.0) * 100.0,
        "profitFactor": (gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "maxDrawdownPct": mdd,
    }


def split_validation(days, trades):
    labels = [x["sessionDateKst"] for x in days]
    if len(labels) < 30:
        return {
            "status": "collecting",
            "trainDays": 0,
            "holdoutDays": 0,
            "train": summary([], []),
            "holdout": summary([], []),
        }

    cut = max(1, int(len(labels) * 0.70))
    train_days = labels[:cut]
    holdout_days = labels[cut:]
    train_set = set(train_days)
    holdout_set = set(holdout_days)
    return {
        "status": "reviewable",
        "trainDays": len(train_days),
        "holdoutDays": len(holdout_days),
        "train": summary([x for x in trades if x["date"] in train_set], train_days),
        "holdout": summary([x for x in trades if x["date"] in holdout_set], holdout_days),
    }


def rolling_baseline(days, trades, window=30):
    labels = [x["sessionDateKst"] for x in days]
    if len(labels) < window:
        return {"windowDays": window, "count": 0}
    by_date = {}
    for t in trades:
        by_date.setdefault(t["date"], []).append(t)

    vals = []
    for i in range(len(labels) - window + 1):
        d = labels[i : i + window]
        ts = []
        for x in d:
            ts.extend(by_date.get(x, []))
        s = summary(ts, d)
        vals.append({
            "from": d[0],
            "to": d[-1],
            "avgPnl": s["avgPnl"],
            "compoundReturnPct": s["compoundReturnPct"],
            "trades": s["trades"],
        })

    return {
        "windowDays": window,
        "count": len(vals),
        "worstCompoundReturnPct": min(x["compoundReturnPct"] for x in vals),
        "bestCompoundReturnPct": max(x["compoundReturnPct"] for x in vals),
        "avgCompoundReturnPct": statistics.fmean(x["compoundReturnPct"] for x in vals),
        "latest": vals[-1],
    }


DIP24_VERSION = "btc_dip24_v1"
DIP24 = dict(dropPct=-5.0, lookbackHours=24, holdHours=24, feeRoundTripPct=0.10, slippageRoundTripPct=0.04,
             designEndKst="2026-09-30", designedFrom="Upbit KRW-BTC 1h 2023-07..2026-09: 52 trades, +0.93%/trade, t=1.76")


def hourly_bars(days):
    """Complete UTC hours only: {hour_start_utc(datetime): dict(o,h,l,c,v,bars=[5m...])}."""
    by = {}
    for d in days:
        for b in d.get("bars") or []:
            try:
                t = datetime.fromisoformat(str(b["tUtc"])[:19])
            except Exception:
                continue
            by.setdefault(t.replace(minute=0, second=0), []).append((t, b))
    out = {}
    for h, v in by.items():
        v.sort(key=lambda x: x[0])
        if len(v) != 12 or len({x[0] for x in v}) != 12:
            continue
        bs = [x[1] for x in v]
        out[h] = dict(o=float(bs[0]["o"]), h=max(float(x["h"]) for x in bs), l=min(float(x["l"]) for x in bs),
                      c=float(bs[-1]["c"]), bars=[(x[0], x[1]) for x in v])
    return out


def dip24_path(entry, path, entry_t):
    """Post-entry 5m path labels (spec: fwd 5/10/20/30m, MFE/MAE, first hits of +-1/+-2%)."""
    lab = {}
    for n in (5, 10, 20, 30):
        k = n // 5
        lab[f"fwd{n}mPct"] = (float(path[k - 1][1]["c"]) / entry - 1) * 100 if len(path) >= k else None
    mfe = max((float(b["h"]) / entry - 1) * 100 for _, b in path)
    mae = min((float(b["l"]) / entry - 1) * 100 for _, b in path)
    lab.update(mfePct=mfe, maePct=mae)
    for name, thr, key in (("Plus1", 1, "h"), ("Plus2", 2, "h"), ("Minus1", -1, "l"), ("Minus2", -2, "l")):
        hit = next((t for t, b in path if ((float(b[key]) / entry - 1) * 100 >= thr if thr > 0 else (float(b[key]) / entry - 1) * 100 <= thr)), None)
        lab[f"hit{name}"] = hit is not None
        # 5분봉이 끝난 시각 기준 (그 봉 안에서 닿았다는 것만 안다)
        lab[f"hit{name}Time"] = (hit + timedelta(minutes=5, hours=9)).strftime("%Y-%m-%d %H:%M") if hit else None
        lab[f"hit{name}Min"] = int((hit - entry_t).total_seconds() // 60) + 5 if hit else None
    return lab


def dip24_shadow(days):
    """Returns (trades, decisions) for btc_dip24_v1. decisions = one row per KST date."""
    hb = hourly_bars(days)
    hours = sorted(hb)
    one = timedelta(hours=1)
    lb, hold = DIP24["lookbackHours"], DIP24["holdHours"]
    fric = DIP24["feeRoundTripPct"] + DIP24["slippageRoundTripPct"]
    trades, per_day = [], {}
    busy_until = None
    for h in hours:
        day = (h + timedelta(hours=9)).strftime("%Y-%m-%d")
        rec = per_day.setdefault(day, dict(date=day, strategyVersion=DIP24_VERSION, evaluatedHours=0, skippedHours=0,
                                           min24hChangePct=None, signals=0))
        if busy_until and h < busy_until:
            continue
        need = [h - one * k for k in range(1, lb + 2)]
        if not all(x in hb for x in need):
            rec["skippedHours"] += 1
            continue
        chg = (hb[h - one]["c"] / hb[h - one * (lb + 1)]["c"] - 1) * 100
        rec["evaluatedHours"] += 1
        rec["min24hChangePct"] = chg if rec["min24hChangePct"] is None else min(rec["min24hChangePct"], chg)
        if chg > DIP24["dropPct"]:
            continue
        fut = [h + one * k for k in range(hold)]
        if not all(x in hb for x in fut):
            rec["skippedHours"] += 1
            continue                      # 보유 24시간 중 빠진 시간 — 결과를 모르므로 기록하지 않는다(다음 실행에서 다시 판단)
        entry = hb[h]["o"]
        exit_px = hb[fut[-1]]["c"]
        path = [x for f in fut for x in hb[f]["bars"]]
        gross = (exit_px / entry - 1) * 100
        t = dict(date=day, strategy="crypto", variant="dip24", strategyVersion=DIP24_VERSION, signalSchemaVersion=1,
                 signalTimeKst=(h + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M"),
                 entryTimeKst=(h + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M"),
                 exitTimeKst=(fut[-1] + one + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M"),
                 trailing24hChangePct=chg, entryPrice=entry, exitPrice=exit_px, reason="time_24h",
                 params=DIP24, decisionReason="trailing_24h_change<=-5%",
                 grossPnlPct=gross, frictionPct=fric, pnlPct=gross - fric,
                 sample="design" if day <= DIP24["designEndKst"] else "outOfSample")
        t.update(dip24_path(entry, path, h))
        trades.append(t)
        rec["signals"] += 1
        busy_until = fut[-1] + one
    decisions = []
    for d in sorted(per_day):
        r = per_day[d]
        r["action"] = "signal" if r["signals"] else "no_signal"
        r["decisionReason"] = "" if r["signals"] else ("insufficient_contiguous_hours" if not r["evaluatedHours"] else "no_24h_drop_below_-5%")
        decisions.append(r)
    return trades, decisions


def dip24_summary(trades):
    def one(xs):
        if not xs:
            return dict(trades=0)
        v = [x["pnlPct"] for x in xs]
        sd = statistics.stdev(v) if len(v) > 1 else 0
        return dict(trades=len(v), winRate=sum(1 for x in v if x > 0) / len(v) * 100, avgPnlPct=statistics.fmean(v),
                    avgGrossPct=statistics.fmean(x["grossPnlPct"] for x in xs),
                    tStat=(statistics.fmean(v) / (sd / math.sqrt(len(v)))) if sd > 0 else None,
                    avgMfePct=statistics.fmean(x["mfePct"] for x in xs), avgMaePct=statistics.fmean(x["maePct"] for x in xs))
    return dict(all=one(trades), design=one([t for t in trades if t["sample"] == "design"]),
                outOfSample=one([t for t in trades if t["sample"] == "outOfSample"]))


def main():
    all_days = load_days()
    OUT.mkdir(parents=True, exist_ok=True)

    valid = []
    invalid = []
    for d in all_days:
        ok, reason = valid_day(d)
        if ok:
            valid.append(d)
        else:
            invalid.append({"date": d.get("sessionDateKst"), "reason": reason})

    if not valid:
        print("No valid crypto archives yet.")
        return 0

    labels = [x["sessionDateKst"] for x in valid]
    reports = []
    variant_trades = {}
    for p in VARIANTS:
        trades = [t for d in valid if (t := trade_for_day(d, p))]
        variant_trades[p.name] = trades
        reports.append({
            "params": asdict(p),
            "summary": summary(trades, labels),
            "validation": split_validation(valid, trades),
        })

    baseline = variant_trades["baseline"]

    # 오늘 KST 세션은 24시간이 끝나기 전에도 별도 상태로 노출한다.
    # 확정 백테스트(valid/summary)에는 섞지 않아 prospective 통계를 오염시키지 않는다.
    today_kst = datetime.now(KST).date().isoformat()
    partial = next((d for d in all_days if d.get("sessionDateKst") == today_kst), None)
    current_session = None
    if partial:
        bars_now = partial.get("bars") or []
        t_now = trade_for_day(partial, VARIANTS[0], allow_partial=True)
        last_hm = kst_hm(bars_now[-1].get("tKst")) if bars_now else ""
        if t_now:
            if t_now.get("status") == "open":
                current_session = {"date": today_kst, "status": "position_open", "trades": 1,
                                   "lastBarKst": last_hm, "trade": t_now}
            else:
                current_session = {"date": today_kst, "status": "trade_closed", "trades": 1,
                                   "lastBarKst": last_hm, "trade": t_now}
        else:
            minute_now = minute_of_day(bars_now[-1].get("tKst")) if bars_now else -1
            current_session = {"date": today_kst,
                               "status": "no_trade" if minute_now >= VARIANTS[0].entry_cutoff_min else "watching",
                               "trades": 0, "lastBarKst": last_hm}

    report = {
        "schema": 3,
        "generatedAt": datetime.now(KST).isoformat(),
        "market": "KRW-BTC",
        "unitMinutes": 5,
        "source": "Upbit public minute candles",
        "from": labels[0],
        "to": labels[-1],
        "archiveDays": len(all_days),
        "validDays": len(valid),
        "invalidDays": invalid,
        "comparisonStatus": "reviewable" if len(valid) >= 90 else "collecting",
        "comparisonRule": "Research comparison only. No automatic strategy promotion or live order connection.",
        "auditRule": "Raw OHLCV + strategy version + observed signal features + thresholds + entry/exit reason are retained for reproducibility.",
        "executionModel": "KST 00:00 opening range; completed 5m signal; next-candle entry through 22:00 KST; same-candle stop/target conflict resolves to stop",
        "frictionModel": "0.10% round-trip fee + 0.04% round-trip slippage assumption",
        "variants": reports,
        "rolling30": rolling_baseline(valid, baseline, 30),
        "latestTrades": baseline[-20:],
        "currentSession": current_session,
    }
    dip_trades, dip_decisions = dip24_shadow(valid)
    report["shadowDip24"] = {
        "strategyVersion": DIP24_VERSION, "params": DIP24, "orders": "none (research shadow)",
        "verdictRule": "Only signals after designEndKst count. Expect ~17 signals/year, so 30 signals take ~2 years.",
        "summary": dip24_summary(dip_trades), "latestTrades": dip_trades[-10:],
    }

    with (OUT / "latest.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with (OUT / "baseline-trades.csv").open("w", encoding="utf-8", newline="") as f:
        cols = [
            "date","strategyVersion","signalTimeKst","entryTimeKst","exitTimeKst","openingHigh","openingLow",
            "signalClose","signalVwap","volumeRatio","entryPrice","exitPrice","reason",
            "grossPnlPct","frictionPct","pnlPct",
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for x in baseline:
            w.writerow({k: x.get(k) for k in cols})

    with (OUT / f"{labels[-1]}.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    if dip_trades:
        with (OUT / "dip24-trades.csv").open("w", encoding="utf-8", newline="") as f:
            cols = [k for k in dip_trades[0] if k != "params"]
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for x in dip_trades:
                w.writerow({k: x.get(k) for k in cols})
    if dip_decisions:
        with (OUT / "dip24-decisions.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(dip_decisions[0].keys()))
            w.writeheader()
            w.writerows(dip_decisions)

    # One row per session, including no-trade days. This is the compact audit
    # trail for "why did the strategy trade / not trade on that date?" Raw bars
    # remain the source of truth and allow the exact decision to be reconstructed.
    by_date = {x["date"]: x for x in baseline}
    with (OUT / "baseline-decisions.csv").open("w", encoding="utf-8", newline="") as f:
        cols = [
            "date","strategyVersion","action","decisionReason","signalTimeKst","entryTimeKst","exitTimeKst",
            "openingHigh","openingLow","signalClose","signalVwap","volumeRatio",
            "entryPrice","exitPrice","exitReason","pnlPct"
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for d in labels:
            t = by_date.get(d)
            if t:
                w.writerow({
                    "date":d,"strategyVersion":t.get("strategyVersion"),"action":"trade",
                    "decisionReason":"fresh_breakout+volume+vwap_pass",
                    "signalTimeKst":t.get("signalTimeKst"),"entryTimeKst":t.get("entryTimeKst"),
                    "exitTimeKst":t.get("exitTimeKst"),"openingHigh":t.get("openingHigh"),
                    "openingLow":t.get("openingLow"),"signalClose":t.get("signalClose"),
                    "signalVwap":t.get("signalVwap"),"volumeRatio":t.get("volumeRatio"),
                    "entryPrice":t.get("entryPrice"),"exitPrice":t.get("exitPrice"),
                    "exitReason":t.get("reason"),"pnlPct":t.get("pnlPct"),
                })
            else:
                w.writerow({
                    "date":d,"strategyVersion":"btc_midnight_orb_v2","action":"no_trade",
                    "decisionReason":"no_qualified_breakout_before_2155_kst_after_volume_vwap_filters",
                })

    base = next(x for x in reports if x["params"]["name"] == "baseline")
    print(json.dumps({
        "days": len(valid),
        "from": labels[0],
        "to": labels[-1],
        "baseline": base["summary"],
        "holdout": base["validation"]["holdout"],
        "rolling30": report["rolling30"],
        "dip24": report["shadowDip24"]["summary"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
