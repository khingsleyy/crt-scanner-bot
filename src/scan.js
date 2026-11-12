import { TIMEFRAMES, SCAN_TIMEFRAMES, SETTINGS, PAIRS } from './config.js';
import { findCrt, reversalScore } from './crt.js';
import { getTrend } from './indicators.js';

export function fmtPrice(p) {
  const d = p >= 1000 ? 2 : p >= 10 ? 3 : 5;
  return p.toFixed(d);
}

export function buildMessage(name, tf, setup, tag) {
  const sell = setup.direction === 'sell';
  const lines = [
    `${sell ? '🔴 SELL' : '🟢 BUY'} CRT | ${name} | ${TIMEFRAMES[tf].label}`,
    `Trend: ${tag}`,
    `Range: ${fmtPrice(setup.high)} – ${fmtPrice(setup.low)}`,
  ];
  if (setup.k > 1) lines.push(`Range candle: ${setup.k} candles ago`);
  return lines.join('\n');
}

/**
 * Scans every pair once. `client.candles(epic, resolution, max)` supplies the data,
 * `send(text)` delivers an alert, `state` remembers what was already sent.
 */
export async function runScan({ client, send, state, now = Date.now(), pairs = PAIRS, log = console.log }) {
  const alerts = [];
  const errors = [];
  let okPairs = 0;

  for (const pair of pairs) {
    try {
      // Fetch each timeframe once; keep only candles that have fully closed.
      const data = {};
      for (const tf of Object.keys(TIMEFRAMES)) {
        const raw = await client.candles(pair.epic, TIMEFRAMES[tf].resolution, SETTINGS.candlesToFetch);
        data[tf] = raw.filter((c) => c.time + TIMEFRAMES[tf].ms <= now);
      }
      okPairs++;

      for (const tf of SCAN_TIMEFRAMES) {
        const tfCfg = TIMEFRAMES[tf];
        const candles = data[tf];
        if (candles.length < 30) continue;

        const last = candles[candles.length - 1];
        if (now - (last.time + tfCfg.ms) > tfCfg.maxAgeMs) continue; // too old to alert on

        const setup = findCrt(candles);
        if (!setup) continue;

        const key = `${pair.name}|${tf}|${last.time}`;
        if (state[key]) continue; // already alerted

        const trendCandles = data[tfCfg.trendFrom];
        const trend = trendCandles.length >= 60 ? getTrend(trendCandles).combined : 'mixed';

        let tag;
        if (trend === 'mixed') {
          tag = 'mixed';
        } else if ((setup.direction === 'sell' && trend === 'bear') || (setup.direction === 'buy' && trend === 'bull')) {
          tag = 'with trend';
        } else {
          const rev = reversalScore(candles, setup);
          if (rev.score < SETTINGS.reversal.minScore) {
            log(`- ${pair.name} ${tf}: ${setup.direction} CRT skipped (counter-trend, reversal ${rev.score}/4)`);
            continue;
          }
          tag = 'counter-trend (reversal)';
        }

        const text = buildMessage(pair.name, tf, setup, tag);
        try {
          await send(text);
          state[key] = now;
          alerts.push({ pair: pair.name, tf, text });
          log(`+ alert: ${pair.name} ${tf} ${setup.direction} (${tag})`);
        } catch (e) {
          errors.push(`send ${pair.name} ${tf}: ${e.message}`);
          log(`! could not send alert for ${pair.name} ${tf}: ${e.message}`);
        }
      }
    } catch (e) {
      errors.push(`${pair.name} (${pair.epic}): ${e.message}`);
      log(`! ${pair.name} (${pair.epic}): ${e.message}`);
    }
  }
  return { alerts, errors, okPairs, total: pairs.length };
}
