"""Synthetic Chromium check. Requires Python Playwright and /usr/bin/chromium.
Run: python scripts/browser-smoke.py
This exercises a touch-sized viewport, not physical iPhone Safari.
"""
import argparse
import functools
import http.server
import json
from pathlib import Path
import tempfile
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--url', help='Test a published app in a fresh isolated browser profile')
parser.add_argument('--engine', choices=['chromium','webkit'], default='chromium')
args=parser.parse_args()
if args.engine=='webkit' and args.url:parser.error('WebKit offline checks require the local test origin; use Chromium for --url')
root = Path(__file__).resolve().parents[1]/'dist'
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/liftlog/'):path=path[len('/liftlog'):]
        return super().translate_path(path)
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = args.url or f'http://127.0.0.1:{server.server_port}/liftlog/'
key = 'liftlog.personal.v1'
try:
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None, args=['--no-sandbox']) if args.engine=='chromium' else p.webkit.launch()
        context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, accept_downloads=True)
        context.add_init_script("Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true})")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        hosts=[]
        context.on('request',lambda request: hosts.append(urlsplit(request.url).netloc) if request.url.startswith('http') else None)
        page.on('dialog', lambda dialog: dialog.accept())
        page.set_default_timeout(8000)
        print('Opening app', flush=True)
        page.goto(url)
        page.wait_for_function('() => writerReady && !recoveryPending')
        page.evaluate("Promise.race([navigator.serviceWorker.ready.then(()=>true),new Promise((_,reject)=>setTimeout(()=>reject(Error('Service worker readiness timeout')),8000))])")
        page.reload()
        page.wait_for_function('() => navigator.serviceWorker.controller !== null')
        print('Testing midweek routine selection',flush=True)
        page.get_by_role('button',name='Choose workout routine').click()
        page.locator('[data-action="select-plan"][data-key="B"]').click()
        assert page.evaluate('state.history.length') == 0
        page.reload()
        page.wait_for_function('() => writerReady && !recoveryPending')
        assert page.evaluate('suggestedPlan().key') == 'B'
        print('Testing logging', flush=True)
        page.locator('[data-action="start-plan"]').first.click()
        page.locator('[data-action="edit-set"]').first.click()
        page.locator('#set-edit-weight').fill('12.75')
        page.locator('#set-edit-reps').fill('9')
        page.locator('[data-action="save-edit-set"]').click()
        page.locator('[data-action="quick-complete"]').click()
        page.get_by_role('button',name='Change workout routine',exact=True).click()
        page.locator('[data-action="select-plan"][data-key="B"]').click()
        assert page.evaluate('state.active.items[0].sets[0].done') is True
        exercise_id=page.evaluate('state.active.items[0].exerciseId')
        assert page.evaluate('state.active.planKey') == 'B'
        state = json.loads(page.evaluate(f'localStorage.getItem({json.dumps(key)})'))
        first = state['active']['items'][0]['sets'][0]
        assert (first['weight'], first['reps'], first['done']) == ('12.75','9',True)
        page.reload()
        assert page.evaluate('state.active.items[0].sets[0].done') is True
        # WebKit's automation-wide offline mode may reject navigation before
        # dispatching a service-worker fetch. Stop the actual origin instead.
        if args.engine=='webkit':
            print('Testing offline startup with the HTTP origin stopped',flush=True)
            port=server.server_port
            server.shutdown();server.server_close()
        else:
            context.set_offline(True)
        page.reload()
        page.wait_for_function('() => typeof state !== "undefined"')
        page.locator('[data-tab="workout"]').click()
        page.locator('[data-action="quick-complete"]').click()
        assert page.evaluate('state.active.items[0].sets[1].done') is True
        if args.engine=='webkit':
            server=http.server.ThreadingHTTPServer(('127.0.0.1',port),functools.partial(QuietHandler,directory=str(root)))
            threading.Thread(target=server.serve_forever,daemon=True).start()
        else:
            context.set_offline(False)
        page.locator('[data-tab="more"]').click()
        with page.expect_download() as info:
            page.locator('[data-action="share-backup"]').click()
        backup = Path(tmp) / 'backup.json'
        info.value.save_as(backup)
        exported = json.loads(backup.read_text())
        assert exported['active']['items'][0]['sets'][0]['weight'] == '12.75'
        # A missing primary must recover the most recent IndexedDB copy before editing.
        page.evaluate('dbWriteQueue')
        page.evaluate(f'localStorage.removeItem({json.dumps(key)})')
        page.reload()
        page.wait_for_function('() => !recoveryPending && state.active !== null')
        assert page.evaluate('state.active.items[0].sets[1].done') is True
        # A corrupt primary must be preserved, with no normal logging UI.
        page.evaluate(f'localStorage.setItem({json.dumps(key)}, "{{broken")')
        page.reload()
        page.get_by_role('heading', name='Saved data needs recovery').wait_for()
        assert page.locator('[data-action="quick-complete"]').count() == 0
        with page.expect_download() as info:
            page.locator('[data-action="export-recovery"]').click()
        recovery = Path(tmp) / 'recovery.json'
        info.value.save_as(recovery)
        assert recovery.read_text() == '{broken'
        page.locator('#backup-file').set_input_files(backup)
        page.wait_for_function('() => !recoveryRequired')
        assert page.evaluate('state.active.items[0].sets[0].weight') == '12.75'
        assert page.evaluate(f'localStorage.getItem({json.dumps(key + ".beforeRestore")})') == '{broken'
        page.reload()
        assert page.evaluate('state.active.items[0].sets[0].weight') == '12.75'
        # Same-origin windows share data; only one may hold the writer lock.
        other = context.new_page()
        other.goto(url)
        other.get_by_text('LiftLog is open in another window.', exact=False).wait_for()
        before = page.evaluate(f'localStorage.getItem({json.dumps(key)})')
        assert other.evaluate('persist()') is False
        assert other.evaluate(f'localStorage.getItem({json.dumps(key)})') == before
        page.close()
        other.reload()
        other.wait_for_function('() => writerReady && !recoveryPending')
        assert other.evaluate('state.active.items[0].sets[0].weight') == '12.75'
        other.on('dialog',lambda dialog:dialog.accept())
        other.locator('[data-tab="workout"]').click()
        other.locator('[data-action="finish"]').first.click()
        assert other.evaluate('state.history.length') == 1
        assert other.evaluate('suggestedPlan().key') == 'C'
        assert other.evaluate("id=>createItem(id).sets[0].weight",exercise_id) == '12.75'
        assert other.evaluate("id=>createItem(id).sets[0].reps",exercise_id) == '9'
        original=other.evaluate('JSON.stringify(state.history)')
        other.locator('[data-tab="more"]').click()
        other.locator('[data-action="show-plan-import"]').click()
        routine={'liftlogRoutine':1,'name':'ChatGPT test routine','location':'gym','exercises':[{'name':'Leg press','sets':[{'weight':15,'reps':8},{'weight':20,'reps':6}]}]}
        other.locator('#import-plan').fill(json.dumps(routine))
        other.locator('[data-action="import-plan"]').click()
        assert other.evaluate('JSON.stringify(state.history)') == original
        assert other.evaluate('state.templates[0].name') == 'ChatGPT test routine'
        other.locator('[data-action="custom-exercise"]').click()
        other.locator('#custom-name').fill('My custom press')
        other.locator('[data-action="save-custom"]').click()
        assert other.evaluate("state.exercises.some(e=>e.name==='My custom press')")
        other.reload()
        other.wait_for_function('() => writerReady && !recoveryPending')
        assert other.evaluate('JSON.stringify(state.history)') == original
        assert other.evaluate("state.exercises.some(e=>e.name==='My custom press')")
        assert other.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow at iPhone width'
        assert set(hosts) == {urlsplit(url).netloc}, 'Unexpected external requests: '+str(hosts)
        assert not errors, errors
        browser.close()
        print('PASS ('+args.engine+'): routine import, custom exercises, completed history, no external requests; touch viewport, exact manual entry, one-tap saves, reload, offline shell/logging, JSON round trip, IndexedDB recovery and corrupt-primary recovery; exclusive multi-window editing and lock transfer')
finally:
    server.shutdown()
