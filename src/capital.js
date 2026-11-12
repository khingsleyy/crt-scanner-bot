// Small Capital.com REST client: login + historical candles.

const BASE = {
  live: 'https://api-capital.backend-capital.com/api/v1',
  demo: 'https://demo-api-capital.backend-capital.com/api/v1',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseUtc(s) {
  if (!s) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
}

export class CapitalClient {
  constructor({ apiKey, email, password, demo = false, priceSide = 'bid' }) {
    this.apiKey = apiKey;
    this.email = email;
    this.password = password;
    this.base = demo ? BASE.demo : BASE.live;
    this.priceSide = priceSide;
    this.lastCall = 0;
  }

  async #throttle() {
    // Capital.com allows 10 requests/second; stay well under it.
    const wait = this.lastCall + 120 - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
  }

  async login() {
    await this.#throttle();
    const res = await fetch(`${this.base}/session`, {
      method: 'POST',
      headers: { 'X-CAP-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: this.email, password: this.password, encryptedPassword: false }),
    });
    if (!res.ok) {
      throw new Error(`Capital.com login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    this.cst = res.headers.get('CST');
    this.token = res.headers.get('X-SECURITY-TOKEN');
    if (!this.cst || !this.token) throw new Error('Capital.com login returned no session tokens');
  }

  async #get(path, attempt = 0) {
    await this.#throttle();
    const res = await fetch(this.base + path, {
      headers: { CST: this.cst, 'X-SECURITY-TOKEN': this.token },
    });
    if (res.status === 401 && attempt < 1) {
      await this.login();
      return this.#get(path, attempt + 1);
    }
    if (res.status === 429 && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return this.#get(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  #pick(p) {
    if (!p) return NaN;
    if (this.priceSide === 'ask') return p.ask;
    if (this.priceSide === 'mid') return (p.bid + p.ask) / 2;
    return p.bid;
  }

  // Returns candles oldest -> newest: { time (open time, ms UTC), open, high, low, close }
  // The newest candle may still be forming; the scanner filters that out.
  async candles(epic, resolution, max) {
    const data = await this.#get(
      `/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${max}`,
    );
    return (data.prices || [])
      .map((p) => ({
        time: parseUtc(p.snapshotTimeUTC),
        open: this.#pick(p.openPrice),
        high: this.#pick(p.highPrice),
        low: this.#pick(p.lowPrice),
        close: this.#pick(p.closePrice),
      }))
      .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
      .sort((a, b) => a.time - b.time);
  }
}
