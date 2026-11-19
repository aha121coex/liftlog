"""Exercise Drawdown's public shell with isolated synthetic data, never personal data."""
import argparse
import copy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = [('VTI','etf'),('VXUS','etf'),('GOOGL','stock'),('META','stock'),('MSFT','stock'),('NVDA','stock'),('AMD','stock'),('INTC','stock'),('MRNA','stock'),('RIVN','stock'),('BTC-USD','crypto'),('GLDM','etf')]
DRAWDOWNS = [-20,-5,-30,1,-19.9,-10,-50,-0.5,-40,-25,-15,-3]
PUBLIC = {'index.html','styles.css','app.js','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'}
MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'}


def snapshot():
    now = int(datetime.now(timezone.utc).timestamp())
    rows = []
    for (sym,kind),dd in zip(SYMBOLS,DRAWDOWNS):
        rows.append({'sym':sym,'kind':kind,'price':100+dd,'asOf':now,'dd1y':dd,'ddMax':dd-1,
                     'peak1y':{'peak':100,'ts':now-86400},'peakMax':{'peak':101,'ts':now-864000},
                     'returns':{'month':-3.2,'quarter':5.1},'recoveryTo1y':max(0,(100/(100+dd)-1)*100),
                     'basis':'adjclose' if kind=='etf' else 'high','fallbackCount':0,'cached':False})
    return {'generatedAt':datetime.now(timezone.utc).isoformat(),'results':rows}


class Handler(BaseHTTPRequestHandler):
    data = snapshot()
    status = 200
    def log_message(self,*args): pass
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/':
            raw,btype,status = b'<!doctype html><title>QA setup</title>', 'text/html',200
        elif path == '/drawdown/data/monitor.json':
            raw,btype,status = json.dumps(type(self).data).encode(),'application/json',type(self).status
        else:
            name = path.removeprefix('/drawdown/') or 'index.html'
            if path == '/drawdown/': name = 'index.html'
            target = ROOT/name
            if not path.startswith('/drawdown/') or name not in PUBLIC or not target.is_file():
                raw,btype,status = b'Not found','text/plain',404
            else:
                raw,btype,status = target.read_bytes(),MIME.get(target.suffix,'application/octet-stream'),200
        self.send_response(status)
        self.send_header('Content-Type',btype)
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(raw)


def ready(page):
    page.wait_for_function("document.querySelector('#refresh-button') && !document.querySelector('#refresh-button').disabled")


def refresh(page):
    page.click('#refresh-button')
    ready(page)


