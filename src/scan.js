import { TIMEFRAMES, SCAN_TIMEFRAMES, SETTINGS, SCHEDULE, PAIRS } from './config.js';
import { findCrt, reversalScore } from './crt.js';
import { getTrend } from './indicators.js';

const MIN = 60 * 1000;

export function fmtPrice(p) {
  const d = p >= 1000 ? 2 : p >= 10 ? 3 : 5;
  return p.toFixed(d);
}

const label = (tf) => TIMEFRAMES[tf].label;

/**
 * Decides whether the LAST candle in `candles` (forming or closed) is an alert-worthy CRT sweep.
 * Returns null (no CRT), { setup, tag: null, skipped } (CRT but filtered out) or { setup, tag }.
 */
export function decide(candles, trendCandles, settings = SETTINGS) {
  const setup = findCrt(candles, settings);
  if (!setup) return null;

  const trend = trendCandles.length >= 60 ? getTrend(trendCandles, settings.trend).combined : 'mixed';
  if (trend === 'mixed') return { setup, tag: 'mixed' };
  if ((setup.direction === 'sell' && trend === 'bear') || (setup.direction === 'buy' && trend === 'bull')) {
    return { setup, tag: 'with trend' };
  }
  const rev = reversalScore(candles, setup, settings);
  if (rev.score < settings.reversal.minScore) {
    return { setup, tag: null, skipped: `counter-trend, reversal ${rev.score}/4` };
  }
  return { setup, tag: 'counter-trend (reversal)' };
}

export function buildAlert({ name, tf, setup, tag, kind, minutesLeft }) {
  const sell = setup.direction === 'sell';
  const lines = [`${sell ? '🔴 SELL' : '🟢 BUY'} CRT (${kind === 'forming' ? 'forming' : 'just closed'}) | ${name} | ${label(tf)}`];
  if (kind === 'forming') lines.push(`Closes in ~${minutesLeft} min`);
  lines.push(`Trend: ${tag}`, `Range: ${fmtPrice(setup.high)} – ${fmtPrice(setup.low)}`);
  if (setup.k > 1) lines.push(`Range candle: ${setup.k} candles ago`);
  return lines.join('\n');
}

export function buildFollowUp({ name, tf, direction, ok }) {
  const head = `${direction === 'sell' ? 'SELL' : 'BUY'} CRT | ${name} | ${label(tf)}`;
  return ok
    ? `✅ CONFIRMED | ${head}\nThe candle closed as a valid sweep.`
    : `❌ DIDN'T HOLD | ${head}\nThe candle closed without a valid sweep. Ignore the earlier alert.`;
}

/**
 * One watcher run.
 *  1. Find every candle that is about to close (within windowMin) or closed recently (within the cutoff).
 *  2. Wait until `preCloseMin` before each close, check the still-forming candle, send the early alert.
 *  3. Shortly after the close, send "confirmed / didn't hold", or a "just closed" backup alert
 *     if no early alert went out (only if the candle closed less than the cutoff ago).
 * `clock` = { now(), sleepUntil(ms) } so tests can fake time.
 */
