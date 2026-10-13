#!/usr/bin/env python3
"""텐배거(클로드) 1단계 — KRX 전 종목 일별 자료로 수정주가 패널을 만든다.

원자료: FinanceData/marcap (KRX 전종목시세를 날마다 모은 공개 자료, 1995-05-02~)
  - 상장폐지 종목도 상장돼 있던 날짜까지 그대로 들어 있다 → 생존편향이 없다.
  - 값은 수정 전 원래 가격이다. 수정주가는 KRX 가 날마다 정한 '기준가'(종가−전일대비)로
    하루 수익률을 이어 붙여 만든다: r_t = 종가_t / 기준가_t − 1.
    액면분할·병합·무상증자·유상증자 권리락·감자는 KRX 가 기준가에 반영하므로 이어 붙이면 그대로 수정된다.
    (네이버 수정주가와 48종목 대조: 30년 누적수익 비율 0.99~1.02, 다른 경우는 네이버 정수 반올림·통합시세)
  - 현금배당은 기준가에 반영하지 않는다(일부 1990년대 배당락 제외) → 가격수익률 기준이다.

종목 범위: 코스피·코스닥(코스닥 글로벌 포함) 보통주(코드 끝자리 0).
  우선주·신주(코드 끝 0 아님), 코넥스, 스팩, 리츠·인프라·선박 펀드는 뺀다.
  같은 코드가 20거래일 넘게 비었다가 다시 나오면(재상장) 다른 종목으로 나눈다 — 이어 붙이면 가격이 틀린다.

쓰는 법:
  python scripts/tenbagger_claude/panel.py --marcap /path/to/marcap/data --out /scratch/panel.npz
"""
import argparse
import glob
import os
import sys

import numpy as np
import pandas as pd

COLS = ['Date', 'Code', 'Name', 'Market', 'Dept', 'Open', 'High', 'Low', 'Close',
        'Volume', 'Amount', 'Changes', 'Marcap', 'Stocks']
MARKETS = {'KOSPI': 1, 'KOSDAQ': 2, 'KOSDAQ GLOBAL': 2}
# 펀드·특수목적 회사 — 영업 회사가 아니다(뮤추얼펀드 'OO1호'·선박펀드·CR리츠·유전펀드·스팩).
# '메리츠'(증권·종금)·'세양선박'(해운사)·'OO인프라'(건설사)는 회사이므로 끝말·숫자로만 거른다.
FUND_RE = (r'스팩|SPAC|기업인수목적|리츠$|코크렙|REIT|메리츠\d$|맥쿼리|발해인프라|인프라펀드|인프라투융자|'
           r'선박투자|선박펀드|유전$|유전\d|해외자원|펀드|기금$|채권|MF$|-MF|\d+호$|아시아퍼시픽\d|하나니켈|'
           # 1999~2008 상장 뮤추얼펀드·부동산/경매 펀드: 운용사 앞말 + 끝 숫자('KTB전환형1'·'미래하이3'·'베트남개발1')
           r'^(?:KTB|미래|마이다스|리젠트|실크|알바트로스|굿라이프|챌린지|옵티멈|플래티넘|월드그랜드|파이오니어|'
           r'글로벌하이|동원장보고|성공파트너|박현주|세이|다임|유리롱숏|마이차익|맵스|지비베트남|베트남개발|지앤알|굿리치|리얼티)'
           r'[^0-9]*[0-9]+$')
GAP_SPLIT = 20          # 이 거래일 수보다 길게 비면 재상장으로 보고 나눈다
DELIST_TAIL = 30        # 상장폐지 종목의 마지막 30거래일 = 정리매매 구간(1990년대엔 30일까지 했다)
DEPT_CODE = {'관리종목(소속부없음)': 1, '투자주의환기종목(소속부없음)': 2, '외국기업(소속부없음)': 3,
             'SPAC(소속부없음)': 4}


def load(marcap_dir):
    fs = sorted(glob.glob(os.path.join(marcap_dir, 'marcap-*.parquet')))
    if not fs:
        sys.exit('marcap parquet 없음: ' + marcap_dir)
    df = pd.concat([pd.read_parquet(f, columns=COLS) for f in fs], ignore_index=True)
    df['Code'] = df['Code'].astype(str).str.zfill(6)
    return df


