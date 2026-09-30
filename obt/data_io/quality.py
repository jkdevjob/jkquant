"""데이터 품질 검사 — 백테스트 실행 전에 경고를 출력한다.

검사: 결측치 / 중복 / 시간순서 / 비정상 OHLC / 거래량 0 / 거래정지(빈 세션) /
상장·상장폐지 커버리지 / 액면분할·병합·권리락 의심(하루 급변).
문제를 '수정'하지는 않고 사실만 보고한다(조용한 조작 금지).
"""
from __future__ import annotations
import pandas as pd


def check(market) -> list[str]:
    warnings: list[str] = []

    for ticker in market.tickers():
        days = market.minute[ticker]
        for date, bars in days.items():
            tag = f"[{ticker} {date}]"
            if bars is None or not len(bars):
                warnings.append(f"{tag} 빈 세션(거래정지 의심)")
                continue
            # 결측치
            if bars[["open", "high", "low", "close", "volume"]].isna().any().any():
                warnings.append(f"{tag} 결측치")
            # 중복 시각
            if bars.index.duplicated().any():
                warnings.append(f"{tag} 중복 시각 {int(bars.index.duplicated().sum())}건")
            # 시간 순서
            if not bars.index.is_monotonic_increasing:
                warnings.append(f"{tag} 시간 역순")
            # 비정상 OHLC
            bad = bars[(bars["high"] < bars["low"]) |
                       (bars["high"] < bars["open"]) | (bars["high"] < bars["close"]) |
                       (bars["low"] > bars["open"]) | (bars["low"] > bars["close"]) |
                       (bars[["open", "high", "low", "close"]] <= 0).any(axis=1)]
            if len(bad):
                warnings.append(f"{tag} 비정상 OHLC {len(bad)}건")
            # 거래량 0 비율
            zero = int((bars["volume"] <= 0).sum())
            if zero > len(bars) * 0.5:
                warnings.append(f"{tag} 거래량 0 봉 과다 {zero}/{len(bars)}")

        # 액면분할/병합·권리락 의심: 전일 종가 대비 시가가 ±40% 이상 튀는 날
        daily = market.daily.get(ticker)
        if daily is not None and len(daily) > 1:
            close = daily["close"]
            chg = close.pct_change().abs()
            spikes = chg[chg > 0.40]
            for d, v in spikes.items():
                warnings.append(f"[{ticker} {d}] 종가 급변 {v*100:.0f}% (액면분할/권리락 의심)")

    # 커버리지(상장/상장폐지): 종목별 데이터 기간 요약 — 생존자 편향 점검용
    for ticker in market.tickers():
        ds = sorted(market.minute[ticker].keys())
        if ds:
            warnings.append(f"[{ticker}] 커버리지 {ds[0]}~{ds[-1]} ({len(ds)}일)  ← 상장폐지 종목 포함 여부 확인 권장")

    return warnings


def print_report(market) -> list[str]:
    w = check(market)
    print("=" * 60)
    print("데이터 품질 검사")
    print("=" * 60)
    if not w:
        print("  이상 없음.")
    else:
        for line in w:
            print("  " + line)
    print(f"  총 {len(w)}개 항목")
    return w
