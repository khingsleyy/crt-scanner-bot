# CRT Scanner Bot

Scans forex, gold, crypto and indices (JP225, US30, NAS100) for CRT setups on 4H, Daily and Weekly using Capital.com data, and sends alerts to your Telegram bot chat. It runs for free on GitHub Actions, so there is nothing to host.

## Setup (about 15 minutes)

### 1. Make the Telegram bot
1. In Telegram, open **@BotFather** and send `/newbot`. Pick a name and username.
2. Copy the **token** it gives you (looks like `123456:ABC-DEF...`).
3. Open your new bot and send it any message, for example `/start`.
4. In your browser open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` (put your token in).
5. Find `"chat":{"id":123456789` and copy that number. That is your **chat ID**.

### 2. Get the Capital.com API key
Settings → API integrations → Generate API key (2FA must be on). Save the **API key**, the **API key password** you chose, and your account **email**.

### 3. Create the GitHub repo
1. Sign up or log in at github.com.
2. Click **+** (top right) → **New repository**. Name it `crt-scanner-bot`.
3. Choose **Public** (recommended: free unlimited runs; your keys stay private because they go in Secrets, never in the code). Keep it Public: the bot runs about 24/7 and would use up the free minutes of a private repo.
4. Click **Create repository**.

### 4. Upload the files
1. Unzip the project on your laptop.
2. On the new repo page click **uploading an existing file**.
3. Drag in **everything inside the unzipped folder** (the `src`, `test`, `state` and `.github` folders plus `package.json`, `README.md`, `.gitignore`). Dragging the folders keeps the structure.
4. Click **Commit changes**.
5. Check that `.github/workflows/scan.yml` shows up in the repo. If it's missing: **Add file → Create new file**, type `.github/workflows/scan.yml` as the name, paste the contents, commit.

### 5. Add your keys
Repo → **Settings → Secrets and variables → Actions**.

On the **Secrets** tab, **New repository secret** for each (names must match exactly):

| Name | Value |
|---|---|
| `CAPITAL_API_KEY` | your Capital.com API key |
| `CAPITAL_EMAIL` | your Capital.com login email |
| `CAPITAL_API_PASSWORD` | the API key password you set |
| `TELEGRAM_BOT_TOKEN` | token from BotFather |
| `TELEGRAM_CHAT_ID` | the chat ID number |

If your Capital.com account is a **demo** account: on the **Variables** tab, add a variable `CAPITAL_DEMO` with the value `true`.

### 6. Test it, in this order
Actions tab → **CRT Scanner** → **Run workflow**, pick a task, run it, open the run to read the log:

1. `telegram-test`: you should get "✅ CRT scanner is connected" in Telegram.
2. `check`: confirms every pair/epic exists (watch J225, US30, US100). Fix or delete any `FAIL` line in `src/config.js`.
3. `candle-times`: shows when the newest candles open and when the bot thinks they close.
4. `preview`: prints what the bot sees right now (including still-forming candles). Sends nothing.
5. `watch`: the real thing. The schedule runs it automatically every 30 minutes.

## When you get alerts
- `🔴/🟢 CRT (forming)`: sent ~10 minutes before the sweep candle closes, tagged with trend (with trend / mixed / counter-trend).
- `✅ CONFIRMED` or `❌ DIDN'T HOLD`: sent ~2 minutes after the close.
- `CRT (just closed)`: backup, only if no early alert went out and the candle closed less than 30 minutes ago. Nothing older is ever sent.

## How it decides
- **CRT:** a bullish range candle followed (up to 10 candles later) by a bearish candle that takes its high and closes back inside = sell. Bearish range candle + bullish candle taking its low and closing back inside = buy. Candles in between must stay inside the range. The alert fires while the sweep candle is still forming (~10 min before close).
- **Trend:** market structure (HH/HL or LH/LL) and the 50 EMA, measured one timeframe up (4H checks Daily, Daily checks Weekly, Weekly checks itself). Both agree = trend. They disagree = mixed.
- **With trend:** sent. **Mixed:** sent, tagged "mixed". **Counter-trend:** only sent if at least 3 of 4 reversal checks pass (key level swept, big rejection wick, close past the range midpoint, unusually big range candle).
- **Filters:** the sweep candle must close back inside by at least 20% of the range, and the range candle must be at least 50% of the average recent candle.

All numbers are in `src/config.js`.

## Notes
- Alerts use the **bid** price candles and Capital.com's own candle times.
- Each run starts early and waits for candle closes, so GitHub's cron delays don't matter. GitHub may switch off schedules on repos with no activity for 60 days. If alerts stop, open the Actions tab and re-enable the workflow.
- The file `state/sent.json` is updated automatically so you never get the same alert twice.
- Educational tool only; it is a scanner, not financial advice.
