const {test} = require('node:test');
const assert = require('node:assert/strict');
const {boot, KEY} = require('./helpers.cjs');
const fixture = () => ({schema:1,settings:{unit:'lb'},exercises:[{id:'e',name:'Press',measure:'reps',defaultSets:3,defaultReps:10,increment:2.5}],history:[{id:'w',date:'2026-11-01',title:'Ramp',items:[{id:'i',exerciseId:'e',sets:[{id:'s1',weight:'10.25',reps:'8',done:true},{id:'s2',weight:'20',reps:'6',done:true}]}]}],templates:[{id:'t',name:'Routine',items:[{exerciseId:'e',sets:[{weight:'30',reps:'5'}]}]}]});

test('reload preserves completed history and exact individual set recall', async () => {
  const h=boot(JSON.stringify(fixture()));await h.ready();
  assert.deepEqual(JSON.parse(h.run("JSON.stringify(createItem('e').sets.map(s=>[s.weight,s.reps,s.done]))")),[['10.25','8',false],['20','6',false]]);
  assert.equal(h.run("weightStep(exById('e'))"),2.5);
  h.run('persist()');const reopened=boot(h.data.get(KEY));await reopened.ready();
  assert.equal(reopened.run('state.history[0].items[0].sets[0].weight'),'10.25');
});

test('unreadable primary database stays untouched and can be downloaded', async () => {
  const raw='{unfinished JSON';const h=boot(raw);await h.ready();
  h.run('persist()');assert.equal(h.data.get(KEY),raw);assert.match(h.elements.view.innerHTML,/needs recovery/);
  h.run('exportRecovery()');assert.equal(h.downloads[0][1],raw);
  assert.equal(h.run('changedSinceBoot'),false);
});

test('malformed nested saved data also enters recovery instead of overwriting',async()=>{
  const d=fixture();d.history[0].items=[null];const raw=JSON.stringify(d);const h=boot(raw);await h.ready();
  h.run('persist()');assert.equal(h.data.get(KEY),raw);assert.equal(h.run('recoveryRequired'),true);
});

test('valid restore preserves previous bytes, clears stale sync intent and survives reload', async () => {
  const original=JSON.stringify(fixture());const h=boot(original);await h.ready();
  const replacement=fixture();replacement.history[0].title='Restored';replacement.sync={deletedWorkoutIds:['w'],baseline:{workouts:{w:'stale'}}};replacement.remotePlans={gym:[]};
  h.restore(replacement);
  assert.equal(h.data.get(KEY+'.beforeRestore'),original);
  const saved=JSON.parse(h.data.get(KEY));assert.equal(saved.history[0].title,'Restored');assert.equal(saved.sync,undefined);assert.equal(saved.remotePlans,undefined);
  const reopened=boot(h.data.get(KEY));await reopened.ready();assert.equal(reopened.run('state.history[0].title'),'Restored');
});

for (const failAt of [KEY+'.beforeRestore',KEY]) test('restore failure at '+failAt+' leaves current history intact', async () => {
  const original=JSON.stringify(fixture());const h=boot(original,key=>key===failAt);await h.ready();
  const replacement=fixture();replacement.history=[];h.restore(replacement);
  assert.equal(h.data.get(KEY),original);assert.equal(h.run('state.history.length'),1);assert.match(h.elements.toast.textContent,/Could not restore/);
});

test('invalid backup rejected before confirmation or storage changes',async()=>{
  const original=JSON.stringify(fixture());const h=boot(original);await h.ready();h.run("confirm=()=>{throw Error('must not confirm invalid input')}");
  const d=fixture();d.templates[0].items[0].sets=[null];h.restore(d);
  assert.equal(h.data.get(KEY),original);assert.equal(h.data.has(KEY+'.beforeRestore'),false);
});

test('cancelled restore changes neither storage nor state',async()=>{
  const original=JSON.stringify(fixture());const h=boot(original);await h.ready();h.run('confirm=()=>false');
  const d=fixture();d.history=[];h.restore(d);assert.equal(h.data.get(KEY),original);assert.equal(h.data.has(KEY+'.beforeRestore'),false);
});

test('quota failure warns and does not overwrite last durable primary copy',async()=>{
  const original=JSON.stringify(fixture());const h=boot(original,()=>true);await h.ready();h.run("state.history[0].title='Unsaved';persist()");
  assert.equal(h.data.get(KEY),original);assert.equal(h.run('storeAvailable'),false);assert.match(h.elements.toast.textContent,/Storage issue/);
});

test('unit conversion includes saved routine per-set weights',async()=>{
  const h=boot(JSON.stringify(fixture()));await h.ready();h.run("changeUnits('kg')");
  assert.equal(h.run('state.templates[0].items[0].sets[0].weight'),'13.61');assert.equal(h.run("weightStep(exById('e'))"),1);
});

test('cannot delete an exercise referenced by a saved routine',async()=>{
  const d=fixture();d.history=[];d.exercises[0].custom=true;const h=boot(JSON.stringify(d));await h.ready();
  const button={dataset:{action:'delete-custom',id:'e'}};h.events.click({target:{closest:s=>s==='[data-action]'?button:null}});
  assert.equal(h.run('state.exercises.length'),1);assert.match(h.elements.toast.textContent,/routine/);
});

test('CSV formula prefixes are neutralized, including whitespace and minus',async()=>{
  const h=boot(JSON.stringify(fixture()));await h.ready();
  for(const v of ['=CMD()','+CMD()','-CMD()','@SUM(1)','  =CMD()','\tCMD()','\rCMD()']){h.context.value=v;assert.ok(h.run('csvCell(value)').startsWith('"\''));}
  assert.equal(h.run("csvCell('12.5')"),'"12.5"');
});

test('explicit reset works from recovery and removes the recovery slot',async()=>{
  const h=boot('broken');await h.ready();h.data.set(KEY+'.beforeRestore','old');h.run('safeReset()');
  assert.equal(h.run('recoveryRequired'),false);assert.equal(JSON.parse(h.data.get(KEY)).history.length,0);assert.equal(h.data.has(KEY+'.beforeRestore'),false);
});

test('startup recovery blocks writes until the secondary lookup completes',async()=>{
  const h=boot();assert.equal(h.run('recoveryPending'),true);
  assert.equal(h.run('persist()'),false);assert.equal(h.data.has(KEY),false);
  await h.ready();assert.equal(h.run('recoveryPending'),false);
});

test('IndexedDB abort rejects the mirror write and closes the database',async()=>{
  const h=boot(JSON.stringify(fixture()));await h.ready();let closed=false;
  const tx={objectStore:()=>({put(){queueMicrotask(()=>tx.onabort());}}),error:Error('Aborted')};
  h.context.fakeDB={transaction:()=>tx,close(){closed=true;}};
  h.run('openSecondaryDB=()=>Promise.resolve(fakeDB)');
  await assert.rejects(h.run('writeSecondary({schema:1})'),/Aborted/);assert.equal(closed,true);
});

for(const [field,value] of [['sync','invalid'],['remotePlans',{gym:[{name:'Broken'}]}]])test('malformed cached '+field+' enters recovery',async()=>{
  const d=fixture();d[field]=value;const raw=JSON.stringify(d);const h=boot(raw);await h.ready();
  assert.equal(h.run('recoveryRequired'),true);assert.equal(h.data.get(KEY),raw);
});