def select_universe(df):
    m = df['Market'].isin(list(MARKETS)) & (df['Code'].str[-1] == '0') & (df['Close'] > 0)
    df = df[m].copy()
    fund = df['Name'].astype(str).str.contains(FUND_RE, regex=True, na=False) | (df['Dept'] == 'SPAC(소속부없음)')
    # 스팩이었다가 합병 뒤 이름이 바뀐 코드는 이름이 바뀐 뒤부터만 쓴다(행 단위로 거른다).
    df['fund'] = fund
    return df


def daily_return(close, changes, prev_close, stocks, prev_stocks, in_tail):
    """하루 수정 수익률. 기본은 KRX 기준가(종가−전일대비) 대비.
    규정상 하루에 나올 수 없는 값(+160% 초과·−66% 미만 — 재개 시초 50~200% 에 가격제한폭을 더해도 넘는다)은
    자료 문제로 본다: 주식 수가 10% 넘게 바뀌었으면(감자·병합인데 기준가 미수정) 시가총액 연속으로,
    아니면 0 으로 둔다. 다만 정리매매(상장폐지 전 마지막 구간)의 폭락은 실제이므로 그대로 둔다
    (정리매매 안의 급등은 '1원' 자리표시 오류가 섞여 있어 보정한다 — 그 구간엔 사지 않으므로 영향이 적다).
    반환: (수익률, 보정 종류: 0 그대로 · 1 시가총액 연속 · 2 0 처리)."""
    ref = close - changes
    ok = (ref > 0) & np.isfinite(ref)
    r = np.where(ok, close / np.where(ok, ref, 1.0) - 1.0, close / prev_close - 1.0)
    r = np.where(np.isfinite(r), r, 0.0)
    imp = ((r > 1.6) | ((r < -0.66) & ~in_tail)) & np.isfinite(prev_close)
    sr = stocks / prev_stocks
    r_cap = close * stocks / (prev_close * prev_stocks) - 1.0
    share_chg = np.isfinite(sr) & (np.abs(np.log(np.where(sr > 0, sr, 1.0))) > np.log(1.1))
    cap_ok = share_chg & np.isfinite(r_cap) & (r_cap <= 1.6) & (r_cap >= -0.66)
    kind = np.where(imp & cap_ok, 1, np.where(imp, 2, 0))
    r = np.where(kind == 1, r_cap, np.where(kind == 2, 0.0, r))
    return r, kind


def chain_adjust(df, keep_open_start=False):
    """종목별 날짜순으로 기준가 수익률을 이어 붙인다. 재상장 구간은 다른 종목 id 로 나눈다.
    keep_open_start: 최근 몇 년만 받은 자료 창(전향 시험) — 창 첫날 이미 상장돼 있던 종목은 거래정지 행도 남긴다
    (30년 패널에서는 상장 전 자리표시가 아니라 진짜 정지 구간이다)."""
    df = df.sort_values(['Code', 'Date']).reset_index(drop=True)
    cal = np.sort(df['Date'].unique())
    ci = pd.Series(np.arange(len(cal)), index=cal)
    df['ci'] = df['Date'].map(ci).astype(np.int32)
    gap = df.groupby('Code')['ci'].diff()
    newseg = gap.isna() | (gap > GAP_SPLIT)
    seg = newseg.groupby(df['Code']).cumsum().astype(int)
    df['id'] = np.where(seg > 1, df['Code'] + '#' + seg.astype(str), df['Code'])
    # 상장 전 자리표시 행(거래량 0 · 종가 1원 등)은 버린다 — 첫 거래가 그 값 대비 수만 배로 잡힌다
    traded_cum = (df['Volume'] > 0).groupby(df['id']).cummax()
    if keep_open_start:
        traded_cum |= df.groupby('id')['ci'].transform('min').eq(0)
    df = df[traded_cum].reset_index(drop=True)
    g = df.groupby('id')
    prev = g['Close'].shift(1)
    prev_st = g['Stocks'].shift(1)
    delisted = g['Date'].transform('max') < df['Date'].max()
    in_tail = (delisted & (g.cumcount(ascending=False) < DELIST_TAIL)).values
    r, kind = daily_return(df['Close'].values.astype(float), df['Changes'].values.astype(float),
                           prev.values.astype(float), df['Stocks'].values.astype(float),
                           prev_st.values.astype(float), in_tail)
    r = pd.Series(r, index=df.index)
    first = df['id'] != df['id'].shift(1)
    r[first] = 0.0
    kind[first.values] = 0
    df['fixkind'] = kind
    df['r'] = r
    df['adj'] = np.exp(np.log1p(df['r'].clip(lower=-0.9999)).groupby(df['id']).cumsum())
    # 첫날 수정가 = 원래 종가가 되게 맞춘다(가격 수준 읽기 쉽게) — 수익률 계산엔 영향 없다
    base = df['Close'].where(first).groupby(df['id']).transform('first')
    df['adj'] = df['adj'] * base
    df['fac'] = df['adj'] / df['Close']
    return df, cal


