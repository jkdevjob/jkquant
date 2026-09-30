# Deep LOC regime sensitivity v2 — research only

Base main: `c6478d116eff14eb038be032712dc0d8d36abff7`
Relevant latest main checked afterward: `2a7d0f6f656367dbd8eebd2fc9b97a08c0a85aea`
No intervening `backtest.html` change.
GitHub Actions run: `36651084378`
Date: 2026-09-30
Engine: backtest.html v2.16.0 full page / real `/api/quote`
SOXL: 2010-03-11~2026-09-28, 4,163 bars
Settings: 20 split / compound / reverse OFF / big 20 / TP20 / costs ON
A: official 1 share x 3 lower LOC rows
B: alpha 1 / 2 rows / beta 0.15 / q=Math.round(0.15*Q), JS half-up
Regime is decided only at cycle start from prior confirmed data and held to cycle end.

## A parity
- $10k full: 597,518.09 / CAGR 28.0355 / MDD 54.4419
- $100k full: 4,689,989.23 / CAGR 26.1756 / MDD 60.5196
- $10k 2020~: 80,336.31
- $100k 2020~: 815,208.10

These reproduce the prior Claude A values.

## 10/20/40-day MA150 slope x q>=2/3/4 sensitivity

| Rule | SOXL full vs A $10k | SOXL full vs A $100k | 5y wins $10k | 5y wins $100k | 5y mean CAGR diff $10k | 5y mean CAGR diff $100k | first-21 starts wins $10k |
|---|---:|---:|---:|---:|---:|---:|---:|
| rise10 q>=2 | -7.48% | +10.87% | 71.94% | 82.73% | +0.24%p | +1.12%p | 2/21 |
| rise10 q>=3 | -9.64% | +10.87% | 74.10% | 79.86% | +0.22%p | +1.11%p | 12/21 |
| rise10 q>=4 | +3.67% | +10.87% | 63.31% | 82.01% | +0.12%p | +1.11%p | 20/21 |
| rise20 q>=2 | -7.80% | +11.01% | 67.63% | 82.01% | +0.20%p | +1.12%p | 2/21 |
| rise20 q>=3 | +0.98% | +11.01% | 74.10% | 79.86% | +0.23%p | +1.11%p | 19/21 |
| rise20 q>=4 | +3.53% | +11.01% | 64.75% | 82.01% | +0.09%p | +1.11%p | 19/21 |
| rise40 q>=2 | -9.83% | +10.92% | 67.63% | 82.01% | +0.20%p | +1.13%p | 2/21 |
| rise40 q>=3 | +0.06% | +10.92% | 73.38% | 81.29% | +0.21%p | +1.12%p | 20/21 |
| rise40 q>=4 | +3.68% | +10.92% | 63.31% | 81.29% | +0.09%p | +1.12%p | 19/21 |

## Most robust research candidate
`MA150 20-day rise AND q>=3 -> B; else A`

SOXL:
- $10k full: 603,364.78 (+0.98% vs A), CAGR +0.075%p, MDD -0.34%p
- $100k full: 5,206,359.22 (+11.01%), CAGR +0.799%p, MDD -6.19%p
- $10k 2020~: 81,151.89 (+1.02%)
- $100k 2020~: 829,382.94 (+1.74%)
- 5y monthly windows 139: wins 74.10% / 79.86% ($10k/$100k)
- 5y mean CAGR diff: +0.230 / +1.112%p
- 5y worst final ratio vs A: 0.958 / 0.933
- first 21 starting days: wins 19/21 / 21/21

`rise40 q>=3` is close and confirms a broad 20~40-day plateau:
- $10k full +0.06%, 5y wins 73.38%, first-21 wins 20/21
- $100k full +10.92%, 5y wins 81.29%, first-21 wins 21/21

q>=4 improves single full-period $10k final value but reduces 5y-window consistency and worsens the worst 5y path, so it is not preferred for robustness.

## Cross-validation
For `rise20 q>=3`:
- TQQQ $10k full: -9.32% vs A; 5y mean CAGR diff +0.016%p
- TQQQ $100k full: +3.72%; 5y mean CAGR diff -0.007%p
- TECL $10k full: -0.53%; 5y mean CAGR diff -0.086%p
- TECL $100k full: +3.22%; 5y mean CAGR diff +0.092%p

Thus the edge is strongest in SOXL / larger capital and does not cleanly generalize to all leveraged ETFs.

## Synthetic stress
The current official webapp leverage-extension synthetic series gives 131 monthly-start 5y windows:
- A bankruptcy windows: 0 / 1 ($10k/$100k)
- all 9 conditional candidates: 0 / 1
So under the current official synthetic path the conditional regime does not increase bankruptcy count.

However this is NOT the same construction as the earlier Claude report's
"1994~2010 synthetic SOXL with virtual splits to keep nominal price in actual range",
which reported A 32/32, B 33/40, C 36/46. The exact virtual-split code/schedule was not committed in the repository and could not be recovered from the LOC research branch, stored outputs, PRs, or prior project files. Do not compare the 0/1 counts with 32/32 as if they were the same dataset.

## Research conclusion
Keep operating A unchanged.
Best research candidate: `MA150 slope 20~40d positive + q>=3 -> B, otherwise A`.
Do not promote to production until the old virtual-split stress construction is recovered or independently specified and reproduced.
