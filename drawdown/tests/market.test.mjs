import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTicker, fetchMonitor, quoteFromChart } from '../market.js';

const NOW = 1_800_000_000;
const TICKER = { sym: 'VTI', kind: 'etf' };
const response = body => ({ ok: true, json: async () => body });
function chart({ daily = true, currency = 'USD', sym = 'VTI', firstTradeDate = NOW - 900 * 86400 } = {}) {
  return { chart: { error: null, result: [{
    meta: {
      currency, symbol: sym, dataGranularity: daily ? '1d' : '1m', firstTradeDate,
      regularMarketPrice: 80, regularMarketTime: NOW - 120,
    },
    timestamp: daily ? [NOW - 900 * 86400, NOW - 86400] : [NOW - 60, NOW - 30, NOW - 15],
    indicators: {
      quote: [{ high: daily ? [110, 100] : [null, null, null], close: daily ? [100, 90] : [81, null, 0] }],
      adjclose: [{ adjclose: daily ? [100, 90] : [] }],
    },
  }] } };
}

test('requests daily history from inception rather than range=max and includes extended minute bars', async () => {
  const urls = [];
  const result = await fetchTicker(TICKER, { now: NOW, retries: 0, fetchImpl: async url => {
    urls.push(new URL(url));
    return response(chart({ daily: new URL(url).searchParams.get('interval') === '1d' }));
  } });
  const daily = urls.find(url => url.searchParams.get('interval') === '1d');
  const minute = urls.find(url => url.searchParams.get('interval') === '1m');
  assert.equal(daily.searchParams.get('period1'), '0');
  assert.equal(daily.searchParams.get('period2'), String(NOW + 1));
  assert.equal(daily.searchParams.has('range'), false);
  assert.equal(minute.searchParams.get('includePrePost'), 'true');
  assert.equal(result.price, 81);
  assert.equal(result.asOf, NOW - 60);
  assert.ok(Math.abs(result.dd1y + 10) < 1e-9);
  assert.ok(Math.abs(result.ddMax + 19) < 1e-9);
});

test('minute null/zero/future bars never replace the latest timestamped actual trade', () => {
  const data = chart({ daily: false });
  data.chart.result[0].timestamp.push(NOW + 1000);
  data.chart.result[0].indicators.quote[0].close.push(999);
  assert.equal(quoteFromChart(data, NOW).price, 81);
  data.chart.result[0].meta.postMarketPrice = 82;
  data.chart.result[0].meta.postMarketTime = NOW - 10;
  assert.deepEqual(quoteFromChart(data, NOW), { price: 82, asOf: NOW - 10, session: 'post' });
});

test('intraday outage falls back to a real regular trade without changing its timestamp', async () => {
  const result = await fetchTicker(TICKER, { now: NOW, retries: 0, fetchImpl: async url => {
    if (new URL(url).searchParams.get('interval') === '1m') throw new Error('Network unavailable');
    return response(chart());
  } });
  assert.equal(result.price, 80);
  assert.equal(result.asOf, NOW - 120);
  assert.equal(result.quoteSource, 'daily-chart-meta');
  assert.match(result.quoteWarning, /Minute data unavailable/);
});

test('invalid daily granularity and truncated coverage cannot become all-time drawdowns', async () => {
  for (const mutate of [
    data => { data.chart.result[0].meta.dataGranularity = '3mo'; },
    data => { data.chart.result[0].meta.firstTradeDate -= 365 * 86400; },
  ]) {
    await assert.rejects(fetchTicker(TICKER, { now: NOW, retries: 0, fetchImpl: async () => {
      const data = chart(); mutate(data); return response(data);
    } }), /Daily history is required|incomplete history/);
  }
});

test('USD validation prevents showing another currency behind a dollar sign', async () => {
  await assert.rejects(fetchTicker(TICKER, {
    now: NOW, retries: 0, fetchImpl: async () => response(chart({ currency: 'EUR' })),
  }), /Expected USD/);
});

test('requests time out even if fetch does not honor abort', async () => {
  const result = await fetchMonitor({
    tickers: [TICKER], now: NOW, retries: 0, timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.match(result.results[0].error, /timed out/);
});

test('one ticker outage is isolated and concurrent tickers remain capped at three', async () => {
  const tickers = ['VTI', 'VXUS', 'GOOGL', 'META', 'NVDA'].map(sym => ({ sym, kind: 'stock' }));
  let active = 0;
  let maximum = 0;
  const result = await fetchMonitor({ tickers, now: NOW, retries: 0, fetchImpl: async url => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active -= 1;
    const parsed = new URL(url);
    const sym = parsed.pathname.split('/').at(-1);
    if (sym === 'META') return { ok: false, status: 429 };
    return response(chart({ sym, daily: parsed.searchParams.get('interval') === '1d' }));
  } });
  assert.equal(result.results.length, 5);
  assert.deepEqual(result.results.map(row => row.sym), tickers.map(ticker => ticker.sym));
  assert.match(result.results.find(row => row.sym === 'META').error, /HTTP 429/);
  assert.ok(result.results.filter(row => row.sym !== 'META').every(row => Number.isFinite(row.dd1y)));
  // Each ticker uses two independent chart calls.
  assert.ok(maximum <= 6);
  assert.equal(result.generatedAt, new Date(NOW * 1000).toISOString());
});

test('both chart hosts are fixed and retries never exceed configured limit', async () => {
  const hosts = [];
  const result = await fetchMonitor({ tickers: [TICKER], now: NOW, retries: 2, fetchImpl: async url => {
    hosts.push(new URL(url).hostname);
    throw new Error('Unavailable');
  } });
  assert.equal(hosts.length, 6);
  assert.deepEqual([...new Set(hosts)].sort(), ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']);
  assert.equal(result.results[0].error, 'Unavailable');
});

test('provider errors and absent prices produce explicit per-symbol errors', async () => {
  const result = await fetchMonitor({ tickers: [TICKER], now: NOW, retries: 0,
    fetchImpl: async () => response({ chart: { result: null, error: { description: 'No data found' } } }),
  });
  assert.equal(result.results[0].error, 'No data found');
});
