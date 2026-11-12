import { SETTINGS } from './config.js';
import { swings } from './indicators.js';

const size = (c) => c.high - c.low;

export function avgRange(candles, endExclusive, n) {
  const slice = candles.slice(Math.max(0, endExclusive - n), endExclusive);
  if (slice.length < 5) return null;
  return slice.reduce((a, c) => a + size(c), 0) / slice.length;
}

/**
 * Looks at the LATEST candle in `candles` (it must be a closed candle) as the sweep candle.
 * Range candle = one of the previous `maxRangeLookback` candles.
 *
 * Sell: bullish range candle, then a bearish candle takes its high and closes back below it.
 * Buy:  bearish range candle, then a bullish candle takes its low and closes back above it.
 * Candles in between must stay inside the range candle's high/low.
 * If several range candles qualify, the widest one is used (one alert per sweep).
 */
export function findCrt(candles, settings = SETTINGS) {
  const s = candles.length - 1;
  if (s < 1) return null;
  const S = candles[s];
  let best = null;

  for (let k = 1; k <= settings.maxRangeLookback && s - k >= 0; k++) {
    const r = s - k;
    const R = candles[r];
    const rangeSize = size(R);
    if (rangeSize <= 0) continue;

    let inside = true;
    for (let j = r + 1; j < s; j++) {
      if (candles[j].high > R.high || candles[j].low < R.low) {
        inside = false;
        break;
      }
    }
    if (!inside) continue;

    let direction = null;
    if (R.close > R.open && S.close < S.open && S.high > R.high && S.close < R.high && S.low >= R.low) {
      direction = 'sell';
    } else if (R.close < R.open && S.close > S.open && S.low < R.low && S.close > R.low && S.high <= R.high) {
      direction = 'buy';
    }
    if (!direction) continue;

    // Filter: sweep candle must close back inside by a minimum amount
    const back = direction === 'sell' ? R.high - S.close : S.close - R.low;
    if (back / rangeSize < settings.sweepCloseBackPct) continue;

    // Filter: range candle must not be tiny compared with recent candles
    const avg = avgRange(candles, r, settings.avgLookback);
    if (avg !== null && rangeSize < settings.minRangeVsAvg * avg) continue;

    if (!best || rangeSize > best.size) {
      best = { direction, k, r, s, high: R.high, low: R.low, size: rangeSize };
    }
  }
  return best;
}

/** Counter-trend CRTs need `minScore` of these 4 checks to pass. */
export function reversalScore(candles, setup, settings = SETTINGS) {
  const cfg = settings.reversal;
  const R = candles[setup.r];
  const S = candles[setup.s];
  const sell = setup.direction === 'sell';
  const passed = [];

  // 1. Sweep took a key level (a swing high/low on another candle, at or near the range extreme)
  const sw = swings(candles, settings.trend.swingLeft, settings.trend.swingRight);
  const tol = cfg.equalTolPct * setup.size;
  const keyLevel = (sell ? sw.highs : sw.lows).some((p) => {
    if (p.i === setup.r || p.i >= setup.s || setup.s - p.i > cfg.swingLookback) return false;
    return sell
      ? p.price >= R.high - tol && p.price < S.high
      : p.price <= R.low + tol && p.price > S.low;
  });
  if (keyLevel) passed.push('key level');

  // 2. Big rejection wick on the sweep candle
  const sSize = size(S);
  const wick = sell ? S.high - Math.max(S.open, S.close) : Math.min(S.open, S.close) - S.low;
  if (sSize > 0 && wick / sSize >= cfg.wickPct) passed.push('rejection wick');

  // 3. Close past the midpoint of the range candle
  const mid = (R.high + R.low) / 2;
  if (sell ? S.close < mid : S.close > mid) passed.push('past midpoint');

  // 4. Range candle unusually large
  const avg = avgRange(candles, setup.r, settings.avgLookback);
  if (avg !== null && setup.size >= cfg.bigRangeMult * avg) passed.push('big range');

  return { score: passed.length, passed };
}