export async function runWatch({
  client,
  send,
  state,
  clock,
  pairs = PAIRS,
  sched = SCHEDULE,
  settings = SETTINGS,
  persist = () => {},
  log = console.log,
}) {
  const sent = [];
  const errors = [];
  const trendCache = new Map();
  const start = clock.now();
  const windowMs = sched.windowMin * MIN;
  const cutoffMs = sched.afterCloseCutoffMin * MIN;

  // 1) What do we need to watch in this run?
  const targets = [];
  let okPairs = 0;
  for (const pair of pairs) {
    let ok = true;
    for (const tf of SCAN_TIMEFRAMES) {
      try {
        const last2 = await client.candles(pair.epic, TIMEFRAMES[tf].resolution, 2);
        for (const c of last2) {
          const C = c.time + TIMEFRAMES[tf].ms; // when this candle closes
          if (C > start && C - start <= windowMs) targets.push({ pair, tf, F: c.time, C });
          else if (C <= start && start - C <= cutoffMs) targets.push({ pair, tf, F: c.time, C });
        }
      } catch (e) {
        ok = false;
        errors.push(`${pair.name} ${tf}: ${e.message}`);
        log(`! ${pair.name} ${tf}: ${e.message}`);
      }
    }
    if (ok) okPairs++;
  }

  const steps = [];
  for (const t of targets) {
    if (t.C > start) {
      const preAt = Math.max(start, t.C - sched.preCloseMin * MIN);
      if (preAt < t.C - sched.minLeadMin * MIN) steps.push({ ...t, type: 'pre', at: preAt });
    }
    steps.push({ ...t, type: 'post', at: Math.max(start, t.C + sched.followUpDelayMin * MIN) });
  }
  steps.sort((a, b) => a.at - b.at);
  log(`Watching ${targets.length} candle(s), ${steps.length} step(s) planned.`);

  const keyOf = (s) => `${s.pair.name}|${s.tf}|${s.F}`;

  // Candles up to and including the sweep candle (forming or closed); null if it isn't there.
  async function loadSeries(s) {
    const raw = await client.candles(s.pair.epic, TIMEFRAMES[s.tf].resolution, settings.candlesToFetch);
    const candles = raw.filter((c) => c.time <= s.F);
    const last = candles[candles.length - 1];
    return last && last.time === s.F ? candles : null;
  }

  // Trend is judged on CLOSED candles of the higher timeframe (or, for Weekly, the weeks before the sweep).
  async function trendFor(s, candles, now) {
    const trendTf = TIMEFRAMES[s.tf].trendFrom;
    if (trendTf === s.tf) return candles.slice(0, -1);
    const k = `${s.pair.epic}|${trendTf}`;
    let hit = trendCache.get(k);
    if (!hit || now - hit.at > 3 * MIN) {
      hit = {
        at: now,
        candles: await client.candles(s.pair.epic, TIMEFRAMES[trendTf].resolution, settings.candlesToFetch),
      };
      trendCache.set(k, hit);
    }
    return hit.candles.filter((c) => c.time + TIMEFRAMES[trendTf].ms <= now);
  }

  async function doPre(s) {
    const key = keyOf(s);
    if (state[key]) return; // an earlier run already handled this candle

    // Don't alert on a frozen candle while the market is closed.
    const m = await client.candles(s.pair.epic, 'MINUTE', 3);
    const lastMin = m[m.length - 1];
    if (!lastMin || clock.now() - lastMin.time > sched.liveMaxAgeMin * MIN) {
      log(`- ${s.pair.name} ${s.tf}: market not live, no early alert`);
      return;
    }
    const candles = await loadSeries(s);
    if (!candles) {
      log(`- ${s.pair.name} ${s.tf}: no forming candle in the data, no early alert`);
      return;
    }
    const now = clock.now();
    if (now >= s.C - sched.minLeadMin * MIN) return;

    const d = decide(candles, await trendFor(s, candles, now), settings);
    if (!d) return;
    if (!d.tag) {
      log(`- ${s.pair.name} ${s.tf}: ${d.setup.direction} CRT forming, skipped (${d.skipped})`);
      return;
    }
    const text = buildAlert({
      name: s.pair.name,
      tf: s.tf,
      setup: d.setup,
      tag: d.tag,
      kind: 'forming',
      minutesLeft: Math.max(1, Math.round((s.C - now) / MIN)),
    });
    await send(text);
    state[key] = { t: now, pre: { at: now, dir: d.setup.direction } };
    persist();
    sent.push(text);
    log(`+ early alert: ${s.pair.name} ${s.tf} ${d.setup.direction} (${d.tag})`);
  }

  async function doPost(s) {
    const key = keyOf(s);
    const entry = state[key];
    if (entry && (entry.done || entry.backup)) return;

    const candles = await loadSeries(s);
    if (!candles) return;
    const now = clock.now();
    if (candles[candles.length - 1].time + TIMEFRAMES[s.tf].ms > now) return; // not closed yet

    const d = decide(candles, await trendFor(s, candles, now), settings);

    if (entry && entry.pre) {
      const ok = !!(d && d.tag && d.setup.direction === entry.pre.dir);
      const text = buildFollowUp({ name: s.pair.name, tf: s.tf, direction: entry.pre.dir, ok });
      await send(text);
      state[key] = { ...entry, t: now, done: now, outcome: ok ? 'confirmed' : 'failed' };
      persist();
      sent.push(text);
      log(`+ follow-up: ${s.pair.name} ${s.tf} ${ok ? 'confirmed' : "didn't hold"}`);
      return;
    }

    if (now - s.C > cutoffMs) return; // too old to be useful
    if (!d) return;
    if (!d.tag) {
      log(`- ${s.pair.name} ${s.tf}: ${d.setup.direction} CRT skipped (${d.skipped})`);
      return;
    }
    const text = buildAlert({ name: s.pair.name, tf: s.tf, setup: d.setup, tag: d.tag, kind: 'closed' });
    await send(text);
    state[key] = { t: now, backup: now };
    persist();
    sent.push(text);
    log(`+ backup alert: ${s.pair.name} ${s.tf} ${d.setup.direction} (${d.tag})`);
  }

  // 2) Walk through the plan in time order.
  for (const s of steps) {
    await clock.sleepUntil(s.at);
    try {
      if (s.type === 'pre') await doPre(s);
      else await doPost(s);
    } catch (e) {
      errors.push(`${s.pair.name} ${s.tf} ${s.type}: ${e.message}`);
      log(`! ${s.pair.name} ${s.tf} ${s.type}: ${e.message}`);
    }
  }

  return { sent, errors, okPairs, total: pairs.length, watched: targets.length };
}

