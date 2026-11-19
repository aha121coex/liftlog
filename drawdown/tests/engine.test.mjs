import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TICKERS, YEAR_SECONDS, findPeak, parseHistory, selectQuote, analyzeTicker,
} from '../engine.js';

function chart({ times = [100, 200, 300], high = [12, 30, 20], close = [11, 25, 19],
  adjusted = [8, 18, 17], granularity = '1d' } = {}) {
  return { chart: { result: [{
    timestamp: times,
    meta: { currency: 'USD', dataGranularity: granularity },
    indicators: { quote: [{ high, close }], adjclose: [{ adjclose: adjusted }] },
  }], error: null } };
}

test('default watchlist preserves supplied symbols, order, and asset kinds', () => {
  assert.deepEqual(DEFAULT_TICKERS.map(t => t.sym), [
    'VTI', 'VXUS', 'GOOGL', 'META', 'MSFT', 'NVDA', 'AMD', 'INTC',
    'MRNA', 'RIVN', 'BTC-USD', 'GLDM',
  ]);
  assert.equal(DEFAULT_TICKERS.filter(t => t.kind === 'etf').length, 3);
});

test('ETF peaks use adjusted closes; stocks and crypto use daily highs', () => {
  assert.equal(findPeak(parseHistory(chart(), 'etf').series).peak, 18);
  assert.equal(findPeak(parseHistory(chart(), 'stock').series).peak, 30);
  assert.equal(findPeak(parseHistory(chart(), 'crypto').series).peak, 30);
});

test('missing and invalid preferred prices fall back to valid closes with provenance', () => {
  const history = parseHistory(chart({ adjusted: [null, 18, 0] }), 'etf');
  assert.deepEqual(history.series.map(point => point.val), [11, 18, 19]);
  assert.equal(history.basis, 'mixed');
  assert.equal(history.preferredBasis, 'adjclose');
  assert.equal(history.fallbackCount, 2);
  assert.equal(history.invalidCount, 0);
  const missing = chart();
  delete missing.chart.result[0].indicators.adjclose;
  const closeOnly = parseHistory(missing, 'etf');
  assert.equal(closeOnly.basis, 'close');
  assert.equal(closeOnly.fallbackCount, 3);
});

test('zero, negative, nonfinite and missing observations never produce a peak', () => {
  assert.equal(findPeak([
    { ts: 1, val: 0 }, { ts: 2, val: -5 }, { ts: 3, val: Infinity },
    { ts: 4, val: null }, { ts: null, val: 100 }, null,
  ]), null);
  const history = parseHistory(chart({ high: [0, -5, NaN], close: [null, 12, 0] }), 'stock');
  assert.deepEqual(history.series, [{ ts: 200, val: 12, basis: 'close' }]);
  assert.equal(history.invalidCount, 2);
});

test('the 365-day boundary is inclusive; the all-history peak remains independent', () => {
  const now = 2_000_000_000;
  const cutoff = now - YEAR_SECONDS;
  const history = parseHistory(chart({
    times: [cutoff - 1, cutoff, now - 60],
    high: [200, 100, 90],
  }), 'stock');
  const result = analyzeTicker({ sym: 'TEST', kind: 'stock',
    live: { price: 80, asOf: now }, history, now });
  assert.equal(result.peak1y.peak, 100);
  assert.equal(result.peak1y.ts, cutoff);
  assert.equal(result.peakMax.peak, 200);
  assert.equal(result.dd1y, -20);
  assert.equal(result.ddMax, -60);
});

test('latest regular session wins over stale premarket and postmarket fields', () => {
  const quote = selectQuote({
    preMarketPrice: 10, preMarketTime: 100,
    postMarketPrice: 9, postMarketTime: 50,
    regularMarketPrice: 12, regularMarketTime: 200,
  });
  assert.deepEqual(quote, { price: 12, asOf: 200, session: 'regular' });
  assert.deepEqual(selectQuote({
    regularMarketPrice: 12, regularMarketTime: 200,
    postMarketPrice: 13, postMarketTime: 300,
  }), { price: 13, asOf: 300, session: 'post' });
});

