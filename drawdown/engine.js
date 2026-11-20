// Provider-independent drawdown calculations. All timestamps are Unix seconds.
export const ALERT_1Y_THRESHOLD = -20;
export const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const DEFAULT_TICKERS = Object.freeze([
  { sym: 'VTI', kind: 'etf' },
  { sym: 'VXUS', kind: 'etf' },
  { sym: 'GOOGL', kind: 'stock' },
  { sym: 'META', kind: 'stock' },
  { sym: 'MSFT', kind: 'stock' },
  { sym: 'NVDA', kind: 'stock' },
  { sym: 'AMD', kind: 'stock' },
  { sym: 'INTC', kind: 'stock' },
  { sym: 'MRNA', kind: 'stock' },
  { sym: 'RIVN', kind: 'stock' },
  { sym: 'BTC-USD', kind: 'crypto' },
  { sym: 'GLDM', kind: 'etf' },
  { sym: 'ANT', kind: 'stock' },
  { sym: 'SPCX', kind: 'stock' },
  { sym: '^IXIC', kind: 'index' },
  { sym: '^GSPC', kind: 'index' },
].map(Object.freeze));

const positive = value => Number.isFinite(value) && value > 0;
const timestamp = value => Number.isFinite(value) && value > 0;

/** Highest valid observation, including observations exactly at afterTs. */
export function findPeak(series, afterTs = null) {
  if (!Array.isArray(series)) throw new Error('History series is missing.');
  if (afterTs !== null && !Number.isFinite(afterTs)) {
    throw new Error('History cutoff is invalid.');
  }
  let result = null;
  for (const point of series) {
    if (!point || !timestamp(point.ts) || !positive(point.val)) continue;
    if (afterTs !== null && point.ts < afterTs) continue;
    if (!result || point.val > result.peak ||
        (point.val === result.peak && point.ts < result.ts)) {
      result = { peak: point.val, ts: point.ts };
    }
  }
  return result;
}

/**
 * Parse Yahoo's chart response while preserving which price basis was available.
 * A parsed response does not establish that the provider supplied full history.
 * The caller must request daily data and verify its historical coverage.
 */
export function parseHistory(chartJSON, kind) {
  const chart = chartJSON?.chart;
  if (chart?.error) {
    throw new Error(chart.error.description || chart.error.code || 'History provider error.');
  }
  const result = chart?.result?.[0];
  if (!result) throw new Error('History response is missing.');
  const times = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  if (!Array.isArray(times) || !times.length || !quote || typeof quote !== 'object') {
    throw new Error('History timestamps or price arrays are missing.');
  }
  const preferredBasis = kind === 'etf' ? 'adjclose' : 'high';
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  const preferred = preferredBasis === 'adjclose'
    ? adjusted
    : quote.high;
  const closes = quote.close;
  if (!Array.isArray(preferred) && !Array.isArray(closes)) {
    throw new Error('History prices are missing.');
  }

  const series = [];
  const returnCloses = [];
  let fallbackCount = 0;
  let invalidCount = 0;
  const bases = new Set();
  for (let i = 0; i < times.length; i += 1) {
    if (!timestamp(times[i])) { invalidCount += 1; continue; }
    const preferredValue = preferred?.[i];
    const close = closes?.[i];
    const adjustedClose = adjusted?.[i];
    const useAdjustedClose = kind === 'etf' && positive(adjustedClose);
    const returnClose = useAdjustedClose ? adjustedClose : close;
    if (positive(returnClose)) {
      returnCloses.push({
        ts: times[i],
        val: returnClose,
        basis: useAdjustedClose ? 'adjclose' : 'close',
        rawClose: positive(close) ? close : null,
      });
    }
    const hasPreferred = positive(preferredValue);
    const val = hasPreferred ? preferredValue : close;
    if (!positive(val)) { invalidCount += 1; continue; }
    const basis = hasPreferred ? preferredBasis : 'close';
    if (!hasPreferred) fallbackCount += 1;
    bases.add(basis);
    series.push({ ts: times[i], val, basis });
  }
  if (!series.length) throw new Error('History contains no valid positive prices.');
  series.sort((a, b) => a.ts - b.ts);
  returnCloses.sort((a, b) => a.ts - b.ts);
  return {
    series,
    closes: returnCloses,
    basis: bases.size === 1 ? [...bases][0] : 'mixed',
    preferredBasis,
    fallbackCount,
    invalidCount,
    currency: typeof result.meta?.currency === 'string' ? result.meta.currency : null,
    timezone: typeof result.meta?.exchangeTimezoneName === 'string'
      ? result.meta.exchangeTimezoneName : null,
    granularity: result.meta?.dataGranularity ?? null,
    firstTimestamp: series[0].ts,
    lastTimestamp: series.at(-1).ts,
  };
}

/** Choose the most recent real trade, never a bid, ask, or relabelled prior close. */
export function selectQuote(rawQuote) {
  if (!rawQuote || typeof rawQuote !== 'object') return null;
  const candidates = [
    ['regular', rawQuote.regularMarketPrice, rawQuote.regularMarketTime],
    ['pre', rawQuote.preMarketPrice, rawQuote.preMarketTime],
    ['post', rawQuote.postMarketPrice, rawQuote.postMarketTime],
  ].filter(([, price, asOf]) => positive(price) && timestamp(asOf));
  candidates.sort((a, b) => b[2] - a[2]);
  if (!candidates.length) return null;
  const [session, price, asOf] = candidates[0];
  return { price, asOf, session };
}

