'use strict';

// User-supplied standard home-gym program. These are prescriptions, never history.
const HOME_PROGRAM_ID = 'home-two-week-v1';
const HOME_PROGRAM_RULES = [
  'Six training days, then Day 7 off: normal walking and outdoor activity; no required gym work. Follow the session sequence, without resetting on Monday. Adjust around hunting, travel, soreness and symptoms.',
  'Listed sets are working sets; warm-ups are additional. Reassess loads through warm-up sets. Historical loads are references, not mandatory targets.',
  'Main lifts: RPE 7–8, about 2–3 reps left; rest 2–3 minutes. Accessories: RPE 6–8 unless specified; rest 60–90 seconds. Avoid grinding reps.',
  'Unilateral sets/reps apply to each side. Start right-sided hip/balance work first. Prioritize control, usable range and reduced assistance in balance/mobility work before adding load.',
  'Log dumbbell weights per dumbbell and farmer-carry weights per hand. Record machine identity; loads are not comparable across machines.',
  'Modify exercises causing increasing pain or a meaningful next-day flare. No step-downs. Keep exercise selections consistent across cycles.',
  'Record only work actually completed. Mark omitted work skipped. An unfinished session does not require repeating completed exercises.',
  'Double progression: keep the weight until every working set reaches the top of its range with good technique at the prescribed RPE. Then use the smallest practical increase and return toward the bottom of the range. Single-leg RDLs may progress beyond 25 lb.',
  'Farmer carries: build all four rounds to 40 seconds, then increase weight and return toward 30 seconds.'
];
const HOME_FINISHER = '10-minute finish: minutes 0–5 gradually build effort; 5–7 hard but controlled, about RPE 8; 7–10 gradually ease down. Use stairs, bike or elliptical. Do not chase a particular heart rate.';

const PROGRAM_EXERCISES = [
  ['machine-chest-press','Machine chest press','Chest','Machines'],
  ['cable-lateral-raise','Cable lateral raise','Shoulders','Machines'],
  ['rope-pressdown','Rope triceps pressdown','Arms','Machines'],
  ['band-external-rotation','Band external rotation','Shoulders','Band/bodyweight'],
  ['goblet-box-squat','Goblet box squat','Lower body','Dumbbells'],
  ['leg-press-calf-raise','Leg-press calf raise','Lower body','Machines'],
  ['standing-calf-raise','Standing calf raise','Lower body','Machines'],
  ['spanish-squat-hold','Spanish squat hold','Quads','Band/bodyweight','seconds'],
  ['band-hip-flexion','Standing band hip flexion','Lower body','Band/bodyweight'],
  ['hip-cars','Hip CARs','Mobility','Bodyweight'],
  ['balance-reaches','Single-leg balance reaches','Balance','Bodyweight','rounds'],
  ['hip-airplane','Assisted hip airplane','Balance','Bodyweight'],
  ['hip-ir-lift','90/90 active hip internal-rotation lift','Mobility','Bodyweight'],
  ['wall-slide-liftoff','Wall slide with lift-off','Mobility','Bodyweight'],
  ['deep-squat-hold','Comfortable deep-squat hold','Mobility','Bodyweight','seconds'],
  ['hip-flexor-stretch','Half-kneeling hip-flexor stretch','Mobility','Bodyweight','seconds'],
  ['forearm-rotation','Forearm pronation/supination','Arms','Dumbbells'],
  ['neutral-lat-pulldown','Neutral-grip lat pulldown','Back','Machines'],
  ['straight-arm-pulldown','Straight-arm cable pulldown','Back','Machines'],
  ['supported-high-row','Chest-supported high row','Back','Machines'],
  ['cable-y-raise','Cable Y-raise','Shoulders','Machines'],
  ['rear-foot-single-rdl','Rear-foot-supported single-leg DB RDL','Hamstrings','Dumbbells'],
  ['hip-thrust','Hip thrust','Posterior chain','Barbell'],
  ['back-extension-glute','45-degree back extension · glute emphasis','Posterior chain','Bodyweight'],
  ['hamstring-curl','Hamstring curl','Hamstrings','Machines'],
  ['band-lateral-walk','Band lateral walk','Lower body','Band/bodyweight','steps'],
  ['farmer-carry','Farmer carry','Core','Dumbbells','seconds',true],
  ['dead-bug','Dead bug','Core','Bodyweight'],
  ['side-plank','Side plank','Core','Bodyweight','seconds'],
  ['pallof-press','Pallof press','Core','Machines'],
  ['bird-dog','Bird dog','Core','Bodyweight'],
  ['wrist-extension','Wrist-extension curl','Arms','Dumbbells'],
  ['neutral-machine-shoulder','Neutral-grip machine shoulder press','Shoulders','Machines'],
  ['single-arm-pressdown','Single-arm cable triceps pressdown','Arms','Machines'],
  ['serratus-wall-slide','Serratus wall slide','Mobility','Bodyweight'],
  ['calf-raise-pause','Calf raise with pause','Lower body','Machines'],
  ['band-hip-extension','Standing band hip extension','Lower body','Band/bodyweight'],
  ['wide-neutral-row','Wide-neutral seated cable row','Back','Machines'],
  ['high-low-row','High-to-low cable row','Back','Machines'],
  ['scapular-pullup','Scapular pull-up','Back','Bodyweight'],
  ['back-extension-hamstring','45-degree back extension · hamstring emphasis','Hamstrings','Bodyweight'],
  ['dead-bug-long','Dead bug with longer leg reach','Core','Bodyweight'],
  ['side-plank-row','Side-plank cable row','Core','Machines'],
  ['pallof-hold','Pallof hold','Core','Machines','seconds',true],
  ['bird-dog-long','Long-lever bird dog','Core','Bodyweight']
].map(([id,name,category,equipment,measure='reps',loadedTimed=false])=>({id,name,category,equipment,measure,loadedTimed,defaultSets:2,defaultReps:measure==='seconds'?20:10,increment:equipment==='Dumbbells'?2.5:5,custom:false}));

