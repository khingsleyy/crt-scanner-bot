// Everything you might want to change lives in this file.

const HOUR = 3600 * 1000;

// Timeframes. `trendFrom` is the timeframe used to judge market direction for that CRT timeframe.
export const TIMEFRAMES = {
  '4H': { label: '4H', resolution: 'HOUR_4', ms: 4 * HOUR, trendFrom: 'D' },
  D: { label: 'Daily', resolution: 'DAY', ms: 24 * HOUR, trendFrom: 'W' },
  W: { label: 'Weekly', resolution: 'WEEK', ms: 168 * HOUR, trendFrom: 'W' },
};

// Which timeframes get scanned for CRT.
export const SCAN_TIMEFRAMES = ['4H', 'D', 'W'];

// When alerts are sent (all in minutes).
export const SCHEDULE = {
  preCloseMin: 10, // early alert this many minutes before the sweep candle closes
  minLeadMin: 1, // no early alert if the candle closes in less than this
  followUpDelayMin: 2, // "confirmed / didn't hold" message this long after the close
  afterCloseCutoffMin: 30, // backup alert only if the candle closed less than this long ago
  windowMin: 50, // each run looks this far ahead for candles about to close
  liveMaxAgeMin: 10, // market counts as closed if its newest 1-minute candle is older than this
};

export const SETTINGS = {
  candlesToFetch: 250, // per pair, per timeframe (Capital.com max is 1000)
  priceSide: 'bid', // 'bid', 'ask' or 'mid'

  // CRT detection
  maxRangeLookback: 10, // range candle can be up to this many candles before the sweep candle
  sweepCloseBackPct: 0.2, // sweep candle must close back inside by >= 20% of the range
  minRangeVsAvg: 0.5, // range candle must be >= 50% of the average candle size...
  avgLookback: 14, // ...over this many candles before it

  // Trend (market structure + EMA, combined)
  trend: {
    emaPeriod: 50,
    emaSlopeBars: 5, // EMA must be higher/lower than it was this many candles ago
    swingLeft: 2, // candles on each side that define a swing high/low
    swingRight: 2,
  },

  // Counter-trend CRTs only alert if enough of these 4 reversal checks pass
  reversal: {
    minScore: 3,
    wickPct: 0.5, // rejection wick >= 50% of the sweep candle's size
    bigRangeMult: 1.5, // range candle >= 1.5x average candle size
    equalTolPct: 0.1, // "equal highs/lows" tolerance, as a fraction of the range
    swingLookback: 30, // how far back to look for a key swing level
  },
};

// [display name, Capital.com epic]. Gold is "GOLD" on Capital.com.
// Run the "check" task to confirm every epic exists on your account, then fix or delete any that fail.
const pair = (name, epic = name) => ({ name, epic });

export const PAIRS = [
  // Your favourites
  pair('XAUUSD', 'GOLD'),
  pair('BTCUSD'),
  pair('ETHUSD'),
  pair('USDCHF'),
  // Indices (epics are my best guess: run "check" to confirm)
  pair('JP225', 'J225'),
  pair('US30'),
  pair('NAS100', 'US100'),
  // JPY pairs
  pair('USDJPY'),
  pair('EURJPY'),
  pair('GBPJPY'),
  pair('AUDJPY'),
  pair('NZDJPY'),
  pair('CADJPY'),
  pair('CHFJPY'),
  // Majors
  pair('EURUSD'),
  pair('GBPUSD'),
  pair('AUDUSD'),
  pair('NZDUSD'),
  pair('USDCAD'),
  // Crosses
  pair('EURGBP'),
  pair('EURAUD'),
  pair('EURCAD'),
  pair('EURCHF'),
  pair('EURNZD'),
  pair('GBPAUD'),
  pair('GBPCAD'),
  pair('GBPCHF'),
  pair('GBPNZD'),
  pair('AUDCAD'),
  pair('AUDCHF'),
  pair('AUDNZD'),
  pair('NZDCAD'),
  pair('NZDCHF'),
  pair('CADCHF'),
];