def to_wide(df, cal):
    ids = pd.Index(sorted(df['id'].unique()))
    T, N = len(cal), len(ids)
    col = ids.get_indexer(df['id'])
    row = df['ci'].values

    def mat(vals, dtype=np.float32, fill=np.nan):
        M = np.full((T, N), fill, dtype=dtype)
        M[row, col] = vals
        return M

    traded = (df['Volume'] > 0).values
    hi = np.where(traded & (df['High'] > 0), df['High'] * df['fac'], df['adj'])
    lo = np.where(traded & (df['Low'] > 0), df['Low'] * df['fac'], df['adj'])
    op = np.where(traded & (df['Open'] > 0), df['Open'] * df['fac'], df['adj'])
    dept = df['Dept'].map(DEPT_CODE).fillna(0).astype(np.int8).values
    meta = df.groupby('id').agg(code=('Code', 'last'), name=('Name', 'last'), market=('Market', 'last'),
                                first=('Date', 'min'), last=('Date', 'max'))
    meta = meta.reindex(ids)
    out = dict(
        dates=np.array(pd.DatetimeIndex(cal).strftime('%Y-%m-%d')).astype(str),
        ids=np.array(ids).astype(str), codes=meta['code'].to_numpy(dtype=str), names=meta['name'].to_numpy(dtype=str),
        market_last=meta['market'].to_numpy(dtype=str),
        first=np.array(pd.DatetimeIndex(meta['first']).strftime('%Y-%m-%d')).astype(str),
        last=np.array(pd.DatetimeIndex(meta['last']).strftime('%Y-%m-%d')).astype(str),
        close=mat(df['adj'].values), high=mat(hi), low=mat(lo), open=mat(op),
        raw=mat(df['Close'].values),
        vol=mat(df['Volume'].values),
        amt=mat(df['Amount'].values),
        cap=mat(df['Marcap'].values),
        mkt=mat(df['Market'].map(MARKETS).values.astype(np.int8), np.int8, 0),
        dept=mat(dept, np.int8, -1),
        fund=mat(df['fund'].values.astype(np.int8), np.int8, 0),
    )
    # 종목명은 날짜마다 바뀐다(사명 변경) — 종목별 이름 이력: (id, 시작일, 이름)
    nm = df[['id', 'Date', 'Name']]
    ch = nm['Name'] != nm.groupby('id')['Name'].shift(1)
    hist = nm[ch]
    out['fix_counts'] = np.array([int((df['fixkind'] == 1).sum()), int((df['fixkind'] == 2).sum())])
    out['name_hist'] = np.array([f"{a}\t{b:%Y-%m-%d}\t{c}" for a, b, c in hist.itertuples(index=False)]).astype(str)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--marcap', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    df = load(a.marcap)
    n0 = df['Code'].nunique()
    df = select_universe(df)
    df, cal = chain_adjust(df)
    W = to_wide(df, cal)
    np.savez_compressed(a.out, **W)
    alive = (W['last'] == W['dates'][-1]).sum()
    print(f'전체 코드 {n0} → 보통주 종목(재상장 분리) {len(W["ids"])} · 마지막 날 상장 {alive} · '
          f'상폐/소멸 {len(W["ids"]) - alive} · 거래일 {len(cal)} ({W["dates"][0]}~{W["dates"][-1]}) · '
          f'자료 보정: 시가총액 연속 {W["fix_counts"][0]}일 · 0 처리 {W["fix_counts"][1]}일')


if __name__ == '__main__':
    main()
