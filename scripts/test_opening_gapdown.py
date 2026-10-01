"""Value tests for D-1 opening_gapdown_v1 research + D-3 btc_dip24_v1 shadow (no network)."""
import json
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backtest_opening_gapdown as g  # noqa: E402
import backtest_crypto_orb as c  # noqa: E402
import backtest_etf_overnight as e  # noqa: E402
import claude_lab as lab  # noqa: E402


def days(n, start="2026-01-01"):
    d, out = date.fromisoformat(start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(str(d))
        d += timedelta(days=1)
    return out


def series(code, closes, opens=None, dept="", vols=None, name=None, split_at=None):
    """rows with Changes consistent with the previous close (or a split base on split_at)."""
    ds = days(len(closes))
    rows = []
    for i, cl in enumerate(closes):
        prev = closes[i - 1] if i else cl
        base = prev / 2 if split_at is not None and i == split_at else prev
        o = opens[i] if opens and opens[i] is not None else cl
        v = vols[i] if vols else 100000.0
        rows.append((ds[i], o, max(o, cl) * 1.01, min(o, cl) * 0.99, cl, cl - base, 5e9, v, name or ("N" + code), "KOSDAQ", dept))
    return rows


def falling(n=80, start=20000.0, step=0.99):
    out, x = [], start
    for i in range(n):
        out.append(round(x))
        x *= 1.004 if i % 4 == 3 else step               # 가끔 반등 — RSI 가 0 에 붙지 않게
    return out


class GapdownRule(unittest.TestCase):
    def test_cost_uses_tick_table(self):
        self.assertAlmostEqual(g.cost_pct(10000, 1.5), 0.23 + 2 * 1.5 * 10 / 10000 * 100)
        self.assertAlmostEqual(g.cost_pct(1999, 0), 0.23)
        self.assertEqual(g.tick(1999), 1)
        self.assertEqual(g.tick(2000), 5)

    def test_common_stock_filter(self):
        self.assertTrue(g.is_common("005930", "삼성전자"))
        self.assertFalse(g.is_common("005935", "삼성전자우"))
        self.assertFalse(g.is_common("123450", "하나스팩10호"))

    def test_signal_needs_prev_rsi_below_30_and_gap(self):
        cl = falling()
        op = [None] * 79 + [round(cl[78] * 0.95)]          # 마지막 날 -5% 갭
        by = {"000010": series("000010", cl, op)}
        dd, watch, pre = g.build_days(by)
        last = days(80)[-1]
        self.assertIn(last, dd)
        x = dd[last][0]
        self.assertAlmostEqual(x["gapPct"], (op[-1] / cl[78] - 1) * 100)
        self.assertLess(x["rsiPrev"], 30)
        self.assertAlmostEqual(x["gross"], (cl[-1] / op[-1] - 1) * 100)

    def test_rsi_is_previous_day_not_signal_day(self):
        cl = falling()
        cl[79] = round(cl[78] * 1.29)                    # 갭하락 후 상한가 근처 마감 → 당일 RSI 는 30 위로
        op = [None] * 79 + [round(cl[78] * 0.95)]
        dd, _, pre = g.build_days({"000010": series("000010", cl, op)})
        last = days(80)[-1]
        self.assertGreater(g.wilder_rsi([float(x) for x in cl])[79], 30)
        self.assertIn("000010", [c for c, _ in pre.get(last, [])])
        self.assertIn(last, dd)
        self.assertAlmostEqual(dd[last][0]["rsiPrev"], g.wilder_rsi([float(x) for x in cl])[78])

    def test_gap_not_deep_enough_or_limit_down(self):
        cl = falling()
        for ratio, expect in ((0.985, False), (0.70, False), (0.72, True)):
            op = [None] * 79 + [round(cl[78] * ratio)]
            dd, _, _ = g.build_days({"000010": series("000010", cl, op)})
            self.assertEqual(days(80)[-1] in dd, expect, ratio)

    def test_split_does_not_fake_a_crash(self):
        cl = [20000.0] * 40 + [10000.0] * 40             # 2:1 split on day 40, flat otherwise
        by = {"000010": series("000010", cl, split_at=40)}
        _, _, pre = g.build_days(by)
        self.assertEqual(sum(len(v) for v in pre.values()), 0, "split must not create RSI<30")

    def test_risk_proxies_exclude(self):
        cl = falling()
        op = [None] * 79 + [round(cl[78] * 0.95)]
        last = days(80)[-1]
        dd, _, _ = g.build_days({"000010": series("000010", cl, op, dept="관리종목(소속부없음)")})
        self.assertNotIn(last, dd)
        vols = [100000.0] * 80
        vols[70] = 0.0                                    # 20거래일 안 거래정지
        dd, _, _ = g.build_days({"000010": series("000010", cl, op, vols=vols)})
        self.assertNotIn(last, dd)
        cl2 = list(cl)
        cl2[75] = round(cl2[74] * 0.6)                   # 10거래일 안 -40% (가격제한 없는 구간)
        for i in range(76, 80):
            cl2[i] = round(cl2[i - 1] * 0.99)
        op2 = [None] * 79 + [round(cl2[78] * 0.95)]
        dd, _, _ = g.build_days({"000010": series("000010", cl2, op2)})
        self.assertNotIn(last, dd)

    def test_watchlist_is_next_session_rsi_list(self):
        by = {"000010": series("000010", falling()), "000020": series("000020", [10000.0 + (i % 2) * 50 for i in range(80)])}
        _, watch, _ = g.build_days(by)
        self.assertEqual([x["code"] for x in watch], ["000010"])
        self.assertEqual(watch[0]["prevClose"], falling()[-1])


class GapdownLive(unittest.TestCase):
    def test_live_join_measures_slippage_and_ignores_provisional_days(self):
        cl = falling()
        op = [None] * 79 + [round(cl[78] * 0.95)]
        by = {"000010": series("000010", cl, op)}
        d = days(80)[-1]
        with tempfile.TemporaryDirectory() as tmp:
            live = Path(tmp)
            ledger = {"ok": True, "ledger": {"date": d, "events": [
                {"stage": "preopen", "payload": {"picks": [{"code": "000010", "name": "N", "expectedPrice": op[-1] * 1.01, "expectedGapPct": -4.0}],
                                                  "orders": [{"code": "000010", "side": "buy", "vts": {"ok": True, "msg": "ok"}}]}},
                {"stage": "reconcile", "payload": {"positions": [{"code": "000010", "buy": {"qty": 10, "avgPrice": op[-1] + 10},
                                                                    "sell": {"qty": 10, "avgPrice": cl[-1] - 10}}]}}]}}
            (live / f"{d}.json").write_text(json.dumps(ledger), encoding="utf-8")
            old = g.LIVE
            g.LIVE = live
            try:
                rows = g.live_trades(by, d)
                none = g.live_trades(by, days(80)[-2])
            finally:
                g.LIVE = old
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertAlmostEqual(r["buySlipPct"], ((op[-1] + 10) / op[-1] - 1) * 100)
        self.assertAlmostEqual(r["sellSlipPct"], -(((cl[-1] - 10) / cl[-1] - 1) * 100))
        self.assertAlmostEqual(r["realizedNetPct"], ((cl[-1] - 10) / (op[-1] + 10) - 1) * 100 - 0.23)
        self.assertAlmostEqual(r["openVsExpectedPct"], (1 / 1.01 - 1) * 100)
        self.assertTrue(r["actualGapQualifies"])
        self.assertIsNone(none[0]["actualOpen"], "provisional day must not be priced")


def btc_days(closes_by_hour, start="2026-01-01T00:00:00"):
    """closes_by_hour: list of hourly closes; each hour = 12 flat 5m bars at that close, open = prev close."""
    t0 = datetime.fromisoformat(start)
    bars = {}
    prev = closes_by_hour[0]
    for h, cl in enumerate(closes_by_hour):
        for k in range(12):
            t = t0 + timedelta(hours=h, minutes=5 * k)
            o = prev if k == 0 else cl
            bars.setdefault(t.strftime("%Y-%m-%d"), []).append(
                {"tUtc": t.strftime("%Y-%m-%dT%H:%M:%S"), "o": o, "h": max(o, cl), "l": min(o, cl), "c": cl, "v": 1})
        prev = cl
    return [{"sessionDateUtc": k, "bars": v} for k, v in sorted(bars.items())]


class Dip24(unittest.TestCase):
    def test_trigger_entry_exit_and_no_overlap(self):
        closes = [100.0] * 30 + [95.0] * 60               # 30번째 시간에 24시간 -5%
        trades, dec = c.dip24_shadow(btc_days(closes))
        self.assertEqual(len(trades), 1, "second -5% window is inside the 24h hold")
        t = trades[0]
        self.assertAlmostEqual(t["trailing24hChangePct"], -5.0)
        self.assertEqual(t["entryPrice"], 95.0)          # 31번째 시간 시가 (= 30번째 종가)
        self.assertAlmostEqual(t["pnlPct"], 0 - 0.14)
        self.assertEqual(t["sample"], "design")
        self.assertTrue(any(r["signals"] for r in dec))

    def test_minus_4_9_does_not_trigger(self):
        closes = [100.0] * 30 + [95.1] * 60
        trades, _ = c.dip24_shadow(btc_days(closes))
        self.assertEqual(trades, [])

    def test_missing_hour_blocks_evaluation(self):
        ds = btc_days([100.0] * 30 + [95.0] * 60)
        ds[1]["bars"] = [b for b in ds[1]["bars"] if not b["tUtc"].endswith("T05:00:00")]
        trades, _ = c.dip24_shadow(ds)
        self.assertEqual(trades, [])

    def test_path_labels(self):
        closes = [100.0] * 30 + [95.0, 96.0, 97.0] + [97.0] * 40
        trades, _ = c.dip24_shadow(btc_days(closes))
        t = trades[0]
        # 진입 = 31번째 시간 시가 95. 그 시간 첫 5분봉이 95→96 이라 5분 뒤 +1.05%, +1% 는 5분 안에 닿는다.
        self.assertAlmostEqual(t["fwd5mPct"], (96 / 95 - 1) * 100)
        self.assertAlmostEqual(t["fwd30mPct"], (96 / 95 - 1) * 100)
        self.assertTrue(t["hitPlus1"])
        self.assertEqual(t["hitPlus1Min"], 5)
        self.assertTrue(t["hitPlus2"])                   # 다음 시간 첫 5분봉 97 → +2.1%
        self.assertEqual(t["hitPlus2Min"], 65)
        self.assertFalse(t["hitMinus1"])


class EtfOvernight(unittest.TestCase):
    def test_signal_threshold_and_next_open_exit(self):
        bars = [("2026-01-01", 100, 100), ("2026-01-02", 99, 97.0), ("2026-01-05", 98.5, 99), ("2026-01-06", 99, 96.1), ("2026-01-07", 97, 97)]
        s = e.signals(bars)
        self.assertEqual([x["signalDate"] for x in s], ["2026-01-02"])     # -3.0% 은 들어가고 -2.93% 는 아니다
        x = s[0]
        self.assertEqual(x["exitDate"], "2026-01-05")
        self.assertAlmostEqual(x["grossPnl"], (98.5 / 97 - 1) * 100)
        self.assertAlmostEqual(x["frictionPct"], 0.03 + 2 * 1 / 97 * 100)

    def test_goal_metrics_count_no_trade_days_as_zero(self):
        cal = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]
        m = e.goal_metrics({"2026-01-05": 1.5, "2026-01-07": -2.0, "2026-01-09": 4.0}, cal)
        self.assertEqual(m["tradeDays"], 3)
        self.assertAlmostEqual(m["plus1DaysPerYear"], 2 / (5 / 250))
        self.assertAlmostEqual(m["lossDayAvgPct"], -2.0)
        self.assertAlmostEqual(m["worstDayPct"], -2.0)
        self.assertAlmostEqual(m["plus5WeeksPerYear"], 0 / (5 / 250))      # 1.015*0.98*1.04 = +3.4% < 5%
        self.assertAlmostEqual(m["mddPct"], -2.0)
        self.assertTrue(m["gate"])

    def test_weekly_average_includes_idle_weeks(self):
        cal = ["2026-01-05", "2026-01-06", "2026-01-12", "2026-01-13"]       # 두 주, 매매는 첫 주 하루
        m = e.goal_metrics({"2026-01-05": 10.0}, cal)
        self.assertAlmostEqual(m["weeklyAvgPct"], (1.10 ** 0.5 - 1) * 100)

    def test_portfolio_is_one_capital_base(self):
        p = e.combine({"a": 2.0, "b": 1.0}, {"b": 3.0, "c": -1.0})
        self.assertEqual(p, {"a": 2.0, "b": 2.0, "c": -1.0})              # 같은 날 둘 다면 반씩, 합산(4%) 아님


