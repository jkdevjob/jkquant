# 시초가 단타매매 전략 백테스트 (Opening Breakout Backtester)

한국 주식시장(KOSPI/KOSDAQ) 대상, **1분봉 기반 시초가 돌파 단타 전략**을
과거 데이터로 검증하는 백테스트 프로그램입니다. 파라미터를 바꿔 가며 반복
테스트하고, 수익률·승률·MDD·Profit Factor 등을 종합해
**"이 전략이 실제로 돈을 벌었는가?"** 를 판단할 수 있게 설계했습니다.

> ⚠️ **가장 중요한 원칙**: 높은 수익률을 만드는 게 아니라 **미래 데이터를 전혀
> 쓰지 않는 정확한 백테스트**를 만드는 것. 이 저장소에 포함된 샘플 데이터는
> `data_io/sample_data.py` 가 만든 **합성(가짜) 데이터**이며, 여기서 나오는 수치는
> **기능 검증용일 뿐 실제 성과가 아닙니다.** 실제 판단은 실분봉을 넣은 뒤에만
> 가능합니다(맨 아래 "실데이터 넣는 법" 참고).

---

## 1. 프로젝트 구조

```
obt/
├── config/strategy.yaml        # 모든 파라미터(코드 수정 없이 여기만 변경)
├── data/
│   ├── raw/                    # 원천 데이터 두는 곳
│   └── processed/              # 로더가 읽는 분봉 CSV
├── data_io/                    # ── 데이터 계층(수집과 전략 분리) ──
│   ├── loader.py               #   CSV → MarketData (전략이 보는 유일한 인터페이스)
│   ├── sample_data.py          #   합성 분봉 생성(가짜, 기능검증용)
│   ├── collect.py              #   실데이터 수집 경계(pykrx 일봉 등)
│   └── quality.py              #   데이터 품질 검사
├── strategy/                   # ── 전략 계층 ──
│   ├── base_strategy.py        #   전략 베이스 + 컨텍스트(확정값만)
│   ├── filters.py              #   후보 선정 필터(순수 함수)
│   └── opening_breakout.py     #   전략 A~E
├── backtest/                   # ── 백테스트 엔진 ──
│   ├── engine.py               #   하루씩 전진(룩어헤드 방지 규약 명시)
│   ├── execution.py            #   체결·슬리피지·수수료·세금
│   ├── portfolio.py            #   자본·포지션 사이징
│   └── metrics.py              #   성과 지표
├── optimization/
│   ├── optimizer.py            #   파라미터 그리드 최적화
│   └── walkforward.py          #   Train/Validation/Test 분할 검증
├── reporting/
│   ├── plots.py                #   그래프 10종 PNG
│   └── report.py               #   리포트 오케스트레이션 + 기간별 성과
├── reports/                    # 결과 CSV·PNG 출력 위치
├── tests/test_units.py         # 단위 테스트(계산 정확성·룩어헤드)
├── main.py                     # CLI 진입점
└── requirements.txt
```

## 2. 설치 & 실행

```bash
cd obt
pip install -r requirements.txt

python main.py sampledata     # (1) 합성 샘플 분봉 생성 — 가짜 데이터
python main.py backtest       # (2) 단일 백테스트 → reports/trades.csv 등
python main.py optimize       # (3) 파라미터 그리드 최적화 → reports/optimization.csv
python main.py report         # (4) 품질검사+백테스트+그래프+기간별 요약
python main.py validate       # (5) Train/Validation/Test (과최적화 점검)

# 설정 파일 바꾸기
python main.py backtest --config config/strategy.yaml
```

## 3. 설정 파일(config/strategy.yaml) 요약

| 섹션 | 키 | 뜻 |
|---|---|---|
| `capital` | initial_capital / position_pct / max_positions | 초기 투자금 / 종목당 비중 / 하루 최대 종목수 |
| `filters` | prev_value, prev_volume, gap, first_bar_volume, first_bar_value | 후보 선정 조건(각각 `enabled` 로 ON/OFF) |
| `entry` | strategy(A~E) / entry_window_min / open_breakout_pct / volume_multiplier / volume_lookback_days | 진입 규칙 |
| `exit` | stop_loss_pct / take_profit_pct / time_exit / trailing.* | 손절·익절·시간청산·트레일링 |
| `costs` | buy_commission / sell_commission / tax / slippage | 매매 비용(하드코딩 금지, 여기서만) |
| `split` | train / validation / test | 기간 분할 비율 |
| `optimize` | objective / grid / grid_axes | 최적화 대상·격자 |

