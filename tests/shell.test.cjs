const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
function worker(corrupt=false){
  const handlers={},stored=new Map();let removed=false,fetches=0;
  const cache={put:async(url,res)=>stored.set(url,res),match:async url=>stored.get(url)?.clone()};
  const context={URL,Response,crypto:webcrypto,self:{registration:{scope:'https://example.test/liftlog/'},addEventListener:(name,fn)=>handlers[name]=fn},
    caches:{open:async()=>cache,delete:async()=>{removed=true;stored.clear();},keys:async()=>[]},
    fetch:async url=>{fetches++;const name=new URL(url).pathname.replace('/liftlog/','')||'index.html';return new Response(corrupt&&name==='app.js'?'wrong release':fs.readFileSync(name));}};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
  return {handlers,stored,get removed(){return removed;},get fetches(){return fetches;}};
}
test('shell installs only when every asset matches its release hash',async()=>{
  const w=worker();let installed;w.handlers.install({waitUntil:p=>installed=p});await installed;assert.equal(w.stored.size,10);
  const count=w.fetches;let result;w.handlers.fetch({request:{url:'https://example.test/liftlog/app.js',method:'GET',mode:'cors'},respondWith:p=>result=p});
  assert.equal(await (await result).text(),fs.readFileSync('app.js','utf8'));assert.equal(w.fetches,count);
});
test('mixed or interrupted release cannot leave an installable partial cache',async()=>{
  const w=worker(true);let installed;w.handlers.install({waitUntil:p=>installed=p});await assert.rejects(installed,/Incomplete LiftLog release/);assert.equal(w.removed,true);assert.equal(w.stored.size,0);
});
