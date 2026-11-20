import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots } from '../snapshot.js';
import { parseArgs } from '../scripts/update-data.mjs';

const NOW = 1_800_000_000;
const iso = seconds => new Date(seconds * 1000).toISOString();
function row(sym = 'VTI', changes = {}) {
  return {
    sym, kind: sym === 'VTI' ? 'etf' : 'stock', currency: 'USD',
    price: 80, asOf: NOW - 100, dd1y: -20, ddMax: -60,
    peak1y: { peak: 100, ts: NOW - 300 },
    peakMax: { peak: 200, ts: NOW - 40_000_000 },
    returns: { month: -5, quarter: null, year: 7 },
    basis: 'adjclose',
    ...changes,
  };
}
const snapshot = results => ({ generatedAt: iso(NOW), results });

test('fresh results preserve prices and real timestamps in configured order', () => {
  const result = mergeSnapshots(snapshot([row('NVDA'), row()]));
  assert.equal(result.updatedCount, 2);
  assert.equal(result.availableCount, 2);
  assert.equal(result.results.length, 16);
  assert.equal(result.results[0].sym, 'VTI');
  assert.equal(result.results[0].cached, false);
  assert.equal(result.results[0].fetchedAt, iso(NOW));
  assert.equal(result.results[0].asOf, NOW - 100);
  assert.deepEqual(result.results[0].returns, { month: -5, quarter: null, year: 7 });
});

test('partial outages retain the earlier quote and original fetchedAt, never now', () => {
  const previous = {
    generatedAt: iso(NOW - 3600),
    results: [row('VTI', { asOf: NOW - 7200, fetchedAt: iso(NOW - 7100) })],
  };
  const result = mergeSnapshots(snapshot([{ sym: 'VTI', error: 'Provider outage' }, row('NVDA')]), previous);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.availableCount, 2);
  const cached = result.results[0];
  assert.equal(cached.cached, true);
  assert.equal(cached.asOf, NOW - 7200);
  assert.equal(cached.fetchedAt, iso(NOW - 7100));
  assert.equal(cached.price, 80);
  assert.equal(cached.error, undefined);
  assert.match(cached.warning, /Provider outage/);
});

test('successive outages preserve the original fetchedAt through repeated publications', () => {
  const first = mergeSnapshots({ generatedAt: iso(NOW - 3600), results: [row('VTI', { asOf: NOW - 3700, peak1y: { peak: 100, ts: NOW - 3800 } })] });
  const second = mergeSnapshots(snapshot([{ sym: 'VTI', error: 'Offline' }]), first);
  const third = mergeSnapshots({ generatedAt: iso(NOW + 3600), results: [] }, second);
  assert.equal(third.results[0].fetchedAt, iso(NOW - 3600));
  assert.equal(third.results[0].asOf, NOW - 3700);
  assert.equal(third.updatedCount, 0);
  assert.equal(third.availableCount, 1);
});

test('old snapshots without per-row fetchedAt use their own publication time', () => {
  const previous = { generatedAt: iso(NOW - 7200), results: [row()] };
  const result = mergeSnapshots(snapshot([]), previous);
  assert.equal(result.results[0].fetchedAt, iso(NOW - 7200));
});

test('an older provider quote cannot overwrite a more recent saved observation', () => {
  const previous = { generatedAt: iso(NOW - 50), results: [row('VTI', { asOf: NOW - 60 })] };
  const result = mergeSnapshots(snapshot([row('VTI', { asOf: NOW - 3600 })]), previous);
  assert.equal(result.results[0].asOf, NOW - 60);
  assert.equal(result.results[0].fetchedAt, iso(NOW - 50));
  assert.equal(result.results[0].cached, true);
  assert.match(result.results[0].warning, /older quote/);
  assert.equal(result.updatedCount, 0);
  const unchanged = mergeSnapshots(snapshot([row('VTI', { asOf: NOW - 60 })]), previous);
  assert.equal(unchanged.updatedCount, 1);
  assert.equal(unchanged.results[0].cached, false);
});