function lastCloseAtOrBefore(closes, cutoff) {
  let result = null;
  for (const point of closes) {
    if (!point || !timestamp(point.ts) || !positive(point.val) || point.ts > cutoff) continue;
    if (!result || point.ts > result.ts) result = point;
  }
  return result;
}

function latestAdjustmentFactor(history, asOf) {
  const closes = Array.isArray(history.closes) ? history.closes : [];
  const adjustment = lastCloseAtOrBefore(closes.filter(point =>
    point?.basis === 'adjclose' && positive(point.rawClose)), asOf);
  const factor = adjustment ? adjustment.val / adjustment.rawClose : null;
  return positive(factor) ? factor : null;
}

function trailingReturns(history, live, asOf) {
  const closes = Array.isArray(history.closes) ? history.closes : [];
  // Yahoo adjusted closes share a scale that can differ from raw live prices.
  // Normalize the live price using the latest available paired observation,
  // excluding observations later than either now or the quote's own timestamp.
  const factor = latestAdjustmentFactor(history, asOf);
  const returns = {};
  for (const [period, days] of [['month', 30], ['quarter', 90], ['year', 365]]) {
    const cutoff = asOf - days * 24 * 60 * 60;
    const reference = lastCloseAtOrBefore(closes, cutoff);
    if (!reference) { returns[period] = null; continue; }
    const current = reference.basis === 'adjclose'
      ? (positive(factor) ? live.price * factor : null)
      : live.price;
    const change = positive(current) ? ((current - reference.val) / reference.val) * 100 : NaN;
    returns[period] = Number.isFinite(change) ? change : null;
  }
  return returns;
}

/** Rolling 365-day calculations use a consistent price scale and quote date. */
export function analyzeTicker({ sym, kind, live, history, now = Date.now() / 1000 }) {
  if (!positive(now)) throw new Error('Current time is invalid.');
  if (!live || !positive(live.price)) throw new Error('Latest price is unavailable.');
  if (!timestamp(live.asOf)) throw new Error('Latest price timestamp is unavailable.');
  if (!history || !Array.isArray(history.series)) throw new Error('History is unavailable.');
  const analysisAsOf = Math.min(now, live.asOf);
  const availableSeries = history.series.filter(point => point && point.ts <= analysisAsOf);
  const adjustedSeries = kind === 'etf'
    ? availableSeries.filter(point => point.basis === 'adjclose') : [];
  const usesAdjustedHistory = adjustedSeries.length > 0;
  // Raw historical fallbacks cannot be ranked alongside adjusted ETF prices:
  // past distributions can give those observations different scales.
  const series = usesAdjustedHistory ? adjustedSeries : availableSeries;
  const excludedFallbackCount = usesAdjustedHistory
    ? availableSeries.length - adjustedSeries.length : 0;
  const factor = usesAdjustedHistory ? latestAdjustmentFactor(history, analysisAsOf) : 1;
  if (!positive(factor)) {
    throw new Error('Cannot compare ETF adjusted history without a valid adjustment pair.');
  }
  const comparisonPrice = live.price * factor;
  if (!positive(comparisonPrice)) throw new Error('Comparable latest price is unavailable.');
  const peakMax = findPeak(series);
  const peak1y = findPeak(series, analysisAsOf - YEAR_SECONDS);
  if (!peakMax) throw new Error('Historical peak is unavailable.');
  if (!peak1y) throw new Error('No valid history within the last 365 days.');
  // Subtract first so a price exactly 20% below 100 does not round up to
  // -19.999999999999996 and miss the inclusive alert threshold.
  const dd1y = ((comparisonPrice - peak1y.peak) / peak1y.peak) * 100;
  const windows = {};
  for (const [key, days] of Object.entries({'30d':30,'6m':183,'1y':365,'5y':1826})) {
    const cutoff = analysisAsOf - days * 86400;
    const peak = findPeak(series, cutoff);
    if (peak) windows[key] = {
      ...peak, decline: ((comparisonPrice - peak.peak) / peak.peak) * 100,
      partial: series[0].ts > cutoff,
    };
  }
  const ddMax = ((comparisonPrice - peakMax.peak) / peakMax.peak) * 100;
  if (!Number.isFinite(dd1y) || !Number.isFinite(ddMax)) {
    throw new Error('Drawdown could not be calculated.');
  }
  const recoveryTo1y = Math.max(0, ((peak1y.peak - comparisonPrice) / comparisonPrice) * 100);
  if (!Number.isFinite(recoveryTo1y)) throw new Error('Recovery could not be calculated.');
  return {
    sym,
    kind,
    price: live.price,
    comparisonPrice,
    asOf: live.asOf,
    session: live.session ?? null,
    dd1y,
    ddMax,
    windows,
    returns: trailingReturns(history, live, analysisAsOf),
    recoveryTo1y,
    peak1y,
    peakMax,
    basis: usesAdjustedHistory ? 'adjclose' : history.basis,
    preferredBasis: history.preferredBasis,
    fallbackCount: history.fallbackCount ?? 0,
    excludedFallbackCount,
    invalidCount: history.invalidCount ?? 0,
    historyStart: series.length ? Math.min(...series.map(point => point.ts)) : null,
    historyEnd: series.length ? Math.max(...series.map(point => point.ts)) : null,
    currency: history.currency ?? null,
  };
}