test('invalid newer quotes, missing timestamps, bid/ask, and prior close cannot masquerade as live', () => {
  assert.deepEqual(selectQuote({
    preMarketPrice: 0, preMarketTime: 400,
    postMarketPrice: Infinity, postMarketTime: 500,
    regularMarketPrice: 12, regularMarketTime: 200,
    bid: 999, ask: 1000,
  }), { price: 12, asOf: 200, session: 'regular' });
  assert.equal(selectQuote({ regularMarketPrice: 12, bid: 11, ask: 13,
    regularMarketPreviousClose: 10, regularMarketTime: null }), null);
});

test('missing arrays, provider errors, and all-invalid series fail explicitly', () => {
  for (const value of [null, {}, { chart: { result: [] } }, chart({ times: [] })]) {
    assert.throws(() => parseHistory(value, 'stock'));
  }
  assert.throws(() => parseHistory({ chart: { error: { description: 'Rate limited' } } }, 'stock'), /Rate limited/);
  assert.throws(() => parseHistory(chart({ high: [null, 0, -1], close: [null, NaN, 0] }), 'stock'), /no valid/);
  const missing = chart();
  delete missing.chart.result[0].indicators.quote;
  assert.throws(() => parseHistory(missing, 'stock'), /arrays are missing/);
});

test('empty rolling window, invalid latest price, and unknown price time fail explicitly', () => {
  const now = 2_000_000_000;
  const history = parseHistory(chart(), 'stock');
  assert.throws(() => analyzeTicker({ sym: 'TEST', kind: 'stock',
    live: { price: 80, asOf: now }, history, now }), /last 365 days/);
  for (const price of [0, -1, null, NaN, Infinity]) {
    assert.throws(() => analyzeTicker({ sym: 'TEST', kind: 'stock',
      live: { price, asOf: now }, history, now }), /Latest price is unavailable/);
  }
  assert.throws(() => analyzeTicker({ sym: 'TEST', kind: 'stock',
    live: { price: 80, asOf: null }, history, now }), /timestamp/);
});

test('equal peaks report their earliest timestamp; future observations do not enter the calculation', () => {
  assert.deepEqual(findPeak([{ ts: 3, val: 20 }, { ts: 1, val: 20 }]), { peak: 20, ts: 1 });
  const now = 2_000_000_000;
  const history = parseHistory(chart({ times: [now - 100, now - 50, now + 100],
    high: [100, 80, 1000] }), 'stock');
  const result = analyzeTicker({ sym: 'TEST', kind: 'stock',
    live: { price: 80, asOf: now }, history, now });
  assert.equal(result.peakMax.peak, 100);
  assert.equal(result.historyEnd, now - 50);
});

test('metadata exposes granularity without claiming that response establishes all-time coverage', () => {
  const history = parseHistory(chart({ granularity: '1wk' }), 'stock');
  assert.equal(history.granularity, '1wk');
  assert.equal(history.currency, 'USD');
  assert.equal(history.firstTimestamp, 100);
  assert.equal(history.lastTimestamp, 300);
  assert.equal('complete' in history, false);
});

test('stock trailing returns use closes rather than the highs used for drawdowns', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 365 * day, now - 90 * day, now - 30 * day, now - day],
    close: [50, 80, 100, 110],
    high: [75, 120, 150, 165],
  }), 'stock');
  const result = analyzeTicker({ sym: 'TEST', kind: 'stock',
    live: { price: 120, asOf: now }, history, now });
  assert.deepEqual(result.returns, { month: 20, quarter: 50, year: 140 });
  assert.equal(result.peak1y.peak, 165);
  assert.equal(result.recoveryTo1y, 37.5);
});

test('trailing returns use the last close before cutoff and do not substitute an inception date after it', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 100 * day, now - 91 * day, now - 31 * day, now - 29 * day, now - day],
    close: [40, 50, 80, 100, 110],
    high: [50, 70, 90, 120, 130],
  }), 'stock');
  const result = analyzeTicker({ sym: 'NEW', kind: 'stock',
    live: { price: 120, asOf: now }, history, now });
  assert.deepEqual(result.returns, { month: 50, quarter: 140, year: null });
  const youngHistory = parseHistory(chart({ times: [now - 29 * day, now - day],
    close: [100, 110], high: [120, 130] }), 'stock');
  assert.deepEqual(analyzeTicker({ sym: 'YOUNG', kind: 'stock',
    live: { price: 120, asOf: now }, history: youngHistory, now }).returns,
  { month: null, quarter: null, year: null });
});