test('invalid prices, peaks, quote times and drawdowns never enter the feed', () => {
  const invalid = [
    { price: 0 }, { price: -5 }, { asOf: 0 }, { asOf: NOW + 301 },
    { dd1y: Infinity }, { ddMax: -20 }, { currency: 'EUR' },
    { peak1y: { peak: 0, ts: NOW - 200 } },
    { peak1y: { peak: 100, ts: NOW + 301 } },
    { peakMax: { peak: 90, ts: NOW - 200 } },
  ];
  for (const change of invalid) {
    const result = mergeSnapshots(snapshot([row('VTI', change)]));
    assert.equal(result.availableCount, 0, JSON.stringify(change));
    assert.equal(result.results[0].price, undefined);
    assert.equal(typeof result.results[0].error, 'string');
  }
});

test('bad prior rows cannot rescue failed fetches or masquerade as fresh', () => {
  const result = mergeSnapshots(snapshot([]), {
    generatedAt: iso(NOW - 100), results: [row('VTI', { price: 0 }), row('NVDA', { asOf: NOW + 500 })],
  });
  assert.equal(result.availableCount, 0);
  assert.equal(result.updatedCount, 0);
  const cachedFresh = mergeSnapshots(snapshot([row('VTI', { cached: true })]));
  assert.equal(cachedFresh.updatedCount, 0);
  assert.equal(cachedFresh.availableCount, 0);
});

test('unknown symbols and duplicate symbols do not produce ambiguous readings', () => {
  const result = mergeSnapshots(snapshot([row('UNKNOWN'), row(), row('VTI', { price: 90, dd1y: -10, ddMax: -55 })]));
  assert.equal(result.results.some(item => item.sym === 'UNKNOWN'), false);
  assert.equal(result.availableCount, 0);
  assert.equal(result.results.length, 16);
});

test('stale prior readings require an honest fetch timestamp and USD basis', () => {
  const noTime = mergeSnapshots(snapshot([]), { results: [row()] });
  assert.equal(noTime.availableCount, 0);
  const future = mergeSnapshots(snapshot([]), { generatedAt: iso(NOW + 301), results: [row()] });
  assert.equal(future.availableCount, 0);
});

test('public feed copies only known fields and normalizes fixed ticker kinds', () => {
  const result = mergeSnapshots(snapshot([row('VTI', { kind: 'crypto', arbitrary: 'not public' })]));
  assert.equal(result.results[0].kind, 'etf');
  assert.equal(result.results[0].arbitrary, undefined);
  assert.equal(result.schemaVersion, 1);
});

test('adjusted ETF comparisons validate on their explicit comparison scale, preserving raw price', () => {
  const result = mergeSnapshots(snapshot([row('VTI', {
    price: 84, comparisonPrice: 80, excludedFallbackCount: 2,
  })]));
  assert.equal(result.availableCount, 1);
  assert.equal(result.results[0].price, 84);
  assert.equal(result.results[0].comparisonPrice, 80);
  assert.equal(result.results[0].excludedFallbackCount, 2);
  assert.equal(result.results[0].dd1y, -20);
  const invalid = mergeSnapshots(snapshot([row('VTI', { comparisonPrice: 0 })]));
  assert.equal(invalid.availableCount, 0);
});

test('generation date and CLI arguments are validated before fetching or writing', () => {
  assert.throws(() => mergeSnapshots({ generatedAt: 'not-a-date', results: [] }), /generation time/);
  assert.throws(() => parseArgs(['--output']), /Usage/);
  assert.throws(() => parseArgs(['--whatever', 'path']), /Usage/);
  const args = parseArgs(['--output', 'dist/data.json', '--previous', 'old.json']);
  assert.match(args.output, /dist\/data\.json$/);
  assert.match(args.previous, /old\.json$/);
});
