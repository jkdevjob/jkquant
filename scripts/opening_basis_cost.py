"""Research-only original-price tick cost uncertainty; never rewrites source bars."""
import math

GRID = ((0, 2000, 1), (2000, 5000, 5), (5000, 20000, 10),
        (20000, 50000, 50), (50000, 200000, 100),
        (200000, 500000, 500), (500000, math.inf, 1000))


def overnight_basis_status(reference):
    """Keep an overnight corporate-action interval pending until separately verified."""
    nxt = reference['nextMarketSession']
    if nxt['status'] != 'reference_available_not_execution_validated':
        return nxt['status']
    fields = ('stck_oprc', 'stck_hgpr', 'stck_lwpr', 'stck_clpr')
    original = [float(nxt['original'][k]) for k in fields]
    adjusted = [float(nxt['adjusted'][k]) for k in fields]
    if min(original + adjusted) <= 0:
        return 'invalid_next_ohlc'
    low = max((a-1)/o for o, a in zip(original, adjusted))
    high = min((a+1)/o for o, a in zip(original, adjusted))
    today = reference['originalPriceFactorBounds']
    if max(low, today['lower']) > min(high, today['upper']):
        return 'corporate_action_basis_change_pending'
    return 'same_basis_reference_available'


def cost_range(adjusted_entry, bounds, fixed_pct=0.23, ticks_per_side=2.5):
    # A quote tick size is not a constraint on every possible execution price
    # (midpoint executions are possible). Bound costs over the entire price
    # interval, without fitting a price to the quote grid.
    if bounds['status'] == 'identical_ohlc':
        minimum = maximum = float(adjusted_entry)
    elif bounds['status'] == 'bounded_rounding_hypothesis' and 0 < bounds['lower'] <= bounds['upper']:
        minimum = (adjusted_entry-1)/bounds['upper']
        maximum = (adjusted_entry+1)/bounds['lower']
    else:
        raise ValueError('Unresolved price interval')
    if minimum <= 0 or not math.isfinite(maximum):
        raise ValueError('Invalid original entry bounds')
    prices = []
    for floor, ceiling, tick in GRID:
        low = max(minimum, floor)
        high = min(maximum, math.nextafter(ceiling, -math.inf))
        if low <= high:
            prices.extend((low, high))
    costs = []
    for price in prices:
        tick = next(t for lo, hi, t in GRID if lo <= price < hi)
        costs.append(fixed_pct + 2 * ticks_per_side * tick / price * 100)
    return dict(status='exact_price' if minimum == maximum else 'bounded_price_uncertainty',
        evaluatedEndpoints=len(prices), originalEntryMin=minimum, originalEntryMax=maximum,
        totalCostPctMin=min(costs), totalCostPctMax=max(costs),
        fixedPct=fixed_pct, ticksPerSide=ticks_per_side,
        assumption='Original-price tick cost bounds; <=1 adjusted KRW rounding uncertainty')
