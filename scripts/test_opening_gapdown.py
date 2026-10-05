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
        variants = [dict(), dict(ma=10, stopPct=3.0), dict(level="vb", k=0.5), dict(lastEntryHour=15, stopPct=2.0), dict(ma=5, level="vb", k=0.3, lastEntryHour=21)]
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
                py.append(dict(action=r["action"], entry=r["entryPrice"], pnl=r["pnlPct"]))
        api_dir = os.environ.get("JKQ_API_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "functions", "api")
        api = os.path.join(api_dir, "claude-live.js")
        js = ("import * as LV from " + json.dumps("file://" + os.path.abspath(api)) + ";"
              "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const out=JSON.parse(s).map(c=>{const h=LV.coinHoldToday(c.daily,c.P);"
              "const r=LV.coinBreakoutDay(h,c.bars,c.bars[23].trade_price,c.P);"
              "return {action:!h.hold?'flat':!r.hold?'no_break':r.stopped?'stop':'trade',entry:r.hold?r.buyPrice:null,pnl:r.hold?r.pnlPct:null};});"
              "process.stdout.write(JSON.stringify(out));});")
        res = subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(cases), capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr[-500:])
        out = json.loads(res.stdout)
        self.assertEqual(len(out), len(py))
        acts = set()
        for a, b in zip(py, out):
            self.assertEqual(a["action"], b["action"])
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


class ArenaTest(unittest.TestCase):
    """전략 경쟁: 신규 투입으로 그림자 10~12개 유지 · 손실 기준 미달/7일 하위 3위 퇴출 · 7일 연속 1위 자동 승격(다음 날부터)."""

    def setUp(self):
        self.old = (lab.arena_eval, lab.post_json, list(lab.MAIN_EVENTS), os.environ.get("JKQ_MONITOR_KEY"))
        lab.MAIN_EVENTS[:] = []
        # 가짜 성적: ① 통과 개수(minQ)가 클수록 점수↑, minQ<3 은 손실 기준 미달. 깊은 종목 수가 적을수록 조금 낮게.
        def ev(tab, e, ctx):
            p = e["params"]
            sc = p["minQ"] * 0.01 - (3 - p["topK"]) * 0.001 - (0.0005 if p.get("gapMax") is not None else 0)
            gate = p["minQ"] >= 3 and p.get("gapMax") is None            # 갭 거르기 안은 손실 기준 미달(새 후보면 투입 전 탈락해야 함)
            return dict(full=dict(gate=gate, mddPct=-10.0 if gate else -40.0, worstDayPct=-5.0, expectancyPct=0.5),
                        year=dict(totalPct=sc * 100), d90={}, oos={}, score=sc)
        lab.arena_eval = ev
        self.posts = []
        lab.post_json = lambda url, body, key, timeout=30: (self.posts.append((url, body)) or {"ok": True})

    def tearDown(self):
        lab.arena_eval, lab.post_json = self.old[0], self.old[1]
        lab.MAIN_EVENTS[:] = self.old[2]
        if self.old[3] is None:
            os.environ.pop("JKQ_MONITOR_KEY", None)
        else:
            os.environ["JKQ_MONITOR_KEY"] = self.old[3]

    def run_days(self, days, key=None):
        if key:
            os.environ["JKQ_MONITOR_KEY"] = key
        else:
            os.environ.pop("JKQ_MONITOR_KEY", None)
        state, outs = {}, []
        for d in days:
            out, state = lab.arena({}, today=d, state=state, tabs=("opening",))
            outs.append(out["opening"])
        return outs, state

    def test_pool_kept_and_bad_retired(self):
        outs, state = self.run_days(["2026-10-05"])
        z = outs[0]
        self.assertEqual(z["poolSize"], lab.POOL_TARGET)                       # 12개로 채운다
        self.assertTrue(all(r["full"]["gate"] for r in z["rows"] if not r["isMain"]))   # 그림자는 손실 기준 통과만
        ret = state["tabs"]["opening"]["retired"]
        self.assertTrue(any(x["version"] == "opening_d1_min1" and "손실 기준 미달" in x["reason"] for x in ret))
        self.assertTrue(any(x["kind"] == "new" for x in state["log"]) and any(x["kind"] == "retire" for x in state["log"]))
        self.assertTrue(any(x["kind"] == "reject" for x in state["log"]))      # 기준 미달 후보는 투입 전 탈락 기록
        self.assertTrue(state["tabs"]["opening"]["tried"])
        self.assertGreaterEqual(z["poolSize"], lab.POOL_MIN)

    def test_seven_days_top_promotes_next_day(self):
        # 10/5 첫날은 기존 목록 1위(min8) → 10/6 부터 새로 들어온 q9 가 1위 → 10/12 에 7일(달력) → 10/13 부터 메인
        days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]
        outs, _ = self.run_days(days, key="k")
        z = outs[-1]
        self.assertEqual(outs[0]["top"], "opening_d1_min8")
        self.assertEqual(z["status"]["code"], "promoted")
        ev = z["status"]["event"]
        self.assertEqual(ev["effectiveFrom"], "2026-10-13")                     # 다음 날부터
        self.assertEqual(ev["version"], "g_open_q9_k3")
        self.assertEqual(ev["params"], dict(minQ=9, topK=3, gapMax=None))
        self.assertTrue(self.posts and self.posts[0][0].endswith("/claude-config"))
        self.assertEqual(lab.main_for("opening")["version"], "g_open_q9_k3")     # 같은 계산 안에서도 다음 메인으로 보인다
        self.assertEqual(lab.main_for("opening", "2026-10-12")["version"], lab.MAIN_DEFAULT["opening"]["version"])

    def test_six_days_not_enough_and_no_key_only_due(self):
        outs, _ = self.run_days(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-11"], key="k")
        self.assertEqual(outs[-1]["status"]["code"], "streak")
        self.assertEqual(outs[-1]["status"]["days"], 6)                       # 10/6~10/11
        self.assertEqual(self.posts, [])
        outs, _ = self.run_days(["2026-10-05", "2026-10-06", "2026-10-13"])    # 감시키 없으면 기록하지 않는다
        self.assertEqual(outs[-1]["status"]["code"], "due")
        self.assertEqual(self.posts, [])

    def test_bottom_three_for_seven_days_retired(self):
        # 첫날은 기존 목록만으로 순위 → 하위 3위 연속은 10/6 부터 → 10/12 에 7일
        outs, state = self.run_days(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"])
        self.assertFalse([x for x in state["tabs"]["opening"]["retired"] if "하위" in x["reason"]])
        outs, state = self.run_days(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"])
        rs = [x for x in state["tabs"]["opening"]["retired"] if "하위" in x["reason"]]
        self.assertTrue(rs, "7일 연속 하위 3위 퇴출이 없음")
        self.assertGreaterEqual(outs[-1]["poolSize"], lab.POOL_MIN)


if __name__ == "__main__":
    unittest.main()