// A rep range remains visible; its lower bound is an editable starting target.
const hp = (exerciseId,sets,min,max=min,notes='',main=false) => ({exerciseId,sets,min,max,notes,main});
const balanceReach = () => hp('balance-reaches',2,1,1,'One set = one round per side: forward, diagonal, backward; twice through. Complete 2 rounds/side. Start right.');
const jointDay = () => [balanceReach(),hp('hip-airplane',2,3,3,'Per side; start right. Assisted, controlled movement.'),hp('hip-ir-lift',2,6,6,'Per side; start right.'),hp('wall-slide-liftoff',2,8),hp('deep-squat-hold',2,20,30,'Seconds. Support is welcome; do not force painful depth.'),hp('hip-flexor-stretch',2,20,30,'Seconds per side; start right.'),hp('forearm-rotation',2,12,12,'Light load; reps per direction, per arm.')];
const rdl = () => hp('rear-foot-single-rdl',3,8,12,'Per side; start right. Rear foot on bench; one DB in the hand opposite the working leg. Initial reference: 15–25 lb total, not a mandatory starting load. Soft standing knee; hinge at hip; keep hips square. Progress beyond 25 lb when appropriate.',true);
const highRow = () => hp('supported-high-row',2,12,15,'Elbows moderately out; lighter than the main row.');
const carry = () => hp('farmer-carry',4,30,40,'Seconds per round. Weight per hand. Rest 90–120 seconds. Build all 4 rounds to 40 seconds, then increase load and return toward 30 seconds.');
const lateralWalk = () => hp('band-lateral-walk',2,10,10,'Steps per direction; start right.');
const easyCurl = () => hp('ham-curl',2,12,15,'Easy: RPE 5–6.');
const wrist = () => hp('wrist-extension',2,15,15,'Per arm.');
const day = (week,n,title,items,cardio,lowFatigue=false) => ({key:`H${week}D${n}`,programId:HOME_PROGRAM_ID,week,day:n,name:`Week ${week} · ${title}`,focus:`Day ${n} · ${title}`,description:lowFatigue?'Keep the entire session low-fatigue; prioritize control.':'Working sets shown; warm-ups are additional. Follow the sequence at your own pace.',items,ids:items.map(x=>x.exerciseId),cardio,lowFatigue});
const HOME_PROGRAM = [
  day(1,1,'Upper Push',[hp('incline-db-bench',3,8,10,'Weight per dumbbell.',true),hp('machine-chest-press',2,10,12),hp('cable-lateral-raise',2,12,15),hp('rope-pressdown',2,10,15),easyCurl(),hp('band-external-rotation',2,15,15,'Per side.')],'10-minute hard finish.'),
  day(1,2,'Lower Push',[hp('leg-press',4,8,12,'Use a comfortable foot position.',true),hp('goblet-box-squat',2,8,10,'Omit if it irritates the left knee.'),hp('ham-curl',3,10,15),hp('leg-press-calf-raise',3,12,15),hp('spanish-squat-hold',2,20,30,'Seconds.'),hp('band-hip-flexion',2,15,15,'Per side; start right.'),hp('hip-cars',1,3,3,'Slow reps per side; start right.')],'Optional 5–10 minutes easy.'),
  day(1,3,'Joint + Balance',jointDay(),'20–30 minutes at conversational effort.',true),
  day(1,4,'Upper Pull',[hp('neutral-lat-pulldown',3,8,10,'',true),hp('row-supported',3,10,12,'',true),hp('straight-arm-pulldown',2,12,15),highRow(),hp('barbell-curl',2,10,12),hp('cable-y-raise',2,12,15)],'Optional 10 minutes easy/moderate.'),
  day(1,5,'Lower Pull',[rdl(),hp('hip-thrust',3,8,10,'',true),hp('back-extension-glute',2,10,15),hp('hamstring-curl',2,10,15),lateralWalk(),hp('hip-ir-lift',1,6,6,'Per side; start right.')],'Optional 5–10 minutes easy.'),
  day(1,6,'Core + Carries',[carry(),hp('dead-bug',3,6,8,'Per side.'),hp('side-plank',2,20,30,'Seconds per side.'),hp('pallof-press',2,10,12,'Per side.'),hp('bird-dog',2,6,6,'Per side; brief controlled pause.'),wrist()],'10-minute hard finish if recovered; otherwise easy.'),
  day(2,1,'Upper Push',[hp('db-bench',3,8,10,'Weight per dumbbell.',true),hp('neutral-machine-shoulder',2,8,10,'',true),hp('cable-lateral-raise',2,12,15),hp('single-arm-pressdown',2,12,15,'Per side.'),easyCurl(),hp('serratus-wall-slide',2,8,10)],'10-minute hard finish.'),
  day(2,2,'Lower Push',[hp('leg-press',4,8,12,'Usual comfortable foot position; slightly higher is optional.',true),hp('ham-curl',3,10,15),hp('spanish-squat-hold',3,20,30,'Seconds.'),hp('calf-raise-pause',3,12,15),hp('band-hip-extension',2,15,15,'Per side; start right.'),balanceReach(),hp('hip-cars',1,3,3,'Slow reps per side; start right.')],'Optional 5–10 minutes easy.'),
  day(2,3,'Joint + Balance',jointDay(),'20–30 minutes at conversational effort.',true),
  day(2,4,'Upper Pull',[hp('neutral-lat-pulldown',3,8,10,'',true),hp('wide-neutral-row',3,10,12,'',true),hp('high-low-row',2,12,12,'Per side.'),highRow(),hp('barbell-curl',2,10,12),hp('scapular-pullup',2,6,8,'Controlled shoulder-blade movement, not full pull-ups.')],'Optional 10 minutes easy/moderate.'),
  day(2,5,'Lower Pull',[rdl(),hp('hip-thrust',3,10,12,'',true),hp('back-extension-hamstring',2,10,12),hp('hamstring-curl',2,10,15),lateralWalk(),hp('hip-airplane',2,3,3,'Per side; start right.')],'Optional 5–10 minutes easy.'),
  day(2,6,'Core + Carries',[carry(),hp('dead-bug-long',3,6,8,'Per side.'),{...hp('side-plank-row',2,8,10,'Per side. Alternative: standard side plank, 2×20–30 seconds/side.'),alternative:hp('side-plank',2,20,30,'Seconds per side; prescribed alternative to side-plank cable row.')},hp('pallof-hold',2,20,20,'Seconds per side.'),hp('bird-dog-long',2,6,6,'Per side.'),wrist()],'10-minute hard finish if recovered; otherwise easy.')
];

