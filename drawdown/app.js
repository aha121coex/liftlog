const TICKERS = [
  {sym:'VTI',kind:'etf'}, {sym:'VXUS',kind:'etf'}, {sym:'GOOGL',kind:'stock'},
  {sym:'META',kind:'stock'}, {sym:'MSFT',kind:'stock'}, {sym:'NVDA',kind:'stock'},
  {sym:'AMD',kind:'stock'}, {sym:'INTC',kind:'stock'}, {sym:'MRNA',kind:'stock'},
  {sym:'RIVN',kind:'stock'}, {sym:'BTC-USD',kind:'crypto'}, {sym:'GLDM',kind:'etf'},
  {sym:'ANT',kind:'stock'}, {sym:'SPCX',kind:'stock'}, {sym:'^IXIC',kind:'index'}, {sym:'^GSPC',kind:'index'}
];
const SETTINGS_KEY = 'drawdown.monitor.settings.v1';
const CACHE_KEY = 'drawdown.monitor.readings.v1';
const HOUR = 60 * 60 * 1000;
const $ = selector => document.querySelector(selector);
let threshold = -20;
let readings = new Map();
let filter = 'all';
const names = {VTI:'Vanguard Total Stock Market ETF', VXUS:'Vanguard Total International Stock ETF', GOOGL:'Alphabet', META:'Meta Platforms', MSFT:'Microsoft', NVDA:'NVIDIA', AMD:'Advanced Micro Devices', INTC:'Intel', MRNA:'Moderna', RIVN:'Rivian', 'BTC-USD':'Bitcoin', GLDM:'SPDR Gold MiniShares Trust', ANT:'Anthropic', SPCX:'SpaceX', '^IXIC':'Nasdaq Composite', '^GSPC':'S&P 500'};
const labels = {'30d':'30-day','6m':'6-month','1y':'1-year','5y':'5-year'};
const baseCount = TICKERS.length;
let period = '1y';
let sort = null;
function windowFor(item) {
  return item?.windows?.[period] || (period === '1y' && item?.peak1y
    ? {...item.peak1y, decline:item.dd1y} : null);
}
function displayName(sym) {
  return names[sym] || readings.get(sym)?.name || sym;
}
function setCatalog(rows) {
  TICKERS.splice(baseCount);
  for (const row of rows) {
    if (typeof row?.sym === 'string' && /^[A-Z^][A-Z0-9.^=-]{0,19}$/.test(row.sym) &&
        ['stock','index','etf','crypto'].includes(row.kind) && !TICKERS.some(t => t.sym === row.sym)) {
      TICKERS.push({sym:row.sym,kind:row.kind});
    }
  }
}
function saveSettings() {
  try {localStorage.setItem(SETTINGS_KEY,JSON.stringify({threshold,period,sort}));}
  catch {storageWarning = true;}
}
let refreshing = false;
let lastChecked = 0;
let generatedAt = null;
let usingCache = false;
let storageWarning = false;
let dialogOpener = null;

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function validReading(item) {
  return item && typeof item.sym === 'string' && Number.isFinite(item.price) && item.price > 0 && Number.isFinite(item.dd1y) && Number.isFinite(item.ddMax) && dateAt(item.asOf) !== null;
}
function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.5 * 10 ** -digits) return digits ? `0.${'0'.repeat(digits)}%` : '0%';
  return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}%`;
}
function price(value) {
  if (!Number.isFinite(value)) return '—';
  const digits = value >= 10000 ? 0 : value >= 1000 ? 1 : 2;
  return '$' + value.toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits});
}
function dateAt(value) {
  if (typeof value === 'number' ? !Number.isFinite(value) || value <= 0 : typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}
function snapshotOld() {
  const date = dateAt(generatedAt);
  return !date || Date.now() - date.getTime() > 2 * HOUR;
}
function freshReading(item) {
  return validReading(item) && !item.cached && !usingCache && !snapshotOld();
}
function ageText(value) {
  const date = dateAt(value);
  if (!date) return 'age unavailable';
  const minutes = Math.max(0,Math.floor((Date.now()-date.getTime())/60000));
  if (minutes < 1) return 'less than a minute old';
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.floor(minutes/60);
  if (hours < 48) return `${hours} hr old`;
  return `${Math.floor(hours/24)} days old`;
}
function basisText(item,ticker) {
  const fallback = Number.isFinite(item.fallbackCount) && item.fallbackCount > 0;
  const base = item.basis === 'close' ? 'Daily closes' : ticker.kind === 'etf' ? 'Dividend-adjusted closes' : 'Daily highs';
  const excluded = Number.isFinite(item.excludedFallbackCount) && item.excludedFallbackCount > 0;
  const note = excluded ? ` · ${item.excludedFallbackCount} days without adjusted prices excluded` : fallback || item.basis === 'mixed' ? ` · Close fallback${fallback ? ` on ${item.fallbackCount} days` : ''}` : '';
  return `Peak basis: ${base}${note}`;
}
function shortDate(value) {
  const date = dateAt(value);
  return date ? date.toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}) : 'Date unavailable';
}
function quoteTime(value) {
  const date = dateAt(value);
  return date ? date.toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : 'Time unavailable';
}
function severity(value) {
  if (value <= -30) return 'deep';
  if (value <= threshold) return 'medium';
  if (value < -10) return 'medium';
  if (value < -1) return 'mild';
  return value > 0 ? 'positive' : 'near';
}
function setMessage(message) {
  $('#message').textContent = message;
  $('#message').hidden = !message;
}
function setStatus(label, state = '') {
  $('#status-text').textContent = label;
  $('#status-dot').className = `status-dot ${state}`;
}
function detail(label, value, note) {
  const part = node('div');
  part.append(node('span','detail-label',label),node('span','detail-value',value));
  if (note) part.append(node('span','detail-date',note));
  return part;
}
function peakOf(item, name) {
  const p = item[name];
  if (p && typeof p === 'object') return {peak:p.peak ?? p.value,ts:p.ts ?? p.timestamp};
  return {peak:NaN,ts:null};
}
function cardFor(ticker) {
  const item = readings.get(ticker.sym);
  const valid = validReading(item);
  const win = windowFor(item);
  const dd = win?.decline;
  const alert = freshReading(item) && Number.isFinite(dd) && dd <= threshold;
  const quote = n => ticker.kind === 'index' ? price(n).replace('$','') : price(n);
  const stale = valid && !freshReading(item);
  const card = node('article',`ticker-card${alert ? ' alert' : ''}`);
  card.setAttribute('aria-label',`${ticker.sym}${alert ? ', in review zone' : ''}`);
  const top = node('div','card-top');
  const id = node('div','ticker-id');
  id.append(node('span',`ticker-icon ${ticker.kind}`, ticker.kind === 'crypto' ? '₿' : ticker.kind === 'etf' ? '▥' : ticker.sym[0]));
  const name = node('div');
  name.append(node('h3','ticker-name',ticker.sym),node('span','ticker-kind',ticker.kind === 'etf' ? 'ETF' : ticker.kind));
  name.append(node('span','asset-name',displayName(ticker.sym)));
  id.append(name);
  const current = node('div','price',valid ? quote(item.price) : '—');
  current.append(node('span','price-label',ticker.kind === 'index' ? 'points' : 'USD'));
  top.append(id,current);
  card.append(top);
  const main = node('div','drawdown-main');
  const mainValue = node('div');
  mainValue.append(node('div',`drawdown-value ${valid ? severity(dd) : 'skeleton'}`,valid ? pct(dd) : '—'),node('span','drawdown-label',`from the ${labels[period]} peak`));
  main.append(mainValue);
  if (valid) main.append(node('span',`badge ${stale ? 'cached-badge' : alert ? 'alert-badge' : ''}`,stale ? 'Cached' : !win ? 'Period unavailable' : alert ? 'Review zone' : dd > 0 ? 'Above recorded high' : dd >= -1 ? 'Near peak' : 'Below peak'));
  else main.append(node('span','badge unavailable-badge',refreshing ? 'Checking' : item?.error ? 'Unavailable' : 'Not checked'));
  card.append(main);
  if (valid) {
    const bar = node('div','peak-bar');
    const fill = node('div','peak-fill');
    fill.style.width = `${Math.max(0,Math.min(100,100 + dd))}%`;
    bar.append(fill);
    card.append(bar);
    const peak1y = win || {};
    const peakMax = peakOf(item,'peakMax');
    const details = node('div','card-details');
    details.append(detail(labels[period]+' peak',quote(peak1y.peak),shortDate(peak1y.ts)), detail('Drawdown from history high',pct(item.ddMax),Number.isFinite(peakMax.peak) ? `Highest in available history: ${quote(peakMax.peak)} · ${shortDate(peakMax.ts)}` : 'Peak unavailable'));
    card.append(details);
    if (win?.partial) card.append(node('p','basis-copy','Shorter history: measured since '+shortDate(item.historyStart)+'.'));
    if (item.returns && (Number.isFinite(item.returns.month) || Number.isFinite(item.returns.quarter))) {
      const returns = node('div','recent-returns');
      returns.append(detail('30-day return',pct(item.returns.month)),detail('90-day return',pct(item.returns.quarter)));
      card.append(returns);
    }
    if (Number.isFinite(item.recoveryTo1y) && item.recoveryTo1y > 0) card.append(node('p','recovery-copy',`${pct(item.recoveryTo1y)} needed to regain the 1-year peak`));
    card.append(node('p','basis-copy',basisText(item,ticker)));
    card.append(node('p','card-bottom',`Quote ${quoteTime(item.asOf)} · ${ageText(item.asOf)}${stale ? ' · Cached; excluded from review count' : ''}`));
    if (item.error) card.append(node('p','card-error',`Could not update: ${item.error}`));
    if (item.warning) card.append(node('p','card-error',String(item.warning)));
  } else {
    card.append(node('p','unavailable-copy',item?.error || (refreshing ? 'Loading the latest published snapshot…' : 'Refresh to load the latest published snapshot.')));
  }
  return card;
}
function render() {
  const available = TICKERS.filter(ticker => validReading(readings.get(ticker.sym)));
  const fresh = available.filter(ticker => freshReading(readings.get(ticker.sym)));
  const alerts = fresh.filter(ticker => Number.isFinite(windowFor(readings.get(ticker.sym))?.decline) && windowFor(readings.get(ticker.sym)).decline <= threshold);
  $('#alert-count').textContent = String(alerts.length);
  $('#review-freshness').textContent = `${fresh.length}/${TICKERS.length} current readings. Cached readings appear in All.`;
  $('#filter-alert-count').textContent = String(alerts.length);
  $('#threshold-button').textContent = pct(threshold,Number.isInteger(threshold) ? 0 : 1);
  const shown = filter === 'alerts' ? alerts : [...TICKERS];
  const review = filter === 'alerts';
  const activeSort = sort || (review ? 'drawdown' : 'watchlist');
  $('#sort-select').value = activeSort;
  $('#period-select').value = period;
  $('#period-caption').textContent = labels[period];
  $('#watch-count').textContent = $('#filter-all span').textContent = TICKERS.length;
  if (activeSort === 'name') shown.sort((a,b) => displayName(a.sym).localeCompare(displayName(b.sym)) || a.sym.localeCompare(b.sym));
  if (activeSort === 'drawdown' || activeSort === 'smallest') shown.sort((a,b) => {
    const left = windowFor(readings.get(a.sym))?.decline;
    const right = windowFor(readings.get(b.sym))?.decline;
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return activeSort === 'drawdown' ? left-right : right-left;
  });
  $('#cards').replaceChildren(...shown.map(cardFor));
  $('#cards').setAttribute('aria-busy',String(refreshing));
  $('#empty-alerts').hidden = !(filter === 'alerts' && !shown.length);
  if (filter === 'alerts' && !fresh.length) {
    $('#empty-alerts h3').textContent = 'No current readings to review';
    $('#empty-alerts p').textContent = available.length ? 'Cached readings are excluded from this filter. View them in All and check again after the next snapshot publishes.' : 'Refresh your watchlist to check your review zone.';
  } else {
    $('#empty-alerts h3').textContent = 'Nothing in your review zone';
    $('#empty-alerts p').textContent = fresh.length === TICKERS.length ? 'No current reading is at or below your threshold.' : `${fresh.length} of ${TICKERS.length} tickers have current readings. Check cached or unavailable tickers in All.`;
  }
  $('#filter-all').classList.toggle('active',filter === 'all');
  $('#filter-alerts').classList.toggle('active',filter === 'alerts');
  $('#filter-all').setAttribute('aria-pressed',String(filter === 'all'));
  $('#filter-alerts').setAttribute('aria-pressed',String(filter === 'alerts'));
  $('#refresh-button').disabled = refreshing;
  $('#refresh-label').textContent = refreshing ? 'Checking…' : 'Refresh';
  $('#updated-text').textContent = generatedAt ? `${usingCache ? 'Saved snapshot' : 'Snapshot prepared'} ${quoteTime(generatedAt)} · ${ageText(generatedAt)} · ${fresh.length}/${TICKERS.length} current.` : 'Refresh to load the latest published snapshot.';
}
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (Number.isFinite(saved?.threshold) && saved.threshold >= -100 && saved.threshold < 0) threshold = saved.threshold;
    if (Object.hasOwn(labels,saved?.period)) period = saved.period;
    if (['name','drawdown','smallest','watchlist'].includes(saved?.sort)) sort = saved.sort;
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cache && Array.isArray(cache.results)) {
      setCatalog(cache.catalog || cache.results);
      for (const item of cache.results) if (validReading(item) && TICKERS.some(t => t.sym === item.sym)) readings.set(item.sym,{...item,cached:true});
      generatedAt = cache.generatedAt;
      usingCache = readings.size > 0;
    }
  } catch {
    storageWarning = true;
  }
}
function persistReadings() {
  try {
    localStorage.setItem(CACHE_KEY,JSON.stringify({generatedAt,catalog:TICKERS,results:[...readings.values()].filter(validReading)}));
  } catch {
    storageWarning = true;
  }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  setMessage('');
  setStatus('Checking for a snapshot','loading');
  render();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),20000);
  try {
    const response = await fetch(new URL('./data/monitor.json',location.href),{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(response.status === 404 ? 'The first snapshot may still be publishing.' : `The snapshot is unavailable (${response.status}).`);
    const data = await response.json();
    if (!data || !Array.isArray(data.results)) throw new Error('The snapshot could not be read.');
    setCatalog(data.results);
    const incoming = new Map(data.results.filter(item => item && typeof item.sym === 'string').map(item => [item.sym,item]));
    let failures = 0;
    for (const ticker of TICKERS) {
      const item = incoming.get(ticker.sym);
      if (validReading(item) && !item.error) {
        readings.set(ticker.sym,{...item,cached:item.cached === true});
        if (item.cached === true) failures++;
      } else {
        failures++;
        const previous = readings.get(ticker.sym);
        readings.set(ticker.sym,{...(validReading(previous) ? previous : {}),sym:ticker.sym,kind:ticker.kind,cached:true,error:item?.error ? String(item.error) : 'No complete reading was returned.'});
      }
    }
    usingCache = failures === TICKERS.length;
    generatedAt = dateAt(data.generatedAt) ? data.generatedAt : null;
    lastChecked = Date.now();
    persistReadings();
    const oldSnapshot = snapshotOld();
    setStatus(oldSnapshot ? generatedAt ? 'Snapshot is over 2 hours old' : 'Snapshot time unavailable' : failures ? `${TICKERS.length-failures} of ${TICKERS.length} updated` : 'Published snapshot loaded',failures || oldSnapshot ? 'warning' : 'ready');
    const messages = [];
    if (oldSnapshot) messages.push(generatedAt ? 'The latest published snapshot is over 2 hours old. GitHub’s scheduled update may be delayed.' : 'The snapshot has no valid publication time.');
    if (failures) messages.push(`${failures} ${failures === 1 ? 'ticker could' : 'tickers could'} not update.`);
    if (oldSnapshot || failures) messages.push('Cached readings keep their original quote times and are excluded from the review count.');
    if (storageWarning) messages.push('This browser could not save readings for offline use.');
    setMessage(messages.join(' '));
  } catch (error) {
    usingCache = [...readings.values()].some(validReading);
    for (const [sym,item] of readings) if (validReading(item)) readings.set(sym,{...item,cached:true});
    setStatus(navigator.onLine ? 'Could not update' : 'You’re offline','warning');
    setMessage(usingCache ? 'Could not load the published snapshot. Showing saved readings with their original quote times. Try Refresh when connected.' : `Could not load market data. ${error.name === 'AbortError' ? 'The request timed out.' : error.message} Try Refresh again after publishing or when connected.`);
    lastChecked = Date.now();
  } finally {
    clearTimeout(timer);
    refreshing = false;
    render();
  }
}
function openDialog(id, opener) {
  dialogOpener = opener;
  if (id === 'settings-dialog') $('#threshold-input').value = String(threshold);
  document.getElementById(id).showModal();
}
for (const id of ['settings-open','threshold-button']) document.getElementById(id).addEventListener('click',event => openDialog('settings-dialog',event.currentTarget));
for (const id of ['about-open','footer-about']) document.getElementById(id).addEventListener('click',event => openDialog('about-dialog',event.currentTarget));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click',() => document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close',() => dialogOpener?.focus()));
$('#settings-form').addEventListener('submit',event => {
  event.preventDefault();
  const value = Number($('#threshold-input').value);
  if (!Number.isFinite(value) || value < -100 || value >= 0) return;
  threshold = value;
  saveSettings();
  render();
  $('#settings-dialog').close();
});
$('#refresh-button').addEventListener('click',refresh);
$('#filter-all').addEventListener('click',() => {filter='all';render();});
$('#filter-alerts').addEventListener('click',() => {filter='alerts';render();});
$('#sort-select').addEventListener('change',event => {sort=event.target.value;saveSettings();render();});
$('#period-select').addEventListener('change',event => {period=event.target.value;saveSettings();render();});
$('#ticker-form').addEventListener('submit',event => {
  event.preventDefault();
  const sym = $('#symbol-input').value.trim().toUpperCase();
  const message = $('#ticker-feedback');
  if (!/^[A-Z^][A-Z0-9.^=-]{0,19}$/.test(sym)) {message.textContent = 'Enter a valid ticker symbol.'; return;}
  if (TICKERS.some(t => t.sym === sym)) {message.textContent = sym + ' is already on your list.'; return;}
  const url = new URL('https://github.com/aha121coex/liftlog/issues/new');
  url.searchParams.set('title','Track '+$('#kind-input').value+': '+sym);
  url.searchParams.set('body','Submit this issue to add '+sym+' to the public Drawdown watchlist. Keep it open to continue tracking.');
  location.assign(url.href);
});
document.addEventListener('visibilitychange',() => {if (!document.hidden && Date.now()-lastChecked >= HOUR) refresh();});
window.addEventListener('online',() => {if (!document.hidden) refresh();});
window.addEventListener('offline',() => {setStatus('You’re offline','warning');setMessage('You’re offline. Displayed readings keep their original quote times.');});
setInterval(() => {if (!document.hidden) {render();if (Date.now()-lastChecked >= HOUR) refresh();}},60000);
loadSaved();
if (usingCache) setStatus('Saved readings','warning');
render();
refresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
