'use strict';

// LiftLog v4.3: local-first one-tap training and user-initiated file sharing.
const STORAGE_KEY = 'liftlog.personal.v1';
const view = document.getElementById('view');
const sheetRoot = document.getElementById('sheet-root');
const toastNode = document.getElementById('toast');
const dateFmt = new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', year:'numeric' });
let tab = 'today';
let historyOpen = null;
let progressExercise = null;
let pickerMode = 'add';
let pickerTarget = null;
let toastTimer = null;
let storeAvailable = true;
let focusedSetKey = null;
let lastSetAction = null;
let dbWriteQueue = Promise.resolve();
let changedSinceBoot = false;
let recoveryRequired = false;
let recoveryPending = false;
let recoveryRaw = null;
let writerReady = false;
let writerMessage = 'Opening workout storage…';
const SECONDARY_DB = 'liftlog-offline-backup';
const SECONDARY_DB_STORE = 'snapshots';

const BASE_EXERCISES = [
  ['leg-press','Leg press','Lower body','Machines','reps',3,10,10],
  ['single-leg-press','Single-leg press','Lower body','Machines','reps',3,10,5],
  ['db-bench','Dumbbell bench press','Chest','Dumbbells','reps',3,10,5],
  ['incline-db-bench','Incline dumbbell press','Chest','Dumbbells','reps',3,10,5],
  ['row-supported','Chest-supported row','Back','Machines','reps',3,10,5],
  ['row-db','One-arm dumbbell row','Back','Dumbbells','reps',3,10,5],
  ['lat-pulldown','Lat pulldown','Back','Machines','reps',3,10,5],
  ['cable-row','Seated cable row','Back','Machines','reps',3,10,5],
  ['ham-curl','Seated hamstring curl','Hamstrings','Machines','reps',3,10,5],
  ['lying-ham-curl','Lying hamstring curl','Hamstrings','Machines','reps',3,10,5],
  ['single-rdl','Supported single-leg RDL','Hamstrings','Dumbbells','reps',3,10,5],
  ['db-rdl','Dumbbell Romanian deadlift','Hamstrings','Dumbbells','reps',3,10,5],
  ['slider-curl','Slider hamstring curl','Hamstrings','Bodyweight','reps',3,10,0],
  ['back-extension','Back extension','Posterior chain','Machines','reps',3,10,5],
  ['leg-extension','Leg extension','Quads','Machines','reps',3,10,5],
  ['goblet-squat','Goblet squat','Lower body','Dumbbells','reps',3,10,5],
  ['split-squat','Split squat','Lower body','Dumbbells','reps',3,10,5],
  ['step-ups','Step-ups','Lower body','Dumbbells','reps',3,10,5],
  ['spanish-squat','Spanish squat','Quads','Band/bodyweight','reps',3,12,0],
  ['db-shoulder','Dumbbell shoulder press','Shoulders','Dumbbells','reps',3,10,5],
  ['lateral-raise','Lateral raise','Shoulders','Dumbbells','reps',3,12,2.5],
  ['barbell-curl','EZ-bar curl','Arms','Barbell','reps',3,10,5],
  ['db-curl','Dumbbell curl','Arms','Dumbbells','reps',3,10,5],
  ['triceps','Triceps cable pushdown','Arms','Machines','reps',3,10,5],
  ['floor-press','Dumbbell floor press','Chest','Dumbbells','reps',3,10,5],
  ['stair-climber','Stair climber','Cardio','Cardio','minutes',1,10,0],
  ['bike','Stationary bike','Cardio','Cardio','minutes',1,15,0],
  ['plank','Plank','Core','Bodyweight','seconds',3,30,0]
].map(([id,name,category,equipment,measure,defaultSets,defaultReps,increment]) => ({id,name,category,equipment,measure,defaultSets,defaultReps,increment,custom:false})).concat(CARDIO_CATALOG);

const PLANS = {
  gym: [
    {key:'A',name:'Full body A',focus:'Strength foundation',description:'Leg press, upper-body push/pull, hamstrings, and a stair finish.',ids:['leg-press','db-bench','row-supported','ham-curl','back-extension','stair-climber']},
    {key:'B',name:'Full body B',focus:'Single-leg & posterior chain',description:'Your supported single-leg hinge, upper body, and Spanish squats.',ids:['single-rdl','db-shoulder','lat-pulldown','leg-extension','spanish-squat','barbell-curl']},
    {key:'C',name:'Full body C',focus:'Strength variation',description:'A different press and row, plus another hamstring session.',ids:['single-leg-press','incline-db-bench','cable-row','lying-ham-curl','lateral-raise','stair-climber']}
  ],
  small: [
    {key:'A',name:'Small gym A',focus:'Dumbbell full body',description:'Minimal machines; includes single-leg RDLs and dumbbell work.',ids:['single-rdl','db-bench','row-db','goblet-squat','db-curl']},
    {key:'B',name:'Small gym B',focus:'Single-leg & balance',description:'Split squats, shoulder work, and hamstrings with minimal equipment.',ids:['split-squat','db-shoulder','row-db','slider-curl','spanish-squat']},
    {key:'C',name:'Small gym C',focus:'Hinge & upper body',description:'Romanian deadlifts, dumbbell presses, rows, and step-ups.',ids:['db-rdl','floor-press','row-db','step-ups','lateral-raise']}
  ]
};