def check(condition,message):
    if not condition: raise AssertionError(message)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--engine',choices=['chromium','webkit'],default='chromium')
    parser.add_argument('--screenshot')
    args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    base=f'http://127.0.0.1:{server.server_port}'
    errors=[]
    with sync_playwright() as p:
        browser_type=getattr(p,args.engine)
        options={'headless':True}
        if args.engine=='chromium':
            options.update(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
        browser=browser_type.launch(**options)
        # First-use outage must never fabricate prices or review entries.
        empty=browser.new_context(viewport={'width':320,'height':780})
        ep=empty.new_page()
        ep.on('pageerror',lambda e:errors.append(str(e)))
        Handler.status=503
        ep.goto(base+'/drawdown/')
        ready(ep)
        check(ep.locator('.ticker-card').count()==12,'initial outage omitted placeholder cards')
        check(ep.locator('.drawdown-value').all_text_contents()==['—']*12,'initial outage fabricated drawdowns')
        check(ep.locator('#alert-count').inner_text()=='0','initial outage fabricated review count')
        check('$' not in ep.locator('#cards').inner_text(),'initial outage fabricated prices')
        empty.close()
        Handler.status=200
        Handler.data=snapshot()
        context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
        page=context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base+'/')
        page.evaluate("""async () => {
          localStorage.setItem('liftlog.personal.v1','sentinel-workout');
          const cache=await caches.open('liftlog-shell-sentinel');
          await cache.put('/liftlog-sentinel',new Response('preserved'));
        }""")
        page.goto(base+'/drawdown/')
        ready(page)
        check(page.locator('.ticker-card').count()==12,'full snapshot must show all 12 tickers')
        check(page.locator('#alert-count').inner_text()=='5','inclusive -20 review threshold failed')
        check('Above recorded high' in page.locator('.ticker-card').nth(3).inner_text(),'new high badge missing')
        check(page.locator('.card-bottom').count()==12,'per-symbol quote times missing')
        check('30-day return' in page.locator('#cards').inner_text(),'rolling-period return label incorrect')
        for width in [320,390,768]:
            page.set_viewport_size({'width':width,'height':844})
            check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'horizontal overflow at {width}px')
        page.set_viewport_size({'width':390,'height':844})
        if args.screenshot: page.screenshot(path=args.screenshot,full_page=True)
        page.click('#filter-alerts')
        check(page.locator('.ticker-name').all_text_contents() == ['AMD','MRNA','GOOGL','RIVN','VTI'],
              'review must rank losses from largest to smallest with default watchlist settings')
        page.click('#filter-all')
        check(page.locator('.ticker-name').first.inner_text() == 'VTI', 'review sorting changed the All list')
        page.select_option('#sort-select','drawdown')
        check(page.locator('.ticker-name').first.inner_text()=='AMD','drawdown sorting failed')
        page.click('#filter-alerts')
        check(page.locator('.ticker-card').count()==5,'review filter count incorrect')
        page.click('#settings-open')
        page.fill('#threshold-input','-30')
        page.click('#settings-form button[type=submit]')
        check(page.locator('#alert-count').inner_text()=='3','custom inclusive review threshold failed')
        page.reload()
        ready(page)
        check(page.locator('#threshold-button').inner_text()=='−30%','threshold did not survive reload')
        # Provider fallback rows remain visible but are never counted as fresh.
        Handler.data=snapshot()
        Handler.data['results'][2].update(cached=True,warning='Latest fetch failed: synthetic provider outage')
        refresh(page)
        check(page.locator('#alert-count').inner_text()=='2','provider-cached row counted as current')
        check('synthetic provider outage' in page.locator('#cards').inner_text(),'provider fallback warning lost')
        check('1 ticker could not update' in page.locator('#message').inner_text(),'provider cached row absent from update summary')
        # Old whole snapshots remain inspectable, with no fresh review count.
        Handler.data=snapshot()
        Handler.data['generatedAt']=datetime.fromtimestamp(datetime.now(timezone.utc).timestamp()-3*3600,timezone.utc).isoformat()
        refresh(page)
        check(page.locator('#alert-count').inner_text()=='0','old snapshot counted as current')
        check(page.locator('.cached-badge').count()==12,'old snapshot cards not visibly cached')
        Handler.data=snapshot()
        refresh(page)
        check(page.locator('#alert-count').inner_text()=='3','fresh snapshot did not recover')
        original_quote=page.locator('.card-bottom').first.inner_text().split(' · ')[0]
        Handler.status=503
        refresh(page)
        check(page.locator('.cached-badge').count()==12,'network failure did not preserve cached cards')
        check(page.locator('.card-bottom').first.inner_text().split(' · ')[0]==original_quote,'refresh changed actual quote timestamp')
        Handler.status=200
        refresh(page)
        # Wait for the scoped shell to install, then restart this page offline.
        page.evaluate('navigator.serviceWorker.ready.then(() => true)')
        page.reload()
        ready(page)
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        if args.engine == 'webkit':
            # WebKit automation can reject offline navigation before the worker runs.
            server.shutdown()
            server.server_close()
        else:
            context.set_offline(True)
        page.reload(wait_until='domcontentloaded')
        ready(page)
        check(page.locator('.ticker-card').count()==12,'offline cold reload lost the watchlist')
        check(page.locator('.cached-badge').count()==12,'offline saved readings were presented as current')
        check(page.locator('#alert-count').inner_text()=='0','offline cached readings counted as current')
        check(page.evaluate("localStorage.getItem('liftlog.personal.v1')")=='sentinel-workout','LiftLog storage was modified')
        check(page.evaluate("caches.has('liftlog-shell-sentinel')"),'LiftLog cache was deleted')
        if args.engine != 'webkit':
            context.set_offline(False)
        check(not errors,'uncaught browser errors: '+repr(errors))
        context.close()
        browser.close()
    server.shutdown()
    print(f'Drawdown {args.engine} smoke passed: empty, thresholds, filter/sort, mobile layout, stale/partial/error recovery, offline reload, and LiftLog isolation.')

if __name__=='__main__': main()
