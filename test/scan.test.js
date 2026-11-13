import test from 'node:test';
import assert from 'node:assert/strict';
import { runWatch, decide, buildAlert } from '../src/scan.js';
import { TIMEFRAMES, SCHEDULE } from '../src/config.js';

const MIN = 60000;
const H4 = TIMEFRAMES['4H'].ms;
const mk = (open, high, low, close) => ({ open, high, low, close });
const flat = (n) => Array.from({ length: n }, () => mk(100, 105, 95, 101));
const R = mk(95, 120, 94, 118); // bullish range candle
const goodSweep = mk(119, 123, 100, 105);
const failedSweep = mk(119, 123, 100, 125); // closes above the range high: not a sweep

const F = Date.UTC(2026, 10, 12, 8, 0); // sweep candle opens 08:00
const C = F + H4; // closes 12:00
const pair = [{ name: 'TEST', epic: 'TEST' }];

function series(sweep) {
  const cs = [...flat(30), R, sweep];
  return cs.map((c, i) => ({ ...c, time: F - (cs.length - 1 - i) * H4 }));
}
function quiet(resolution) {
  // daily / weekly with no CRT, last candle closed long before the test window
  const ms = resolution === 'DAY' ? TIMEFRAMES.D.ms : TIMEFRAMES.W.ms;
  return flat(80).map((c, i) => ({ ...c, time: F - 10 * ms - (79 - i) * ms }));
}

function setup({ startAt, finalSweep = goodSweep, live = true }) {
  let now = startAt;
  const clock = { now: () => now, sleepUntil: async (ms) => { if (ms > now) now = ms; } };
  const client = {
    async candles(epic, resolution, max) {
      if (resolution === 'MINUTE') return [{ time: live ? now - MIN : now - 60 * MIN, open: 1, high: 1, low: 1, close: 1 }];
      let out;
      if (resolution === 'HOUR_4') out = series(now < C ? goodSweep : finalSweep);
      else out = quiet(resolution);
      return out.slice(-max);
    },
  };
  const sent = [];
  const send = async (t) => { sent.push(t); };
  return { clock, client, sent, send, now: () => now };
}

const run = async (o, state = {}) => {
  const s = setup(o);
  const r = await runWatch({ client: s.client, send: s.send, state, clock: s.clock, pairs: pair, log: () => {} });
  return { ...s, r, state };
};

test('early alert ~10 min before close, then confirmed after close', async () => {
  const { sent, state } = await run({ startAt: C - 25 * MIN });
  assert.equal(sent.length, 2);
  assert.match(sent[0], /SELL CRT \(forming\) \| TEST \| 4H/);
  assert.match(sent[0], /Closes in ~10 min/);
  assert.match(sent[1], /✅ CONFIRMED/);
  assert.equal(Object.values(state)[0].outcome, 'confirmed');
});

test('sweep that fails at close -> didn\'t hold', async () => {
  const { sent } = await run({ startAt: C - 25 * MIN, finalSweep: failedSweep });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /DIDN'T HOLD/);
});

test('no duplicate early alert if an earlier run already sent it; follow-up still goes out', async () => {
  const key = `TEST|4H|${F}`;
  const state = { [key]: { t: C - 9 * MIN, pre: { at: C - 9 * MIN, dir: 'sell' } } };
  const { sent } = await run({ startAt: C - 5 * MIN }, state);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /CONFIRMED/);
});

test('backup alert only when closed < 30 min ago and no early alert', async () => {
  const { sent } = await run({ startAt: C + 10 * MIN });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /just closed/);
});

test('stale setups (closed > 30 min ago) never alert', async () => {
  const { sent } = await run({ startAt: C + 45 * MIN });
  assert.equal(sent.length, 0);
});

test('no early alert while the market is closed', async () => {
  const { sent } = await run({ startAt: C - 25 * MIN, live: false });
  assert.equal(sent.filter((t) => /forming/.test(t)).length, 0);
});

test('same candle is not alerted twice across runs', async () => {
  const state = {};
  await run({ startAt: C + 10 * MIN }, state);
  const { sent } = await run({ startAt: C + 20 * MIN }, state);
  assert.equal(sent.length, 0);
});

test('decide / buildAlert basics', () => {
  const d = decide(series(goodSweep), []);
  assert.equal(d.setup.direction, 'sell');
  assert.equal(d.tag, 'mixed');
  assert.equal(decide(series(mk(100, 104, 96, 101)), []), null);
  assert.match(buildAlert({ name: 'X', tf: 'D', setup: d.setup, tag: 'mixed', kind: 'closed' }), /Daily/);
  assert.ok(SCHEDULE.preCloseMin === 10);
});
