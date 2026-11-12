// Entry point. Usage: node src/cli.js <scan | scan-dry | check | telegram-test>
import { CapitalClient } from './capital.js';
import { sendTelegram } from './telegram.js';
import { loadState, saveState } from './state.js';
import { runScan } from './scan.js';
import { PAIRS, SETTINGS } from './config.js';

const STATE_PATH = 'state/sent.json';
const task = process.argv[2] || 'scan';

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

  const dry = task === 'scan-dry';
  const state = loadState(STATE_PATH);
  const send = dry
    ? async (text) => console.log('\n--- would send ---\n' + text + '\n------------------')
    : (text) => sendTelegram(need('TELEGRAM_BOT_TOKEN'), need('TELEGRAM_CHAT_ID'), text);

  const result = await runScan({ client, send, state: dry ? { ...state } : state });
  if (!dry) saveState(STATE_PATH, state);

  console.log(`\nScanned ${result.okPairs}/${result.total} pairs, ${result.alerts.length} alert(s), ${result.errors.length} error(s).`);
  if (result.okPairs === 0) process.exit(1); // nothing worked: make the run show as failed
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