function uid(prefix='id') { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9); }
function localDate(d=new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function parseDate(value) { const d = new Date(String(value || '') + 'T12:00:00'); return Number.isNaN(d.getTime()) ? new Date() : d; }
function formatDate(value) { return dateFmt.format(parseDate(value)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function roundWeight(v) { return Number(Number(v).toFixed(2)); }
function unit() { return state.settings.unit; }
// Exercise-specific physical increments. A changed step persists for future workouts;
// pounds and kilograms have independent, gym-friendly increments.
const WEIGHT_STEPS = {lb:[1,2.5,5,10,25],kg:[0.5,1,2.5,5,10]};
function weightStep(ex) {
  const base=Number(ex?.increment);
  const raw=unit()==='kg' ? Number(ex?.incrementKg) : base;
  if(unit()==='kg') {
    if(Number.isFinite(raw)&&raw>0) return raw;
    return base>=25?10:base>=10?5:base>=5?2.5:base>=2.5?1:0.5;
  }
  return Number.isFinite(raw)&&raw>0?raw:5;
}
function stepLabel(ex) {return `±${fmtWeight(weightStep(ex))} ${unit()}`;}

function deepCopy(value) { return JSON.parse(JSON.stringify(value)); }
function emptyState() { return {schema:1,exercises:deepCopy(BASE_EXERCISES),history:[],active:null,templates:[],activityDays:[],settings:{planChoices:{},unit:'lb',location:'gym',restSeconds:90,sessionMinutes:45,lastBackupWorkoutCount:0,lastBackupAt:null},createdAt:new Date().toISOString()}; }
function hydrateState(d) {
  d.settings = {...emptyState().settings,...(d.settings || {})};
  d.settings.planChoices = {...(d.settings.planChoices || {})};
  d.templates = Array.isArray(d.templates) ? d.templates : [];
  if(![25,45,60].includes(Number(d.settings.sessionMinutes))) d.settings.sessionMinutes=45;
  if(!['lb','kg'].includes(d.settings.unit)) d.settings.unit='lb';
  if(!['gym','small'].includes(d.settings.location)) d.settings.location='gym';
  if(!Array.isArray(d.active?.items) && d.active) d.active=null;
  return hydrateCardio(d);
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { recoveryPending=true; return emptyState(); }
    const d = JSON.parse(raw);
    validateBackup(d);
    return hydrateState(d);
  } catch (err) {
    console.error('Could not load LiftLog data:',err);
    storeAvailable=false;
    recoveryRequired=true;
    return emptyState();
  }
}
let state=loadState();
function openSecondaryDB() {
  return new Promise((resolve,reject) => {
    if(!('indexedDB' in window)) {reject(Error('IndexedDB unavailable'));return;}
    const req=indexedDB.open(SECONDARY_DB,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(SECONDARY_DB_STORE);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(Error('Another LiftLog window is blocking storage access'));
  });
}
async function writeSecondary(snapshot) {
  const db=await openSecondaryDB();
  try {await new Promise((resolve,reject)=>{
    const tx=db.transaction(SECONDARY_DB_STORE,'readwrite');
    tx.objectStore(SECONDARY_DB_STORE).put(snapshot,'current');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted'));
  });} finally {db.close();}
}
async function recoverSecondaryIfNeeded() {
  if(!recoveryPending)return;
  if(changedSinceBoot)return;
  try {
    if(localStorage.getItem(STORAGE_KEY))return;
    const db=await openSecondaryDB();
    let value;
    try {value=await new Promise((resolve,reject)=>{
      const tx=db.transaction(SECONDARY_DB_STORE,'readonly');
      const req=tx.objectStore(SECONDARY_DB_STORE).get('current');
      req.onsuccess=()=>{value=req.result;};req.onerror=()=>reject(req.error);
      tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||Error('Recovery transaction aborted'));
    });}finally{db.close();}
    if(!changedSinceBoot && value) {
      recoveryRaw=JSON.stringify(value);
      validateBackup(value);
      state=hydrateState(value);try {localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storeAvailable=true;}catch(_){storeAvailable=false;}
      render();toast('Recovered workouts from second on-device copy',4500);
    }
  }catch(err){recoveryRequired=true;storeAvailable=false;console.info('Secondary storage needs recovery',err);}
  finally {recoveryPending=false;render();}
}
function persist() {
  if(!writerReady){toast(writerMessage,5000);return false;}
  if(recoveryRequired||recoveryPending){toast('Saved data needs recovery before saving.',6500);return false;}
  changedSinceBoot=true;
  const snapshot=deepCopy(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); storeAvailable=true; }
  catch(err) { storeAvailable=false; console.error('Could not save workout data:',err); toast('Storage issue — export a backup',5500); }
  // A second on-device copy reduces the chance of accidental local storage loss;
  // it is NOT a cloud backup and can be deleted with all Safari site data.
  dbWriteQueue=dbWriteQueue.then(()=>writeSecondary(snapshot)).catch(err=>console.warn('Second storage copy unavailable',err));
  return storeAvailable;
}

function toast(message,ms=2500) {
  clearTimeout(toastTimer);toastNode.textContent=message;toastNode.classList.add('show');
  toastTimer=setTimeout(()=>toastNode.classList.remove('show'),ms);
}
function exById(id) { return state.exercises.find(e=>e.id===id) || BASE_EXERCISES.find(e=>e.id===id) || {id,name:'Unknown exercise',category:'Other',equipment:'',measure:'reps',defaultSets:3,defaultReps:10,increment:5}; }
function isTimed(ex) { return ex.measure==='minutes' || ex.measure==='seconds'; }
function fmtWeight(v) { const n=Number(v); return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(v || ''); }
function doneSets(session) { return (session?.items || []).flatMap(i=>i.sets||[]).filter(s=>s.done); }
function sessionsSorted() { return [...state.history].sort((a,b) => (b.endedAt || b.startedAt || b.date || '').localeCompare(a.endedAt || a.startedAt || a.date || '')); }
function statsFor(session) { return {exercises:(session?.items || []).length,sets:doneSets(session).length,volume:(session?.items || []).reduce((sum,item)=>sum + (item.sets||[]).filter(s=>s.done && !isTimed(exById(item.exerciseId))).reduce((v,s)=>v+(Number(s.weight)||0)*(Number(s.reps)||0),0),0)}; }
function historyExercise(exId) {
  for(const session of sessionsSorted()) {
    const matches=(session.items || []).filter(i=>i.exerciseId===exId);
    if (!matches.length) continue;
    const completed=matches.flatMap(i=>i.sets || []).filter(s=>s.done);
    if (completed.length) return {session,sets:completed};
  }
  return null;
}
function recentSummary(exId) {
  const recent=historyExercise(exId); if(!recent) return 'No previous sets yet';
  const ex=exById(exId);
  if(isCardio(ex)) return 'Last: '+recent.sets.map(s=>cardioSetSummary(s,ex)).join(' / ');
  if(isTimed(ex)) return `Last: ${recent.sets.map(s=>`${s.reps || '–'} ${ex.measure}`).join(', ')}`;
  const show=recent.sets.slice(0,3).map(s=>`${s.weight !== '' ? s.weight : 'BW'} × ${s.reps || '–'}`);
  return `Last: ${show.join('  ·  ')} ${unit()}`;
}
function recommendedWeight(ex) {
  if (isTimed(ex)) return '';
  const recent=historyExercise(ex.id); if (!recent) return '';
  const numeric=recent.sets.filter(s=>s.weight!=='' && s.weight!==null && Number.isFinite(Number(s.weight)));
  if(!numeric.length) return '';
  const max=Math.max(...numeric.map(s=>Number(s.weight)));
  const atMax=numeric.filter(s=>Number(s.weight)===max);
  const success=atMax.length>=ex.defaultSets && atMax.every(s=>Number(s.reps)>=12);
  return fmtWeight(roundWeight(max+(success ? weightStep(ex) : 0)));
}
function createItem(exId) {
  const ex=exById(exId),last=historyExercise(exId);
  // Repeat each completed set from the previous session, in order. Never silently
  // replace every warm-up set with the heaviest weight from last time.
  const previous=last?.sets || [];
  const count=previous.length?Math.min(16,previous.length):(ex.defaultSets || 3);
  const sets=Array.from({length:count},(_,i)=>{
    const old=previous[i] || previous[previous.length-1] || null;
    return {id:uid('set'),weight:old?String(old.weight??''):'',reps:old?String(old.reps??ex.defaultReps):String(ex.defaultReps),done:false,...(isCardio(ex)?{cardio:cardioDefaults()}:{})};
  });
  return {id:uid('item'),exerciseId:exId,note:'',sets};
}
function getFocusedSet() {
  const items=state.active?.items || [];
  if(focusedSetKey){
    for(const item of items)for(let i=0;i<item.sets.length;i++) {
      const set=item.sets[i];
      if(`${item.id}:${set.id}`===focusedSetKey && !set.done)return {item,set,index:i};
    }
  }
  for(const item of items)for(let i=0;i<item.sets.length;i++)if(!item.sets[i].done)
    return {item,set:item.sets[i],index:i};
  return null;
}
function renderQuickPanel() {
  const current=getFocusedSet();
  if(!current)return `<div class="quick-panel all-done"><div class="quick-eyebrow">ALL SETS CHECKED</div><strong>Workout ready to finish</strong><p>Want another set? Add one under an exercise below.</p><div class="row margin-bottom"><button class="button dark sm" data-action="undo-last">↶ Undo last set</button><button class="button dark sm" data-action="jump-exercise">Jump to exercise</button></div><button class="button full" data-action="finish">Finish & save ✓</button></div>`;
  const {item,set,index}=current,ex=exById(item.exerciseId),timed=isTimed(ex),cardio=isCardio(ex);
  const haveWeight=set.weight!==''&&set.weight!==null;
  const measure=timed?ex.measure:'reps';
  return `<section class="quick-panel" aria-label="One-tap next set">
    <div class="quick-actions"><button class="tiny-action" data-action="jump-exercise">☰ Change exercise</button><button class="tiny-action" data-action="undo-last" ${lastDoneSet()?'':'disabled'}>↶ Undo last set</button></div>
    <div class="quick-eyebrow">${cardio?'CARDIO BLOCK':'NEXT SET'} · ${item.sets.filter(s=>s.done).length}/${item.sets.length} COMPLETED IN EXERCISE</div>
    <div class="quick-name">${esc(ex.name)}</div>
    <div class="quick-caption">${cardio?'Block':'Set'} ${index+1} of ${item.sets.length} · ${esc(recentSummary(ex.id))}</div>
    <div class="quick-meters">
      ${!timed?`<div class="quick-meter"><span class="quick-label">WEIGHT · ${esc(unit())}</span>
        <div class="quick-meter-controls"><button data-action="quick-adjust" data-field="weight" data-delta="-1" aria-label="Decrease weight by ${esc(weightStep(ex))} ${esc(unit())}">−</button>
        <button class="quick-value" data-action="edit-set" data-item="${esc(item.id)}" data-set="${esc(set.id)}" aria-label="Type exact weight and reps">${haveWeight?esc(set.weight):'—'}</button>
        <button data-action="quick-adjust" data-field="weight" data-delta="1" aria-label="Increase weight by ${esc(weightStep(ex))} ${esc(unit())}">+</button></div>
        <button class="step-picker" data-action="choose-weight-step" data-id="${esc(ex.id)}" aria-label="Change weight increments for ${esc(ex.name)}">Step: ${esc(fmtWeight(weightStep(ex)))} ${esc(unit())} <span aria-hidden="true">⌄</span></button></div>`:''}
      <div class="quick-meter"><span class="quick-label">${esc(measure.toUpperCase())}</span><div class="quick-meter-controls"><button data-action="quick-adjust" data-field="reps" data-delta="-1" aria-label="Decrease ${esc(measure)}">−</button>
      <button class="quick-value" data-action="edit-set" data-item="${esc(item.id)}" data-set="${esc(set.id)}" aria-label="Type exact weight and reps">${esc(set.reps || '—')}</button>
      <button data-action="quick-adjust" data-field="reps" data-delta="1" aria-label="Increase ${esc(measure)}">+</button></div></div>
    </div>
    <button class="quick-complete" data-action="quick-complete" aria-label="Complete ${esc(ex.name)} set ${index+1}">✓ &nbsp; ${cardio?'Log cardio block':'Complete set'}</button>
    <div class="quick-footer"><span>${timed?esc(ex.measure):esc(ex.equipment==='Dumbbells'?'Weight per dumbbell / hand':'Use the same weight convention each time')}</span><button data-action="edit-set" data-item="${esc(item.id)}" data-set="${esc(set.id)}">Type values</button></div>
  </section>`;
}
function planExercises(plan) {
  const minutes=Number(state.settings.sessionMinutes);
  if(minutes===25) {
    // Short workout preserves hinge/hamstrings and upper-body push/pull wherever possible.
    return plan.ids.slice(0,4);
  }
  if(minutes===60) {
    const accessory=state.settings.location==='small'
      ? ({A:'plank',B:'plank',C:'spanish-squat'})[plan.key]
      : ({A:'lateral-raise',B:'stair-climber',C:'back-extension'})[plan.key];
    return accessory && !plan.ids.includes(accessory) ? [...plan.ids,accessory] : [...plan.ids];
  }
  return plan.ids;
}
function templateItems(t) {
  return t.items.map(spec=>{
    const item=createItem(spec.exerciseId);
    const prev=historyExercise(spec.exerciseId)?.sets || [];
    const count=Math.max(1,Math.min(16,spec.sets.length));
    item.sets=Array.from({length:count},(_,k)=>{
      const from=prev[k] || prev[prev.length-1] || spec.sets[k] || {};
      return {id:uid('set'),weight:String(from.weight??''),reps:String(from.reps??exById(spec.exerciseId).defaultReps),done:false,...(isCardio(exById(spec.exerciseId))?{cardio:cardioTemplateTargets(spec.sets[k]?.cardio)}:{})};
    });
    return item;
  });
}
function startTemplate(id) {
  const t=state.templates.find(t=>t.id===id);if(!t)return;
  if(state.active&&!confirm('Replace the unfinished workout with this routine?'))return;
  state.active={id:uid('workout'),date:localDate(),startedAt:new Date().toISOString(),endedAt:null,
    title:t.name,planKey:null,location:t.location||state.settings.location,notes:'',restUntil:null,editingId:null,
    items:templateItems(t)};
  focusedSetKey=null;lastSetAction=null;persist();setTab('workout');
}
function showPlanImporter() {
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">Import a suggested routine</h2><p class="subtle">Paste a LiftLog routine from ChatGPT. Only matching exercise names are accepted; your workout history is never overwritten.</p></div><button class="micro-btn" data-action="close-sheet">✕</button></div>
  <textarea id="import-plan" rows="11" spellcheck="false" autocapitalize="off" placeholder='Paste your LiftLog routine JSON here'></textarea>
  <div class="stack margin-top"><button class="button full" data-action="import-plan">Save imported routine</button><button class="button dark full" data-action="copy-plan-format">Copy a request for ChatGPT</button></div>`);
}
function planRequestText() {
  return 'Please create a personalized workout routine for my LiftLog iPhone app. Return ONLY a JSON object, not markdown, in this exact structure: '+
    JSON.stringify({liftlogRoutine:1,name:'Travel full body',location:'small',exercises:[{name:'Supported single-leg RDL',sets:[{weight:20,reps:10},{weight:25,reps:10}]},{name:'Dumbbell bench press',sets:[{weight:50,reps:10},{weight:50,reps:10}]}]})+
    '. Use real exercises from this library: '+state.exercises.map(e=>e.name).join(', ')+
    '. Use '+unit()+' for all weights, log dumbbells by weight per hand, and use plausible set progressions. Ask me about any missing starting weights rather than inventing past performance.';
}
async function copyPlanRequest() {
  const value=planRequestText();
  try{await navigator.clipboard.writeText(value);toast('Request copied. Paste it into ChatGPT.');}
  catch(err){showSheet(`<div class="sheet-top"><h2 class="sheet-title">Copy request</h2><button class="micro-btn" data-action="close-sheet">✕</button></div><textarea rows="14" readonly>${esc(value)}</textarea>`);}
}
function importSuggestedPlan() {
  const input=document.getElementById('import-plan')?.value.trim()||'';
  let parsed;
  try {parsed=JSON.parse(input);}catch(err){toast('Paste valid JSON first');return;}
  if(parsed?.liftlogRoutine!==1 || typeof parsed.name!=='string'||!parsed.name.trim()||parsed.name.length>80 ||
      !['gym','small'].includes(parsed.location) || !Array.isArray(parsed.exercises) ||
      !parsed.exercises.length ||parsed.exercises.length>20){toast('Not a valid LiftLog routine');return;}
  const specs=[];
  for(const raw of parsed.exercises){
    if(!raw || typeof raw.name!=='string') {toast('Each exercise needs a name');return;}
    const ex=state.exercises.find(e=>e.name.toLowerCase()===raw.name.trim().toLowerCase());
    if(!ex){toast('Exercise not found: '+raw.name,5500);return;}
    if(!Array.isArray(raw.sets) || !raw.sets.length || raw.sets.length>16){toast('Sets must be an array with 1–16 entries');return;}
    const sets=[];
    for(const x of raw.sets){
      const w=Number(x?.weight??0),r=Number(x?.reps);
      if(!Number.isFinite(w)||w<0||w>2000||(!isTimed(ex)&&!Number.isInteger(r))||!Number.isFinite(r)||r<1||r>10000){toast('Invalid weight or reps in '+ex.name);return;}
      if(x.cardio!==undefined){try{validateCardio(x.cardio);}catch(err){toast(err.message);return;}}
      sets.push({weight:isTimed(ex)?'':String(w),reps:String(r),...(isCardio(ex)&&x.cardio?{cardio:deepCopy(x.cardio)}:{})});
    }
    specs.push({exerciseId:ex.id,sets});
  }
  const t={id:uid('routine'),name:parsed.name.trim(),location:parsed.location,items:specs,createdAt:new Date().toISOString()};
  state.templates.push(t);persist();closeSheet();render();toast('Imported '+t.name+' as a new routine',4500);
}
function saveTemplate() {
  const w=state.active;if(!w||!w.items.length)return;
  const name=prompt('Routine name',w.title);if(name===null)return;
  if(!name.trim()){toast('Give the routine a name');return;}
  const t={id:uid('routine'),name:name.trim().slice(0,70),location:w.location,
    items:w.items.map(i=>({exerciseId:i.exerciseId,sets:i.sets.map(s=>({weight:s.weight,reps:s.reps,...(s.cardio?{cardio:cardioTemplateTargets(s.cardio)}:{})}))})),
    createdAt:new Date().toISOString()};
  state.templates.push(t);persist();toast('Routine saved. Start it from Today.');
}
function deleteTemplate(id) {
  const t=state.templates.find(t=>t.id===id);if(!t)return;
  if(!confirm(`Delete the routine “${t.name}”? Workout history is unaffected.`))return;
  state.templates=state.templates.filter(x=>x.id!==id);persist();render();
}
function rotationPlans(location=state.settings.location) {
  const saved=state.remotePlans?.[location];
  return saved?.length===3 && new Set(saved.map(p=>p.key)).size===3 ? saved : PLANS[location];
}
function lastRotationWorkout(location=state.settings.location) {
  const keys=new Set(rotationPlans(location).map(p=>p.key));
  // Use the workout date/start time, so editing an old session does not move
  // the rotation backwards. Ignore blank/custom sessions and other equipment.
  return state.history.map((session,index)=>({session,index}))
    .filter(({session:s})=>(s.location||'gym')===location && keys.has(s.planKey))
    .sort((a,b)=>(b.session.date||'').localeCompare(a.session.date||'') ||
      (b.session.startedAt||b.session.endedAt||'').localeCompare(a.session.startedAt||a.session.endedAt||'') || b.index-a.index)[0]?.session || null;
}
function automaticPlan() {
  const plans=rotationPlans(),last=lastRotationWorkout();
  return plans[last?(plans.findIndex(p=>p.key===last.planKey)+1)%plans.length:0];
}
function suggestedPlan() {
  const key=state.settings.planChoices?.[state.settings.location];
  return rotationPlans().find(p=>p.key===key) || automaticPlan();
}
function showPlanPicker() {
  const automatic=automaticPlan(),last=lastRotationWorkout(),selected=state.active?.location===state.settings.location?state.active.planKey:suggestedPlan().key;
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">Choose your workout</h2><p class="subtle">${state.active?'Switching routines replaces your unfinished workout after confirmation.':'Missed a log? Start wherever you are in your rotation.'}</p></div><button class="micro-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
    <div class="picker-options"><button class="picker-option" data-action="select-plan" data-key="auto"><div><strong>Use suggestion · ${esc(automatic.name)}</strong><span>${last?'Next after your recorded '+esc(last.title):'No recorded routine yet — you can choose any workout below.'}</span></div><span aria-hidden="true">↻</span></button>
    ${rotationPlans().map(p=>`<button class="picker-option" data-action="select-plan" data-key="${esc(p.key)}" aria-pressed="${p.key===selected}"><div><strong>${esc(p.name)}</strong><span>${esc(p.focus)} · ${planExercises(p).length} exercises</span></div><span aria-hidden="true">${p.key===selected?'✓':'→'}</span></button>`).join('')}</div>`);
}
function choosePlan(key) {
  const plan=key==='auto'?automaticPlan():rotationPlans().find(p=>p.key===key);
  if(!plan)return;
  if(state.active){
    if(state.active.location===state.settings.location && state.active.planKey===plan.key){setTab('workout');return;}
    startWorkout('plan',key);return;
  }
  if(key==='auto')delete state.settings.planChoices[state.settings.location];
  else state.settings.planChoices[state.settings.location]=key;
  persist();closeSheet();render();
}
function startWorkout(kind,requestedKey=null) {
  const plan=requestedKey==='auto'?automaticPlan():requestedKey===null?suggestedPlan():rotationPlans().find(p=>p.key===requestedKey);
  if(!plan)return false;
  if(state.active && !confirm('Discard your unfinished workout and start another?')) return;
  if(requestedKey!==null){
    if(requestedKey==='auto')delete state.settings.planChoices[state.settings.location];
    else state.settings.planChoices[state.settings.location]=requestedKey;
  }
  state.active={id:uid('workout'),date:localDate(),startedAt:new Date().toISOString(),endedAt:null,
    title:kind==='blank'?'My workout':plan.name,planKey:kind==='blank'?null:plan.key,
    location:state.settings.location,notes:'',restUntil:null,editingId:null,
    items:kind==='blank'?[]:planExercises(plan).map(createItem)};
  focusedSetKey=null;lastSetAction=null;persist();closeSheet();tab='workout';render();window.scrollTo({top:0,behavior:'instant'});return true;
}
function repeatLastWorkout() {
  const prior=sessionsSorted()[0];if(!prior)return;
  if(state.active && !confirm('Replace your unfinished workout?'))return;
  state.active={id:uid('workout'),date:localDate(),startedAt:new Date().toISOString(),endedAt:null,
    title:prior.title,planKey:prior.planKey||null,location:prior.location||state.settings.location,
    notes:'',restUntil:null,editingId:null,items:prior.items.map(i=>({
      id:uid('item'),exerciseId:i.exerciseId,note:i.note||'',
      sets:i.sets.filter(s=>s.done).map(s=>({id:uid('set'),weight:String(s.weight??''),reps:String(s.reps??''),done:false,...(isCardio(exById(i.exerciseId))?{cardio:cardioDefaults()}:{})}))
    })).filter(i=>i.sets.length)};
  focusedSetKey=null;persist();setTab('workout');
}
function setTab(next) {tab=next;closeSheet();render();window.scrollTo({top:0,behavior:'instant'});}
function render() {
  if(!writerReady){view.innerHTML=pageShell(`<h1>Workout storage</h1><p>${esc(writerMessage)}</p><button class="button full" data-action="reload-app">Try again</button><button class="button dark full" data-action="export-recovery">Download saved data</button>`);return;}
  if(recoveryPending){view.innerHTML=pageShell('<h1>Checking saved workouts…</h1><p>Please wait while LiftLog checks the second on-device copy.</p>');return;}
  if(recoveryRequired){view.innerHTML=pageShell(`<h1>Saved data needs recovery</h1><p>LiftLog could not read the saved database. Logging is paused to protect it. Download the saved data before restoring a known-good backup.</p><div class="stack"><button class="button full" data-action="export-recovery">Download saved data</button><button class="button dark full" data-action="import-json">Restore JSON backup</button><button class="button danger" data-action="reset">Erase local data and start fresh</button></div>`);return;}
  const views={today:renderToday,workout:renderWorkout,history:renderHistory,progress:renderProgress,more:renderMore,cardio:renderCardio};
  view.innerHTML=(views[tab] || renderToday)();
  document.querySelectorAll('[data-tab]').forEach(btn=>{
    const active=btn.dataset.tab===tab;btn.classList.toggle('active',active);
    if(active) btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
  updateRestDisplay();
}
function pageShell(inner) {return `<div class="content">${inner}</div>`;}
function metrics() {
  const now=Date.now(),weekAgo=now-7*86400000,monthAgo=now-30*86400000;
  const recent=state.history.filter(s => (new Date(s.endedAt || s.date+'T12:00:00').getTime() || 0)>=weekAgo);
  const month=state.history.filter(s => (new Date(s.endedAt || s.date+'T12:00:00').getTime() || 0)>=monthAgo);
  return {week:recent.length,month:month.length,sets:month.reduce((n,s)=>n+s.items.filter(i=>!isCardio(exById(i.exerciseId))).reduce((m,i)=>m+i.sets.filter(x=>x.done).length,0),0)};
}
function renderMetrics(){const m=metrics();return `<div class="kpi-grid"><div class="kpi"><strong>${m.week}</strong><span>Sessions / 7d</span></div><div class="kpi"><strong>${m.month}</strong><span>Sessions / 30d</span></div><div class="kpi"><strong>${m.sets}</strong><span>Sets / 30d</span></div></div>`;}
function renderToday() {
  const plan=suggestedPlan();const last=sessionsSorted()[0];const isActive=!!state.active;
  return pageShell(`<div class="eyebrow">${esc(new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric'}).format(new Date()))}</div>
    <h1 class="page-title">Keep getting stronger<span style="color:var(--mint)">.</span></h1>
    <p class="subtle margin-bottom">Your workouts, your pace. Saved instantly on this phone.</p>
    ${!storeAvailable?'<div class="notice warn margin-bottom">Your browser is not saving data reliably. Export a backup before leaving this page.</div>':''}
    <div class="hero card"><div class="eyebrow">${isActive?'WORKOUT IN PROGRESS':'UP NEXT · TAP TO CHANGE'}</div>
    <h2>${isActive?esc(state.active.title):`<button class="plan-picker-title" data-action="show-plan-picker" aria-label="Choose workout routine" aria-haspopup="dialog">${esc(plan.name)} <span aria-hidden="true">⌄</span></button>`}</h2>
    <p>${esc(isActive?'Your sets are saved as you go. Jump right back in.':plan.description)}</p>
    <div class="hero-actions"><button class="button" data-action="${isActive?'continue':'start-plan'}">${isActive?'Continue workout':'Start workout '+esc(plan.key)} <span aria-hidden="true">→</span></button>
    ${!isActive?'<button class="button dark" data-action="start-blank">Start blank</button>':'<button class="button dark" data-action="show-plan-picker" aria-haspopup="dialog">Change routine</button>'}</div></div>
    <div class="card margin-top"><div class="row"><h2 class="section-title">Cardio</h2><button class="button dark sm" data-action="nav" data-value="cardio">View cardio →</button></div><p class="subtle margin-top-sm">Dog walks, jogs and gym cardio. Log separately or add to a lift; A/B/C stays on track.</p><button class="button dark full margin-top-sm" data-action="cardio-picker">${isActive?'＋ Add cardio to this workout':'＋ Start cardio'}</button></div>
    ${!isActive && state.templates.length?`<div class="section-heading"><h2 class="section-title">Your routines</h2></div><div class="card routines-list">${state.templates.map(t=>`<div class="routine-row"><div class="grow"><strong>${esc(t.name)}</strong><div class="subtle small">${t.items.length} exercises · ${esc(t.location==='small'?'Travel gym':'Full gym')}</div></div><button class="button sm" data-action="start-template" data-id="${esc(t.id)}">Start</button><button class="micro-btn" data-action="delete-template" data-id="${esc(t.id)}" aria-label="Delete ${esc(t.name)}">✕</button></div>`).join('')}</div>`:''}
    <div class="section-heading"><h2 class="section-title">Your week</h2><span class="subtle">Last 7–30 days</span></div>${renderMetrics()}
    <div class="section-heading"><h2 class="section-title">Workout setup</h2></div>
    <div class="card"><p class="subtle" style="margin-bottom:11px">Pick the equipment available today. Suggestions adapt; logging stays flexible.</p>
      <div class="segmented"><button class="segment ${state.settings.location==='gym'?'active':''}" data-action="location" data-value="gym">Full gym</button><button class="segment ${state.settings.location==='small'?'active':''}" data-action="location" data-value="small">Small gym / travel</button></div>
      <div class="segmented time-pick margin-top-sm">${[25,45,60].map(v=>`<button class="segment ${Number(state.settings.sessionMinutes)===v?'active':''}" data-action="duration" data-value="${v}">${v===25?'Quick · 25m':v===45?'Standard · 45m':'Full · 60m'}</button>`).join('')}</div>
      ${!isActive?`<div class="mini-list margin-top">${planExercises(plan).map((id,idx)=>`<div class="mini-row"><div class="row gap8"><span class="marker">${idx+1}</span><span class="mini-label">${esc(exById(id).name)}</span></div><span class="subtle tiny">${esc(exById(id).category)}</span></div>`).join('')}</div>`:'<p class="subtle margin-top-sm">Changing this selects equipment for your next new workout; your current workout is unchanged.</p>'}
    </div>
    <div class="section-heading"><h2 class="section-title">Last completed</h2><button class="button linkish" data-action="nav" data-value="history">View history →</button></div>
    ${last?`<div class="card"><div class="row"><div><strong>${esc(last.title)}</strong><div class="subtle margin-top-sm">${formatDate(last.date)} · ${esc(sessionSummary(last))}</div></div><button class="button dark sm" data-action="repeat-last">Repeat this</button></div></div>`:
      '<div class="empty"><div class="empty-icon">↗</div><strong>Your first workout starts here</strong><p>No fabricated history. Your real progress will appear after your first saved session.</p></div>'}`);
}
function renderWorkout() {
  const w=state.active;
  if(!w) return pageShell(`<div class="eyebrow">WORKOUT</div><h1 class="page-title">Ready when you are.</h1><p class="subtle">Start a planned full-body session or build a workout from scratch.</p><div class="stack margin-top"><button class="button full" data-action="start-plan">Start ${esc(suggestedPlan().name)}</button><button class="button dark full" data-action="show-plan-picker" aria-haspopup="dialog">Choose routine</button><button class="button dark full" data-action="cardio-picker">Start cardio</button><button class="button dark full" data-action="start-blank">Start blank workout</button></div>`);
  const count=doneSets(w).length;const total=w.items.reduce((n,i)=>n+i.sets.length,0);
  return pageShell(`<div class="workout-head"><div class="grow"><div class="eyebrow">${w.editingId?'EDITING SAVED WORKOUT':'ACTIVE WORKOUT'}</div><h1 class="page-title"><button class="plan-picker-title" data-action="show-plan-picker" aria-label="Change workout routine" aria-haspopup="dialog">${esc(w.title)} <span aria-hidden="true">⌄</span></button></h1><div class="subtle">${formatDate(w.date)} · ${count}/${total} entries completed</div></div>
  <button class="button dark sm" data-action="edit-meta">Edit details</button></div>
  <div class="badges session-badges"><span class="chip green">${esc(w.location==='gym'?'Full gym':'Small gym')}</span>${w.items.some(i=>!isTimed(exById(i.exerciseId)))?`<span class="chip">${esc(unit())} weights</span>`:''}${w.planKey?`<span class="chip">Workout ${esc(w.planKey)}</span>`:''}</div>
  ${renderQuickPanel()}
  ${w.restUntil && w.restUntil>Date.now()?`<div class="rest-banner" id="rest-banner"><div><div class="eyebrow">REST TIMER</div><strong id="rest-countdown">${formatCountdown(w.restUntil-Date.now())}</strong></div><button class="button dark sm" data-action="skip-rest">Skip rest</button></div>`:''}
  <div class="row margin-bottom cardio-actions"><h2 class="section-title">Exercises</h2><button class="button dark sm" data-action="cardio-picker">+ Cardio</button><button class="button mint-outline sm" data-action="pick-exercise">+ Add exercise</button></div>
  ${w.items.length?w.items.map((item,index)=>renderExerciseCard(item,index)).join(''):'<div class="empty"><strong>No exercises yet</strong><p>Tap “Add exercise” to build this workout.</p><button class="button sm" data-action="pick-exercise">+ Add exercise</button></div>'}
  ${w.items.length?`<button class="button dark full margin-top-sm" data-action="pick-exercise">+ Add another exercise</button>`:''}
  <div class="card margin-top"><div class="row"><div><strong>Session notes</strong><div class="subtle small">How did it feel? Anything worth remembering?</div></div></div>
  <textarea data-action="workout-notes" placeholder="Knee felt good, increased load, short on time…" rows="2">${esc(w.notes)}</textarea></div>
  <div class="stack margin-top">${!w.editingId?'<button class="button dark full" data-action="save-template">☆ Save as reusable routine</button>':''}<button class="button full" data-action="finish">${w.editingId?'Save changes':'Finish & save workout'} ✓</button><button class="button ghost full" data-action="discard">${w.editingId?'Cancel editing':'Discard workout'}</button></div>`);
}
function renderExerciseCard(item,index) {
  const ex=exById(item.exerciseId),timed=isTimed(ex);
  return `<article class="exercise-card" data-item="${esc(item.id)}"><div class="exercise-top"><div class="row start"><span class="exercise-index">${index+1}</span><div class="grow"><button class="focus-exercise-title exercise-name" data-action="focus-exercise" data-item="${esc(item.id)}" aria-label="Log ${esc(ex.name)} next">${esc(ex.name)} ↗</button><div class="exercise-sub">${esc(ex.category)} · ${esc(ex.equipment)}${timed?' · '+esc(ex.measure):''}</div></div>
  <div class="exercise-options"><button class="micro-btn" aria-label="Move ${esc(ex.name)} up" data-action="move-up" data-item="${esc(item.id)}" ${index===0?'disabled':''}>↑</button><button class="micro-btn" aria-label="Move ${esc(ex.name)} down" data-action="move-down" data-item="${esc(item.id)}" ${index===state.active.items.length-1?'disabled':''}>↓</button><button class="micro-btn" aria-label="More options for ${esc(ex.name)}" data-action="exercise-menu" data-item="${esc(item.id)}">⋯</button></div></div></div>
  <div class="exercise-hint">${esc(recentSummary(ex.id))}</div>
  <div class="fast-set-heading"><span>${isCardio(ex)?'BLOCK':'SET'}</span><span>${isCardio(ex)?'DURATION / DETAILS':'WEIGHT / REPS'} · TAP TO EDIT</span><span>DONE</span></div>
  ${item.sets.map((set,i)=>`<div class="fast-set-row ${set.done?'done':''}"><span class="fast-set-number">${i+1}</span>
  <button class="fast-set-values" data-action="edit-set" data-item="${esc(item.id)}" data-set="${esc(set.id)}" aria-label="Edit ${esc(ex.name)} set ${i+1}">${isCardio(ex)?esc(cardioSetSummary(set,ex)):timed?`${esc(set.reps||'—')} ${esc(ex.measure)}`:`${esc(set.weight===''?'—':set.weight)} ${esc(unit())} <span class="fast-mult">×</span> ${esc(set.reps||'—')}`}</button>
  <button class="set-done" data-action="toggle-set" data-item="${esc(item.id)}" data-set="${esc(set.id)}" aria-label="${set.done?'Unmark':'Complete'} ${esc(ex.name)} set ${i+1}" aria-pressed="${set.done}">${set.done?'✓':'○'}</button></div>`).join('')}
  <div class="exercise-bottom"><button class="button dark sm" data-action="add-set" data-item="${esc(item.id)}">${isCardio(ex)?'+ Add cardio block':'+ Add set'}</button><button class="button linkish sm" data-action="remove-set" data-item="${esc(item.id)}" ${item.sets.length<=1?'disabled':''}>${isCardio(ex)?'Remove last block':'Remove last set'}</button></div>
  <div class="note-inline"><input type="text" placeholder="Optional exercise note" aria-label="${esc(ex.name)} exercise note" data-action="exercise-note" data-item="${esc(item.id)}" value="${esc(item.note)}"></div></article>`;
}
function renderHistory() {
  const all=sessionsSorted();
  return pageShell(`<div class="eyebrow">YOUR RECORD</div><h1 class="page-title">Workout history</h1><p class="subtle margin-bottom">Every session is kept on this device. Tap one to see or edit it.</p>
    ${all.length?all.map(session=>{
      const st=statsFor(session),open=historyOpen===session.id;
      return `<article class="history-entry"><div class="row start"><div class="grow"><h3>${esc(session.title)}</h3><div class="subtle">${formatDate(session.date)} · ${st.exercises} exercises · ${esc(sessionSummary(session))}</div></div>
      <button class="button dark sm" data-action="toggle-history" data-id="${esc(session.id)}">${open?'Hide':'Details'}</button></div>
      ${open?`<div class="history-details margin-top"><div class="history-exercise"><div class="subtle small">Session notes</div><div class="small">${esc(session.notes || 'None')}</div></div>
      ${(session.items || []).map(item=>{const e=exById(item.exerciseId);const ds=(item.sets||[]).filter(s=>s.done);return `<div class="history-exercise"><h4>${esc(e.name)}</h4><div class="history-sets">${ds.length?ds.map(s=>isCardio(e)?esc(cardioSetSummary(s,e)):isTimed(e)?`${esc(s.reps)} ${esc(e.measure)}`:`${esc(s.weight||'BW')} ${esc(unit())} × ${esc(s.reps)}`).join('  ·  '):'No completed sets'}</div>${item.note?`<div class="subtle small">${esc(item.note)}</div>`:''}</div>`;}).join('')}
      <div class="row margin-top-sm"><button class="button dark sm" data-action="edit-history" data-id="${esc(session.id)}">Edit session</button><button class="button danger sm" data-action="delete-history" data-id="${esc(session.id)}">Delete session</button></div></div>`:''}</article>`;
    }).join(''):'<div class="empty"><div class="empty-icon">▤</div><strong>No sessions yet</strong><p>Finish a workout and your full set-by-set history appears here.</p><button class="button sm" data-action="start-plan">Start a workout</button></div>'}`);
}
function pointsForExercise(id) {
  const ex=exById(id);const rows=[];
  for(const session of [...state.history].sort((a,b)=>(a.endedAt||a.date||'').localeCompare(b.endedAt||b.date||''))) {
    const ds=(session.items||[]).filter(i=>i.exerciseId===id).flatMap(i=>i.sets||[]).filter(s=>s.done);
    if(!ds.length) continue;
    const nums=ds.map(s=>isTimed(ex)?Number(s.reps):(s.weight===''?NaN:Number(s.weight))).filter(v=>Number.isFinite(v));
    if(nums.length) rows.push({date:session.date, value:Math.max(...nums),id:session.id});
  }
  return rows;
}
function svgChart(points,ex) {
  if(points.length<1) return '<div class="empty"><strong>No measurements yet</strong><p>Log at least one completed set with a weight or duration to see the chart.</p></div>';
  const width=350,height=195,left=34,right=14,top=23,bottom=35;
  const values=points.map(p=>p.value),max=Math.max(...values),min=Math.min(...values),pad=Math.max((max-min)*.25,max*.1,1),low=Math.max(0,min-pad),high=max+pad;
  const count=points.length;
  const px=i=>left+(count===1?(width-left-right)/2:i*(width-left-right)/(count-1));
  const py=v=>top+(high-v)/(high-low)*(height-top-bottom);
  const grid=[0,.5,1].map(t=>{const y=top+t*(height-top-bottom);return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" class="chart-grid"/><text x="${left-5}" y="${y+4}" text-anchor="end" class="chart-label">${fmtWeight(high-t*(high-low))}</text>`;}).join('');
  const path=points.map((p,i)=>`${i===0?'M':'L'}${px(i).toFixed(2)},${py(p.value).toFixed(2)}`).join(' ');
  const dots=points.map((p,i)=>`<circle cx="${px(i)}" cy="${py(p.value)}" r="4.5" class="chart-dot"><title>${esc(formatDate(p.date))}: ${fmtWeight(p.value)}</title></circle>`).join('');
  const labels=(count===1?[0]:[0,Math.floor((count-1)/2),count-1].filter((v,i,a)=>a.indexOf(v)===i)).map(i=>`<text x="${px(i)}" y="${height-10}" text-anchor="middle" class="chart-label">${esc(new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(parseDate(points[i].date)))}</text>`).join('');
  return `<div class="chart-wrap"><svg role="img" aria-label="Best ${isTimed(ex)?esc(ex.measure):'weight'} by workout for ${esc(ex.name)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${grid}<path d="${path}" class="chart-line"/>${dots}${labels}</svg></div>`;
}
function renderProgress() {
  const activeIds=Array.from(new Set(state.history.flatMap(s=>(s.items||[]).map(i=>i.exerciseId))));
  const options=activeIds.map(exById).sort((a,b)=>a.name.localeCompare(b.name));
  if(!progressExercise || !activeIds.includes(progressExercise)) progressExercise=options[0]?.id || '';
  const ex=exById(progressExercise), points=pointsForExercise(progressExercise),max=points.length?Math.max(...points.map(p=>p.value)):0;
  const first=points[0]?.value,last=points[points.length-1]?.value,diff=points.length>1?roundWeight(last-first):null;
  return pageShell(`<div class="eyebrow">STRENGTH OVER TIME</div><h1 class="page-title">Your progress</h1><p class="subtle margin-bottom">Track your best completed weight per workout, or minutes for cardio.</p>${renderMetrics()}
  <div class="section-heading"><h2 class="section-title">Exercise trend</h2></div>
  ${options.length?`<div class="field margin-bottom"><label for="progress-select">Choose exercise</label><select id="progress-select" data-action="progress-exercise" style="width:100%">${options.map(e=>`<option value="${esc(e.id)}" ${e.id===progressExercise?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
  <div class="row margin-bottom"><div><div class="subtle tiny">BEST RECORDED</div><strong style="font-size:27px">${fmtWeight(max)} <span class="subtle">${esc(isTimed(ex)?ex.measure:unit())}</span></strong></div>
  <div class="right"><div class="subtle tiny">FIRST → LATEST</div><strong>${diff===null?'–':`${diff>0?'+':''}${diff} ${esc(isTimed(ex)?ex.measure:unit())}`}</strong></div></div>
  ${svgChart(points,ex)}<p class="subtle small margin-top-sm">Only completed sets count. For unilateral exercises, record the weight in the same way each time (e.g., per dumbbell).</p>`:
  '<div class="empty"><div class="empty-icon">⌁</div><strong>Charts appear after your first logged workout</strong><p>Complete and save a session to start building a progress graph.</p><button class="button sm" data-action="start-plan">Start a workout</button></div>'}`);
}
function backupDue() {
  const baseline=Number(state.settings.lastBackupWorkoutCount)||0;
  return state.history.length>=3 && (state.history.length-baseline>=7 || !state.settings.lastBackupAt);
}
function lastDoneSet() {
  if(!state.active)return null;
  const all=state.active.items.flatMap(item=>item.sets.filter(set=>set.done).map(set=>({item,set})));
  const withTime=all.filter(x=>x.set.completedAt).sort((a,b)=>String(b.set.completedAt).localeCompare(String(a.set.completedAt)));
  return withTime[0] || (lastSetAction ? all.find(x=>x.item.id===lastSetAction.itemId&&x.set.id===lastSetAction.setId) : null);
}
function focusExercise(itemId) {
  const item=itemById(itemId);if(!item)return;
  const set=item.sets.find(x=>!x.done);
  if(!set){toast('All sets for that exercise are complete');return;}
  focusedSetKey=`${item.id}:${set.id}`;closeSheet();render();
  document.querySelector('.quick-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function showExerciseJump() {
  const items=state.active?.items || [];
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">Which exercise next?</h2><p class="subtle small">Jump around freely. Your sets stay saved.</p></div><button class="micro-btn" data-action="close-sheet">✕</button></div><div class="picker-options">${items.map(item=>{const e=exById(item.exerciseId),remain=item.sets.filter(s=>!s.done).length;return `<button class="picker-option" data-action="focus-exercise" data-item="${esc(item.id)}" ${!remain?'disabled':''}><div><strong>${esc(e.name)}</strong><span>${item.sets.length-remain}/${item.sets.length} sets done</span></div><span>${remain?'→':'✓'}</span></button>`;}).join('')}</div>`);
}
function undoLastSet() {
  const recent=lastDoneSet();if(!recent){toast('No completed sets to undo');return;}
  recent.set.done=false;recent.set.completedAt=null;
  focusedSetKey=`${recent.item.id}:${recent.set.id}`;
  state.active.restUntil=null;lastSetAction=null;persist();render();toast('Last set undone');
}
function renderMore() {
  const custom=state.exercises.filter(e=>e.custom).length;
  return pageShell(`<div class="eyebrow">LIFTLOG 4.3.1 · ON THIS DEVICE</div><h1 class="page-title">Settings & backup</h1><p class="subtle margin-bottom">Your workouts save on this phone. Share a file when you want ChatGPT to review them.</p>
    <div class="stack">${backupDue()?'<div class="notice warn">Backup recommended: you have new workouts saved only on this iPhone. Export your JSON backup to Files.</div>':''}<div class="card"><h2 class="section-title margin-bottom">Workout defaults</h2>
      <div class="input-row"><label for="location-select">Equipment</label><select id="location-select" data-action="settings-location"><option value="gym" ${state.settings.location==='gym'?'selected':''}>Full gym</option><option value="small" ${state.settings.location==='small'?'selected':''}>Small gym</option></select></div><div class="divider"></div>
      <div class="input-row"><label for="unit-select">Weight units</label><select id="unit-select" data-action="settings-unit"><option value="lb" ${unit()==='lb'?'selected':''}>Pounds (lb)</option><option value="kg" ${unit()==='kg'?'selected':''}>Kilograms (kg)</option></select></div><div class="divider"></div>
      <div class="input-row"><label for="rest-select">Rest timer</label><select id="rest-select" data-action="settings-rest">${[0,60,90,120,180].map(v=>`<option value="${v}" ${state.settings.restSeconds===v?'selected':''}>${v===0?'Off':`${v} seconds`}</option>`).join('')}</select></div></div>
    <div class="card"><h2 class="section-title margin-bottom">Your routines</h2><p class="subtle">Save a workout as a routine to reuse its exercise order and individual sets. Your latest logged values take priority next time.</p>${state.templates.length?state.templates.map(t=>`<div class="routine-row"><div class="grow"><strong>${esc(t.name)}</strong><div class="subtle small">${t.items.length} exercises</div></div><button class="button danger sm" data-action="delete-template" data-id="${esc(t.id)}">Delete</button></div>`).join(''):'<p class="subtle">None saved yet. Open a workout and tap Save as reusable routine.</p>'}</div>
    <div class="card"><h2 class="section-title margin-bottom">Exercise library</h2><p class="subtle">${state.exercises.length} exercises (${custom} custom). Add movements that aren't in the starter library.</p><div class="row margin-top-sm"><button class="button dark sm" data-action="library">Browse exercises</button><button class="button sm" data-action="custom-exercise">+ Custom exercise</button></div></div>
    <div class="card"><h2 class="section-title margin-bottom">Work with ChatGPT</h2><p class="subtle">Share a backup containing your full history, exercises, routines and current workout. Choose ChatGPT if available in the share sheet, or save the file to Files and attach it in your chat. ChatGPT receives only the snapshot you send. You can import a suggested routine below.</p><div class="stack"><button class="button full" data-action="share-backup">Share backup</button><button class="button dark full" data-action="share-coach">Share short summary</button><button class="button dark full" data-action="copy-coach">Copy summary</button></div></div>
    <div class="card"><h2 class="section-title margin-bottom">Import plans from ChatGPT</h2><p class="subtle">I can generate a routine in a simple format that you paste here. It becomes a reusable routine; it never changes completed workouts.</p><button class="button dark full" data-action="show-plan-import">Import a routine</button></div>
    <div class="card"><h2 class="section-title margin-bottom">Your data</h2><p class="subtle">Back up to the Files app regularly, especially before changing phones or clearing Safari website data.</p>
      <div class="stack"><button class="button dark full" data-action="export-json">Export complete backup (.json)</button><button class="button dark full" data-action="export-csv">Export sets as spreadsheet (.csv)</button><button class="button ghost full" data-action="import-json">Restore from JSON backup</button><button class="button ghost full" data-action="export-previous">Download data from before last restore</button></div></div>
    <div class="card"><h2 class="section-title margin-bottom">Keep LiftLog on your Home Screen</h2><p class="subtle">Open this address in Safari, tap Share, then Add to Home Screen. To load a new version, close all LiftLog windows and reopen while online. Your saved history stays on this device.</p></div>
    <div class="notice">Offline after the app has been opened online at least once. Your workout history saves immediately in browser storage. Sharing a file does not create an automatic cloud backup. iOS may remove website data under some circumstances, so keep a backup.</div>
    <div class="card"><h2 class="section-title margin-bottom">Reset</h2><p class="subtle">Permanently clear workouts, custom exercises, and preferences from this app on this device.</p><button class="button danger sm" data-action="reset">Erase all local data</button></div></div>`);
}
function formatCountdown(ms) {const sec=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function updateRestDisplay() {
  const w=state.active;if(!w || !w.restUntil || tab!=='workout')return;
  const node=document.getElementById('rest-countdown');
  if(w.restUntil<=Date.now()) {w.restUntil=null;persist();if(document.getElementById('rest-banner'))render();return;}
  if(node)node.textContent=formatCountdown(w.restUntil-Date.now());
}
setInterval(updateRestDisplay,1000);

function showSheet(inner) {
  sheetRoot.innerHTML=`<div class="sheet-backdrop" data-action="close-sheet"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="Options"><div class="sheet-handle"></div>${inner}</section>`;
  sheetRoot.classList.add('open');
}
function closeSheet() {sheetRoot.innerHTML='';sheetRoot.classList.remove('open');}
function showPicker(mode='add',target=null) {
  pickerMode=mode;pickerTarget=target;
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">${mode==='replace'?'Replace exercise':'Add an exercise'}</h2><p class="subtle small">Search the library or add your own movement.</p></div><button class="micro-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
    <input type="search" id="exercise-search" data-action="exercise-search" class="filter-input" placeholder="Search exercises…" autocomplete="off" aria-label="Search exercises">
    <div class="picker-options" id="picker-options"></div><button class="button dark full" data-action="custom-exercise">+ Create a custom exercise</button>`);
  refreshPicker('');
}
function refreshPicker(search) {
  const holder=document.getElementById('picker-options');if(!holder)return;
  const q=search.toLowerCase().trim(); const matches=state.exercises.filter(e=>(e.name+' '+e.category+' '+e.equipment).toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  holder.innerHTML=matches.length?matches.map(e=>`<button class="picker-option" data-action="select-exercise" data-id="${esc(e.id)}"><div><strong>${esc(e.name)}</strong><span>${esc(e.category)} · ${esc(e.equipment)}</span></div><span style="color:var(--mint);font-size:20px">+</span></button>`).join(''):'<p class="subtle">No matches. Create a custom exercise below.</p>';
}
function showExerciseMenu(itemId) {
  const item=state.active?.items.find(i=>i.id===itemId);if(!item)return;const ex=exById(item.exerciseId);
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">${esc(ex.name)}</h2><p class="subtle">Manage this exercise in today's workout.</p></div><button class="micro-btn" data-action="close-sheet">✕</button></div>
  <div class="stack margin-top"><button class="button dark full" data-action="replace-exercise" data-item="${esc(itemId)}">Swap for another exercise</button><button class="button danger full" data-action="remove-exercise" data-item="${esc(itemId)}">Remove from workout</button></div>`);
}
function showWeightStepPicker(exId) {
  const ex=exById(exId);
  const selected=weightStep(ex);
  const options=WEIGHT_STEPS[unit()];
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">Weight increments</h2><p class="subtle">${esc(ex.name)} · choose the step your gym's equipment actually supports. Remembered for this exercise.</p></div><button class="micro-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
  <div class="step-choice-grid margin-top">${options.map(step=>`<button class="step-choice ${step===selected?'active':''}" data-action="set-weight-step" data-id="${esc(exId)}" data-step="${step}" aria-label="Adjust by ${step} ${esc(unit())}">${esc(fmtWeight(step))} <small>${esc(unit())}</small>${step===selected?' <span aria-hidden="true">✓</span>':''}</button>`).join('')}</div>
  <p class="subtle small margin-top">For unusual loads such as 6 or 7 ${esc(unit())}, tap the large weight number to enter any exact value. The +/− buttons then move by your selected step.</p>`);
}
function showEditSet(itemId,setId) {
  const item=itemById(itemId),set=item?.sets.find(x=>x.id===setId);
  if(!set)return;
  const ex=exById(item.exerciseId),timed=isTimed(ex);
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">${esc(ex.name)}</h2><p class="subtle">${isCardio(ex)?'Log your duration and any readings you have.':`Edit set ${item.sets.indexOf(set)+1}. Saved weights stay independent for every set.`}</p></div><button class="micro-btn" data-action="close-sheet">✕</button></div>
    <div class="field-grid margin-top">${!timed?`<div class="field"><label for="set-edit-weight">Weight (${esc(unit())})</label><input id="set-edit-weight" type="number" inputmode="decimal" min="0" step="any" value="${esc(set.weight)}" placeholder="Weight"></div>`:''}
    <div class="field"><label for="set-edit-reps">${esc(timed?'Duration · '+ex.measure:'Repetitions')}</label><input id="set-edit-reps" type="number" inputmode="${timed?'decimal':'numeric'}" min="0" step="${timed?'any':'1'}" value="${esc(set.reps)}"></div></div>
    ${isCardio(ex)?cardioFields(set):''}
    <div class="stack margin-top"><button class="button full" data-action="save-edit-set" data-item="${esc(itemId)}" data-set="${esc(setId)}">Save values</button></div>`);
}
function saveEditSet(itemId,setId) {
  const item=itemById(itemId),set=item?.sets.find(s=>s.id===setId);if(!set)return;
  const ex=exById(item.exerciseId),timed=isTimed(ex);
  const reps=document.getElementById('set-edit-reps')?.value ?? '';
  const weight=timed?'':(document.getElementById('set-edit-weight')?.value??'');
  if(reps!=='' && (!Number.isFinite(Number(reps))||(!timed&&!Number.isInteger(Number(reps)))||Number(reps)<0)) {toast(timed?'Enter a nonnegative duration':'Enter nonnegative whole-number reps');return;}
  let details;if(isCardio(ex)){try{details=readCardioFields();}catch(err){toast(err.message,5000);return;}}
  if(!timed && weight!=='' && (!Number.isFinite(Number(weight))||Number(weight)<0)) {toast('Enter a valid weight');return;}
  const fillRest=!timed&&set.weight===''&&weight!=='';
  set.weight=weight;set.reps=reps;if(details)set.cardio=details;
  // When a new exercise has no recorded loads yet, fill blank remaining sets
  // with the first entered weight. Already filled or completed sets stay untouched.
  if(fillRest)for(const other of item.sets)if(!other.done && other.weight==='')other.weight=weight;
  persist();closeSheet();render();
}
function showWorkoutMeta() {
  const w=state.active;if(!w)return;
  showSheet(`<div class="sheet-top"><h2 class="sheet-title">Workout details</h2><button class="micro-btn" data-action="close-sheet">✕</button></div>
  <div class="stack margin-top"><div class="field"><label for="workout-title">Name</label><input id="workout-title" maxlength="90" value="${esc(w.title)}"></div>
  <div class="field"><label for="workout-date">Date</label><input id="workout-date" type="date" value="${esc(w.date)}"></div>
  <button class="button full" data-action="save-meta">Save details</button></div>`);
}
function showCustomExercise() {
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">New exercise</h2><p class="subtle small">Your custom exercise is saved to this device.</p></div><button class="micro-btn" data-action="close-sheet">✕</button></div>
    <div class="stack margin-top"><div class="field"><label for="custom-name">Exercise name</label><input id="custom-name" maxlength="80" placeholder="e.g. Cable reverse fly"></div>
    <div class="field-grid"><div class="field"><label for="custom-category">Muscle group</label><select id="custom-category"><option>Lower body</option><option>Hamstrings</option><option>Back</option><option>Chest</option><option>Shoulders</option><option>Arms</option><option>Core</option><option>Cardio</option><option>Other</option></select></div>
    <div class="field"><label for="custom-equipment">Equipment</label><select id="custom-equipment"><option>Dumbbells</option><option>Machines</option><option>Barbell</option><option>Bodyweight</option><option>Band/bodyweight</option><option>Cardio</option><option>Other</option></select></div></div>
    <div class="field-grid"><div class="field"><label for="custom-measure">Tracked as</label><select id="custom-measure"><option value="reps">Weight & reps</option><option value="minutes">Minutes</option><option value="seconds">Seconds</option></select></div>
    <div class="field"><label for="custom-sets">Default sets</label><input id="custom-sets" type="number" inputmode="numeric" min="1" max="12" value="3"></div></div>
    <button class="button full" data-action="save-custom">Save exercise</button></div>`);
}
function showLibrary() {
  const items=[...state.exercises].sort((a,b)=>a.name.localeCompare(b.name));
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">Exercise library</h2><p class="subtle small">${items.length} movements available.</p></div><button class="micro-btn" data-action="close-sheet">✕</button></div>
  <div class="picker-options">${items.map(e=>`<div class="exercise-library-item"><div><strong>${esc(e.name)}</strong><span>${esc(e.category)} · ${esc(e.equipment)}${e.custom?' · Custom':''}</span></div>${e.custom?`<button class="button danger sm" data-action="delete-custom" data-id="${esc(e.id)}">Delete</button>`:''}</div>`).join('')}</div>
  <button class="button full" data-action="custom-exercise">+ New custom exercise</button>`);
}
function itemById(id) {return state.active?.items.find(i=>i.id===id);}
function markSet(itemId,setId) {
  const s=itemById(itemId)?.sets.find(s=>s.id===setId);if(!s)return;
  if(!s.done && (!s.reps || Number(s.reps)<=0)) {toast('Enter reps or duration before marking done');showEditSet(itemId,setId);return;}
  const ex=exById(itemById(itemId).exerciseId);
  if(!s.done && !isTimed(ex) && !['Bodyweight','Band/bodyweight'].includes(ex.equipment) && s.weight==='') {
    toast('Enter the weight for this first set');showEditSet(itemId,setId);return;
  }
  s.done=!s.done;
  s.completedAt=s.done?new Date().toISOString():null;
  lastSetAction=s.done?{itemId,setId}:null;
  state.active.restUntil=s.done && !isCardio(ex) && Number(state.settings.restSeconds)>0 ? Date.now()+Number(state.settings.restSeconds)*1000 : null;
  focusedSetKey=null;persist();render();
}
function finishWorkout() {
  const w=state.active;if(!w)return;
  if(!w.items.length) {toast('Add an exercise first');return;}
  if(!doneSets(w).length && !confirm('No sets are marked complete. Save this workout anyway?'))return;
  const record=deepCopy(w);record.endedAt=new Date().toISOString();record.restUntil=null;
  delete record.editingId;
  if(w.editingId){const idx=state.history.findIndex(s=>s.id===w.editingId);if(idx>=0){record.id=w.editingId;state.history[idx]=record;}else state.history.push(record);}
  else state.history.push(record);
  if(!w.editingId && record.planKey)delete state.settings.planChoices[record.location];
  state.active=null;focusedSetKey=null;historyOpen=record.id;const saved=persist();setTab('history');toast(saved?(w.editingId?'Workout changes saved':'Workout saved — nice work'):'Workout is in memory only — export a backup before closing',6500);
}
function editHistory(id) {
  const s=state.history.find(s=>s.id===id);if(!s)return;
  if(state.active && !confirm('Discard your unfinished workout to edit this saved session?'))return;
  state.active=deepCopy(s);focusedSetKey=null;state.active.editingId=id;state.active.restUntil=null;
  persist();setTab('workout');
}
function changeUnits(next) {
  if(!['lb','kg'].includes(next) || next===unit())return;
  const old=unit();
  const factor=old==='lb'?1/2.2046226218:2.2046226218;
  if(!confirm(`Convert all recorded and in-progress weights from ${old} to ${next}? This also changes the displayed unit.`)) {render();return;}
  for(const session of [...state.history,...state.templates,...(state.active?[state.active]:[])])for(const item of session.items||[])for(const s of item.sets||[]){
    if(s.weight!==''&&s.weight!==null&&Number.isFinite(Number(s.weight)))s.weight=String(roundWeight(Number(s.weight)*factor));
  }
  state.settings.unit=next;persist();render();toast('Weights converted to '+next);
}
function csvCell(value) { const raw=String(value??'');const safe=/^[\s]*[=+@-]|^[\t\r\n]/.test(raw)?'\''+raw:raw; return '"'+safe.replace(/"/g,'""')+'"';}
function downloadBlob(filename,content,mime) {
  const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function exportJSON() {
  state.settings.lastBackupWorkoutCount=state.history.length;state.settings.lastBackupAt=new Date().toISOString();persist();
  downloadBlob('LiftLog-backup-'+localDate()+'.json',JSON.stringify(state,null,2),'application/json');
  toast('Backup prepared — make sure to save it to Files');
}
async function shareBackup() {
  const filename='LiftLog-backup-'+localDate()+'.json';
  const content=JSON.stringify(state,null,2);
  try {
    const file=new File([content],filename,{type:'application/json'});
    if(navigator.share&&navigator.canShare?.({files:[file]})){
      await navigator.share({files:[file],title:'LiftLog workout backup'});
      toast('Share sheet closed. Confirm the file was attached in your chat.');
      return;
    }
  }catch(err){if(err.name==='AbortError')return;}
  downloadBlob(filename,content,'application/json');
  toast('Save the backup to Files, then attach it in ChatGPT.',6500);
}
function exportRecovery() {
  try {
    const raw=localStorage.getItem(STORAGE_KEY)??recoveryRaw;
    if(raw===null){toast('No saved database is available');return;}
    downloadBlob('LiftLog-recovery-'+localDate()+'.json',raw,'application/json');
    toast('Saved data prepared — save it to Files');
  }catch(err){toast('Could not read saved data: '+err.message,5000);}
}
function exportPreviousBackup() {
  try {
    const raw=localStorage.getItem(STORAGE_KEY+'.beforeRestore');
    if(raw===null){toast('No previous restore backup is available');return;}
    downloadBlob('LiftLog-before-restore-'+localDate()+'.json',raw,'application/json');
    toast('Previous saved data prepared — save it to Files');
  }catch(err){toast('Could not read the previous backup: '+err.message,5000);}
}
function exportCSV() {
  const rows=[['date','workout','exercise','set_number','weight','unit','reps_or_duration','measurement','completed','workout_notes','exercise_notes','distance','distance_unit','speed','speed_unit','incline_percent','machine_level','floors','effort_1_to_10','average_heart_rate_bpm','route_or_machine','measurement_source']];
  for(const w of sessionsSorted())for(const i of w.items||[]){const e=exById(i.exerciseId);(i.sets||[]).forEach((s,k)=>rows.push([w.date,w.title,e.name,k+1,isTimed(e)?'':s.weight,unit(),s.reps,e.measure,s.done?'yes':'no',w.notes||'',i.note||'',s.cardio?.distance??'',s.cardio?.distanceUnit??'',s.cardio?.speed??'',s.cardio?.speedUnit??'',s.cardio?.incline??'',s.cardio?.level??'',s.cardio?.floors??'',s.cardio?.effort??'',s.cardio?.avgHeartRate??'',s.cardio?.benchmark??'',s.cardio?.source??'']));}
  downloadBlob('LiftLog-sets-'+localDate()+'.csv',rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('CSV prepared — save it to Files');
}
function coachSummary() {
  const lines=['LiftLog workout history (recorded data; units '+unit()+').',
    'Equipment: '+(state.settings.location==='small'?'small/travel gym':'full gym')+'; target session length: '+state.settings.sessionMinutes+' min.',
    'Total logged sessions: '+state.history.length+'.',
    'Please base recommendations on the recorded sets, and distinguish plans from logged data.'];
  function formatSession(w,prefix){
    lines.push(prefix+': '+w.date+' | '+w.title+(w.notes?' | Notes: '+w.notes:''));
    for(const item of w.items||[]){
      const e=exById(item.exerciseId),sets=item.sets.filter(s=>s.done);
      if(sets.length)lines.push('  '+e.name+': '+sets.map(s=>isCardio(e)?cardioSetSummary(s,e):isTimed(e)?`${s.reps} ${e.measure}`:`${s.weight===''?'BW':s.weight} ${unit()} × ${s.reps}`).join(' ; ')+(item.note?' | '+item.note:''));
    }
  }
  if(state.active)formatSession(state.active,'In progress');
  for(const w of sessionsSorted().slice(0,15))formatSession(w,'Completed');
  if(state.activityDays?.length)lines.push('Recent daily step totals (Apple Fitness, manually entered; already include walks): '+[...state.activityDays].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7).map(d=>d.date+': '+d.steps).join('; '));
  if(!state.history.length&&!state.active)lines.push('No recorded workouts yet.');
  return lines.join('\n');
}
async function shareForChatGPT() {
  const summary=coachSummary();
  if(navigator.share) {
    try {await navigator.share({title:'My LiftLog workouts',text:summary});return;}
    catch(err){if(err.name==='AbortError')return;}
  }
  await copyForChatGPT();
}
async function copyForChatGPT() {
  const text=coachSummary();
  try {
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
    else {const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.top='0';document.body.appendChild(t);t.select();if(!document.execCommand('copy'))throw Error('Copy not supported');t.remove();}
    toast('Copied. Paste into your ChatGPT conversation.',4500);
  }catch(err){showSheet(`<div class="sheet-top"><h2 class="sheet-title">Copy this for ChatGPT</h2><button class="micro-btn" data-action="close-sheet">✕</button></div><textarea rows="14" readonly style="width:100%;min-height:240px">${esc(text)}</textarea><p class="subtle small">Select all, copy, and paste into ChatGPT.</p>`);}
}
// Validate the complete backup before confirmation or any storage mutation.
function validateBackup(d) {
  const fail=()=>{throw Error('Invalid or incomplete LiftLog backup');};
  const obj=x=>x && typeof x==='object' && !Array.isArray(x);
  const text=x=>typeof x==='string';
  const ids=new Set();
  const id=x=>{if(!text(x)||!x||['__proto__','constructor','prototype'].includes(x)||ids.has(x))fail();ids.add(x);};
  const numeric=x=>x==='' || ((typeof x==='string'||typeof x==='number') && Number.isFinite(Number(x)) && Number(x)>=0);
  const strings=(o,keys)=>{for(const key of keys)if(o[key]!=null&&!text(o[key]))fail();};
  if(!obj(d)||d.schema!==1||!obj(d.settings)||!['lb','kg'].includes(d.settings.unit)||!Array.isArray(d.history)||!Array.isArray(d.exercises))fail();
  if(d.settings.planChoices!=null && (!obj(d.settings.planChoices)||Object.values(d.settings.planChoices).some(key=>!text(key))))fail();
  validateActivityDays(d.activityDays);
  const checkItems=(items,routine=false)=>{
    if(!Array.isArray(items))fail();
    for(const i of items){
      if(!obj(i)||!text(i.exerciseId)||!Array.isArray(i.sets))fail();
      strings(i,['note']);
      if(!routine)id(i.id);
      for(const s of i.sets){if(!obj(s)||!numeric(s.weight)||!numeric(s.reps)||s.done!=null&&typeof s.done!=='boolean')fail();strings(s,['completedAt']);validateCardio(s.cardio);if(!routine)id(s.id);}
    }
  };
  for(const e of d.exercises){
    if(!obj(e)||!text(e.name)||!e.name)fail();id(e.id);
    strings(e,['category','equipment','measure']);
    if(e.measure!=null&&!['reps','seconds','minutes'].includes(e.measure))fail();
    for(const key of ['defaultSets','defaultReps','increment','incrementKg'])if(e[key]!=null&&!numeric(e[key]))fail();
    if(e.defaultSets!=null&&(!Number.isInteger(Number(e.defaultSets))||Number(e.defaultSets)<1||Number(e.defaultSets)>16))fail();
  }
  const checkWorkout=w=>{if(!obj(w)||!text(w.date)||!text(w.title))fail();strings(w,['startedAt','endedAt','notes','location']);checkItems(w.items);};
  for(const w of d.history){if(!obj(w))fail();id(w.id);checkWorkout(w);}
  // Active edits intentionally reuse the saved workout's item/set IDs.
  if(d.active!=null){if(!obj(d.active)||!text(d.active.id))fail();const saved=new Set(ids);ids.clear();id(d.active.id);checkWorkout(d.active);ids.clear();for(const x of saved)ids.add(x);}
  if(d.templates!==undefined){if(!Array.isArray(d.templates))fail();for(const t of d.templates){if(!obj(t)||!text(t.name))fail();id(t.id);checkItems(t.items,true);}}
  if(d.sync!=null){
    if(!obj(d.sync))fail();
    for(const key of ['deletedWorkoutIds','deletedExercisesIds','deletedTemplatesIds'])if(d.sync[key]!=null&&(!Array.isArray(d.sync[key])||d.sync[key].some(x=>!text(x))))fail();
    if(d.sync.baseline!=null&&!obj(d.sync.baseline))fail();
  }
  if(d.remotePlans!=null){
    if(!obj(d.remotePlans))fail();
    for(const plans of Object.values(d.remotePlans)){
      if(!Array.isArray(plans))fail();
      for(const plan of plans)if(!obj(plan)||!text(plan.key)||!text(plan.name)||!Array.isArray(plan.ids)||plan.ids.some(x=>!text(x)))fail();
    }
  }
  return d;
}

function importBackup(file) {
  if(!writerReady)return;
  if(!file)return;if(file.size>8*1024*1024){toast('Backup is too large (limit: 8 MB)');return;}
  const reader=new FileReader();reader.onload=()=>{
    try {
      const imported=JSON.parse(reader.result);
      if(!writerReady)throw Error(writerMessage);
      validateBackup(imported);
      if(!confirm(`Restore ${imported.history.length} workouts? This REPLACES everything currently stored on this device.`))return;
      // Preserve the exact old database before replacing it; failure aborts restore.
      const previous=localStorage.getItem(STORAGE_KEY);
      if(previous!==null)localStorage.setItem(STORAGE_KEY+'.beforeRestore',previous);
      delete imported.sync; // Old baselines and pending deletions must never replay.
      delete imported.remotePlans;
      const replacement=hydrateState(imported);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(replacement));
      state=replacement;recoveryRequired=false;recoveryPending=false;
      if(!Array.isArray(state.active?.items) && state.active)state.active=null;
      persist();historyOpen=null;progressExercise=null;setTab('today');toast('Backup restored successfully');
    }catch(err){toast('Could not restore: '+err.message,5000);}
  };reader.onerror=()=>toast('Could not read that file');reader.readAsText(file);
}
function saveCustom() {
  const name=document.getElementById('custom-name')?.value.trim();
  if(!name){toast('Enter an exercise name');document.getElementById('custom-name')?.focus();return;}
  const measure=document.getElementById('custom-measure').value;
  const defaultSets=Math.max(1,Math.min(12,parseInt(document.getElementById('custom-sets').value,10)||3));
  const e={id:uid('custom'),name,category:document.getElementById('custom-category').value,equipment:document.getElementById('custom-equipment').value,measure,defaultSets,defaultReps:measure==='minutes'?10:measure==='seconds'?30:10,increment:5,custom:true};
  state.exercises.push(e);
  if(state.active && tab==='workout'){
    if(pickerMode==='replace'&&pickerTarget){const item=itemById(pickerTarget);if(item){item.exerciseId=e.id;item.sets=createItem(e.id).sets;item.note='';}}
    else state.active.items.push(createItem(e.id));
  }
  persist();closeSheet();render();toast('Custom exercise added');
}
function safeReset() {
  if(!writerReady)return;
  if(!confirm('Erase ALL your saved workouts and custom exercises from this device? Export a backup first.'))return;
  if(!confirm('Final confirmation: this cannot be undone without a backup.'))return;
  try {
    const replacement=emptyState();
    // A failed write must not unlock the recovery screen or claim success.
    localStorage.setItem(STORAGE_KEY,JSON.stringify(replacement));
    localStorage.removeItem(STORAGE_KEY+'.beforeRestore');
    state=replacement;recoveryRequired=false;recoveryPending=false;
    persist();historyOpen=null;progressExercise=null;closeSheet();setTab('today');toast('All local data erased');
  }catch(err){toast('Could not erase local data: '+err.message,5000);}
}

// Event delegation keeps inputs responsive on iOS (no re-render while typing).
document.addEventListener('click',event=>{
  const tabButton=event.target.closest('[data-tab]');if(tabButton){setTab(tabButton.dataset.tab);return;}
  const b=event.target.closest('[data-action]');if(!b)return;
  const action=b.dataset.action,id=b.dataset.id,itemId=b.dataset.item;
  if(action==='reload-app'){location.reload();return;}
  if(!writerReady&&action!=='export-recovery')return;
  if(recoveryPending)return;
  if(recoveryRequired&&!['export-recovery','import-json','reset'].includes(action))return;
  if(action==='export-recovery'){exportRecovery();return;}
  if(action==='close-sheet'){closeSheet();return;}
  if(action==='nav'){setTab(b.dataset.value);return;}
  if(action==='location'){state.settings.location=b.dataset.value;persist();render();return;}
  if(action==='duration'){state.settings.sessionMinutes=Number(b.dataset.value);persist();render();return;}
  if(action==='start-template'){startTemplate(id);return;}
  if(action==='delete-template'){deleteTemplate(id);return;}
  if(action==='save-template'){saveTemplate();return;}
  if(action==='jump-exercise'){showExerciseJump();return;}
  if(action==='focus-exercise'){focusExercise(itemId);return;}
  if(action==='undo-last'){undoLastSet();return;}
  if(action==='cardio-picker'){showCardioPicker();return;}
  if(action==='cardio-log-picker'){showCardioPicker(true);return;}
  if(action==='log-cardio'){showSeparateCardioLog(id);return;}
  if(action==='save-cardio-log'){saveSeparateCardioLog();return;}
  if(action==='select-cardio'){addCardio(id);return;}
  if(action==='save-steps'){saveActivitySteps();return;}
  if(action==='start-plan'){startWorkout('plan');return;}
  if(action==='show-plan-picker'){showPlanPicker();return;}
  if(action==='select-plan'){choosePlan(b.dataset.key);return;}
  if(action==='repeat-last'){repeatLastWorkout();return;}
  if(action==='start-blank'){startWorkout('blank');return;}
  if(action==='continue'){setTab('workout');return;}
  if(action==='pick-exercise'){showPicker();return;}
  if(action==='exercise-menu'){showExerciseMenu(itemId);return;}
  if(action==='replace-exercise'){showPicker('replace',itemId);return;}
  if(action==='select-exercise'){
    if(!state.active){closeSheet();return;}
    if(pickerMode==='replace' && pickerTarget){const item=itemById(pickerTarget);if(item){item.exerciseId=id;item.sets=createItem(id).sets;item.note='';}}
    else state.active.items.push(createItem(id));
    persist();closeSheet();render();toast('Exercise added');return;
  }
  if(action==='remove-exercise'){
    if(!state.active)return;
    const item=itemById(itemId);if(!item)return;
    if(item.sets.some(s=>s.done) && !confirm('Remove this exercise and its completed sets?'))return;
    state.active.items=state.active.items.filter(i=>i.id!==itemId);persist();closeSheet();render();return;
  }
  if(action==='move-up'||action==='move-down'){
    const index=state.active?.items.findIndex(i=>i.id===itemId) ?? -1;if(index<0)return;
    const target=index+(action==='move-up'?-1:1);if(target<0||target>=state.active.items.length)return;
    const arr=state.active.items;[arr[index],arr[target]]=[arr[target],arr[index]];persist();render();return;
  }
  if(action==='add-set'){
    const item=itemById(itemId);if(!item)return;
    const previous=item.sets[item.sets.length-1]||{};
    item.sets.push({id:uid('set'),weight:String(previous.weight??''),reps:String(previous.reps??exById(item.exerciseId).defaultReps),done:false,...(isCardio(exById(item.exerciseId))?{cardio:cardioDefaults()}:{})});persist();render();return;
  }
  if(action==='remove-set'){
    const item=itemById(itemId);if(!item||item.sets.length<=1)return;
    const last=item.sets[item.sets.length-1];if(last.done&&!confirm('Remove the last completed set?'))return;
    item.sets.pop();persist();render();return;
  }
  if(action==='toggle-set'){markSet(itemId,b.dataset.set);return;}
  if(action==='quick-complete'){const f=getFocusedSet();if(f)markSet(f.item.id,f.set.id);return;}
  if(action==='choose-weight-step'){showWeightStepPicker(id);return;}
  if(action==='set-weight-step'){
    const ex=state.exercises.find(x=>x.id===id);
    const n=Number(b.dataset.step);
    if(!ex||!WEIGHT_STEPS[unit()].includes(n))return;
    if(unit()==='kg')ex.incrementKg=n;else ex.increment=n;
    persist();closeSheet();render();return;
  }
  if(action==='quick-adjust'){
    const f=getFocusedSet();if(!f)return;
    const field=b.dataset.field,delta=Number(b.dataset.delta);
    if(!['weight','reps'].includes(field)||![-1,1].includes(delta))return;
    const ex=exById(f.item.exerciseId);
    const amount=field==='reps'?1:weightStep(ex);
    const current=f.set[field]===''?0:Number(f.set[field]);
    f.set[field]=String(field==='weight'?roundWeight(Math.max(0,current+delta*amount)):Math.max(0,current+delta));
    persist();render();return;
  }
  if(action==='edit-set'){showEditSet(itemId,b.dataset.set);return;}
  if(action==='save-edit-set'){saveEditSet(itemId,b.dataset.set);return;}
  if(action==='finish'){finishWorkout();return;}
  if(action==='discard'){
    if(state.active && confirm(state.active.editingId?'Cancel edits to this saved session?':'Discard this unfinished workout?')){state.active=null;persist();setTab('today');}return;
  }
  if(action==='skip-rest'){state.active.restUntil=null;persist();render();return;}
  if(action==='edit-meta'){showWorkoutMeta();return;}
  if(action==='save-meta'){
    const name=document.getElementById('workout-title')?.value.trim();const date=document.getElementById('workout-date')?.value;
    if(!name||!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast('Enter a name and valid date');return;}
    state.active.title=name;state.active.date=date;persist();closeSheet();render();return;
  }
  if(action==='toggle-history'){historyOpen=historyOpen===id?null:id;render();return;}
  if(action==='edit-history'){editHistory(id);return;}
  if(action==='delete-history'){
    if(confirm('Permanently delete this workout from the phone?')){state.history=state.history.filter(s=>s.id!==id);historyOpen=null;persist();render();toast('Workout deleted');}return;
  }
  if(action==='library'){showLibrary();return;}
  if(action==='custom-exercise'){showCustomExercise();return;}
  if(action==='save-custom'){saveCustom();return;}
  if(action==='delete-custom'){
    if(!confirm('Delete this custom exercise from the library?'))return;
    const used=[...state.history,...state.templates,...(state.active?[state.active]:[])].some(s=>s.items.some(i=>i.exerciseId===id));
    if(used){toast('Exercise is used by a workout or routine; cannot delete');return;}
    state.exercises=state.exercises.filter(e=>e.id!==id);persist();showLibrary();return;
  }
  if(action==='copy-coach'){copyForChatGPT();return;}
  if(action==='share-coach'){shareForChatGPT();return;}
  if(action==='share-backup'){shareBackup();return;}
  if(action==='show-plan-import'){showPlanImporter();return;}
  if(action==='copy-plan-format'){copyPlanRequest();return;}
  if(action==='import-plan'){importSuggestedPlan();return;}
  if(action==='export-json'){exportJSON();return;}
  if(action==='export-previous'){exportPreviousBackup();return;}
  if(action==='export-csv'){exportCSV();return;}
  if(action==='import-json'){document.getElementById('backup-file').click();return;}
  if(action==='reset'){safeReset();return;}
});
document.addEventListener('input',event=>{
  if(!writerReady||recoveryRequired||recoveryPending)return;
  const target=event.target; const action=target.dataset.action;
  if(action==='exercise-search'){refreshPicker(target.value);return;}
  if(action==='set-field'){
    const item=itemById(target.dataset.item),s=item?.sets.find(s=>s.id===target.dataset.set);
    if(!s)return;
    const raw=target.value;
    if(raw!=='' && (!Number.isFinite(Number(raw))||Number(raw)<0))return;
    s[target.dataset.field]=raw;persist();return;
  }
  if(action==='workout-notes'&&state.active){state.active.notes=target.value;persist();return;}
  if(action==='exercise-note'){const item=itemById(target.dataset.item);if(item){item.note=target.value;persist();}return;}
});
document.addEventListener('change',event=>{
  const t=event.target;
  if(t.id==='backup-file'){importBackup(t.files?.[0]);t.value='';return;}
  if(!writerReady||recoveryRequired||recoveryPending)return;
  const action=t.dataset.action;
  if(t.id==='steps-date'){const input=document.getElementById('steps-count');if(input)input.value=state.activityDays.find(d=>d.date===t.value)?.steps??'';return;}
  if(action==='cardio-comparison'){cardioComparisonKey=t.value;render();return;}
  if(action==='cardio-metric'&&['minutes','pace','paceMiles','avgHeartRate','effort'].includes(t.value)){cardioMetric=t.value;render();return;}
  if(action==='progress-exercise'){progressExercise=t.value;render();return;}
  if(action==='settings-location'){state.settings.location=t.value;persist();render();return;}
  if(action==='settings-unit'){changeUnits(t.value);return;}
  if(action==='settings-rest'){state.settings.restSeconds=Number(t.value);persist();render();toast('Rest preference saved');return;}
});
window.addEventListener('visibilitychange',()=>{if(!document.hidden)updateRestDisplay();});
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Offline installer failed:',err)));
}
render();
// The browser releases this exclusive lock when the document closes. A second
// Safari tab or Home Screen window must never save an independent stale snapshot.
if(navigator.locks?.request){
  navigator.locks.request('liftlog.personal.v1.writer',{ifAvailable:true},async lock=>{
    if(!lock){writerMessage='LiftLog is open in another window. Close that window, then tap Try again.';render();return;}
    writerReady=true;recoveryPending=false;state=loadState();
    render();await recoverSecondaryIfNeeded();
    await new Promise(()=>{});
  }).catch(()=>{writerReady=false;writerMessage='Workout storage could not be locked. Reload LiftLog to retry.';render();});
}else{
  writerMessage='This browser cannot safely lock workout storage. Open LiftLog in an updated Safari browser.';render();
}
