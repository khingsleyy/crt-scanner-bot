import test from 'node:test';
import assert from 'node:assert/strict';
import { findCrt, reversalScore } from '../src/crt.js';
import { getTrend } from '../src/indicators.js';

const mk = (open, high, low, close) => ({ time: 0, open, high, low, close });
const flat = (n = 30) => Array.from({ length: n }, () => mk(100, 105, 95, 101)); // range 10 each

const bullRange = mk(95, 120, 94, 118); // green, range 26
const bearRange = mk(118, 120, 94, 96); // red, range 26

test('classic sell CRT (2 candles)', () => {
  const c = [...flat(), bullRange, mk(119, 123, 100, 105)];
  const s = findCrt(c);
  assert.equal(s.direction, 'sell');
  assert.equal(s.k, 1);
  assert.equal(s.high, 120);
  assert.equal(s.low, 94);
});

test('classic buy CRT (2 candles)', () => {
  const c = [...flat(), bearRange, mk(95, 112, 91, 109)];
  const s = findCrt(c);
  assert.equal(s.direction, 'buy');
  assert.equal(s.k, 1);
});

test('extended sell CRT: candles stay inside, then sweep', () => {
  const c = [
    ...flat(),
    bullRange,
    mk(110, 114, 106, 108),
    mk(108, 112, 104, 111),
    mk(111, 115, 109, 110),
    mk(112, 120, 108, 109), // touches the high exactly, not a sweep
    mk(119, 123, 100, 105), // sweep candle, k = 5
  ];
  const s = findCrt(c);
  assert.equal(s.direction, 'sell');
  assert.equal(s.k, 5);
});

test('colour rule: bearish range candle + bearish sweep candle = no sell', () => {
  const c = [...flat(), bearRange, mk(119, 123, 100, 105)];
  assert.equal(findCrt(c), null);
});

test('range already broken by a candle in between = no setup', () => {
  const c = [
    ...flat(),
    bullRange,
    mk(121, 125, 110, 112), // breaks the high, red
    mk(118, 122, 108, 110), // later sweep of the same level
  ];
  assert.equal(findCrt(c), null);
});

test('sweep quality: closing barely back inside is rejected', () => {
  const c = [...flat(), bullRange, mk(119, 123, 118, 119.5)];
  assert.equal(findCrt(c), null);
});

test('range size: tiny range candle is rejected', () => {
  const tiny = mk(100, 102, 99.5, 101.5); // range 2.5 < 50% of avg 10
  const c = [...flat(), tiny, mk(101, 103, 99.8, 100.2)];
  assert.equal(findCrt(c), null);
});

test('range candle further back than 10 candles is ignored', () => {
  const inner = Array.from({ length: 11 }, () => mk(110, 112, 108, 109)); // small red candles inside the range
  const c = [...flat(), bullRange, ...inner, mk(119, 123, 100, 105)];
  assert.equal(findCrt(c), null);
});

test('widest qualifying range wins and only one setup is returned', () => {
  const big = mk(90, 125, 88, 120); // range 37, green
  const c = [...flat(), big, mk(110, 118, 100, 112), mk(118, 130, 100, 108)];
  const s = findCrt(c);
  assert.equal(s.k, 2);
  assert.equal(s.size, 37);
});

test('reversal score: weak counter-trend setup scores below 3', () => {
  const c = [...flat(), bullRange, mk(119, 123, 100, 105)];
  const s = findCrt(c);
  const r = reversalScore(c, s);
  assert.deepEqual(r.passed.sort(), ['big range', 'past midpoint']);
});

test('reversal score: long rejection wick pushes it to 3', () => {
  const c = [...flat(), bullRange, mk(106, 123, 103, 104)];
  const s = findCrt(c);
  assert.equal(reversalScore(c, s).score, 3);
});

test('reversal score: key level (equal highs) counts', () => {
  const eq = flat();
  eq[15] = mk(110, 120.5, 108, 112); // swing high just above the range high
  const c = [...eq, bullRange, mk(119, 123, 100, 105)];
  const r = reversalScore(c, findCrt(c));
  assert.ok(r.passed.includes('key level'));
});

function trendSeries(slope, n = 200) {
  const out = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const close = 100 + i * slope + 3 * Math.sin(i / 2);
    const open = prev;
    out.push(mk(open, Math.max(open, close) + 1, Math.min(open, close) - 1, close));
    prev = close;
  }
  return out;
}

test('trend: steady uptrend is bull, downtrend is bear', () => {
  assert.equal(getTrend(trendSeries(0.5)).combined, 'bull');
  assert.equal(getTrend(trendSeries(-0.5)).combined, 'bear');
});

test('trend: disagreement between structure and EMA = mixed', () => {
  // long uptrend that has just dropped below its EMA after a lower low
  const c = trendSeries(0.5);
  for (let i = 0; i < 6; i++) {
    const p = c[c.length - 1].close;
    c.push(mk(p, p + 0.5, p - 9, p - 8));
  }
  assert.equal(getTrend(c).combined, 'mixed');
});