def trend_rows(closes, lows=None):
    ds = days(len(closes))
    return [(d, (closes[i - 1] if i else c), max(c, closes[i - 1] if i else c), (lows[i] if lows else min(c, closes[i - 1] if i else c)), c)
            for i, (d, c) in enumerate(zip(ds, closes))]


class ClaudeLabTrend(unittest.TestCase):
    P = dict(version="t", ma=3, stopPct=4.0, size=0.5, costRoundTripPct=0.14, stopSlipPct=0.1)

    def test_enter_on_day_after_close_above_ma_and_size(self):
        closes = [100, 100, 100, 100, 103, 104]            # 4번째 날 종가 103 > 3일 평균(101) → 5번째 날 보유
        dv, dec, nxt = lab.trend_daily(trend_rows(closes), self.P)
        d = days(6)
        self.assertNotIn(d[4], dv)                         # 103 이 된 날은 아직 신호 전 (룩어헤드 없음)
        self.assertAlmostEqual(dv[d[5]], ((104 / 103 - 1) * 100 - 0.07) * 0.5)   # 시가(=전일 종가) 진입, 비용 절반, 투입 50%
        self.assertTrue(nxt["holdNext"])

    def test_today_close_never_changes_todays_decision(self):
        dv, _, _ = lab.trend_daily(trend_rows([100, 100, 100, 100, 103, 130]), self.P)
        self.assertIn(days(6)[5], dv)                      # 오늘 종가 130 이 평균을 끌어올려도 오늘 보유 판단은 그대로

    def test_stop_caps_loss(self):
        closes = [100, 100, 100, 104, 103]
        lows = [100, 100, 100, 104, 99]                    # 시가 104 대비 저가 -4.8%
        dv, dec, _ = lab.trend_daily(trend_rows(closes, lows), self.P)
        self.assertAlmostEqual(dv[days(5)[4]], (-4.0 - 0.1 - 0.07 - 0.07) * 0.5)
        self.assertEqual(dec[-1]["action"], "stop")

    def test_crypto_basket_fixed_share_idle_coin_is_cash(self):
        per = {"A": ({"d1": 2.0, "d2": 1.0}, {"d1", "d2"}), "B": ({"d2": 3.0}, {"d1", "d2"})}
        b = lab.basket(per, ["d1", "d2"])
        self.assertEqual(b, {"d1": 1.0, "d2": 2.0})        # d1: B 는 쉬므로 A 몫만(2%/2), 평균으로 부풀리지 않는다

    def test_account_weights_and_us_date_shift(self):
        us = lab.us_to_kst({"2026-01-05": 2.0})
        self.assertEqual(us, {"2026-01-06": 2.0})                          # 미국 1/5 장 → 한국 1/6 아침 확정
        a = lab.account_daily({"2026-01-06": 1.0}, {"2026-01-06": -1.0, "2026-01-07": 3.0}, us, ["2026-01-06", "2026-01-07"])
        self.assertAlmostEqual(a["2026-01-06"], 0.3 * 1.0 + 0.3 * -1.0 + 0.4 * 2.0)
        self.assertAlmostEqual(a["2026-01-07"], 0.3 * 3.0)

    def test_paper_ledger_is_write_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "k" / "2026-10-02.json"
            self.assertTrue(lab.write_once(f, {"pnlPct": 1.0}))
            self.assertFalse(lab.write_once(f, {"pnlPct": -5.0}))           # 두 번째는 쓰지 않는다
            self.assertEqual(json.loads(f.read_text())["pnlPct"], 1.0)

    def test_drift_status_waits_then_flags(self):
        self.assertEqual(lab.drift_status({str(i): 1.0 for i in range(19)}, {"expectancyPct": 1.0})["code"], "collecting")
        bad = {str(i): (-1.0 if i % 2 else -0.5) for i in range(25)}
        self.assertEqual(lab.drift_status(bad, {"expectancyPct": 1.0})["code"], "below")
        ok = {str(i): (2.0 if i % 2 else 0.0) for i in range(25)}
        self.assertEqual(lab.drift_status(ok, {"expectancyPct": 1.0})["code"], "ok")

    def test_soxl_meanrev_next_open_and_max_hold(self):
        # 200일 평균 위에서 이틀 급락 → 다음 날 시가 매수 → 오른 날 다음 시가 매도. 같은 날 종가로 사고팔지 않는다.
        rows = [(f"d{i:03d}", 100.0 + i * 0.1, 0, 0, 100.0 + i * 0.1) for i in range(205)]
        base = rows[-1][4]
        rows += [("s1", base, 0, 0, base * 0.97),                                         # 급락 → s1 종가에 신호(이날은 매매 없음)
                 ("b1", base * 0.96, 0, 0, base * 0.94),                                     # 시가 매수, 더 빠짐
                 ("b2", base * 0.94, 0, 0, base * 0.96),                                     # 오른 날 → 다음 시가 매도
                 ("x1", base * 0.97, 0, 0, base * 0.99)]
        p = dict(lab.SOXL_MR)
        dv, dec, nx = lab.soxl_meanrev(rows, p)
        by = {r["date"]: r for r in dec}
        self.assertEqual((by["s1"]["next"], by["s1"]["action"]), ("buy_open", "flat"))
        self.assertNotIn("s1", dv)
        self.assertEqual(by["b1"]["action"], "enter")
        self.assertAlmostEqual(dv["b1"], (0.94 / 0.96 - 1) * 100 - 0.1)
        self.assertAlmostEqual(dv["b2"], (0.96 / 0.94 - 1) * 100)
        self.assertEqual(by["b2"]["next"], "sell_open")
        self.assertEqual(by["x1"]["action"], "exit")
        self.assertAlmostEqual(dv["x1"], (0.97 / 0.96 - 1) * 100 - 0.1)
        self.assertEqual(by["x1"]["heldDays"], 2)
        # 계속 빠지면 5거래일째 종가 뒤 다음 시가에 무조건 판다
        rows2 = rows[:-3] + [(f"f{k}", base * (0.96 - k * 0.01), 0, 0, base * (0.955 - k * 0.01)) for k in range(7)]
        dv2, dec2, _ = lab.soxl_meanrev(rows2, p)
        ex = [r for r in dec2 if r["action"] == "exit"]
        self.assertEqual(ex[0]["date"], "f5")
        self.assertEqual(ex[0]["heldDays"], 5)
        self.assertEqual(max(r["heldDays"] or 0 for r in dec2), 5)

    def test_profit_factor(self):
        D = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
        z = lab.goal_metrics({D[0]: 3.0, D[1]: -1.0, D[2]: -2.0, D[3]: 1.0}, D)
        self.assertAlmostEqual(z["profitFactor"], 4.0 / 3.0)
        self.assertIsNone(lab.goal_metrics({D[0]: 1.0}, D[:1])["profitFactor"])

    def test_promotion_waits_then_needs_better_and_safe(self):
        off = {"tradeDays": 30, "totalPct": 5.0, "plus1Days": 6, "mddPct": -8.0, "gate": True}
        self.assertEqual(lab.promotion(off, {"tradeDays": 19, "totalPct": 50.0, "plus1Days": 9, "mddPct": -1.0, "gate": True})["code"], "collecting")
        self.assertEqual(lab.promotion(off, {"tradeDays": 20, "totalPct": 9.0, "plus1Days": 6, "mddPct": -12.0, "gate": True})["code"], "candidate")
        self.assertEqual(lab.promotion(off, {"tradeDays": 20, "totalPct": 9.0, "plus1Days": 5, "mddPct": -8.0, "gate": True})["code"], "keep")
        self.assertEqual(lab.promotion(off, {"tradeDays": 20, "totalPct": 9.0, "plus1Days": 7, "mddPct": -14.0, "gate": True})["code"], "keep")
        self.assertEqual(lab.promotion(off, {"tradeDays": 25, "totalPct": 9.0, "plus1Days": 7, "mddPct": -8.0, "gate": False})["code"], "keep")
        self.assertEqual(lab.promotion(off, {"tradeDays": 25, "totalPct": 5.0, "plus1Days": 7, "mddPct": -8.0, "gate": True})["code"], "keep")

    def test_week_summary_weights_and_us_shift(self):
        R = lambda *xs: {"rows": [{"date": d, "action": ac, "pnlPct": v} for d, ac, v in xs]}
        sm = {"opening_d1v2": R(("2026-10-05", "trade", 2.0), ("2026-10-06", "no_trade", 0.0)),
              "daytrading_etf": R(("2026-10-05", "trade", 1.0), ("2026-10-06", "trade", 1.0)),
              "crypto_btc": R(("2026-10-04", "hold", 9.0), ("2026-10-05", "hold", 2.0)),
              "crypto_eth": R(("2026-10-05", "flat", 0.0)),
              "us_soxl": R(("2026-10-02", "hold", 7.0), ("2026-10-09", "hold", 3.0)),
              "account": R(("2026-10-05", "trade", 3.0), ("2026-10-06", "trade", 2.0), ("2026-10-04", "trade", 9.0))}
        w = lab.week_summary(sm, "2026-10-09")
        self.assertEqual((w["weekStart"], w["weekEnd"]), ("2026-10-05", "2026-10-11"))
        self.assertAlmostEqual(w["parts"]["opening_d1v2"]["contribPct"], 0.3 * 0.5 * 2.0)
        self.assertAlmostEqual(w["parts"]["daytrading_etf"]["contribPct"], 0.3 * 0.5 * 1.0 + 0.3 * 1.0)
        self.assertAlmostEqual(w["parts"]["crypto_btc"]["contribPct"], 0.3 * 0.5 * 2.0)
        self.assertEqual(w["parts"]["crypto_eth"]["tradeDays"], 0)
        self.assertAlmostEqual(w["parts"]["us_soxl"]["contribPct"], 0.4 * 3.0)   # 10/2(지난주 금) 제외, 10/9 금 → 10/10 토(이번 주)
        self.assertAlmostEqual(w["account"]["weekPct"], (1.03 * 1.02 - 1) * 100)
        self.assertTrue(w["account"]["hit5"])
        self.assertEqual(w["account"]["plus1Days"], 2)

    def test_review_flags_order_failures_and_streaks(self):
        rep = {"paper": {"summary": {"opening_d1v2": {"status": {"code": "below", "text": "x"}, "lossStreak": 4}}}, "daily": {"rows": []}}
        old = lab.read_json
        lab.read_json = lambda p: {"ledger": {"events": [{"stage": "preopen", "payload": {"orders": [{"code": "000010", "vts": {"ok": False, "msg": "거절"}}], "picks": []}}]}}
        try:
            e = lab.review_entry(rep)
        finally:
            lab.read_json = old
        txt = " ".join(e["issues"])
        self.assertIn("preopen 주문 실패: 000010", txt)
        self.assertIn("규칙 점검", txt)
        self.assertIn("4일 연속 손실", txt)
        self.assertTrue(e["verdict"].startswith("점검 필요"))

    def test_daily_board_cells(self):
        self.assertEqual(lab.cell({"a": 1.5}, "a"), 1.5)
        self.assertEqual(lab.cell({"a": 1.5}, "b"), "no_trade")              # 기록 없는 날은 손실이 아니라 매매 없음
        self.assertEqual(lab.cell({}, "c", final_through="b"), "pending")     # 확정 일봉 전
        self.assertEqual(lab.cell({}, "c", final_through="b", live=lambda d: "no_trade"), "no_trade")
        self.assertEqual(lab.last_two(["d1", "d2", "d3"]), ["d2", "d3"])

    def test_gpt_compare_uses_gpt_window_only(self):
        old = lab.gpt_daily
        lab.gpt_daily = lambda tab: ({"2026-01-07": -1.0}, ["gpt_v1"], 1)
        try:
            cal = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]
            r = lab.tab_report("x", "n", "v", "r", {"2026-01-05": 5.0, "2026-01-08": 1.0}, cal, 250)
        finally:
            lab.gpt_daily = old
        self.assertEqual(r["compare"]["window"], ["2026-01-07", "2026-01-08"])
        self.assertAlmostEqual(r["compare"]["claude"]["totalPct"], 1.0)     # 01-05 의 +5% 는 GPT 기록 전이라 빼고 비교
        self.assertAlmostEqual(r["compare"]["gpt"]["totalPct"], -1.0)


if __name__ == "__main__":
    unittest.main()
