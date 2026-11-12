import test from 'node:test';
import assert from 'node:assert/strict';
import { runScan, buildMessage } from '../src/scan.js';
import { TIMEFRAMES } from '../src/config.js';

const mk = (open, high, low, close) => ({ open, high, low, close });
const NOW = Date.UTC(2026, 10, 12, 12, 7);

function trendSeries(slope, n = 200) {
  const out = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const close = 100 + i * slope + 3 * Math.sin(i / 2);
    out.push(mk(prev, Math.max(prev, close) + 1, Math.min(prev, close) - 1, close));
    prev = close;
  }
  return out;
}

// Give candles timestamps so the newest one closed 5 minutes before NOW.
function stamp(candles, ms) {
  return candles.map((c, i) => ({ ...c, time: NOW - 5 * 60000 - ms - (candles.length - 1 - i) * ms }));
}

const flat = (n) => Array.from({ length: n }, () => mk(100, 105, 95, 101));
const R = mk(95, 120, 94, 118);
const weakSell = mk(119, 123, 100, 105);
const wickySell = mk(106, 123, 103, 104);

function fakeClient({ h4, daily, weekly, forming = true }) {
  return {
    async candles(epic, resolution) {
      const tf = Object.values(TIMEFRAMES).find((t) => t.resolution === resolution);
      const src = resolution === 'HOUR_4' ? h4 : resolution === 'DAY' ? daily : weekly;
      const out = stamp(src, tf.ms);
      if (forming) {
        // add a still-forming candle that would wrongly trigger if not filtered out
        const last = out[out.length - 1];
        out.push({ ...mk(100, 130, 90, 95), time: last.time + tf.ms });
      }
      return out;
    },
  };
}

const run = async (opts, state = {}) => {
  const sent = [];
  const result = await runScan({
    client: fakeClient(opts),
    send: async (t) => sent.push(t),
    state,
    now: NOW,
    pairs: [{ name: 'XAUUSD', epic: 'GOLD' }],
    log: () => {},
  });
  return { sent, result, state };
};

const h4Sell = [...flat(60), R, weakSell];

test('sell CRT with a bearish daily trend: sent as "with trend", only once', async () => {
  const opts = { h4: h4Sell, daily: trendSeries(-0.5), weekly: trendSeries(-0.5) };
  const state = {};
  const a = await run(opts, state);
  const h4 = a.result.alerts.filter((x) => x.tf === '4H');
  assert.equal(h4.length, 1);
  assert.equal(
    h4[0].text,
    '🔴 SELL CRT | XAUUSD | 4H\nTrend: with trend\nRange: 120.00 – 94.00'.replace('120.00', '120.000').replace('94.00', '94.000'),
  );
  const b = await run(opts, state);
  assert.equal(b.result.alerts.filter((x) => x.tf === '4H').length, 0, 'duplicate alert');
});

test('weak counter-trend sell in a bullish daily trend is not sent', async () => {
  const a = await run({ h4: h4Sell, daily: trendSeries(0.5), weekly: trendSeries(0.5) });
  assert.equal(a.result.alerts.filter((x) => x.tf === '4H').length, 0);
});

test('strong reversal in a bullish daily trend is sent, tagged counter-trend', async () => {
  const a = await run({ h4: [...flat(60), R, wickySell], daily: trendSeries(0.5), weekly: trendSeries(0.5) });
  const h4 = a.result.alerts.filter((x) => x.tf === '4H');
  assert.equal(h4.length, 1);
  assert.match(h4[0].text, /Trend: counter-trend \(reversal\)/);
});

test('mixed trend (not enough trend data) is sent, tagged mixed', async () => {
  const a = await run({ h4: h4Sell, daily: trendSeries(0.5, 40), weekly: trendSeries(0.5, 40) });
  const h4 = a.result.alerts.filter((x) => x.tf === '4H');
  assert.equal(h4.length, 1);
  assert.match(h4[0].text, /Trend: mixed/);
});

test('message shows "Range candle" line only for extended setups', () => {
  const base = { direction: 'buy', high: 2650.4, low: 2631.1 };
  assert.ok(!buildMessage('XAUUSD', '4H', { ...base, k: 1 }, 'mixed').includes('Range candle'));
  assert.match(buildMessage('XAUUSD', '4H', { ...base, k: 6 }, 'mixed'), /Range candle: 6 candles ago/);
  assert.match(buildMessage('XAUUSD', 'D', { ...base, k: 1 }, 'mixed'), /^🟢 BUY CRT \| XAUUSD \| Daily/);
});

test('a still-forming candle is never used as the sweep candle', async () => {
  // data ends with R only; the forming candle added by the fake client would look like a sweep
  const a = await run({ h4: [...flat(60), R], daily: trendSeries(-0.5), weekly: trendSeries(-0.5) });
  assert.equal(a.result.alerts.filter((x) => x.tf === '4H').length, 0);
});

test('a failing pair is reported and the others still run', async () => {
  const client = {
    async candles(epic) {
      if (epic === 'BAD') throw new Error('404 not found');
      return stamp(flat(60), 4 * 3600e3);
    },
  };
  const result = await runScan({
    client,
    send: async () => {},
    state: {},
    now: NOW,
    pairs: [{ name: 'BAD', epic: 'BAD' }, { name: 'OK', epic: 'OK' }],
    log: () => {},
  });
  assert.equal(result.okPairs, 1);
  assert.equal(result.errors.length, 1);
});
