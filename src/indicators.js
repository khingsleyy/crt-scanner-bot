import { SETTINGS } from './config.js';

export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

// Swing highs/lows: a candle whose high (low) beats `left` candles before and `right` candles after.
export function swings(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= left; j++) {
      if (candles[i - j].high >= candles[i].high) isHigh = false;
      if (candles[i - j].low <= candles[i].low) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (candles[i + j].high > candles[i].high) isHigh = false;
      if (candles[i + j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ i, price: candles[i].high });
    if (isLow) lows.push({ i, price: candles[i].low });
  }
  return { highs, lows };
}

// Bullish = higher highs + higher lows, bearish = lower highs + lower lows.
export function structureTrend(candles, cfg = SETTINGS.trend) {
  const { highs, lows } = swings(candles, cfg.swingLeft, cfg.swingRight);
  if (highs.length < 2 || lows.length < 2) return 'neutral';
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  if (h2.price > h1.price && l2.price > l1.price) return 'bull';
  if (h2.price < h1.price && l2.price < l1.price) return 'bear';
  return 'neutral';
}

// Bullish = price above a rising EMA, bearish = price below a falling EMA.
export function emaTrend(candles, cfg = SETTINGS.trend) {
  if (candles.length < cfg.emaPeriod + cfg.emaSlopeBars) return 'neutral';
  const e = ema(candles.map((c) => c.close), cfg.emaPeriod);
  const n = e.length - 1;
  const close = candles[n].close;
  if (close > e[n] && e[n] > e[n - cfg.emaSlopeBars]) return 'bull';
  if (close < e[n] && e[n] < e[n - cfg.emaSlopeBars]) return 'bear';
  return 'neutral';
}

// Both agree -> bull/bear. Anything else -> mixed.
export function getTrend(candles, cfg = SETTINGS.trend) {
  const structure = structureTrend(candles, cfg);
  const emaT = emaTrend(candles, cfg);
  let combined = 'mixed';
  if (structure === 'bull' && emaT === 'bull') combined = 'bull';
  if (structure === 'bear' && emaT === 'bear') combined = 'bear';
  return { structure, ema: emaT, combined };
}