**전략 A~E**
- A: 첫 1분봉 고가 돌파(+거래량 급증 요건) · B: 첫 3분봉 고가 · C: 첫 5분봉 고가
- D: 시초가 대비 +x% 돌파 · E: 첫 1분봉 고가 돌파 + 거래량 증가(강제)

## 4. 룩어헤드(미래참조) 방지 — 이 프로그램의 핵심

`backtest/engine.py` 상단 주석에 규약을 명시했고, 코드 곳곳에 "언제 이용 가능한
데이터인지" 주석을 달았습니다.

- **후보 선정**은 전일 일봉(과거) + 당일 첫 window개 **완료된** 봉만 사용.
- **거래량 급증 평균**은 `prev_first_bar_volumes()` 로 **과거 거래일만**(당일·미래 제외).
- **진입 스캔**은 window 이후 봉부터, 각 봉은 그 봉이 끝났을 때의 OHLC만 사용.
- **청산 스캔**은 진입한 봉 **다음** 봉부터.
- 한 봉에서 손절·익절이 동시에 닿으면 **손절 우선(보수적)**, 갭으로 기준가를
  지나치면 **더 불리한 쪽**으로 체결.
- 상장폐지 종목도 CSV에 넣을 수 있어 **생존자 편향**을 줄이도록 설계.

테스트(`tests/test_units.py`)에 룩어헤드 방지 케이스를 포함(`test_no_entry_within_window`,
`test_prev_first_bar_volumes_past_only`, `test_prev_daily_row_strictly_past`).

## 5. 출력물

- `reports/trades.csv` — 거래별 상세(date,ticker,gap_rate,entry/exit,비용,net_return,exit_reason…)
- `reports/daily.csv` — 일별(starting/ending capital, daily_pnl, trades…)
- `reports/metrics.csv` — 전체 지표
- `reports/optimization.csv` — 그리드 조합별 CAGR/MDD/PF/승률/거래수/최종자산
- `reports/walkforward.csv` — Train/Val/Test 성과
- `reports/period_breakdown.csv` — 전체·1·3·5·10년·연도별
- `reports/01_*.png ~ 10_*.png` — 자산곡선/누적수익률/Drawdown/월·연별/분포/시간대별/종목별/갭률별/청산사유

## 6. 테스트

```bash
cd obt && python -m pytest tests/ -q
```
갭률·진입·손절·익절·트레일링·시간청산·수수료·세금·포지션 사이징·MDD·룩어헤드 방지 검증.

## 7. "이 전략이 실제로 돈을 벌었는가?" 판단법

한 줄 수익률로 결론짓지 마세요. `report` 와 `validate` 가 함께 보여주는:
CAGR · MDD · Profit Factor · 승률 · 평균 손익 · 거래 횟수 · 연도별/월별 수익률 ·
최대 연속 손실 · **Train/Validation/Test 성과 일관성**을 종합해 판단합니다.
특히 Train 만 좋고 Validation/Test 가 무너지면 **과최적화**입니다.

## 8. 실제 한국 주식 1분봉 데이터 넣는 법

무료 분봉 소스는 사실상 없습니다.
- **pykrx**: 일봉·거래대금은 주지만 **분봉은 제공하지 않습니다.**
  (`data_io/collect.fetch_daily_pykrx()` 로 정확한 전일 종가/거래대금 CSV는 생성 가능)
- **1분봉**은 증권사 API(키움/대신/한국투자 등) 또는 유료 벤더에서 받아 아래
  CSV 포맷으로 `data/processed/` 에 저장하면 코드 수정 없이 그대로 백테스트됩니다.

```
datetime,ticker,name,open,high,low,close,volume,value
2023-05-02 09:00:00,005930,삼성전자,66000,66100,65900,66050,120000,7926000000
2023-05-02 09:01:00,005930,삼성전자,66050,66200,66000,66150,80000,5292000000
...
```
- 종목당 1파일 또는 통합 1파일 모두 지원(`config.data.minute_glob`).
- 정확한 전일 종가가 필요하면 `config.data.daily_file` 에 일봉 CSV 경로 지정.
- 데이터를 넣은 뒤 `python main.py report` → 그때 나온 수치가 **실제 성과**입니다.

## 라이선스/주의
개인 학습·연구용. 백테스트 결과는 과거이며 미래 수익을 보장하지 않습니다.
매매 비용·체결 가정이 실제와 다를 수 있습니다.