function usesWeight(ex) { return !['minutes','seconds','rounds','steps'].includes(ex.measure) || ex.loadedTimed===true; }
function loggedSetLabel(s,ex) {
  if(isCardio(ex))return cardioSetSummary(s,ex);
  const load=usesWeight(ex)?`${s.weight===''?(s.done?'BW':'—'):s.weight} ${unit()}${ex.id==='farmer-carry'?' / hand':''} × `:'';
  return load+`${s.reps||'—'} ${setMeasure(ex)}`;
}
function setMeasure(ex) { return ex.measure==='reps'?'reps':ex.measure; }
function prescribedLabel(p) {
  const ex=exById(p.exerciseId),range=p.min===p.max?String(p.min):`${p.min}–${p.max}`;
  return `${p.sets} × ${range} ${setMeasure(ex)}${p.main?' · RPE 7–8':''}`;
}
function createProgramItem(spec) {
  const item=createItem(spec.exerciseId),prior=historyExercise(spec.exerciseId);
  item.prescription=deepCopy(spec);
  item.machine=prior?.item?.machine||'';
  const slots=prior?.item?.sets||[],warmups=slots.filter(s=>s.role==='warmup');
  const legacyUnlabelled=slots.some(s=>!s.role)&&!prior?.item?.prescription;
  const count=legacyUnlabelled?Math.max(spec.sets,slots.length):spec.sets;
  // Preserve each historical value, including legacy unlabelled ramp-up sets.
  // Extra recalled sets remain editable; never infer warm-up roles or heavy loads.
  const make=(old,role)=>({id:uid('set'),weight:String(old?.weight??''),reps:String(old?.reps??spec.min),role,done:false});
  item.sets=[...warmups.slice(0,16-count).map((_,k)=>make(historySetReference(spec.exerciseId,item.machine,'warmup',k),'warmup')),...Array.from({length:Math.min(16,count)},(_,k)=>make(historySetReference(spec.exerciseId,item.machine,'working',k),'working'))];
  return item;
}
function historySetReference(exerciseId,machine,role,index) {
  for(const session of sessionsSorted())for(const item of session.items||[]){
    if(item.exerciseId!==exerciseId||(item.machine||'')!==machine)continue;
    const set=item.sets.filter(s=>(s.role||'working')===role)[index];
    if(set?.done)return set;
  }
  return null;
}
function renderProgramGuidance(plan) {
  if(!plan?.programId)return '';
  return `<details class="program-guidance card margin-top"><summary>Program rules & progression</summary><ul>${HOME_PROGRAM_RULES.map(rule=>`<li>${esc(rule)}</li>`).join('')}</ul></details>`;
}
function renderPlannedCardio(plan) {
  if(!plan?.programId)return '';
  return `<div class="card margin-top"><h2 class="section-title">Cardio for this session</h2><p class="margin-top-sm">${esc(plan.cardio)}</p>${plan.cardio.includes('hard finish')?`<p class="subtle small">${esc(HOME_FINISHER)}</p>`:''}<p class="subtle small">Guidance only; log the activity you actually do.</p><button class="button dark sm" data-action="cardio-picker">${state.active?'Add a cardio activity':'Choose cardio'}</button></div>`;
}
function activeProgramPlan() {return HOME_PROGRAM.find(p=>p.key===state.active?.planKey);}
function skipSet(itemId,setId) {
  const item=itemById(itemId),s=item?.sets.find(s=>s.id===setId);if(!s||s.done)return;
  s.skipped=!s.skipped;s.completedAt=null;focusedSetKey=null;state.active.restUntil=null;persist();render();
}
function skipRemainingExercise(itemId) {
  const item=itemById(itemId);if(!item)return;
  for(const s of item.sets)if(!s.done){s.skipped=true;s.completedAt=null;}
  focusedSetKey=null;persist();closeSheet();render();
}
function addWarmup(itemId) {
  const item=itemById(itemId);if(!item||item.sets.length>=16)return;
  const s={id:uid('set'),weight:'',reps:String(item.prescription?.min??exById(item.exerciseId).defaultReps),role:'warmup',done:false};
  const index=item.sets.findIndex(s=>s.role!=='warmup');item.sets.splice(index<0?item.sets.length:index,0,s);
  focusedSetKey=`${item.id}:${s.id}`;persist();render();
}
function usePrescribedAlternative(itemId) {
  const item=itemById(itemId),spec=item?.prescription?.alternative;if(!spec)return;
  if(item.sets.some(s=>s.done)&&!confirm('Replace this exercise and its logged sets with the prescribed alternative?'))return;
  const replacement=createProgramItem(spec);replacement.id=item.id;
  state.active.items[state.active.items.indexOf(item)]=replacement;focusedSetKey=null;persist();closeSheet();render();
}
function changeMachine(itemId,value) {
  const item=itemById(itemId);if(!item)return;
  const machine=value.trim().slice(0,100);if(machine===(item.machine||''))return;
  if(item.sets.some(s=>s.done)){toast('Keep this machine with its logged sets. Add another exercise entry for a different machine.',6000);render();return;}
  if(!confirm('Change machine and recall only loads recorded on that machine? Unmatched loads will be blank.')){render();return;}
  for(const role of ['warmup','working']){
    item.sets.filter(s=>(s.role||'working')===role).forEach((s,k)=>{s.weight=String(historySetReference(item.exerciseId,machine,role,k)?.weight??'');});
  }
  item.machine=machine;persist();render();
}
function validatePrescription(p) {
  if(p===undefined)return;
  if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.exerciseId!=='string'||typeof p.notes!=='string'||typeof p.main!=='boolean'||!Number.isInteger(p.sets)||p.sets<1||p.sets>16||!Number.isFinite(p.min)||p.min<=0||!Number.isFinite(p.max)||p.max<p.min)throw Error('Invalid exercise prescription');
  if(p.alternative!==undefined){if(p.alternative?.alternative!==undefined)throw Error('Invalid nested alternative');validatePrescription(p.alternative);}
}
