// Entry point. Usage: node src/cli.js <watch | preview | check | candle-times | telegram-test>
import { CapitalClient } from './capital.js';
import { sendTelegram } from './telegram.js';
import { loadState, saveState } from './state.js';
import { runWatch, runPreview } from './scan.js';
import { PAIRS, SETTINGS, TIMEFRAMES, SCAN_TIMEFRAMES } from './config.js';

const STATE_PATH = 'state/sent.json';
const ALIASES = { scan: 'watch', 'scan-dry': 'preview' };
const raw = process.argv[2] || 'watch';
const task = ALIASES[raw] || raw;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing secret/env var: ${name}`);
  return v;
}

function makeClient() {
  return new CapitalClient({
    apiKey: need('CAPITAL_API_KEY'),
    email: need('CAPITAL_EMAIL'),
    password: need('CAPITAL_API_PASSWORD'),
    demo: String(process.env.CAPITAL_DEMO || '').toLowerCase() === 'true',
    priceSide: SETTINGS.priceSide,
  });
}

const realClock = {
  now: () => Date.now(),
  sleepUntil: async (ms) => {
    const d = ms - Date.now();
    if (d > 0) await new Promise((r) => setTimeout(r, d));
  },
};

async function main() {
  if (task === 'telegram-test') {
    await sendTelegram(need('TELEGRAM_BOT_TOKEN'), need('TELEGRAM_CHAT_ID'), '✅ CRT scanner is connected to this chat.');
    console.log('Test message sent. Check Telegram.');
    return;
  }

  const client = makeClient();
  await client.login();
  console.log('Capital.com login OK');

  if (task === 'check') {
    let bad = 0;
    for (const p of PAIRS) {
      try {
        const c = await client.candles(p.epic, 'DAY', SETTINGS.candlesToFetch);
        console.log(`OK    ${p.name.padEnd(8)} epic=${p.epic.padEnd(8)} ${c.length} daily candles`);
      } catch (e) {
        bad++;
        console.log(`FAIL  ${p.name.padEnd(8)} epic=${p.epic.padEnd(8)} ${e.message}`);
      }
    }
    console.log(bad ? `\n${bad} pair(s) failed. Remove or fix them in src/config.js.` : '\nAll pairs OK.');
    return;
  }

  if (task === 'candle-times') {
    const now = Date.now();
    console.log(`Now (UTC): ${new Date(now).toISOString()}`);
    for (const p of PAIRS.slice(0, 8)) {
      for (const tf of SCAN_TIMEFRAMES) {
        try {
          const c = await client.candles(p.epic, TIMEFRAMES[tf].resolution, 3);
          const last = c[c.length - 1];
          const closeAt = last.time + TIMEFRAMES[tf].ms;
          console.log(
            `${p.name.padEnd(7)} ${tf.padEnd(3)} newest candle opens ${new Date(last.time).toISOString()} -> assumed close ${new Date(closeAt).toISOString()} (${closeAt > now ? 'still forming' : 'already closed'})`,
          );
        } catch (e) {
          console.log(`${p.name} ${tf}: ${e.message}`);
        }
      }
    }
    return;
  }

  if (task === 'preview') {
    await runPreview({ client });
    return;
  }

  if (task === 'watch') {
    const state = loadState(STATE_PATH);
    const result = await runWatch({
      client,
      clock: realClock,
      state,
      send: (text) => sendTelegram(need('TELEGRAM_BOT_TOKEN'), need('TELEGRAM_CHAT_ID'), text),
      persist: () => saveState(STATE_PATH, state),
    });
    saveState(STATE_PATH, state);
    console.log(`\nWatched ${result.watched} candle(s), sent ${result.sent.length} message(s), ${result.errors.length} error(s).`);
    if (result.okPairs === 0) process.exit(1);
    return;
  }

  throw new Error(`Unknown task: ${raw}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
