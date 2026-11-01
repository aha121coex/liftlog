"""Check a real v4 -> current worker upgrade with synthetic data only."""
import functools
import http.server
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
base='636bf1884f3435c5fca5db489225f54503910b35'
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
try:
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        public=Path(tmp)/'liftlog';public.mkdir()
        names=subprocess.check_output(['git','ls-tree','--name-only',base],cwd=root,text=True).splitlines()
        for name in names:
            if name.endswith(('.js','.html','.css','.webmanifest','.png')):
                (public/name).write_bytes(subprocess.check_output(['git','show',base+':'+name],cwd=root))
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=tmp))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{server.server_port}/liftlog/'
        browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(url) else route.abort())
        page=context.new_page();page.set_default_timeout(10000)
        print('Creating a synthetic v4 workout',flush=True)
        page.goto(url)
        page.locator('[data-action="start-plan"]').first.click()
        page.locator('[data-action="edit-set"]').first.click()
        page.locator('#set-edit-weight').fill('17.25');page.locator('#set-edit-reps').fill('7')
        page.locator('[data-action="save-edit-set"]').click()
        page.locator('[data-action="quick-complete"]').click()
        page.evaluate('dbWriteQueue')
        previous=page.evaluate("localStorage.getItem('liftlog.personal.v1')")
        page.evaluate("Promise.race([navigator.serviceWorker.ready.then(()=>true),new Promise((_,reject)=>setTimeout(()=>reject(Error('Old worker timeout')),8000))])")
        print('Installing the verified current release while v4 remains open',flush=True)
        for f in (root/'dist').iterdir():
            if f.is_file():shutil.copy2(f,public/f.name)
        page.evaluate("async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();}")
        page.wait_for_function('async()=>{const r=await navigator.serviceWorker.getRegistration();return !!r.waiting;}')
        assert page.evaluate("localStorage.getItem('liftlog.personal.v1')")==previous
        page.close()
        page=context.new_page();page.goto(url)
        page.wait_for_function('()=>typeof writerReady!=="undefined"&&writerReady&&!recoveryPending')
        assert page.evaluate('state.active.items[0].sets[0].weight')=='17.25'
        assert page.evaluate('state.active.items[0].sets[0].reps')=='7'
        assert page.evaluate('state.active.items[0].sets[0].done') is True
        assert page.evaluate("localStorage.getItem('liftlog.personal.v1')")==previous
        context.set_offline(True);page.reload()
        page.wait_for_function('()=>writerReady&&!recoveryPending')
        assert page.evaluate('state.active.items[0].sets[0].weight')=='17.25'
        assert page.locator('script[src="./sync.js"]').count()==0
        browser.close()
        print('PASS: upgrade waits for v4 to close, preserves raw saved state and active set, and starts offline',flush=True)
finally:
    if 'server' in globals():server.shutdown()
