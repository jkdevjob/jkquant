# Historical opening research price basis

Historical Top100 archives combine original daily prices and KIS adjusted minute prices. For example, 2026-02-09 / 011930 has original daily open 2,270 and adjusted daily/minute open 22,700. Using those fields together distorts intraday qualification and overnight returns.

This change supports an explicit `priceBasisReference` annotation in a separate input archive. Legacy archives retain identical behavior. The original gap remains original daily open divided by the archived reference previous close. Intraday opening-price comparisons use the authoritative adjusted daily open. Minute OHLCV and historical turnover ranks remain unchanged. Corrected signals use separate `opening_rebreak_basis_v2` / `opening_hold_to_next_open_basis_v2` versions and retain reference file names.

Fallback execution cost remains 0.23% plus 2.5 ticks per side. Paired original/adjusted daily OHLC constrain an original-equivalent entry-price interval under an explicit one-won rounding uncertainty model. The engine evaluates both endpoints of every tick band crossed and reports both cost bounds, applying the larger cost. It does not force an execution price onto the quote grid. This is a bounded cost approximation, not a claim that the original execution price was observed.

The overnight exit uses the annotated immediate next market session's adjusted open. A missing next reference, a changed adjustment-factor interval, or an existing corporate-action review leaves the signal pending. It does not substitute the next available symbol trading date. Baseline and overnight entries must match.

## Validation and limits

- The existing source-price review/adoption gate remains active. Supporting annotated replay does not certify the dataset or promote a strategy.
- Every legacy outcome record was compared with the preserved one-year run: 15,544 exact matches.
- The preliminary annotated run produced 15,954 records; all 14 aggregate summaries, resolved net returns, original Top100 reconstruction and baseline/overnight entry parity were independently recalculated. This is arithmetic verification, not final research approval.
- Ten focused value tests cover original-gap preservation, adjusted opening comparisons, original tick cost, tick-band uncertainty, non-grid executions, invalid factors and pending corporate actions. Three behavioral mutations test mixing the intraday open, choosing the favorable cost bound, and mixing the overnight exit price.
- Same-day closing Top100 membership contains hindsight. Missing opening minutes and sparse observations remain visible. The design period is distinct from prospective observations from 2026-10-01. Trade averages are not a portfolio return series.
- The September 30 FinanceData snapshot differs from final KIS daily totals. A follow-up collected all 2,873 historical listing members with no empty responses: final turnover Top100 adds 071090 and removes 247540, with other rank changes. The added stock's original/adjusted daily references and 60 observed opening bars were collected into a separately versioned input. The original snapshot is preserved. Final replay validation remains required; do not publish draft results as validated final performance.

No original archive or prior outcome file is overwritten by this change. Updated signal output is revision-preserved by the existing content-addressed revision mechanism. No order path is changed.
