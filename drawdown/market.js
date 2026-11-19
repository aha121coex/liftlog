// Yahoo chart transport. Runs in Node 22+ or a Worker; no secrets or accounts.
import { DEFAULT_TICKERS, parseHistory, selectQuote, analyzeTicker } from './engine.js';

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const DAY_SECONDS = 86_400;
const positive = value => Number.isFinite(value) && value > 0;

function optionsWithDefaults(options = {}) {
  const config = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    now: options.now ?? Math.floor(Date.now() / 1000),
    timeoutMs: options.timeoutMs ?? 12_000,
    retries: options.retries ?? 2,
  };
  if (typeof config.fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  if (!positive(config.now)) throw new Error('Current time is invalid.');
  if (!positive(config.timeoutMs)) throw new Error('Request timeout is invalid.');
  if (!Number.isInteger(config.retries) || config.retries < 0 || config.retries > 2) {
    throw new Error('Retries must be an integer between 0 and 2.');
  }
  return config;
}

async function fetchChart(sym, params, config) {
  let lastError;
  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const url = new URL(`https://${HOSTS[attempt % HOSTS.length]}/v8/finance/chart/${encodeURIComponent(sym)}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Yahoo Finance request timed out.'));
      }, config.timeoutMs);
    });
    try {
      const json = await Promise.race([
        (async () => {
          const response = await config.fetchImpl(url.href, {
            signal: controller.signal,
            headers: { Accept: 'application/json', 'User-Agent': 'DrawdownMonitor/1.0' },
          });
          if (!response?.ok) throw new Error(`Yahoo Finance returned HTTP ${response?.status ?? 'unknown'}.`);
          return response.json();
        })(),
        timeout,
      ]);
      const chart = json?.chart;
      if (chart?.error) {
        throw new Error(chart.error.description || chart.error.code || 'Yahoo Finance reported an error.');
      }
      if (!chart?.result?.[0]) throw new Error('Yahoo Finance returned no chart.');
      return json;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Yahoo Finance request failed.');
}

function validateCurrency(result, required = false) {
  const currency = result?.meta?.currency;
  if ((required && currency !== 'USD') || (currency && currency !== 'USD')) {
    throw new Error(`Expected USD prices; provider returned ${currency || 'no currency'}.`);
  }
}

/** Newest timestamped trade from chart metadata or actual minute bars. */
export function quoteFromChart(json, now = Math.floor(Date.now() / 1000)) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  validateCurrency(result);
  const candidates = [];
  const metaQuote = selectQuote(result.meta);
  if (metaQuote && metaQuote.asOf <= now + 300) candidates.push(metaQuote);
  const timestamps = result.timestamp;
  const closes = result.indicators?.quote?.[0]?.close;
  if (Array.isArray(timestamps) && Array.isArray(closes)) {
    for (let i = 0; i < Math.min(timestamps.length, closes.length); i += 1) {
      if (!positive(closes[i]) || !positive(timestamps[i]) || timestamps[i] > now + 300) continue;
      candidates.push({ price: closes[i], asOf: timestamps[i], session: 'intraday' });
    }
  }
  candidates.sort((a, b) => b.asOf - a.asOf);
  return candidates[0] ?? null;
}

function validateHistory(json, history, sym, now) {
  const result = json.chart.result[0];
  validateCurrency(result, true);
  if (history.granularity !== '1d') {
    throw new Error(`Daily history is required; provider returned ${history.granularity || 'unknown granularity'}.`);
  }
  if (result.meta?.symbol && result.meta.symbol.toUpperCase() !== sym.toUpperCase()) {
    throw new Error('History provider returned a different symbol.');
  }
  const firstTradeDate = result.meta?.firstTradeDate;
  // Permit exchange calendars and a few missing opening bars, but refuse a
  // truncated recent window masquerading as an all-time peak.
  if (positive(firstTradeDate) && history.firstTimestamp > firstTradeDate + 14 * DAY_SECONDS) {
    throw new Error('Provider returned incomplete history; all-time drawdown is unavailable.');
  }
  if (history.lastTimestamp > now + DAY_SECONDS) {
    throw new Error('Provider history contains invalid future dates.');
  }
}

/** Fetch latest trade and full daily history for one fixed-market symbol. */
export async function fetchTicker(ticker, options = {}) {
  const config = optionsWithDefaults(options);
  if (!ticker || typeof ticker.sym !== 'string' || !/^[A-Z0-9.^=-]{1,24}$/.test(ticker.sym) ||
      !['stock', 'etf', 'crypto'].includes(ticker.kind)) {
    throw new Error('Ticker configuration is invalid.');
  }
  const { sym, kind } = ticker;
  const [historical, intraday] = await Promise.allSettled([
    fetchChart(sym, {
      period1: '0', period2: String(Math.floor(config.now) + 1),
      interval: '1d', events: 'div,split',
    }, config),
    fetchChart(sym, { range: '1d', interval: '1m', includePrePost: 'true' }, config),
  ]);
  if (historical.status !== 'fulfilled') throw historical.reason;
  const historyJSON = historical.value;
  const history = parseHistory(historyJSON, kind);
  validateHistory(historyJSON, history, sym, config.now);
  const dailyQuote = selectQuote(historyJSON.chart.result[0].meta);
  const minuteQuote = intraday.status === 'fulfilled'
    ? quoteFromChart(intraday.value, config.now) : null;
  const candidates = [dailyQuote, minuteQuote]
    .filter(quote => quote && quote.asOf <= config.now + 300)
    .sort((a, b) => b.asOf - a.asOf);
  const live = candidates[0];
  if (!live) throw new Error('No valid timestamped latest price is available.');
  const result = analyzeTicker({ sym, kind, live, history, now: config.now });
  result.quoteSource = minuteQuote && minuteQuote === live ? 'intraday-chart' : 'daily-chart-meta';
  result.historyCoverage = positive(historyJSON.chart.result[0].meta?.firstTradeDate)
    ? 'provider-full-history' : 'requested-full-history';
  if (intraday.status !== 'fulfilled') {
    result.quoteWarning = 'Minute data unavailable; showing the latest timestamped quote from daily chart metadata.';
  }
  return result;
}

/** Isolate symbol failures, retain configured order, and cap concurrent tickers. */
export async function fetchMonitor(options = {}) {
  const config = optionsWithDefaults(options);
  const tickers = options.tickers ?? DEFAULT_TICKERS;
  const concurrency = options.concurrency ?? 3;
  if (!Array.isArray(tickers) || !tickers.length || tickers.length > 50) {
    throw new Error('Expected between 1 and 50 tickers.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error('Concurrency must be between 1 and 3.');
  }
  const results = new Array(tickers.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tickers.length) {
      const index = cursor++;
      const ticker = tickers[index];
      try {
        results[index] = await fetchTicker(ticker, config);
      } catch (error) {
        results[index] = {
          sym: ticker?.sym ?? '?', kind: ticker?.kind ?? 'stock',
          error: error instanceof Error ? error.message : 'Price data is unavailable.',
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tickers.length) }, worker));
  return { generatedAt: new Date(config.now * 1000).toISOString(), results };
}
