// Validate public feed rows and retain the last good observation on an outage.
import { DEFAULT_TICKERS } from './engine.js';

const positive = value => Number.isFinite(value) && value > 0;
const safeText = (value, fallback) => typeof value === 'string' && value.trim()
  ? value.trim().slice(0, 500) : fallback;

function timestamp(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 1000 : null;
}

function validPeak(peak, now) {
  return peak && positive(peak.peak) && positive(peak.ts) && peak.ts <= now + 300;
}

/** Reject incomplete, future-dated, or internally inconsistent saved readings. */
export function validSnapshotRow(row, now) {
  if (!row || row.error || !positive(row.price) || !positive(row.asOf) ||
      row.asOf > now + 300 || !Number.isFinite(row.dd1y) ||
      !Number.isFinite(row.ddMax) || !validPeak(row.peak1y, now) ||
      !validPeak(row.peakMax, now)) return false;
  if (row.currency && row.currency !== 'USD') return false;
  if (row.peakMax.peak < row.peak1y.peak) return false;
  const comparisonPrice = row.comparisonPrice === undefined ? row.price : row.comparisonPrice;
  if (!positive(comparisonPrice)) return false;
  const expected = peak => ((comparisonPrice - peak) / peak) * 100;
  return Math.abs(expected(row.peak1y.peak) - row.dd1y) < 0.000001 &&
    Math.abs(expected(row.peakMax.peak) - row.ddMax) < 0.000001;
}

function indexRows(snapshot) {
  const allowed = new Set(DEFAULT_TICKERS.map(ticker => ticker.sym));
  const rows = new Map();
  if (!Array.isArray(snapshot?.results)) return rows;
  // A repeated symbol makes its reading ambiguous. Keep it unavailable rather
  // than allowing array order to select a potentially different observation.
  const duplicates = new Set();
  for (const row of snapshot.results) {
    if (!row || !allowed.has(row.sym)) continue;
    if (rows.has(row.sym)) duplicates.add(row.sym);
    else rows.set(row.sym, row);
  }
  for (const sym of duplicates) rows.delete(sym);
  return rows;
}

function publicRow(row, ticker) {
  const result = {
    sym: ticker.sym,
    kind: ticker.kind,
    price: row.price,
    asOf: row.asOf,
    dd1y: row.dd1y,
    ddMax: row.ddMax,
    peak1y: { peak: row.peak1y.peak, ts: row.peak1y.ts },
    peakMax: { peak: row.peakMax.peak, ts: row.peakMax.ts },
    currency: 'USD',
  };
  for (const key of ['basis', 'preferredBasis', 'session', 'quoteSource', 'historyCoverage']) {
    if (typeof row[key] === 'string') result[key] = row[key].slice(0, 100);
  }
  for (const key of ['comparisonPrice', 'fallbackCount', 'excludedFallbackCount', 'invalidCount', 'historyStart', 'historyEnd', 'recoveryTo1y']) {
    if (Number.isFinite(row[key]) && row[key] >= 0) result[key] = row[key];
  }
  if (row.returns && typeof row.returns === 'object') {
    result.returns = {};
    for (const key of ['month', 'quarter', 'year']) {
      result.returns[key] = Number.isFinite(row.returns[key]) ? row.returns[key] : null;
    }
  }
  if (typeof row.quoteWarning === 'string') result.quoteWarning = row.quoteWarning.slice(0, 500);
  return result;
}

/**
 * A new publication is an attempted update, not a new quote timestamp.
 * Valid fallback rows retain their original price, quote time and fetchedAt.
 */
export function mergeSnapshots(fresh, previous = null) {
  const now = timestamp(fresh?.generatedAt);
  if (!now) throw new Error('Snapshot generation time is invalid.');
  const generatedAt = new Date(now * 1000).toISOString();
  const current = indexRows(fresh);
  const saved = indexRows(previous);
  let updatedCount = 0;
  let availableCount = 0;
  const results = DEFAULT_TICKERS.map(ticker => {
    const next = current.get(ticker.sym);
    const old = saved.get(ticker.sym);
    const oldFetchedAt = timestamp(old?.fetchedAt) ?? timestamp(previous?.generatedAt);
    const oldIsValid = validSnapshotRow(old, now) && oldFetchedAt && oldFetchedAt <= now + 300;
    const olderQuote = oldIsValid && positive(next?.asOf) && next.asOf < old.asOf;
    if (validSnapshotRow(next, now) && next.cached !== true && !olderQuote) {
      updatedCount += 1;
      availableCount += 1;
      return { ...publicRow(next, ticker), cached: false, fetchedAt: generatedAt };
    }
    const failure = olderQuote ? 'Provider returned an older quote than the saved reading.'
      : safeText(next?.error ?? next?.warning, 'No complete new reading was returned.');
    if (oldIsValid) {
      availableCount += 1;
      return {
        ...publicRow(old, ticker),
        cached: true,
        fetchedAt: new Date(oldFetchedAt * 1000).toISOString(),
        warning: `Latest fetch failed: ${failure}`,
      };
    }
    return { sym: ticker.sym, kind: ticker.kind, error: failure };
  });
  return {
    schemaVersion: 1,
    source: 'Yahoo Finance',
    generatedAt,
    updatedCount,
    availableCount,
    results,
  };
}