/** Prints what the bot sees right now (sends nothing, changes nothing). */
export async function runPreview({ client, now = Date.now(), pairs = PAIRS, settings = SETTINGS, log = console.log }) {
  let total = 0;
  let withForming = 0;
  let shown = 0;
  const ago = (ms) => (ms >= 3600e3 ? `${(ms / 3600e3).toFixed(1)}h` : `${Math.round(ms / 60e3)}min`);

  for (const pair of pairs) {
    try {
      const data = {};
      for (const tf of Object.keys(TIMEFRAMES)) {
        data[tf] = await client.candles(pair.epic, TIMEFRAMES[tf].resolution, settings.candlesToFetch);
      }
      for (const tf of SCAN_TIMEFRAMES) {
        const ms = TIMEFRAMES[tf].ms;
        const raw = data[tf];
        if (raw.length < 30) continue;
        total++;
        const closed = raw.filter((c) => c.time + ms <= now);
        const forming = raw.length > closed.length;
        if (forming) withForming++;
        const trendTf = TIMEFRAMES[tf].trendFrom;
        const trendOf = (series) =>
          trendTf === tf ? series.slice(0, -1) : data[trendTf].filter((c) => c.time + TIMEFRAMES[trendTf].ms <= now);

        const report = (what, series, when) => {
          const d = decide(series, trendOf(series), settings);
          if (!d) return;
          shown++;
          const verdict = d.tag ? d.tag : `skipped: ${d.skipped}`;
          log(
            `${pair.name} ${tf} | ${what}: ${d.setup.direction.toUpperCase()} CRT (${verdict}) range ${fmtPrice(d.setup.high)}–${fmtPrice(d.setup.low)}, ${when}`,
          );
        };
        if (closed.length) {
          const lastClosed = closed[closed.length - 1];
          report('last closed candle', closed, `closed ${ago(now - (lastClosed.time + ms))} ago`);
        }
        if (forming) {
          const f = raw[raw.length - 1];
          report('forming candle', raw, `closes in ${ago(f.time + ms - now)}`);
        }
      }
    } catch (e) {
      log(`! ${pair.name}: ${e.message}`);
    }
  }
  log(`\nForming candle present for ${withForming} of ${total} pair/timeframes. ${shown} setup(s) listed above.`);
}
