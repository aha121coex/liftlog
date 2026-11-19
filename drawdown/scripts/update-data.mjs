#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMonitor } from '../market.js';
import { mergeSnapshots } from '../snapshot.js';

const PREVIOUS_URL = 'https://aha121coex.github.io/liftlog/drawdown/data/monitor.json';
const MAX_BYTES = 128 * 1024;
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function parseArgs(args) {
  const parsed = { output: resolve(projectRoot, 'data/monitor.json'), previous: null };
  for (let i = 0; i < args.length; i += 1) {
    if (!['--output', '--previous'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: node scripts/update-data.mjs [--output path] [--previous path]');
    }
    parsed[args[i].slice(2)] = resolve(args[++i]);
  }
  return parsed;
}

async function localPrevious(path) {
  try {
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Snapshot exceeds the size limit.');
    return JSON.parse(text);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Previous local snapshot ignored: ${error.message}`);
    return null;
  }
}

async function remotePrevious() {
  try {
    const response = await fetch(PREVIOUS_URL, {
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      throw new Error('Snapshot exceeds the size limit.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Snapshot exceeds the size limit.');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    console.warn(`Previous published snapshot unavailable: ${error.message}`);
    return null;
  }
}

export async function updateData({ output, previous }) {
  const saved = await localPrevious(previous || output) || await remotePrevious();
  const fresh = await fetchMonitor();
  const merged = mergeSnapshots(fresh, saved);
  if (!merged.availableCount) {
    for (const row of merged.results) console.error(`${row.sym}: ${row.error}`);
    throw new Error('No valid prices are available; keeping the previously published site.');
  }
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(merged, null, 2) + '\n', { mode: 0o644 });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`Snapshot: ${merged.updatedCount}/${merged.results.length} updated; ${merged.availableCount}/${merged.results.length} available.`);
  for (const row of merged.results) {
    if (row.cached) console.warn(`${row.sym}: cached quote retained (${row.warning})`);
    else if (row.error) console.warn(`${row.sym}: ${row.error}`);
  }
  return merged;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await updateData(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
