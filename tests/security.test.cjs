const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const validate=vm.runInNewContext(fs.readFileSync('program.js','utf8')+'\n'+fs.readFileSync('cardio.js','utf8')+'\n'+app.slice(app.indexOf('function validateBackup('),app.indexOf('function importBackup('))+';validateBackup');
const backup=()=>({schema:1,settings:{unit:'lb'},exercises:[{id:'e',name:'Exercise'}],history:[{id:'w',date:'2026-11-01',title:'Workout',items:[{id:'i',exerciseId:'e',sets:[{id:'s1',weight:'10',reps:'8'},{id:'s2',weight:'20',reps:'6'}]}]}],templates:[]});
test('per-set ramp values survive validation unchanged',()=>{const d=backup();assert.equal(validate(d),d);assert.equal(d.history[0].items[0].sets[1].weight,'20');});
for(const [name,mutate] of Object.entries({duplicate:d=>d.history.push(d.history[0]),nullSet:d=>d.history[0].items[0].sets.push(null),negative:d=>d.history[0].items[0].sets[0].weight=-1,badRoutine:d=>d.templates=[{id:'t',name:'Plan',items:null}],futureSchema:d=>d.schema=2}))test('reject '+name,()=>{const d=backup();mutate(d);assert.throws(()=>validate(d));});
test('active history edits may reuse saved item IDs',()=>{const d=backup();d.active=structuredClone(d.history[0]);assert.doesNotThrow(()=>validate(d));});
test('production entry points cannot authenticate, fetch or resolve conflicts',async()=>{
 let calls=0;const window={};const ctx={window,localStorage:{getItem(){throw Error('unexpected storage')}},navigator:{onLine:true},setInterval(){},document:{addEventListener(){}},fetch(){calls++;throw Error('network prohibited')}};
 vm.runInNewContext(fs.readFileSync('sync.js','utf8'),ctx);
 const s=window.LiftLogSync;s.connect();await s.sync();await s.chooseConflict('workouts','w','sheet');s.schedule();assert.match(s.status.message,/disabled/);assert.equal(calls,0);assert.match(s.renderCard(),/paused/);
 assert.doesNotMatch(fs.readFileSync('index.html','utf8'),/accounts.google.com\/gsi/);
});
