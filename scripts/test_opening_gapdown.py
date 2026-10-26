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
                {"stage": "preopen", "payload": {"picks": [{"code": "000010", "name": "N", "expectedPrice": op[-1] * 1.01, "expectedGapPct": -4.0,
                                                             "expectedPrice0856": op[-1] * 0.9, "expectedGapPct0856": -14.0}],
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
        self.assertAlmostEqual(r["openVsExpected0856Pct"], (1 / 0.9 - 1) * 100)          # 08:58 다시 보기 전(08:56) 값과의 차이도 잰다
        self.assertEqual(r["expectedGapPct0856"], -14.0)
        self.assertEqual(g.live_summary(rows)["openVsExpected0856Pct"]["n"], 1)
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

    def test_coin_breakout_rule_and_lookahead(self):
        from datetime import datetime, timedelta
        H = {}

        def day(d, o, hi_at=None, hi=None, lo=None, close=None):
            s0 = datetime.fromisoformat(d + "T09:00:00")
            for k in range(24):
                b = [o, o, o, o]
                if hi_at is not None and k == hi_at:
                    b = [o, hi, o, o]
                if lo is not None and hi_at is not None and k == hi_at + 1:
                    b = [o, o, lo, o]
                if k == 23 and close:
                    b = [o, o, o, close]
                H[(s0 + timedelta(hours=k)).isoformat()] = b
        base = datetime(2026, 9, 1)
        for i in range(21):
            day((base + timedelta(days=i)).date().isoformat(), 100.0 + i)        # 오르는 흐름, 고가 = 시가
        t1 = (base + timedelta(days=21)).date().isoformat()
        day(t1, 119.0, hi_at=5, hi=125.0, close=124.0)                            # 어제 고가 120 → 14시 봉에서 돌파
        t2 = (base + timedelta(days=22)).date().isoformat()
        day(t2, 124.0, hi_at=2, hi=130.0, lo=110.0, close=126.0)                  # 돌파 뒤 −5% 아래 → 손절
        dv, dec, nx, days = lab.coin_breakout(H, dict(lab.COIN_BO))
        by = {r["date"]: r for r in dec}
        e = 120.0 * 1.0005                                                        # 봉 시가 119 < 기준 120 → 기준선에 산다
        self.assertEqual(by[t1]["entryHour"], "14:00")
        self.assertAlmostEqual(dv[t1], (124.0 / e - 1) * 100 - 0.14)
        self.assertEqual(by[t2]["action"], "stop")
        self.assertAlmostEqual(dv[t2], -5 - 0.1 - 0.14)
        self.assertEqual(nx["basedOn"], t2)
        self.assertEqual(nx["levelNext"], 130.0)
        # 어제 종가가 평균 아래면 돌파해도 매매 없음 (t2 다음 날을 하락 흐름으로)
        t3 = (base + timedelta(days=23)).date().isoformat()
        day(t2, 124.0, close=90.0)
        day(t3, 91.0, hi_at=1, hi=200.0, close=150.0)
        _, dec3, _, _ = lab.coin_breakout(H, dict(lab.COIN_BO))
        self.assertEqual({r["date"]: r for r in dec3}[t3]["action"], "flat")

    def test_paper_settles_no_trade_from_ledger_and_account_waits(self):
        old = (lab.d1_live_status, lab.d1_live_reason, lab.etf_daily, lab.read_json, dict(lab.CAL), dict(lab.DECISIONS))
        try:
            lab.d1_live_status = lambda d: "no_trade" if d == "2026-10-01" else "pending"
            lab.d1_live_reason = lambda d: "no_expected_gap_down"
            lab.etf_daily = lambda: {}
            lab.read_json = lambda p: {"to": "2026-10-01"} if "etf-overnight" in str(p) else {}
            lab.CAL.clear(); lab.CAL.update(etf=["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], coin=["2026-10-03"], us=["2026-10-02"])
            lab.DECISIONS.clear()
            out = lab.paper_entries({}, {}, ["2026-09-29"], {}, {}, ["2026-10-01", "2026-10-02", "2026-10-03"])
            self.assertEqual([d for d, _ in out["opening_d1v2"]], ["2026-10-01"])          # 9/30 은 원본·확정 둘 다 없어 기다린다
            self.assertEqual(out["opening_d1v2"][0][1]["source"], "kis-vts-ledger")
            self.assertEqual([d for d, _ in out["daytrading_etf"]], ["2026-10-01"])        # ETF 일봉 확정일까지
            self.assertEqual(out["account"], [])                                          # 10/2 국내 미확정 → 계좌 기다림
            self.assertEqual(lab.kr_settled_through("2026-09-29", "2026-10-01", lab.CAL["etf"], "2026-10-01"), "2026-10-01")
            self.assertEqual(lab.kr_settled_through("2026-09-29", "2026-10-02", lab.CAL["etf"], "2026-09-29"), "2026-09-29")
        finally:
            lab.d1_live_status, lab.d1_live_reason, lab.etf_daily, lab.read_json = old[:4]
            lab.CAL.clear(); lab.CAL.update(old[4]); lab.DECISIONS.clear(); lab.DECISIONS.update(old[5])

    def test_fair_compare_same_dates_same_cost(self):
        old = (lab.claude_trades, lab.gpt_trades)
        try:
            lab.claude_trades = lambda tab: ({"2026-09-29": [dict(name="BTC", entry=100, exit=102, reason="다음 09시 청산", gross=2.0, slot=0.5)],
                                              "2026-09-20": [dict(name="BTC", entry=100, exit=110, reason="x", gross=10.0, slot=0.5)]},
                                             {"2026-09-29": (2, 2)})
            lab.gpt_trades = lambda tab: ({"2026-09-28": [dict(name="BTC", entry=100, exit=101, reason="익절", gross=1.0)],
                                           "2026-09-30": [dict(name="BTC", entry=100, exit=99, reason="손절", gross=-1.0)]}, {}, ["gpt_v1"])
            f = lab.fair_compare("crypto", ["2026-09-20", "2026-09-28", "2026-09-29", "2026-09-30"])
            self.assertEqual(f["window"], ["2026-09-28", "2026-09-30"])                  # GPT 기록 구간만 — 9/20 클로드 매매는 빠진다
            self.assertEqual(f["costPct"], {"claude": 0.14, "gpt": 0.14})
            self.assertEqual(f["claude"]["trades"], 1)
            self.assertAlmostEqual(f["claude"]["avgTradePct"], 2.0 - 0.14)
            self.assertAlmostEqual(f["days"][1]["claude"]["pnlPct"], (2.0 - 0.14) * 0.5)  # 코인 한쪽 몫(반)
            self.assertAlmostEqual(f["gpt"]["avgTradePct"], 0.0 - 0.14)
            self.assertEqual((f["gpt"]["wins"], f["gpt"]["losses"]), (1, 1))
            self.assertEqual(f["days"][0]["date"], "2026-09-30")
            lab.gpt_trades = lambda tab: ({}, {}, [])
            self.assertFalse(lab.fair_compare("soxl", ["2026-09-30"])["available"])
        finally:
            lab.claude_trades, lab.gpt_trades = old

    def test_fair_opening_uses_main_of_each_day(self):
        """⚖️ 같은 조건 비교 ①: 그날 효력 메인으로 고른다(옛 코드는 통과 5 이상 · 3종목 모두 하나로) · 연구 자료가 없는 날은 비교에서 뺀다."""
        old = (lab.DATA, list(lab.MAIN_EVENTS), lab.gpt_trades)
        with tempfile.TemporaryDirectory() as d:
            r = Path(d) / "opening-gapdown-research"
            r.mkdir()
            (r / "decisions.csv").write_text("date,gapDownCandidates,rsiPassed\n2026-10-08,38,5\n2026-10-14,50,6\n2026-10-15,434,40\n", encoding="utf-8")
            rows = [("2026-10-08", "가", -2.5, 1.0), ("2026-10-08", "나", -4.0, 2.0), ("2026-10-08", "다", -3.5, -1.0),
                    ("2026-10-14", "라", -5.0, 3.0), ("2026-10-15", "마", -8.5, -6.0), ("2026-10-15", "바", -2.5, 4.0), ("2026-10-15", "사", -6.8, -2.0)]
            (r / "signals.csv").write_text("date,name,gapPct,entryPrice,exitPrice,grossPnl,pnl\n" + "".join(
                f"{a},{b},{c},100,{100 + g},{g},{g}\n" for a, b, c, g in rows), encoding="utf-8")
            try:
                lab.DATA = Path(d)
                lab.MAIN_EVENTS[:] = [dict(tab="opening", version="g_open_q7_k3_gap3", name="m", rule="r", effectiveFrom="2026-10-13", promotedAt="x",
                                           params=dict(minQ=7, topK=3, gapMax=-3.0))]
                by, cands = lab.claude_trades("opening")
                self.assertEqual(sorted(t["name"] for t in by["2026-10-08"]), ["가", "나", "다"])   # 10/13 전: 옛 메인(통과 5 · 3종목 모두)
                self.assertNotIn("2026-10-14", by)                                                  # 통과 6 < 7 — 옛 코드는 '라'를 샀다
                self.assertEqual([t["name"] for t in by["2026-10-15"]], ["마", "사"])                 # 갭 −3% 이하만, 깊은 순
                lab.gpt_trades = lambda tab: ({"2026-10-08": [dict(name="x", entry=1, exit=1, reason="", gross=0.0)],
                                               "2026-10-16": [dict(name="y", entry=1, exit=1, reason="", gross=0.0)]}, {}, ["v"])
                f = lab.fair_compare("opening", ["2026-10-08", "2026-10-14", "2026-10-15", "2026-10-16"])
                self.assertEqual(f["window"], ["2026-10-08", "2026-10-15"])                         # 10/16 은 연구 자료 전 — '매매 없음'으로 넣지 않는다
                self.assertEqual((f["claude"]["trades"], f["claude"]["wins"]), (5, 2))
            finally:
                lab.DATA, lab.gpt_trades = old[0], old[2]
                lab.MAIN_EVENTS[:] = old[1]

    def test_us_open_session_dropped(self):
        from datetime import datetime, timezone
        bars = {"2026-10-01": 1, "2026-10-02": 2}
        # 뉴욕 10/2 11:00(장중) → 10/2 봉 버림 · 16:20(마감 뒤) → 씀
        self.assertEqual(sorted(lab.drop_open_session(bars, datetime(2026, 10, 2, 15, 0, tzinfo=timezone.utc))), ["2026-10-01"])
        self.assertEqual(sorted(lab.drop_open_session(bars, datetime(2026, 10, 2, 20, 20, tzinfo=timezone.utc))), ["2026-10-01", "2026-10-02"])
        # 겨울(EST): 20:20 UTC = 뉴욕 15:20 → 아직 장중
        self.assertEqual(sorted(lab.drop_open_session({"2026-12-01": 1}, datetime(2026, 12, 1, 20, 20, tzinfo=timezone.utc))), [])

    def test_duel_live_records_only_same_start_same_cost(self):
        old = (lab.claude_closed_records, lab.gpt_trades, lab.gpt_coverage)
        try:
            recs = {"2026-10-02": {"status": "closed", "trades": [{"name": "X", "entryPrice": 100, "exitPrice": 110}]},          # 시작일 전 → 제외
                    "2026-10-05": {"status": "closed", "trades": [{"name": "BTC", "entryPrice": 100, "exitPrice": 102}]},
                    "2026-10-06": {"status": "closed", "trades": []},
                    "2026-10-07": {"status": "closed", "trades": [{"name": "ETH", "entryPrice": 100, "exitPrice": 99}]}}          # GPT 기록 없음 → 대기
            lab.claude_closed_records = lambda tab: recs if tab == "crypto" else {}
            lab.gpt_trades = lambda tab: ({"2026-10-05": [dict(name="BTC", entry=100, exit=100.5, reason="익절", gross=0.5)]} if tab == "crypto" else {}, {}, ["g1"])
            lab.gpt_coverage = lambda tab: {"2026-10-05", "2026-10-06"} if tab == "crypto" else set()
            t = lab.duel_tab("crypto")
            self.assertEqual([r["date"] for r in t["days"]], ["2026-10-05", "2026-10-06"])
            d5 = t["days"][0]
            self.assertAlmostEqual(d5["claude"]["pnlPct"], (2.0 - 0.14) * 0.5)          # 코인 한쪽 몫
            self.assertAlmostEqual(d5["gpt"]["pnlPct"], 0.5 - 0.14)
            self.assertEqual(d5["winner"], "claude")
            self.assertEqual(t["days"][1]["winner"], "draw")                               # 둘 다 매매 없음 0%
            self.assertEqual(t["record"], {"claude": 1, "gpt": 0, "draw": 1})
            self.assertEqual(t["pending"], [{"date": "2026-10-07", "missing": "GPT"}])
            full = lab.duel()
            self.assertAlmostEqual(full["total"]["days"][0]["claudePct"], 0.25 * (2.0 - 0.14) * 0.5)   # 합계는 4탭 균등
            self.assertEqual(full["latest"], "2026-10-06")
        finally:
            lab.claude_closed_records, lab.gpt_trades, lab.gpt_coverage = old

    def test_kr_calendar_includes_today_only_after_close(self):
        from datetime import datetime
        f = lambda: ["2026-10-01", "2026-10-02"]
        self.assertEqual(lab.kr_calendar(datetime(2026, 10, 2, 15, 30, tzinfo=lab.KST), f), ["2026-10-01"])
        self.assertEqual(lab.kr_calendar(datetime(2026, 10, 2, 16, 5, tzinfo=lab.KST), f), ["2026-10-01", "2026-10-02"])

    def test_coin_breakout_last_entry_hour_shadow(self):
        from datetime import datetime, timedelta
        H = {}
        base = datetime(2026, 9, 1)
        for i in range(22):
            s0 = datetime.fromisoformat((base + timedelta(days=i)).date().isoformat() + "T09:00:00")
            o = 100.0 + i
            for k in range(24):
                H[(s0 + timedelta(hours=k)).isoformat()] = [o, o, o, o]
        last = (base + timedelta(days=21)).date().isoformat()
        s0 = datetime.fromisoformat(last + "T09:00:00")
        for k in range(24):
            H[(s0 + timedelta(hours=k)).isoformat()] = [119.0, 119.5, 118.0, 119.0]         # 어제 고가 120 아래
        H[(s0 + timedelta(hours=13)).isoformat()] = [119.0, 130.0, 119.0, 125.0]          # 22시 돌파
        _, dec, _, _ = lab.coin_breakout(H, dict(lab.COIN_BO))
        self.assertEqual({r["date"]: r for r in dec}[last]["entryHour"], "22:00")
        _, dec2, _, _ = lab.coin_breakout(H, dict(lab.COIN_BO, lastEntryHour=21))
        self.assertEqual({r["date"]: r for r in dec2}[last]["action"], "no_break")

    def test_recent_curves_window_and_compounding(self):
        c = lab.recent_curves({"x": ({"2026-09-01": 50.0, "2026-09-20": 10.0, "2026-09-25": -10.0}, ["2026-09-01", "2026-09-20", "2026-09-25", "2026-10-03"])},
                              "2026-10-02", days=20)
        pts = c["series"]["x"]
        self.assertEqual([p["date"] for p in pts], ["2026-09-20", "2026-09-25"])          # 창 밖(9/1)과 미래(10/3) 제외
        self.assertAlmostEqual(pts[-1]["cumPct"], (1.1 * 0.9 - 1) * 100)
        self.assertEqual(c["source"], "reconstructed")
        self.assertEqual(c["tradeDays"], {"x": 2})

    def test_profit_factor(self):
        D = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
        z = lab.goal_metrics({D[0]: 3.0, D[1]: -1.0, D[2]: -2.0, D[3]: 1.0}, D)
        self.assertAlmostEqual(z["profitFactor"], 4.0 / 3.0)
        self.assertIsNone(lab.goal_metrics({D[0]: 1.0}, D[:1])["profitFactor"])

    def test_week_summary_weights_and_us_shift(self):
        R = lambda *xs: {"rows": [{"date": d, "action": ac, "pnlPct": v} for d, ac, v in xs]}
        sm = {"opening_d1v2": R(("2026-10-05", "trade", 2.0), ("2026-10-06", "no_trade", 0.0)),
              "daytrading_etf": R(("2026-10-05", "trade", 1.0), ("2026-10-06", "trade", 1.0)),
              "coin_bo_btc": R(("2026-10-04", "hold", 9.0), ("2026-10-05", "hold", 2.0)),
              "coin_bo_eth": R(("2026-10-05", "flat", 0.0)),
              "us_soxl": R(("2026-10-02", "hold", 7.0), ("2026-10-09", "hold", 3.0)),
              "account": R(("2026-10-05", "trade", 3.0), ("2026-10-06", "trade", 2.0), ("2026-10-04", "trade", 9.0))}
        w = lab.week_summary(sm, "2026-10-09")
        self.assertEqual((w["weekStart"], w["weekEnd"]), ("2026-10-05", "2026-10-11"))
        self.assertAlmostEqual(w["parts"]["opening_d1v2"]["contribPct"], 0.3 * 0.5 * 2.0)
        self.assertAlmostEqual(w["parts"]["daytrading_etf"]["contribPct"], 0.3 * 0.5 * 1.0 + 0.3 * 1.0)
        self.assertAlmostEqual(w["parts"]["coin_bo_btc"]["contribPct"], 0.3 * 0.5 * 2.0)
        self.assertEqual(w["parts"]["coin_bo_eth"]["tradeDays"], 0)
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

    def test_daily_board_same_kst_dates(self):
        # 오늘 탭: 모든 전략이 같은 한국 날짜(어제 10/5 · 오늘 10/6). 10/5 는 개천절 대체휴일, 미국 10/4(일)은 휴장.
        today, hm = "2026-10-06", 1930
        self.assertEqual(lab.kr_cell({}, "2026-10-05", today, hm), "holiday")
        self.assertEqual(lab.kr_cell({"2026-10-06": 0.4}, "2026-10-06", today, hm, wait_close=True), 0.4)
        self.assertEqual(lab.kr_cell({}, "2026-10-06", today, 1000, wait_close=True), "pending")     # 장 마감 확정 전
        self.assertEqual(lab.kr_cell({}, "2026-10-06", today, hm), "no_trade")
        cal = ["2026-10-04", "2026-10-05"]                                                           # 업비트 하루(09시 시작)
        self.assertEqual(lab.coin_cell({"2026-10-05": -0.5}, "2026-10-05", cal), -0.5)
        self.assertEqual(lab.coin_cell({}, "2026-10-06", cal), "pending")                          # 10/6 09시~10/7 09시 진행 중
        ucal = ["2026-10-01", "2026-10-02", "2026-10-05"]                                            # 뉴욕 거래일
        self.assertEqual(lab.us_cell({"2026-10-05": 1.2}, "2026-10-06", ucal), 1.2)                 # 한국 10/6 = 뉴욕 10/5 밤
        self.assertEqual(lab.us_cell({}, "2026-10-05", ucal), "holiday")                            # 뉴욕 10/4(일)
        self.assertEqual(lab.us_cell({}, "2026-10-07", ucal), "pending")

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

    def test_gpt_daily_skips_blank_values(self):
        # 2026-10-05 밤 계산이 죽은 원인: 빈 손익 칸(미청산)이 '빈 날짜'를 만들고 평균에서 예외. 빈 값은 날짜째 건너뛴다.
        with tempfile.TemporaryDirectory() as tmp:
            old_data, old_files = lab.DATA, dict(lab.GPT_FILES)
            lab.DATA = lab.Path(tmp)
            try:
                (lab.DATA / "g.csv").write_text("date,pnl,strategyVersion\n2026-10-01,1.5,v1\n2026-10-02,,v1\n2026-10-02,nan,v1\n2026-10-03,-1,v1\n2026-10-03,2,v1\n", encoding="utf-8")
                lab.GPT_FILES["soxl"] = ("g.csv", "pnl")
                d, ver, n = lab.gpt_daily("soxl")
            finally:
                lab.DATA, lab.GPT_FILES = old_data, old_files
                lab.GPT_FILES.update(old_files)
        self.assertEqual(sorted(d), ["2026-10-01", "2026-10-03"])
        self.assertAlmostEqual(d["2026-10-03"], 0.5)
        self.assertEqual(ver, ["v1"])
        self.assertEqual(n, 5)


class OrderSettleTest(unittest.TestCase):
    """①②⑤ 주문 정산(2026-10-22 사용자 "모의계좌로 판단하지 말고 그냥 모의계좌에 주문한 건으로 정산") — 밤 계산은 Pages 마감 장부 값을 그대로 쓴다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = (lab.DATA, dict(lab.ORDERS), dict(lab.CAL), dict(lab.DECISIONS), lab.ETF_PW, lab.C30_PW, lab.d1_live_status, lab.d1_live_reason, lab.read_json)
        lab.DATA = Path(self.tmp.name)

    def tearDown(self):
        lab.DATA = self.old[0]
        lab.ORDERS.clear(); lab.ORDERS.update(self.old[1])
        lab.CAL.clear(); lab.CAL.update(self.old[2])
        lab.DECISIONS.clear(); lab.DECISIONS.update(self.old[3])
        lab.ETF_PW, lab.C30_PW, lab.d1_live_status, lab.d1_live_reason, lab.read_json = self.old[4:]
        self.tmp.cleanup()

    def put_live(self, d, **recs):
        f = lab.DATA / "claude-live" / f"{d}.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(dict(ok=True, date=d, ledger=dict(events=[dict(id="close:" + k, payload=v) for k, v in recs.items()]))), encoding="utf-8")

    def put_copy(self, d, **recs):
        f = lab.DATA / "claude-settle" / f"{d}.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(dict(date=d, records=recs)), encoding="utf-8")

    @staticmethod
    def rec(v, settled=True, basis="orders", **kw):
        return dict(dict(status="closed", basis=basis, settled=settled, dayPct=v, trades=[], strategyVersion="g_open_q7_k3_gap3"), **kw)

    def test_records_prefer_worker_then_nightly_and_only_settled(self):
        old_fmt = dict(status="closed", trades=[], open=[], note="메인 매매일(통과 9종목)")          # 10/22 15:40 Worker 저장분(체결 기준 · 0건)
        self.put_live("2026-10-21", opening=self.rec(9.0))                                          # SETTLE_FROM 전 — 안 쓴다
        self.put_live("2026-10-22", opening=old_fmt, daytrading=dict(status="closed", trades=[]))
        self.put_copy("2026-10-22", opening=self.rec(-2.486), daytrading=self.rec(None))            # 밤 사본(Pages 같은 계산)
        self.put_live("2026-10-23", opening=self.rec(1.2), daytrading=self.rec(0.4), close30=self.rec(-0.3))
        self.put_copy("2026-10-23", opening=self.rec(7.7))                                          # Worker 장부가 확정이면 그것이 정본
        self.put_live("2026-10-26", opening=self.rec(None, settled=False), close30=self.rec(0.5, basis=None))   # 확정 전 · 옛 형식 → 대기
        o = lab.load_orders()
        self.assertEqual({d: (x["v"], x["src"]) for d, x in o["opening"].items()}, {"2026-10-22": (-2.486, "nightly"), "2026-10-23": (1.2, "worker")})
        self.assertEqual({d: (x["v"], x["src"]) for d, x in o["daytrading"].items()}, {"2026-10-22": (None, "nightly"), "2026-10-23": (0.4, "worker")})
        self.assertEqual({d: x["v"] for d, x in o["close30"].items()}, {"2026-10-23": -0.3})
        self.assertEqual(lab.claude_closed_records("opening")["2026-10-22"]["dayPct"], -2.486)     # 대결도 주문 정산 장부
        self.assertEqual(lab.claude_closed_records("opening")["2026-10-21"]["dayPct"], 9.0)        # 그 전 날은 Worker 장부 그대로

    def test_apply_orders_and_cells(self):
        lab.ORDERS.clear()
        lab.ORDERS.update(opening={"2026-10-22": dict(v=-2.486, src="nightly", rec={}), "2026-10-23": dict(v=None, src="worker", rec={})}, daytrading={}, close30={})
        rule = {"2026-10-21": 3.0, "2026-10-22": 5.0, "2026-10-26": 4.0}                          # 연구 규칙 값(그날 고른 종목이 다를 수 있다)
        s = lab.apply_orders(rule, "opening")
        self.assertEqual(s, {"2026-10-21": 3.0, "2026-10-22": -2.486})                              # 10/22~ 는 주문 정산 값만 · 확정 안 된 10/26 은 빠진다
        self.assertEqual(lab.apply_orders(s, "opening"), s)                                         # 두 번 적용해도 같다
        before = lambda d: "before:" + str(d)
        cell = lambda d: lab.order_cell("opening", s, d, "2026-10-26", before)
        self.assertEqual([cell("2026-10-21"), cell("2026-10-22"), cell("2026-10-23"), cell("2026-10-24"), cell("2026-10-26"), cell("2026-10-27")],
                         ["before:2026-10-21", -2.486, "no_trade", "holiday", "pending", None])
        self.assertEqual(lab.apply_orders({"2026-10-22": 5.0, "2026-10-23": 1.0}, "close30"), {"2026-10-22": 5.0})   # ⑤ 는 채택일(10/23)부터 주문 정산

    def test_paper_and_account_use_order_settlement(self):
        lab.d1_live_status = lambda d: "pending"
        lab.d1_live_reason = lambda d: ""
        lab.read_json = lambda p, _r=lab.read_json: {"to": "2026-10-23"} if "etf-overnight" in str(p) else _r(p) if "claude-" in str(p) else {}
        lab.CAL.clear()
        lab.CAL.update(etf=["2026-10-21", "2026-10-22", "2026-10-23"], coin=["2026-10-22", "2026-10-23"], us=["2026-10-22"], close30=["2026-10-23"])
        lab.DECISIONS.clear()
        tr = [dict(name="금호타이어", code="073240", entryTime="09:00 시가(동시호가)", entryPrice=5460, exitTime="15:30 종가(동시호가)", exitPrice=5330, qty=382,
                   pnlPct=-3.0, vts=dict(ok=False, msg="매수 생략 — 매수가능 0주(계좌 현금 부족)"), signal=dict(at="08:58:15", expectedGapPct=-4.74, expectedPrice=5230))]
        lab.ORDERS.clear()
        lab.ORDERS.update(opening={"2026-10-22": dict(v=-2.486, src="nightly", rec=self.rec(-2.486, trades=tr, warn="모의계좌 주문 안 됨 3건"))},
                          daytrading={"2026-10-22": dict(v=None, src="nightly", rec=self.rec(None)), "2026-10-23": dict(v=0.8, src="worker", rec=self.rec(0.8))},
                          close30={"2026-10-23": dict(v=None, src="worker", rec=self.rec(None))})
        lab.ETF_PW = {"2026-10-21": 1.0, "2026-10-22": 7.0, "2026-10-23": 0.5}                    # 규칙 값 — 10/22~ 는 주문 정산 값으로
        lab.C30_PW = {}
        d1_rule = {"2026-10-20": 2.0, "2026-10-22": 4.0}
        out = lab.paper_entries({}, d1_rule, ["2026-10-20", "2026-10-21"], {"2026-10-22": 1.0, "2026-10-23": 1.0}, {}, ["2026-10-22", "2026-10-23"])
        o1 = dict(out["opening_d1v2"])
        self.assertEqual(sorted(o1), ["2026-10-20", "2026-10-21", "2026-10-22"])                  # 10/23 ① 은 확정 전 — 기다린다
        r = o1["2026-10-22"]
        self.assertEqual((r["action"], r["pnlPct"], r["source"], r["strategyVersion"], r["liveVersion"], r["warn"]),
                         ("trade", -2.486, "orders:nightly", lab.main_for("opening", "2026-10-22")["version"], "g_open_q7_k3_gap3", "모의계좌 주문 안 됨 3건"))
        self.assertEqual((r["trades"][0]["entryPrice"], r["trades"][0]["exitPrice"], r["trades"][0]["qty"], r["trades"][0]["vtsOk"]), (5460, 5330, 382, False))
        self.assertEqual(r["trades"][0]["signal"], dict(at="08:58:15", expectedGapPct=-4.74, expectedPrice=5230))   # 신호 낸 조건도 장부에
        self.assertEqual((o1["2026-10-20"]["pnlPct"], o1["2026-10-20"]["source"]), (2.0, "kis-vts+final-daily-bars"))   # 그 전 날은 옛 규칙 그대로
        e2 = dict(out["daytrading_etf"])
        self.assertEqual([(d, e2[d]["action"], e2[d]["pnlPct"]) for d in sorted(e2)], [("2026-10-20", "no_trade", 0.0), ("2026-10-21", "trade", 1.0), ("2026-10-22", "no_trade", 0.0), ("2026-10-23", "trade", 0.8)])   # 규칙 값 7.0 · 0.5 가 아니라 주문 정산
        self.assertEqual([(d, r["action"]) for d, r in out["close30_etf"]], [("2026-10-23", "no_trade")])
        self.assertEqual(lab.kr_settled_through("2026-10-21", "2026-10-23", lab.CAL["etf"], "2026-10-21", "2026-10-23", lab.ORDERS), "2026-10-22")   # 10/23 ① 확정 전
        self.assertEqual(lab.kr_settled_through("2026-10-21", "2026-10-23", lab.CAL["etf"], "2026-10-21", "2026-10-23"), "2026-10-21")   # orders 없이 부르면 옛 규칙(① 확정 일봉 기다림)
        acct = dict(out["account"])
        self.assertEqual(sorted(acct), ["2026-10-22"])                                              # 국내는 10/22 까지 확정
        for k, rows in out.items():
            self.assertEqual(len(rows), len({d for d, _ in rows}), k)                                # 같은 날 두 줄 없음
        late = lab.paper_entries({}, d1_rule, ["2026-10-20", "2026-10-21", "2026-10-22"], {"2026-10-22": 1.0}, {}, ["2026-10-22"])   # 확정 일봉이 10/22 까지 와도
        for k in ("opening_d1v2", "daytrading_etf", "close30_etf"):
            self.assertEqual(len(late[k]), len({d for d, _ in late[k]}), k)                          # 10/22~ 는 주문 정산 한 줄만(규칙 값 줄을 따로 쓰지 않는다)
        self.assertEqual(dict(late["opening_d1v2"])["2026-10-22"]["source"], "orders:nightly")
        self.assertAlmostEqual(acct["2026-10-22"]["pnlPct"], lab.account_daily({"2026-10-22": -2.486}, {"2026-10-22": 1.0, "2026-10-23": 1.0}, {}, ["2026-10-22"])["2026-10-22"])

    def test_fetch_settle_copies_only_settled_once(self):
        calls = []
        def post(url, body, key):
            calls.append((body["date"], body["strategy"]))
            self.assertTrue(url.endswith("/api/claude-telegram")); self.assertEqual((body["op"], key), ("close", "k"))
            if body["strategy"] == "daytrading" and body["date"] == "2026-10-23":
                raise OSError("timeout")
            v = {"opening": -2.486, "daytrading": None, "close30": 0.3}[body["strategy"]]
            return dict(ok=True, result=self.rec(v, settled=body["date"] != "2026-10-26"))
        self.put_live("2026-10-23", opening=self.rec(1.2))                                          # Worker 장부가 이미 확정 — 부르지 않는다
        now = datetime(2026, 10, 26, 15, 50, tzinfo=lab.KST)                                        # 월요일 16:00 전 — 오늘은 건너뛴다
        self.assertEqual(lab.fetch_settle_copies(now, post, key=""), dict(skipped="감시키 없음"))
        r = lab.fetch_settle_copies(now, post, key="k")
        self.assertEqual(sorted(calls), [("2026-10-22", "daytrading"), ("2026-10-22", "opening"), ("2026-10-23", "close30"), ("2026-10-23", "daytrading")])   # 주말 · 10/22 전 · ⑤ 채택일 전 안 부름
        self.assertEqual(sorted(r["got"]), ["2026-10-22:daytrading", "2026-10-22:opening", "2026-10-23:close30"])
        self.assertEqual([e["tab"] for e in r["errors"]], ["daytrading"])
        j = json.loads((lab.DATA / "claude-settle" / "2026-10-22.json").read_text(encoding="utf-8"))
        self.assertEqual((j["records"]["opening"]["dayPct"], j["records"]["opening"]["copiedAt"], j["source"]), (-2.486, "2026-10-26T15:50:00+09:00", "pages-claude-telegram-op-close(nightly)"))
        calls.clear()
        r2 = lab.fetch_settle_copies(datetime(2026, 10, 26, 18, 40, tzinfo=lab.KST), post, key="k")   # 다시 돌면 받은 것은 그대로 · 남은 것만
        self.assertEqual(sorted(calls), [("2026-10-23", "daytrading"), ("2026-10-26", "close30"), ("2026-10-26", "daytrading"), ("2026-10-26", "opening")])
        self.assertEqual(r2["got"], [])                                                             # 10/26 은 확정 전(settled false) — 저장 안 함
        self.assertFalse((lab.DATA / "claude-settle" / "2026-10-26.json").exists())
        self.assertEqual(json.loads((lab.DATA / "claude-settle" / "2026-10-22.json").read_text(encoding="utf-8"))["records"]["opening"]["copiedAt"], "2026-10-26T15:50:00+09:00")


class ReviewHolidayTest(unittest.TestCase):
    """밤 점검: 휴장일(10/5 개천절 대체휴일)엔 ①② 원본이 없어도 정상, 개장일(10/6)엔 '원본 없음' 점검. 주문 실패는 날과 상관없이 점검."""

    def at(self, day, ledger):
        class FixedDT(lab.datetime):
            @classmethod
            def now(cls, tz=None):
                return lab.datetime.fromisoformat(day + "T20:00:00+09:00")
        old = (lab.datetime, lab.read_json)
        lab.datetime, lab.read_json = FixedDT, (lambda p: ledger)
        try:
            return " ".join(lab.review_entry({"paper": {"summary": {}}, "daily": {"rows": []}}).get("issues") or [])
        finally:
            lab.datetime, lab.read_json = old

    def test_holiday_vs_open_day(self):
        self.assertNotIn("원본 기록 없음", self.at("2026-10-05", {}))
        self.assertIn("원본 기록 없음", self.at("2026-10-06", {}))
        bad = {"ledger": {"events": [{"stage": "preopen", "payload": {"orders": [{"code": "000010", "vts": {"ok": False, "msg": "휴장"}}]}}]}}
        self.assertIn("preopen 주문 실패: 000010", self.at("2026-10-05", bad))


lab_read = lab.read_json


class ReviewLateRunTest(unittest.TestCase):
    """밤 점검 기록 날짜: 16시 이후는 오늘, 저녁 계산이 자정을 넘겨 늦게 돌면(0~8시) 어제 것 — 어제 칸 결과로. 장중은 안 씀(10/8 · 10/13 기록 누락 재현)."""

    def test_review_day(self):
        at = lambda s: lab.datetime.fromisoformat(s + "+09:00")
        self.assertEqual(lab.review_day(at("2026-10-13T18:40:00")), "2026-10-13")
        self.assertEqual(lab.review_day(at("2026-10-14T02:06:00")), "2026-10-13")   # 23:40 예약이 02:06 에 돈 날
        self.assertEqual(lab.review_day(at("2026-10-14T07:13:00")), "2026-10-13")
        self.assertIsNone(lab.review_day(at("2026-10-14T12:05:00")))                # 장중엔 안 씀

    def test_late_run_writes_yesterday_with_prev_cells(self):
        import tempfile
        rep = {"paper": {"summary": {}}, "daily": {"rows": [
            dict(side="claude", group="시초가", name="①", prevDate="2026-10-13", prev=-0.9, lastDate="2026-10-14", last="pending", plan="p"),
            dict(side="gpt", group="시초가", name="g", prevDate="2026-10-13", prev=1.0, lastDate="2026-10-14", last=2.0)]}}
        led = {"ledger": {"events": [{"stage": "preopen", "payload": {"picks": [{"name": "펩트론"}], "breadth": {"qualified": 30}, "orders": []}}]}}
        old = (lab.REVIEW, lab.read_json)
        with tempfile.TemporaryDirectory() as d:
            lab.REVIEW = Path(d)
            lab.read_json = lambda p: led if str(p).endswith("2026-10-13.json") else ({} if "opening-gapdown-live" in str(p) else lab_read(p))
            try:
                lab.write_review(rep, lab.datetime.fromisoformat("2026-10-14T02:06:00+09:00"))
                lab.write_review(rep, lab.datetime.fromisoformat("2026-10-14T12:05:00+09:00"))     # 장중 — 쓰지 않는다
                files = sorted(x.name for x in Path(d).glob("*.json"))
                e = json.loads((Path(d) / "2026-10-13.json").read_text(encoding="utf-8"))
            finally:
                lab.REVIEW, lab.read_json = old
        self.assertEqual(files, ["2026-10-13.json"])
        self.assertEqual(e["date"], "2026-10-13")
        self.assertEqual(e["tabs"]["시초가"], dict(name="①", date="2026-10-13", result=-0.9, plan="p"))   # 어제 칸 값
        self.assertEqual(e["opening"]["breadth"], 30)                                                      # 어제 원본 기록
        self.assertNotIn("원본 기록 없음", " ".join(e["issues"]))


class CoinParityTest(unittest.TestCase):
    """③ 같은 규칙을 밤 계산(Python)과 실시간·마감 장부(JS)가 각자 계산한다 — 변수를 바꿔도 결과가 같아야 한다."""

    def test_python_and_js_agree_on_variants(self):
        import random
        import subprocess
        rnd = random.Random(7)
        H, px, t0 = {}, 100.0, lab.datetime(2026, 8, 1, 9)
        for k in range(24 * 45):
            o = px
            c = max(1.0, o * (1 + rnd.gauss(0.0004, 0.012)))
            hi, lo = max(o, c) * (1 + abs(rnd.gauss(0, 0.004))), min(o, c) * (1 - abs(rnd.gauss(0, 0.004)))
            H[(t0 + lab.timedelta(hours=k)).isoformat()] = (o, hi, lo, c)
            px = c
        Dd = lab.upbit_days(H)
        days = sorted(Dd)
        variants = [dict(), dict(ma=10, stopPct=3.0), dict(level="vb", k=0.5), dict(lastEntryHour=15, stopPct=2.0), dict(ma=5, level="vb", k=0.3, lastEntryHour=21),
                    dict(hiN=3), dict(hiN=5, stopPct=99.0, ma=10), dict(hiN=2, lastEntryHour=18)]
        cases, py = [], []
        for v in variants:
            P = dict(lab.MAIN_DEFAULT["crypto"]["params"], **v)
            _, dec, _, _ = lab.coin_breakout(H, dict(lab.COIN_BO, **P, version="x"))
            for r in dec[-15:]:
                i = days.index(r["date"])
                daily = [dict(candle_date_time_kst=d + "T09:00:00", opening_price=Dd[d][0], high_price=Dd[d][1], low_price=Dd[d][2], trade_price=Dd[d][3])
                         for d in reversed(days[:i + 1])]
                s0 = lab.datetime.fromisoformat(r["date"] + "T09:00:00")
                bars = [dict(candle_date_time_kst=(s0 + lab.timedelta(hours=k)).isoformat(), opening_price=H[(s0 + lab.timedelta(hours=k)).isoformat()][0],
                             high_price=H[(s0 + lab.timedelta(hours=k)).isoformat()][1], low_price=H[(s0 + lab.timedelta(hours=k)).isoformat()][2],
                             trade_price=H[(s0 + lab.timedelta(hours=k)).isoformat()][3]) for k in range(24)]
                cases.append(dict(P=P, daily=daily, bars=bars))
                py.append(dict(action=r["action"], entry=r["entryPrice"], pnl=r["pnlPct"], level=r["level"]))
        api_dir = os.environ.get("JKQ_API_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "functions", "api")
        api = os.path.join(api_dir, "claude-live.js")
        js = ("import * as LV from " + json.dumps("file://" + os.path.abspath(api)) + ";"
              "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const out=JSON.parse(s).map(c=>{const h=LV.coinHoldToday(c.daily,c.P);"
              "const r=LV.coinBreakoutDay(h,c.bars,c.bars[23].trade_price,c.P);"
              "return {action:!h.hold?'flat':!r.hold?'no_break':r.stopped?'stop':'trade',entry:r.hold?r.buyPrice:null,pnl:r.hold?r.pnlPct:null,level:h.level};});"
              "process.stdout.write(JSON.stringify(out));});")
        res = subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(cases), capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr[-500:])
        out = json.loads(res.stdout)
        self.assertEqual(len(out), len(py))
        acts = set()
        for a, b in zip(py, out):
            self.assertEqual(a["action"], b["action"])
            self.assertAlmostEqual(a["level"], b["level"], places=6)              # 기준선(최근 N일 고가 · 변동성 돌파)도 같아야
            acts.add(a["action"])
            if a["entry"] is not None:
                self.assertAlmostEqual(a["entry"], b["entry"], places=6)
                self.assertAlmostEqual(a["pnl"], b["pnl"], places=6)
        self.assertTrue({"trade", "no_break"} <= acts, acts)                  # 여러 경우가 실제로 나왔는지


class SoxlParamsTest(unittest.TestCase):
    """④ 변수: 평균 조건(ma, 0=없음) · 메인 교체 구간 매수 막기 · 교체는 앞 규칙이 다 판 뒤(겹치지 않음)."""

    def rows(self, closes, start="2026-01-01"):
        d0 = lab.date.fromisoformat(start)
        return [((d0 + lab.timedelta(days=i)).isoformat(), c, c, c, c) for i, c in enumerate(closes)]

    def test_ma_filter_and_switch_blocks(self):
        base = dict(lab.SOXL_MR, rsiMax=20.0, rsiN=2, maxHoldDays=5, size=1.0)
        down = [100.0] * 5 + [90.0, 80.0, 70.0, 75.0, 80.0, 85.0]                 # 이틀 급락 뒤 반등
        r = self.rows(down)
        _, dec_ma, _ = lab.soxl_meanrev(r, dict(base, ma=5))                        # 종가 70 < 5일 평균 → 사지 않음
        _, dec_no, _ = lab.soxl_meanrev(r, dict(base, ma=0))                        # 평균 조건 없음 → 다음 시가 매수
        self.assertFalse(any(x["action"] == "enter" for x in dec_ma))
        self.assertTrue(any(x["action"] == "enter" for x in dec_no))
        ent = next(x["date"] for x in dec_no if x["action"] == "enter")
        _, dec_blk, _ = lab.soxl_meanrev(r, dict(base, ma=0), no_entry_from=ent)     # 교체 효력일부터는 새로 사지 않음
        self.assertFalse(any(x["action"] == "enter" for x in dec_blk))
        late = (lab.date.fromisoformat(ent) + lab.timedelta(days=1)).isoformat()
        _, dec_late, _ = lab.soxl_meanrev(r, dict(base, ma=0), entry_from=late)
        enters = [x["date"] for x in dec_late if x["action"] == "enter"]
        self.assertTrue(enters and min(enters) >= late)                           # 교체일 전 시가에는 새 규칙이 사지 않고, 그 뒤 새 신호로만 산다

    def test_piecewise_switch_waits_until_flat(self):
        old = list(lab.MAIN_EVENTS)
        try:
            closes = [100.0] * 210 + [90.0, 80.0, 70.0, 72.0, 71.0, 75.0, 80.0, 82.0, 84.0]
            r = self.rows(closes, "2025-01-01")
            _, _, dec0, _ = lab.soxl_series(dict(lab.MAIN_DEFAULT["soxl"]["params"], ma=0), r)
            ent = next(x["date"] for x in dec0 if x["action"] == "enter")
            eff = (lab.date.fromisoformat(ent) + lab.timedelta(days=1)).isoformat()        # 보유 중에 효력일
            lab.MAIN_EVENTS[:] = [dict(tab="soxl", version="x_new", name="x", rule="", effectiveFrom=eff, promotedAt="t",
                                       params=dict(lab.MAIN_DEFAULT["soxl"]["params"], ma=0, rsiN=3))]
            orig = lab.MAIN_DEFAULT["soxl"]["params"]["ma"]
            lab.MAIN_DEFAULT["soxl"]["params"]["ma"] = 0
            try:
                _, full, dec, nx, sw = lab.soxl_piecewise(r)
            finally:
                lab.MAIN_DEFAULT["soxl"]["params"]["ma"] = orig
            swd = sw[0]["switchDate"]
            exit_d = next(x["date"] for x in dec if x["action"] == "exit")
            self.assertGreater(swd, exit_d)                                         # 앞 규칙이 판 다음 거래일부터 새 규칙
            self.assertTrue(all(x["strategyVersion"] == "x_new" for x in dec if x["date"] >= swd))
            self.assertTrue(all(x["strategyVersion"] != "x_new" for x in dec if x["date"] < swd))
        finally:
            lab.MAIN_EVENTS[:] = old


def fake_metrics(sc, gate=True, trade_days=100, years=(9, 9), dv=None, cal=None, tpy=None):
    """경쟁 시험용 가짜 성적 — arena_eval 과 같은 모양(점수 = adj = raw). tpy: 연 매매 횟수(빈도 보정)."""
    return dict(full=dict(gate=gate, mddPct=-10.0 if gate else -40.0, worstDayPct=-5.0, expectancyPct=0.5 if gate else -0.1,
                          tradeDays=trade_days, weeklyAvgPct=sc),
                year=dict(totalPct=sc * 100), d90={}, oos={}, years=dict(n=years[1], pos=years[0], worstPct=1.0),
                raw=sc, adj=sc, score=sc, tradesPerYear=tpy, _dv=dv, _cal=cal or [])


class ArenaTest(unittest.TestCase):
    """전략 경쟁: 안정 점수 순위 · 7일 연속 1위 자동 승격(다음 날부터) · 기준 미달/7일 하위 3위/복제 퇴출 · 후보 생성과 자리 교체 · 메인 보호."""

    def setUp(self):
        self.old = (lab.arena_eval, lab.post_json, list(lab.MAIN_EVENTS), os.environ.get("JKQ_MONITOR_KEY"), lab.EVAL_BUDGET)
        lab.MAIN_EVENTS[:] = []
        self.formula = lambda p: (p["minQ"] * 0.01 + p["topK"] * 0.001, p["minQ"] >= 3)
        self.tpy = lambda p: None                                                # 연 매매 횟수(기본: 모름 → 빈도 보정 없음)
        self.series = {}

        def ev(tab, e, ctx):
            p = e["params"]
            sc, gate = self.formula(p)
            dv = self.series.get(lab.gen_version(tab, lab._canon(tab, p)))
            return fake_metrics(sc, gate=gate, dv=dv, cal=sorted(dv) if dv else None, tpy=self.tpy(lab._canon(tab, p)))
        lab.arena_eval = ev
        self.posts = []
        lab.post_json = lambda url, body, key, timeout=30: (self.posts.append((url, body)) or {"ok": True})

    def tearDown(self):
        lab.arena_eval, lab.post_json = self.old[0], self.old[1]
        lab.MAIN_EVENTS[:] = self.old[2]
        lab.EVAL_BUDGET = self.old[4]
        if self.old[3] is None:
            os.environ.pop("JKQ_MONITOR_KEY", None)
        else:
            os.environ["JKQ_MONITOR_KEY"] = self.old[3]

    def pool_state(self, params_list):
        pool = []
        for p in params_list:
            p = lab._canon("opening", p)
            v = lab.gen_version("opening", p)
            pool.append(dict(version=v, name=v, rule="", params=p, source="seed", addedAt="2026-10-01"))
        return {"schema": lab.ARENA_SCHEMA, "tabs": {"opening": dict(pool=pool, retired=[], tried=[], snapshots=[])}, "log": []}

    def run_days(self, days, key=None, state=None):
        if key:
            os.environ["JKQ_MONITOR_KEY"] = key
        else:
            os.environ.pop("JKQ_MONITOR_KEY", None)
        state, outs = (state if state is not None else {}), []
        for d in days:
            out, state = lab.arena({}, today=d, state=state, tabs=("opening",))
            outs.append(out["opening"])
        return outs, state

    def fixed(self, n=12, budget=0):
        lab.EVAL_BUDGET = budget                                                 # 후보 생성 없이 정해 둔 경쟁군만
        return self.pool_state([dict(minQ=q, topK=3) for q in range(13 - n, 13) if q != 5][:n])

    def test_first_run_fills_pool_and_retires_bad(self):
        outs, state = self.run_days(["2026-10-05"])
        z = outs[0]
        self.assertEqual(z["poolSize"], lab.POOL_TARGET)                       # 12개로 채운다
        self.assertTrue(all(lab.gate_ok(r) for r in z["rows"] if not r["isMain"]))   # 그림자는 기준 통과만
        ret = state["tabs"]["opening"]["retired"]
        self.assertTrue(any(x["version"] == "opening_d1_min1" and "손실 기준 미달" in x["reason"] for x in ret))
        kinds = {x["kind"] for x in state["log"]}
        self.assertTrue({"new", "retire", "reject"} <= kinds, kinds)
        news = [x for x in state["log"] if x["kind"] == "new"]
        self.assertTrue(all(x.get("op") in lab.OPS and lab.OP_NAME[x["op"]] in x["reason"] and "순위 점수" in x["reason"] and "× 빈도" in x["reason"] for x in news))
        ops = state["tabs"]["opening"]["ops"]
        self.assertEqual(sum(s["accepted"] for s in ops.values()), len(z["added"]))   # 방법별 성적 = 실제 투입 수
        self.assertEqual(sum(s["tried"] for s in ops.values()), z["gen"]["evaluated"])
        self.assertEqual(z["gen"]["evaluated"], lab.EVAL_BUDGET)
        self.assertTrue(state["tabs"]["opening"]["tried"])
        # 이미 본 변수(기본 목록 · 경쟁군)는 다시 후보로 만들지 않는다 — 같은 날 한 번 더 돌려도 같은 후보가 없다
        _, state2 = self.run_days(["2026-10-05"], state=state)
        firsts = [x["version"] for x in state["log"] if x["kind"] == "new"]
        self.assertEqual(len(firsts), len(set(firsts)))

    def test_seven_days_top_promotes_next_day(self):
        days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-11"]
        outs, _ = self.run_days(days, key="k", state=self.fixed())
        z = outs[-1]
        self.assertEqual(outs[0]["top"], "g_open_q12_k3")
        self.assertEqual(z["status"]["code"], "promoted")
        ev = z["status"]["event"]
        self.assertEqual(ev["effectiveFrom"], "2026-10-12")                     # 다음 날부터
        self.assertEqual(ev["version"], "g_open_q12_k3")
        self.assertEqual(ev["params"], dict(minQ=12, topK=3, gapMax=None))
        self.assertTrue(self.posts and self.posts[0][0].endswith("/claude-config"))
        self.assertEqual(lab.main_for("opening")["version"], "g_open_q12_k3")    # 같은 계산 안에서도 다음 메인으로 보인다
        self.assertEqual(lab.main_for("opening", "2026-10-11")["version"], lab.MAIN_DEFAULT["opening"]["version"])

    def test_six_days_not_enough_and_no_key_only_due(self):
        outs, _ = self.run_days(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10"], key="k", state=self.fixed())
        self.assertEqual(outs[-1]["status"]["code"], "streak")
        self.assertEqual(outs[-1]["status"]["days"], 6)                       # 10/5~10/10
        self.assertEqual(self.posts, [])
        outs, _ = self.run_days(["2026-10-05", "2026-10-11"], state=self.fixed())   # 감시키 없으면 기록하지 않는다
        self.assertEqual(outs[-1]["status"]["code"], "due")
        self.assertEqual(self.posts, [])

    def test_main_margin_keeps_near_tie(self):
        # 메인(q5 k3 = 0.053) 대비 +0.015 는 1위가 못 되고(사실상 같음), +0.03 이면 1위
        # 이웃도 같은 값이 되게(안정 점수 = 그 값): minQ 6 이상은 0.053+차이, 그 밑은 0.053
        lab.EVAL_BUDGET = 0
        self.formula = lambda p: (0.053 + (0.015 if p["minQ"] >= 6 else 0.0), True)
        outs, _ = self.run_days(["2026-10-05"], state=self.pool_state([dict(minQ=6, topK=3), dict(minQ=7, topK=3)]))
        self.assertEqual(outs[0]["top"], lab.MAIN_DEFAULT["opening"]["version"])
        self.assertEqual(outs[0]["status"]["code"], "main_top")
        self.formula = lambda p: (0.053 + (0.03 if p["minQ"] >= 6 else 0.0), True)
        outs, _ = self.run_days(["2026-10-05"], state=self.pool_state([dict(minQ=6, topK=3), dict(minQ=7, topK=3)]))
        self.assertEqual(outs[0]["top"], "g_open_q6_k3")

    def test_bottom_three_for_seven_days_retired(self):
        st = self.pool_state([dict(minQ=q, topK=3) for q in (3, 4, 6, 7, 8, 9, 10, 11, 12)] + [dict(minQ=q, topK=2) for q in (9, 10, 11, 12)])
        lab.EVAL_BUDGET = 0
        outs, state = self.run_days(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"], state=json.loads(json.dumps(st)))
        self.assertFalse([x for x in state["tabs"]["opening"]["retired"] if "하위" in x["reason"]])
        outs, state = self.run_days(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], state=st)
        rs = [x["version"] for x in state["tabs"]["opening"]["retired"] if "하위" in x["reason"]]
        self.assertEqual(sorted(rs), ["g_open_q3_k3", "g_open_q4_k3", "g_open_q6_k3"], rs)
        self.assertEqual(outs[-1]["poolSize"], lab.POOL_MIN)                   # 10개 밑으로는 줄이지 않는다

    def test_duplicates_retired_lower_kept_higher(self):
        import random
        rnd = random.Random(3)
        cal = [f"2026-0{m}-{d:02d}" for m in (1, 2, 3) for d in range(1, 29)]
        for q in range(1, 13):
            for k in (1, 2, 3):
                self.series[lab.gen_version("opening", lab._canon("opening", dict(minQ=q, topK=k)))] = {d: rnd.gauss(0, 1) for d in cal}
        twin = self.series["g_open_q12_k3"]
        self.series["g_open_q11_k3"] = {d: v * 1.01 for d, v in twin.items()}     # 같은 매매(상관 1.0)
        lab.EVAL_BUDGET = 0
        st = self.pool_state([dict(minQ=q, topK=3) for q in (3, 4, 6, 7, 8, 9, 10, 11, 12)] + [dict(minQ=q, topK=2) for q in (10, 11, 12)])
        outs, state = self.run_days(["2026-10-05"], state=st)
        ret = state["tabs"]["opening"]["retired"]
        self.assertEqual([x["version"] for x in ret], ["g_open_q11_k3"])           # 순위 낮은 쌍둥이만
        self.assertIn("복제", ret[0]["reason"])
        self.assertIn("g_open_q12_k3", [r["version"] for r in outs[0]["rows"]])

    def test_spike_scored_by_neighbors(self):
        # q9 k2 만 혼자 튀는 값(이웃은 평범) → 안정 점수는 이웃 중앙값으로 깎여 1위가 못 된다
        self.formula = lambda p: (0.5 if (p["minQ"], p["topK"], p.get("gapMax")) == (9, 2, None) else p["minQ"] * 0.01 + p["topK"] * 0.001, True)
        lab.EVAL_BUDGET = 0
        outs, _ = self.run_days(["2026-10-05"], state=self.pool_state([dict(minQ=9, topK=2), dict(minQ=12, topK=3)]))
        spike = next(r for r in outs[0]["rows"] if r["version"] == "g_open_q9_k2")
        self.assertAlmostEqual(spike["raw"], 0.5)
        self.assertLess(spike["plateau"], 0.2)
        self.assertEqual(spike["score"], spike["plateau"])
        self.assertEqual(outs[0]["top"], "g_open_q12_k3")

    def test_better_candidates_replace_worst(self):
        # 경쟁군은 깊은 1종목 안(약함) 12개 — 깊은 3종목 후보가 훨씬 좋으면 하룻밤 최대 3개 자리 교체
        self.formula = lambda p: (0.01 + p["topK"] * 0.05 + p["minQ"] * 0.001, p["minQ"] >= 3)
        st = self.pool_state([dict(minQ=q, topK=1) for q in range(3, 13) if q != 5] + [dict(minQ=3, topK=2), dict(minQ=4, topK=2), dict(minQ=6, topK=2)])
        outs, state = self.run_days(["2026-10-05"], state=st)
        z = outs[0]
        rep = [x for x in state["tabs"]["opening"]["retired"] if x["reason"].startswith("자리 교체")]
        self.assertEqual(len(rep), lab.MAX_REPLACE)
        self.assertEqual(z["gen"]["replaced"], lab.MAX_REPLACE)
        self.assertEqual(z["poolSize"], lab.POOL_TARGET)
        self.assertTrue(all("_k1" in x["version"] for x in rep))                 # 약한 쪽이 나간다
        self.assertTrue(all(lab._canon("opening", r["params"])["topK"] >= 2 for r in z["rows"] if r["isNew"]))
        self.assertIsNone(z["status"].get("newTopVersion"))                         # 메인(0.165+보호)이 표 1위 — 새 1위 표시 없음
        # 깊은 3종목 · 통과 수 많을수록 훨씬 좋게 → 오늘 들어온 전략이 표 1위. 1위 기록(승격 일수)은 어제까지 경쟁군 기준
        self.formula = lambda p: (0.01 + p["topK"] * 0.05 + p["minQ"] * 0.01, p["minQ"] >= 3)
        st = self.pool_state([dict(minQ=q, topK=1) for q in range(3, 13) if q != 5] + [dict(minQ=3, topK=2), dict(minQ=4, topK=2), dict(minQ=6, topK=2)])
        z = self.run_days(["2026-10-05"], state=st)[0][0]
        self.assertTrue(z["rows"][0]["isNew"])
        self.assertEqual(z["status"].get("newTopVersion"), z["rows"][0]["version"])
        self.assertNotEqual(z["top"], z["rows"][0]["version"])


    def test_frequency_breaks_near_tie(self):
        # 안정 점수가 모두 같을 때(0.06): 메인(연 10회)은 보호 +0.02 로 1위. 연 40회 전략은 0.06 × 4^0.25 = 0.0849 > 0.08 → 1위.
        # 빈도 보정이 없으면 메인이 1위(사실상 같음). 메인 자신의 보정은 ×1 이다.
        lab.EVAL_BUDGET = 0
        self.formula = lambda p: (0.06, True)
        self.tpy = lambda p: 40.0 if p["minQ"] == 6 else 10.0
        outs, state = self.run_days(["2026-10-05"], state=self.pool_state([dict(minQ=6, topK=3), dict(minQ=7, topK=3)]))
        z = outs[0]
        self.assertEqual(z["top"], "g_open_q6_k3")
        r6 = next(r for r in z["rows"] if r["version"] == "g_open_q6_k3")
        self.assertAlmostEqual(r6["freqFactor"], 4 ** lab.FREQ_BETA)
        self.assertAlmostEqual(r6["score"], 0.06 * 4 ** lab.FREQ_BETA)
        self.assertAlmostEqual(r6["stable"], 0.06)
        main = next(r for r in z["rows"] if r["isMain"])
        self.assertEqual((main["freqFactor"], main["score"]), (1.0, main["stable"]))
        r7 = next(r for r in z["rows"] if r["version"] == "g_open_q7_k3")
        self.assertEqual(r7["freqFactor"], 1.0)                                   # 메인과 같은 빈도
        self.assertTrue(any(x["kind"] == "note" and "매매 빈도" in x["reason"] for x in state["log"]))
        self.assertEqual(state["freqBeta"], lab.FREQ_BETA)
        # 수익이 확실히 나쁘면 빈도로 뒤집지 않는다: 연 40회라도 안정 점수가 메인의 절반(0.03 × 1.41 = 0.042 < 0.08)이면 메인 1위
        self.formula = lambda p: (0.03 if p["minQ"] == 6 else 0.06, True)
        outs, _ = self.run_days(["2026-10-05"], state=self.pool_state([dict(minQ=6, topK=3), dict(minQ=7, topK=3)]))
        self.assertEqual(outs[0]["top"], lab.MAIN_DEFAULT["opening"]["version"])

    def test_frequency_presort_reaches_frequent_candidates(self):
        # 경쟁군이 가득 찬 상태(빈자리 0)에선 대략 순서 상위 9개만 이웃까지 계산한다.
        # 안정 점수(adj)는 통과 수가 많을수록 조금 높지만, 매매는 통과 수가 적을수록 훨씬 잦다 → 빈도 보정 순위로 골라야 잦은 후보가 들어온다.
        self.formula = lambda p: (0.05 + p["minQ"] * 0.001, p["minQ"] >= 2)
        self.tpy = lambda p: 2000.0 / p["minQ"] ** 4
        st = self.pool_state([dict(minQ=q, topK=1, gapMax=-6.0) for q in range(2, 14) if q != 5 and q <= 12] + [dict(minQ=12, topK=2, gapMax=-6.0)])
        lab.EVAL_BUDGET = 48
        outs, state = self.run_days(["2026-10-05"], state=st)
        added = [lab._canon("opening", r["params"])["minQ"] for r in outs[0]["rows"] if r["isNew"]]
        self.assertTrue(added, "잦은 후보가 하나도 안 들어옴")
        self.assertTrue(all(q <= 3 for q in added), added)


class FreqFactorTest(unittest.TestCase):
    """빈도 보정 — 연 매매 횟수 · 메인 대비 비율^β · 손실 전략 제외 · ④ 는 들어간 횟수."""

    def test_trades_per_year_and_factor(self):
        cal = [f"d{i:03d}" for i in range(250)]
        dv = {d: 0.1 for d in cal[::5]}                                            # 50일
        self.assertAlmostEqual(lab.trades_per_year(dv, cal, 250), 50.0)
        self.assertAlmostEqual(lab.trades_per_year(dv, cal, 250, entries=10), 10.0)
        self.assertAlmostEqual(lab.trades_per_year(dict(dv, x999=1.0), cal, 250), 50.0)   # 달력 밖 날짜는 세지 않는다
        self.assertAlmostEqual(lab.freq_factor(100, 50), 2 ** lab.FREQ_BETA)
        self.assertAlmostEqual(lab.freq_factor(25, 100), 0.25 ** lab.FREQ_BETA)
        self.assertEqual(lab.freq_factor(30, None), 1.0)
        self.assertEqual(lab.freq_factor(0, 30), 1.0)
        self.assertAlmostEqual(2 ** lab.FREQ_BETA, 1.189207, places=5)              # 매매 2배 ↔ ×1.19 (화면 설명과 같은 값)

    def test_rank_score_not_applied_to_losers(self):
        E = lab._Evaluator("opening", {})
        E.ref = 10.0
        sc, f = E.rank_score(0.05, dict(tradesPerYear=40.0))
        self.assertAlmostEqual(sc, 0.05 * 4 ** lab.FREQ_BETA)
        sc, f = E.rank_score(-0.05, dict(tradesPerYear=1.0))                        # 드물다고 손실이 덜 나빠지지 않는다
        self.assertEqual(sc, -0.05)
        sc, f = E.rank_score(-0.05, dict(tradesPerYear=100.0))                      # 잦다고 손실이 더 나빠지지도 않는다
        self.assertEqual(sc, -0.05)
        self.assertEqual(E.rank_score(None, {})[0], None)

    def test_soxl_counts_entries_not_hold_days(self):
        rows = [(f"2026-01-{d:02d}", 100.0, 101.0, 99.0, 100.0) for d in range(1, 21)]
        dec = [dict(date="2026-01-05", action="enter"), dict(date="2026-01-06", action="hold"), dict(date="2026-01-07", action="hold"),
               dict(date="2026-01-08", action="exit"), dict(date="2026-01-12", action="enter"), dict(date="2026-01-13", action="exit")]
        dv = {r["date"]: 0.5 for r in dec}                                           # 보유일 6일 · 들어간 횟수 2번
        old = lab.soxl_series
        lab.soxl_series = lambda p, srows, *a: (dv, dv, dec, {})
        try:
            m = lab.arena_eval("soxl", dict(version="x", params=lab.MAIN_DEFAULT["soxl"]["params"]), dict(soxl=rows))
        finally:
            lab.soxl_series = old
        self.assertAlmostEqual(m["tradesPerYear"], 2 / (20 / 252))
        self.assertEqual(m["full"]["tradeDays"], 6)


class ArenaScoreTest(unittest.TestCase):
    """안정 점수 · 기준(표본 · 해마다 일관성) 값 시험."""

    def test_shrinks_thin_recent_window(self):
        cal = [(lab.date(2024, 1, 1) + lab.timedelta(days=i)).isoformat() for i in range(800)]
        dv = {d: 0.2 for d in cal[:700:3]}                                         # 꾸준한 작은 이익
        dv.update({cal[-10]: 6.0, cal[-5]: 6.0})                                   # 최근 90일엔 딱 2번, 크게
        m = lab.score_metrics(dv, cal, 365)
        wf, n90 = m["full"]["weeklyAvgPct"], m["d90"]["tradeDays"]
        self.assertEqual(n90, 2)
        shr = lambda x: (x["tradeDays"] * x["weeklyAvgPct"] + lab.SHRINK_K * wf) / (x["tradeDays"] + lab.SHRINK_K)
        self.assertAlmostEqual(m["adj"], (wf + shr(m["year"]) + shr(m["d90"])) / 3, places=9)
        self.assertLess(m["adj"] - wf, (m["raw"] - wf) / 2)                        # 표본 2개짜리 90일 성적이 점수를 끌어올리지 못한다(차이의 절반 이상을 당김)
        self.assertGreater(m["raw"] - m["adj"], 0.05)
        self.assertEqual(m["score"], m["adj"])

    def test_gate_reasons(self):
        ok = fake_metrics(0.3)
        self.assertEqual(lab.gate_reason(ok), "")
        self.assertIn("매매일 부족", lab.gate_reason(fake_metrics(0.3, trade_days=lab.MIN_TRADE_DAYS - 1)))
        self.assertEqual(lab.gate_reason(fake_metrics(0.3, trade_days=lab.MIN_TRADE_DAYS)), "")
        self.assertIn("일관성", lab.gate_reason(fake_metrics(0.3, years=(5, 9))))
        self.assertEqual(lab.gate_reason(fake_metrics(0.3, years=(6, 9))), "")
        self.assertIn("손실 기준 미달", lab.gate_reason(fake_metrics(0.3, gate=False)))

    def test_year_stats(self):
        cal = ["2024-01-02", "2024-06-03", "2025-01-02", "2025-02-03"] + [f"2026-01-{d:02d}" for d in range(1, 8)]
        dv = {d: 1.0 for d in cal[4:]}
        dv.update({"2024-01-02": 1.0, "2025-01-02": -2.0})
        y = lab.year_stats(dv, cal)
        self.assertEqual((y["n"], y["pos"]), (1, 1))                             # 매매 5일 미만인 해는 세지 않는다
        self.assertAlmostEqual(y["worstPct"], (1.01 ** 7 - 1) * 100)

    def test_corr_and_canon(self):
        cal = ["a", "b", "c", "d"]
        self.assertAlmostEqual(lab.corr({"a": 1, "b": 2}, {"a": 2, "b": 4}, cal), 1.0)
        self.assertLess(lab.corr({"a": 1, "b": -1}, {"a": -1, "b": 1}, cal), 0)
        # 쓰지 않는 변수는 같은 값으로 — 변동성 돌파의 고가 일수 · 고가 기준의 k · RSI 꺼짐의 기간
        c1 = lab._canon("crypto", dict(level="vb", k=0.6, hiN=5))
        self.assertEqual(c1["hiN"], 1)
        self.assertEqual(lab._canon("crypto", dict(hiN=5, k=0.9))["k"], 0.5)
        self.assertEqual(lab.gen_version("crypto", lab._canon("crypto", dict(hiN=5))), "g_coin_ma20_s5_hi5_both")
        self.assertEqual(lab.gen_version("soxl", lab._canon("soxl", dict(rsiMax=100.0, rsiN=3, ibsMax=0.3))), "g_soxl_norsi_ibs0.3_ma200_d5")
        self.assertEqual(lab.gen_version("soxl", lab._canon("soxl", {})), "g_soxl_r2lt20_ma200_d5")   # 옛 이름 그대로

    def test_proposals_valid_and_ops_weighted(self):
        import random
        rng = random.Random(1)
        parents = [dict(version=f"p{i}", params=lab._canon("soxl", dict(rsiMax=r))) for i, r in enumerate((10.0, 20.0, 30.0))]
        for op in lab.OPS:
            for _ in range(20):
                c = lab.propose("soxl", op, parents, rng)
                self.assertIsNotNone(c, op)
                lab._canon("soxl", {k: v for k, v in c[0].items() if k in lab.GRID["soxl"] or k == "tabSize"}) if (c[0].get("rsiMax", 0) < 100 or c[0].get("ibsMax", 1) < 1 or c[0].get("downDays")) else None
        self.assertIsNone(lab.propose("opening", "struct", parents, rng))           # ① 은 새 구조 없음(데이터로 효과 없음 확인)
        w = lab.op_weights("soxl", {"struct": dict(tried=10, accepted=8), "explore": dict(tried=10, accepted=0)}, 3)
        self.assertGreater(w["struct"], w["explore"])
        self.assertGreaterEqual(min(w.values()), 0.05)                              # 어떤 방법도 끊지 않는다
        self.assertNotIn("struct", lab.op_weights("opening", {}, 3))
        self.assertEqual(set(lab.op_weights("soxl", {}, 0)), {"explore"})            # 기준 통과 전략이 없으면 탐색만


class HistoryTest(unittest.TestCase):
    """매매 이력(사용자 2026-10-22 '그림자 포함 모든 매매이력 기록 · 조회'): 매매 행이 경쟁 점수와 같은 시계열에서 나오고,
    매일 기록은 날짜마다 한 번만(덮어쓰지 않음) · 퇴출되면 멈추고 · 실시간 장부는 적힌 버전의 전략에만 붙는다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = (lab.DATA, lab.HISTORY, lab.HISTORY_START, dict(lab.ETF_BARS), list(lab.MAIN_EVENTS))
        lab.DATA = Path(self.tmp.name)
        lab.HISTORY = lab.DATA / "claude-lab" / "history"
        lab.MAIN_EVENTS[:] = []

    def tearDown(self):
        lab.DATA, lab.HISTORY, lab.HISTORY_START = self.old[0], self.old[1], self.old[2]
        lab.ETF_BARS.clear()
        lab.ETF_BARS.update(self.old[3])
        lab.MAIN_EVENTS[:] = self.old[4]
        self.tmp.cleanup()

    def csv(self, rel, rows):
        f = lab.DATA / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        lab.write_csv(f, rows)

    def etf(self, closes, opens=None, code="122630"):
        ds = days(len(closes), "2026-10-12")
        lab.ETF_BARS[code] = [(d, (opens or closes)[i], c) for i, (d, c) in enumerate(zip(ds, closes))]
        return ds

    def test_opening_rows_are_the_scored_picks(self):
        self.csv("opening-gapdown-research/decisions.csv", [dict(date="2026-10-13", rsiPassed=6), dict(date="2026-10-14", rsiPassed=2)])
        sig = lambda d, code, gap, pnl: dict(date=d, code=code, name="N" + code, gapPct=gap, entryPrice=100, exitPrice=100 + pnl, pnl=pnl)
        self.csv("opening-gapdown-research/signals.csv", [sig("2026-10-13", "A", -2.5, 1.0), sig("2026-10-13", "B", -6.0, -3.0), sig("2026-10-13", "C", -4.0, 5.0),
                                                          sig("2026-10-14", "D", -9.0, 9.0)])
        p = dict(minQ=5, topK=2, gapMax=-3.0)
        rows, dv, cal, acts = lab.strategy_trades("opening", p, {})
        self.assertEqual([r[5] for r in rows], ["B", "C"])                          # 깊은 갭 · −3% 이하 2종목, 통과 2<5 인 날은 없음
        self.assertAlmostEqual(dv["2026-10-13"], 1.0)                               # (−3 + 5) / 2
        self.assertEqual(dv, lab.d1_series(p)[0])                                   # 경쟁 점수와 같은 값
        self.assertEqual(acts, {"2026-10-13": "trade", "2026-10-14": "no_trade"})
        self.assertEqual(rows[0][1], "2026-10-13 09:00")
        self.assertEqual(rows[0][3], "2026-10-13 15:30")

    def test_etf_rows_match_series_and_overnight_dates(self):
        ds = self.etf([100.0, 96.0, 97.0, 90.0, 92.0], opens=[100.0, 99.0, 98.5, 95.0, 93.0])
        p = dict(code="122630", th=-3.0)
        rows, dv, cal, acts = lab.strategy_trades("daytrading", p, {"kr_cal": ds})
        self.assertEqual(dv, lab.etf_variant("122630", -3.0)[0])
        self.assertEqual([r[0] for r in rows], [ds[2], ds[4]])                      # −4% 날 종가 매수 → 다음 날 시가 매도
        self.assertEqual(rows[0][1], ds[1] + " 15:30")
        self.assertEqual(rows[0][2], 96.0)
        self.assertEqual(rows[0][4], 98.5)
        self.assertAlmostEqual(rows[0][7], round((98.5 / 96 - 1) * 100 - (0.03 + 2 * 1 / 96 * 100), 4))
        self.assertEqual(acts[ds[1]], "no_trade")

    def test_soxl_trade_compounds_daily_values_and_open_position(self):
        d0 = lab.date.fromisoformat("2026-01-01")
        closes = [100.0] * 5 + [90.0, 80.0, 70.0, 75.0, 80.0, 85.0, 70.0, 60.0]
        srows = [((d0 + lab.timedelta(days=i)).isoformat(), c, c, c, c) for i, c in enumerate(closes)]
        p = dict(lab.MAIN_DEFAULT["soxl"]["params"], rsiMax=20.0, ma=0)
        rows, dv, cal, acts = lab.strategy_trades("soxl", p, {"soxl": srows})
        _, full, dec, _ = lab.soxl_series(p, srows)
        done = [r for r in rows if r[3]]
        self.assertTrue(done)
        r0 = done[0]
        span = [d for d in cal if r0[1][:10] <= d <= r0[0]]
        eq = 1.0
        for d in span:
            eq *= 1 + full.get(d, 0.0) / 100
        self.assertAlmostEqual(r0[7], round((eq - 1) * 100, 4))                     # 매매 손익 = 그 사이 일 손익 복리
        self.assertEqual(acts[r0[0]], "exit")
        if rows[-1][3] is None:
            self.assertEqual(rows[-1][8], "보유 중")

    def test_forward_is_append_only_and_stops_at_retirement(self):
        lab.HISTORY_START = "2026-10-13"
        ds = self.etf([100.0, 96.0, 97.0, 90.0, 92.0, 92.0], opens=[100.0, 99.0, 98.5, 95.0, 93.0, 92.0])
        info = dict(version="v1", name="n", params=dict(code="122630", th=-3.0), status="shadow", since="2026-10-12")
        a = lab.history_entry("daytrading", info, {"kr_cal": ds}, None, "2026-10-20T19:00")
        self.assertEqual([x["date"] for x in a["forward"]], ds[1:])                 # HISTORY_START 부터 · 확정된 날까지
        first = {x["date"]: x for x in a["forward"]}
        self.assertEqual(first[ds[2]]["action"], "trade")
        self.assertEqual(len(first[ds[2]]["trades"]), 1)
        self.assertEqual(first[ds[1]]["action"], "no_trade")
        # 자료가 바뀌어(다시 계산) 과거 계산 값이 달라져도 이미 쓴 날은 그대로, 새 날만 붙는다
        ds2 = self.etf([100.0, 96.0, 99.0, 90.0, 92.0, 92.0, 80.0, 85.0], opens=[100.0, 99.0, 50.0, 95.0, 93.0, 92.0, 91.0, 84.0])
        b = lab.history_entry("daytrading", info, {"kr_cal": ds2}, a, "2026-10-21T19:00")
        self.assertEqual(b["forward"][:len(a["forward"])], a["forward"])
        self.assertEqual([x["date"] for x in b["forward"]], ds2[1:])
        self.assertNotEqual(b["backtest"], a["backtest"])                           # 과거 계산은 다시 계산된 값
        self.assertEqual(b["forward"][-1]["recordedAt"], "2026-10-21T19:00")
        # 퇴출된 날부터는 쓰지 않는다
        c = lab.history_entry("daytrading", dict(info, status="retired", retiredAt=ds2[6]), {"kr_cal": ds2}, a, "2026-10-22T19:00")
        self.assertEqual(max(x["date"] for x in c["forward"]), ds2[5])
        # HISTORY_START 전 날짜는 매일 기록에 없다(재구성으로 채우지 않는다)
        lab.HISTORY_START = ds2[4]
        d = lab.history_entry("daytrading", info, {"kr_cal": ds2}, None, "2026-10-22T19:00")
        self.assertEqual(min(x["date"] for x in d["forward"]), ds2[4])

    def test_live_ledger_goes_to_recorded_version(self):
        ds = self.etf([100.0, 96.0, 97.0])
        live = {"2026-10-13": dict(strategyVersion="etf_dip_overnight_v1", trades=[dict(name="x", pnlPct=1.0)]),
                "2026-10-14": dict(strategyVersion="other", trades=[]), "2026-10-15": dict(trades=[])}
        info = dict(version="etf_dip_overnight_v1", name="n", params=dict(code="122630", th=-3.0), status="main", since=None)
        h = lab.history_entry("daytrading", info, {"kr_cal": ds}, None, "t", live)
        self.assertEqual([x["date"] for x in h["live"]], ["2026-10-13", "2026-10-15"])   # 버전이 적힌 날은 그 버전, 없으면 그날 메인(기본)
        h2 = lab.history_entry("daytrading", info, {"kr_cal": ds}, h, "t2", dict(live, **{"2026-10-13": dict(strategyVersion="etf_dip_overnight_v1", trades=[])}))
        self.assertEqual(h2["live"][0]["trades"], [dict(name="x", pnlPct=1.0)])          # 실시간 장부도 날짜마다 한 번만

    def test_live_ledger_keeps_original_and_attaches_order_settlement(self):
        ds = self.etf([100.0, 96.0, 97.0])
        old = dict(lab.ORDERS)
        try:
            tr = [dict(name="KODEX", entryPrice=6045, exitPrice=6100, pnlPct=0.8, signal=dict(at="15:21:35", dropPct=-3.5, th=-3))]
            lab.ORDERS.clear()
            lab.ORDERS.update(daytrading={"2026-10-22": dict(v=0.8, src="nightly", rec=dict(trades=tr, open=[], warn="모의계좌 주문 안 됨 1건")),
                                          "2026-10-23": dict(v=0.5, src="worker", rec=dict(trades=[], open=[]))})
            live = {"2026-10-22": dict(strategyVersion="etf_dip_overnight_v1", trades=[], note="옛 형식(체결 기준)"),
                    "2026-10-23": dict(strategyVersion="etf_dip_overnight_v1", basis="orders", settled=True, dayPct=0.5, trades=[dict(name="KODEX", pnlPct=0.5)])}
            info = dict(version="etf_dip_overnight_v1", name="n", params=dict(code="122630", th=-3.0), status="main", since=None)
            h = lab.history_entry("daytrading", info, {"kr_cal": ds}, None, "t", live)
            by = {x["date"]: x for x in h["live"]}
            self.assertEqual(by["2026-10-22"]["trades"], [])                                 # 실시간 원본(모의투자 체결 기준)은 그대로
            st = by["2026-10-22"]["settle"]
            self.assertEqual((st["dayPct"], st["trades"], st["source"], st["warn"]), (0.8, tr, "nightly-pages-op-close", "모의계좌 주문 안 됨 1건"))   # 신호 조건 포함
            self.assertNotIn("settle", by["2026-10-23"])                                     # Worker 장부가 확정된 주문 정산이면 따로 안 붙인다
            self.assertEqual((by["2026-10-23"]["basis"], by["2026-10-23"]["dayPct"]), ("orders", 0.5))
            lab.ORDERS["daytrading"]["2026-10-22"] = dict(v=9.9, src="nightly", rec=dict(trades=[], open=[]))
            h2 = lab.history_entry("daytrading", info, {"kr_cal": ds}, json.loads(json.dumps(h)), "t2", live)
            self.assertEqual({x["date"]: x for x in h2["live"]}["2026-10-22"]["settle"]["dayPct"], 0.8)   # 한 번 붙이면 그대로
        finally:
            lab.ORDERS.clear()
            lab.ORDERS.update(old)

    def test_write_if_changed_ignores_updated_at(self):
        f = lab.DATA / "h.json"
        self.assertTrue(lab.write_if_changed(f, dict(a=1), "t1"))
        self.assertFalse(lab.write_if_changed(f, dict(a=1), "t2"))                 # 내용 같으면 다시 쓰지 않는다
        self.assertEqual(json.loads(f.read_text())["updatedAt"], "t1")
        self.assertTrue(lab.write_if_changed(f, dict(a=2), "t3"))

    def test_write_history_index_and_retired_frozen(self):
        lab.HISTORY_START = "2026-10-13"
        ds = self.etf([100.0, 96.0, 97.0, 90.0, 92.0])
        main = dict(version="g_etf_th2", name="main", rule="r", params=dict(code="122630", th=-2.0), addedAt="2026-10-12", isMain=True)
        sh = dict(version="g_etf_th3", name="sh", rule="r", params=dict(code="122630", th=-3.0), addedAt="2026-10-12", isMain=False)
        out = {"daytrading": dict(rows=[main, sh])}
        st = {"tabs": {"daytrading": dict(retired=[dict(version="old_x", name="old", params=dict(code="122630", th=-5.0), retiredAt="2026-10-01", reason="r"),
                                                    dict(version="../bad", name="bad", params=dict(code="122630", th=-5.0), retiredAt="2026-10-01")])}}
        r = lab.write_history(out, st, {"kr_cal": ds}, now="t1", tabs=("daytrading",))
        self.assertEqual(r["errors"], [])
        idx = json.loads((lab.HISTORY / "index.json").read_text())
        self.assertEqual([(x["version"], x["status"]) for x in idx["tabs"]["daytrading"]], [("g_etf_th2", "main"), ("g_etf_th3", "shadow"), ("old_x", "retired")])
        self.assertFalse((lab.HISTORY / "daytrading" / "..").joinpath("bad.json").exists())   # 경로 문자 버전은 쓰지 않는다
        old = json.loads((lab.HISTORY / "daytrading" / "old_x.json").read_text())
        self.assertEqual(old["forward"], [])                                         # 2026-10-01 퇴출 — 매일 기록 없음
        self.etf([100.0, 90.0, 80.0, 70.0, 60.0])                                    # 자료가 바뀌어도
        lab.write_history(out, st, {"kr_cal": ds}, now="t2", tabs=("daytrading",))
        self.assertEqual(json.loads((lab.HISTORY / "daytrading" / "old_x.json").read_text())["backtest"], old["backtest"])   # 퇴출 전략은 다시 계산 안 함


class Close30Test(unittest.TestCase):
    """⑤ 종가 30분(사용자 2026-10-22 '종가 전략도 탭에 추가하고 다른 전략이랑 동일하게 적용'): 15:00 가격(60분봉 14시 봉 종가)과 전일 종가로만 판단 ·
    끝난 정시 봉만 · 받은 봉은 바꾸지 않음 · 매수는 기준 '미만' · 비용 = 수수료 0.03% + 15:00 매수 반 호가 · 국내 칸은 그날 매매한 탭끼리 똑같이."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = (lab.KR_HOURLY, dict(lab.KR_HOURLY_CACHE), dict(lab.ETF_BARS), dict(lab.C30_CACHE), lab.HISTORY, list(lab.MAIN_EVENTS))
        lab.KR_HOURLY = Path(self.tmp.name) / "kr-hourly"
        lab.KR_HOURLY_CACHE.clear()
        lab.C30_CACHE.clear()
        lab.MAIN_EVENTS[:] = []

    def tearDown(self):
        lab.KR_HOURLY = self.old[0]
        lab.KR_HOURLY_CACHE.clear()
        lab.KR_HOURLY_CACHE.update(self.old[1])
        lab.ETF_BARS.clear()
        lab.ETF_BARS.update(self.old[2])
        lab.C30_CACHE.clear()
        lab.C30_CACHE.update(self.old[3])
        lab.HISTORY = self.old[4]
        lab.MAIN_EVENTS[:] = self.old[5]
        self.tmp.cleanup()

    @staticmethod
    def chart(bars):
        ts = [int(datetime.fromisoformat(k + ":00+09:00").timestamp()) for k, _ in bars]
        return {"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"close": [c for _, c in bars]}]}}]}}

    def market(self):
        """6거래일: 15:00 −0.5% 매수 · 보합 안 삼 · 9시 봉 없는 날(늦은 개장 — 15:00 −10% 여도 달력 밖) · −1.01% 매수 · 자료 오류(−49.7%)."""
        ds = days(6, "2026-10-12")
        lab.ETF_BARS["233740"] = [(ds[0], 10000.0, 10000.0), (ds[1], 10000.0, 10100.0), (ds[2], 10100.0, 10000.0), (ds[3], 10000.0, 9900.0),
                                  (ds[4], 9900.0, 9950.0), (ds[5], 9950.0, 4000.0)]
        full = lambda p15: dict({str(h): 1.0 for h in range(9, 14)}, **{"14": p15})
        lab.KR_HOURLY_CACHE["233740"] = {ds[1]: full(9950.0), ds[2]: full(10100.0), ds[3]: {str(h): 9000.0 for h in range(10, 15)},
                                         ds[4]: full(9800.0), ds[5]: full(5000.0)}
        return ds

    def test_hourly_only_finished_top_of_hour_bars_append_only(self):
        urls = []

        def f1(u):
            urls.append(u)
            return self.chart([("2026-10-21 09:00", 100.0), ("2026-10-21 10:00", 101.0), ("2026-10-21 10:30", 555.0), ("2026-10-21 14:00", 99.0),
                               ("2026-10-21 15:00", 98.0), ("2026-10-22 11:00", None), ("2026-10-22 12:00", 97.0), ("2026-10-22 13:00", 96.0)])
        H = lab.fetch_kr_hourly("233740", now=datetime(2026, 10, 22, 13, 30), fetch=f1)
        self.assertEqual(H, {"2026-10-21": {"9": 100.0, "10": 101.0, "14": 99.0}, "2026-10-22": {"12": 97.0}})   # 30분 · 15시 · 빈 값 · 안 끝난 13시 봉 제외
        self.assertIn("range=730d", urls[0])
        lab.KR_HOURLY_CACHE.clear()

        def f2(u):
            urls.append(u)
            return self.chart([("2026-10-21 09:00", 777.0), ("2026-10-22 13:00", 96.5)])
        H2 = lab.fetch_kr_hourly("233740", now=datetime(2026, 10, 22, 15, 0), fetch=f2)
        self.assertEqual(H2["2026-10-21"]["9"], 100.0)                                # 이미 받은 봉은 바꾸지 않는다
        self.assertEqual(H2["2026-10-22"], {"12": 97.0, "13": 96.5})
        self.assertIn("range=1mo", urls[1])                                           # 캐시가 있으면 최근 한 달만
        self.assertEqual(json.loads((lab.KR_HOURLY / "233740.json").read_text())["2026-10-22"]["13"], 96.5)
        lab.KR_HOURLY_CACHE.clear()

        def boom(u):
            raise OSError("down")
        self.assertEqual(lab.fetch_kr_hourly("233740", now=datetime(2026, 10, 22, 16, 0), fetch=boom), H2)   # 받기 실패 → 캐시로 계산(막지 않음)

    def test_trades_use_1500_price_strict_below_and_cost(self):
        ds = self.market()
        tr, cal = lab.close30_trades("233740", 0.0)
        self.assertEqual(cal, [ds[1], ds[2], ds[4]])                                  # 6시간이 다 없는 날 · 자료 오류 날은 달력 밖
        self.assertEqual([t["date"] for t in tr], [ds[1], ds[4]])                     # 보합(0%)은 사지 않는다
        self.assertAlmostEqual(tr[0]["sofarPct"], -0.5)
        self.assertAlmostEqual(tr[0]["pnl"], (10100 / 9950 - 1) * 100 - (0.03 + 2.5 / 9950 * 100))
        self.assertAlmostEqual(tr[1]["pnl"], (9950 / 9800 - 1) * 100 - (0.03 + 2.5 / 9800 * 100))
        self.assertEqual([t["date"] for t in lab.close30_trades("233740", -1.0)[0]], [ds[4]])
        self.assertEqual(set(lab.close30_series(dict(code="233740", th=0.0))[0]), {ds[1], ds[4]})

    def test_history_rows_match_scored_series(self):
        ds = self.market()
        p = dict(code="233740", th=0.0)
        rows, dv, cal, acts = lab.strategy_trades("close30", p, {})
        self.assertEqual(dv, lab.close30_series(p)[0])
        self.assertEqual([r[0] for r in rows], [ds[1], ds[4]])
        self.assertEqual((rows[0][1], rows[0][2], rows[0][3], rows[0][4], rows[0][5]), (ds[1] + " 15:00", 9950.0, ds[1] + " 15:30", 10100.0, "233740"))
        self.assertIn("15:00 까지 -0.50%", rows[0][8])
        self.assertEqual(acts[ds[2]], "no_trade")

    def test_kr_capital_split_by_traded_tabs(self):
        self.assertEqual(lab.combine_same_capital({"a": 1.0}, {"a": 2.0, "b": 4.0}, {"a": 3.0, "c": 6.0}), {"a": 2.0, "b": 4.0, "c": 6.0})
        R = lambda *xs: {"rows": [{"date": d, "action": ac, "pnlPct": v} for d, ac, v in xs]}
        sm = {"opening_d1v2": R(("2026-10-26", "trade", 3.0)), "daytrading_etf": R(("2026-10-26", "trade", 1.0), ("2026-10-27", "no_trade", 0.0)),
              "close30_etf": R(("2026-10-26", "trade", 2.0), ("2026-10-27", "trade", -1.0)), "account": R(("2026-10-26", "trade", 0.6))}
        w = lab.week_summary(sm, "2026-10-28")
        self.assertAlmostEqual(w["parts"]["opening_d1v2"]["contribPct"], 0.3 / 3 * 3.0)        # 셋이 매매한 날 = 3분의 1씩
        self.assertAlmostEqual(w["parts"]["close30_etf"]["contribPct"], 0.3 / 3 * 2.0 + 0.3 * -1.0)   # 혼자 매매한 날 = 국내 칸 전액

    def test_account_waits_for_close30_from_its_start_only(self):
        old = lab.d1_live_status
        try:
            lab.d1_live_status = lambda d: "pending"
            kd = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"]
            self.assertEqual(lab.kr_settled_through("2026-10-26", "2026-10-26", kd, "2026-10-21", "2026-10-22"), "2026-10-22")   # 채택일(10/23)부터 ⑤ 를 기다린다
            self.assertEqual(lab.kr_settled_through("2026-10-26", "2026-10-26", kd, "2026-10-21", "2026-10-26"), "2026-10-26")
            self.assertEqual(lab.kr_settled_through("2026-10-26", "2026-10-26", kd, "2026-10-21", None), "2026-10-26")           # 자료가 아예 없으면 기다리지 않음
            self.assertEqual(lab.kr_settled_through("2026-10-26", "2026-10-26", kd, "2026-10-21", "2026-10-20"), "2026-10-22")   # 채택일 전 날짜는 ⑤ 를 안 기다린다
        finally:
            lab.d1_live_status = old

    def test_paper_close30_from_adoption_day(self):
        old = (lab.d1_live_status, lab.d1_live_reason, lab.etf_daily, lab.read_json, dict(lab.CAL), dict(lab.DECISIONS), lab.C30_PW, dict(lab.ORDERS))
        try:
            lab.d1_live_status = lambda d: "pending"
            lab.d1_live_reason = lambda d: ""
            lab.etf_daily = lambda: {}
            lab.read_json = lambda p: {"to": "2026-10-23"} if "etf-overnight" in str(p) else {}
            lab.CAL.clear()
            lab.CAL.update(etf=["2026-10-22", "2026-10-23"], coin=["2026-10-23"], us=["2026-10-22"], close30=["2026-10-22", "2026-10-23", "2026-10-26"])
            lab.DECISIONS.clear()
            lab.C30_PW = {"2026-10-22": 5.0, "2026-10-26": 9.9}                                   # 규칙 값(Yahoo 60분봉) — 채택일부터는 안 쓴다
            rec = lambda v: dict(status="closed", basis="orders", settled=True, dayPct=v, trades=[], strategyVersion="close30_dip_v1")
            lab.ORDERS.clear()
            lab.ORDERS.update(close30={"2026-10-22": dict(v=5.0, src="worker", rec=rec(5.0)), "2026-10-23": dict(v=None, src="worker", rec=rec(None)),
                                       "2026-10-26": dict(v=1.5, src="nightly", rec=rec(1.5))})
            out = lab.paper_entries({}, {}, ["2026-10-22", "2026-10-23"], {}, {}, ["2026-10-22", "2026-10-23"])
            self.assertEqual([(d, r["action"], r["pnlPct"], r["strategyVersion"], r["source"]) for d, r in out["close30_etf"]],
                             [("2026-10-23", "no_trade", 0.0, "close30_dip_v1", "orders:worker"), ("2026-10-26", "trade", 1.5, "close30_dip_v1", "orders:nightly")])   # 10/22(채택 전)은 쓰지 않는다 · 주문 정산 값
        finally:
            lab.d1_live_status, lab.d1_live_reason, lab.etf_daily, lab.read_json = old[:4]
            lab.CAL.clear()
            lab.CAL.update(old[4])
            lab.DECISIONS.clear()
            lab.DECISIONS.update(old[5])
            lab.C30_PW = old[6]
            lab.ORDERS.clear()
            lab.ORDERS.update(old[7])

    def test_params_versions_and_catalog(self):
        self.assertEqual(lab._valid_params("close30", dict(code="233740", th=-1.5)), dict(code="233740", th=-1.5))
        for p in (dict(code="122630", th=-1.0), dict(code="233740", th=0.5), dict(code="233740", th=-10.5)):
            with self.assertRaises(ValueError):
                lab._valid_params("close30", p)
        self.assertEqual(lab.gen_version("close30", dict(code="233740", th=-1.5)), "g_c30_th1.5")
        self.assertEqual(lab.describe("close30", dict(code="233740", th=0.0))[0], "15:00 까지 내린 날")
        self.assertEqual(lab.describe("close30", dict(code="233740", th=-2.0))[0], "15:00 까지 2% 넘게 내린 날")
        cat = {c["version"]: c for c in lab.catalog("close30")}
        self.assertTrue(cat["close30_dip_th1"]["promotable"])
        self.assertFalse(cat["close30_k200_dip"]["promotable"])                       # 다른 종목은 주문 경로가 없어 승격 불가
        self.assertEqual(lab.main_for("close30")["params"], dict(code="233740", th=0.0))

    def test_no_hourly_data_night_skips_arena_and_keeps_history(self):
        self.market()                                                                 # (쉬지 않는 변이라도 받기 없이 계산되게)
        lab.HISTORY = Path(self.tmp.name) / "history"
        lab.HISTORY.mkdir(parents=True)
        keep = [dict(version="close30_dip_v1", status="main", trades=3)]
        (lab.HISTORY / "index.json").write_text(json.dumps({"tabs": {"close30": keep}}))
        pool = [dict(version="x", name="x", rule="", params=dict(code="233740", th=-1.0), source="seed", addedAt="2026-10-22")]
        state = {"schema": lab.ARENA_SCHEMA, "tabs": {"close30": dict(pool=list(pool), retired=[], tried=[], snapshots=[])}, "log": []}
        out, st = lab.arena({"skip": {"close30": "60분봉 자료 없음"}}, today="2026-10-23", state=state, tabs=("close30",))
        self.assertEqual(out["close30"]["status"]["code"], "skipped")
        self.assertEqual(st["tabs"]["close30"]["pool"], pool)                          # 자료 없음으로 퇴출 · 교체 · 승격하지 않는다
        lab.write_history(out, st, {"skip": {"close30": "x"}}, now="t", tabs=("close30",))
        self.assertEqual(json.loads((lab.HISTORY / "index.json").read_text())["tabs"]["close30"], keep)   # 지난 목록을 빈 계산으로 덮지 않는다


class UsRowsTest(unittest.TestCase):
    def test_blank_close_dropped(self):
        nan = float("nan")
        rows = lab.us_rows([("2026-10-02 00:00:00", 165.4, 169.8, 162.4, 163.7), ("2026-10-05", 161.7, 164.4, 158.1, nan), ("2026-10-06", 0, 1, 1, 1)])
        self.assertEqual(rows, {"2026-10-02": (165.4, 169.8, 162.4, 163.7)})      # 종가가 빈 봉 · 0 인 봉은 버린다


class FiniteJsonTest(unittest.TestCase):
    def test_nan_becomes_null(self):
        o = lab.finite(dict(a=float("nan"), b=[1.5, float("inf"), dict(c=-float("inf"))], d="x", e=(2, 3.0)))
        self.assertEqual(json.dumps(o, allow_nan=False), '{"a": null, "b": [1.5, null, {"c": null}], "d": "x", "e": [2, 3.0]}')


class NewRuleComponentsTest(unittest.TestCase):
    """새 구조: ③ 최근 N일 고가 돌파 · ④ 종가 위치(IBS) · 연속 하락 · RSI 끄기 — 값으로 확인."""

    def test_soxl_ibs_and_down_days(self):
        d0 = lab.date(2026, 1, 1)
        # (시가, 고가, 저가, 종가): 사흘 연속 하락, 마지막 날은 저가 근처 마감(IBS 0.1)
        bars = [(100, 101, 99, 100)] * 6 + [(100, 100, 94, 99), (99, 99, 89, 95), (95, 95, 80, 81.5), (81, 90, 80, 88), (88, 92, 87, 91)]
        rows = [((d0 + lab.timedelta(days=i)).isoformat(), *b) for i, b in enumerate(bars)]
        base = dict(lab.SOXL_MR, ma=0, rsiN=2, maxHoldDays=5, size=1.0, version="t")
        enter = lambda p: [x["date"] for x in lab.soxl_meanrev(rows, dict(base, **p))[1] if x["action"] == "enter"]
        e_day = rows[9][0]                                                          # 8번째(인덱스 8) 종가 판단 → 다음 시가
        self.assertEqual(enter(dict(rsiMax=100.0, ibsMax=0.2)), [e_day])             # IBS 0.1 ≤ 0.2
        self.assertEqual(enter(dict(rsiMax=100.0, ibsMax=0.05)), [])                 # 0.1 > 0.05 → 안 산다
        self.assertEqual(enter(dict(rsiMax=100.0, ibsMax=1.0, downDays=3)), [e_day])  # 사흘 연속 하락
        self.assertEqual(enter(dict(rsiMax=100.0, ibsMax=1.0, downDays=4)), [])
        dec = lab.soxl_meanrev(rows, dict(base, rsiMax=100.0, ibsMax=0.2))[1]
        d8 = next(x for x in dec if x["date"] == rows[8][0])
        self.assertAlmostEqual(d8["ibs"], 0.1)
        self.assertEqual(d8["downRun"], 3)
        nx = lab.soxl_meanrev(rows[:8], dict(base, rsiMax=100.0, ibsMax=0.2, downDays=3))[2]
        self.assertIn("IBS 0.60 > 0.2", nx["why"])
        self.assertIn("연속 하락 2일 < 3일", nx["why"])
        self.assertEqual(nx["entryRule"], "종가 위치(IBS) ≤ 0.2 · 3일 연속 하락")
        with self.assertRaises(ValueError):
            lab._valid_params("soxl", dict(lab.MAIN_DEFAULT["soxl"]["params"], rsiMax=100.0))   # 조건이 하나도 없으면 거절

    def test_coin_n_day_high_level(self):
        H, t0 = {}, lab.datetime(2026, 8, 1, 9)
        highs = [110, 130, 120, 105, 100, 100]
        for di, hi in enumerate(highs):
            for k in range(24):
                ts = t0 + lab.timedelta(days=di, hours=k)
                H[ts.isoformat()] = (100.0, hi if k == 3 else 100.5, 99.0, 100.2)
        p = dict(lab.COIN_BO, ma=2, version="t")
        dec1 = lab.coin_breakout(H, dict(p, hiN=1))[1]
        dec3 = lab.coin_breakout(H, dict(p, hiN=3))[1]
        lv = lambda dec, d: next(x["level"] for x in dec if x["date"] == d)
        self.assertEqual(lv(dec1, "2026-08-05"), 105)                              # 어제 고가
        self.assertEqual(lv(dec3, "2026-08-05"), 130)                              # 최근 3일 중 가장 높은 고가
        self.assertEqual(lab.coin_breakout(H, dict(p, hiN=3))[2]["levelNext"], 105)  # 다음 날 기준선도 같은 식(마지막 3일 고가 105·100·100)
        self.assertEqual(lab.coin_breakout(H, dict(p, hiN=1))[2]["levelNext"], 100.5)


if __name__ == "__main__":
    unittest.main()