test('ETF trailing returns normalize the raw live price to the adjusted close scale', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 365 * day, now - 90 * day, now - 30 * day, now - day, now + day],
    close: [100, 100, 100, 100, 100],
    adjusted: [60, 72, 80, 90, 45],
    high: [110, 110, 110, 110, 110],
  }), 'etf');
  const result = analyzeTicker({ sym: 'ETF', kind: 'etf',
    live: { price: 120, asOf: now }, history, now });
  assert.deepEqual(result.returns, { month: 35, quarter: 50, year: 80 });
  assert.equal(result.recoveryTo1y, 0);
});

test('ETF close-only fallbacks compare raw prices; unavailable adjustment factors fail explicitly', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 365 * day, now - 90 * day, now - 30 * day, now - day],
    close: [50, 80, 100, 110],
    adjusted: [null, null, null, null],
  }), 'etf');
  assert.deepEqual(analyzeTicker({ sym: 'ETF', kind: 'etf',
    live: { price: 120, asOf: now }, history, now }).returns,
  { month: 20, quarter: 50, year: 140 });
  const noPairs = parseHistory(chart({
    times: [now - 365 * day, now - day], close: [null, null], adjusted: [60, 90],
  }), 'etf');
  assert.throws(() => analyzeTicker({ sym: 'ETF', kind: 'etf',
    live: { price: 120, asOf: now }, history: noPairs, now }), /valid adjustment pair/);
});

test('missing closing prices do not fabricate returns from highs and invalid closes are skipped', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 365 * day, now - 31 * day, now - 30 * day, now - day],
    high: [100, 100, 100, 100], close: [0, 80, null, NaN],
  }), 'stock');
  const result = analyzeTicker({ sym: 'TEST', kind: 'stock',
    live: { price: 120, asOf: now }, history, now });
  assert.deepEqual(result.returns, { month: 50, quarter: null, year: null });
});

test('ETF drawdown and recovery normalize raw live prices while retaining the displayed market price', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 400 * day, now - 30 * day, now - day],
    close: [150, 120, 100], adjusted: [135, 108, 90],
  }), 'etf');
  const result = analyzeTicker({ sym: 'ETF', kind: 'etf',
    live: { price: 100, asOf: now }, history, now });
  assert.equal(result.price, 100);
  assert.equal(result.comparisonPrice, 90);
  assert.equal(result.peak1y.peak, 108);
  assert.equal(result.peakMax.peak, 135);
  assert.ok(Math.abs(result.dd1y - (-100 / 6)) < 1e-10);
  assert.ok(Math.abs(result.ddMax - (-100 / 3)) < 1e-10);
  assert.equal(result.recoveryTo1y, 20);
});

test('mixed ETF raw fallback observations cannot override adjusted peaks', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const history = parseHistory(chart({
    times: [now - 100 * day, now - 30 * day, now - day],
    close: [1000, 100, 90], adjusted: [null, 90, 81],
  }), 'etf');
  const result = analyzeTicker({ sym: 'ETF', kind: 'etf',
    live: { price: 80, asOf: now }, history, now });
  assert.equal(result.comparisonPrice, 72);
  assert.equal(result.peak1y.peak, 90);
  assert.equal(result.peakMax.peak, 90);
  assert.equal(result.dd1y, -20);
  assert.equal(result.recoveryTo1y, 25);
  assert.equal(result.basis, 'adjclose');
  assert.equal(result.fallbackCount, 1);
  assert.equal(result.excludedFallbackCount, 1);
});

test('period cutoffs and history bounds use the quote timestamp when the quote is stale', () => {
  const now = 2_000_000_000;
  const day = 24 * 60 * 60;
  const asOf = now - 10 * day;
  const history = parseHistory(chart({
    times: [asOf - 366 * day, asOf - 365 * day, asOf - 31 * day,
      asOf - 29 * day, asOf - day, asOf + day],
    close: [20, 40, 80, 100, 110, 999],
    high: [1000, 200, 150, 160, 170, 999],
  }), 'stock');
  const result = analyzeTicker({ sym: 'STALE', kind: 'stock',
    live: { price: 120, asOf }, history, now });
  assert.equal(result.asOf, asOf);
  assert.equal(result.peak1y.peak, 200);
  assert.equal(result.peakMax.peak, 1000);
  assert.equal(result.historyEnd, asOf - day);
  assert.equal(result.returns.month, 50);
  assert.equal(result.returns.year, 200);
  assert.equal(result.comparisonPrice, result.price);
});
