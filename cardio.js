'use strict';
// Cardio is a view of the same saved workout entries, not a second history copy.
// Measurements are entered by the user; this web app does not read Apple Fitness.
const CARDIO_CATALOG = [
  ['walk','Outdoor walk',20],['dog-walk','Dog walk',20],['jog','Outdoor jog',15],
  ['treadmill','Treadmill',15],['elliptical','Elliptical',15],['rower','Rowing machine',10]
].map(([id,name,defaultReps])=>({id,name,category:'Cardio',equipment:'Cardio',measure:'minutes',defaultSets:1,defaultReps,increment:0,custom:false}));
let cardioComparisonKey='';
let cardioMetric='minutes';
let cardioLogExerciseId=null;
function isCardio(ex){return ex.category==='Cardio'&&isTimed(ex);}
function cardioDefaults(){return {source:'manual',distance:'',distanceUnit:state.settings.unit==='kg'?'km':'mi',speed:'',speedUnit:state.settings.unit==='kg'?'km/h':'mph',incline:'',level:'',floors:'',effort:'',avgHeartRate:'',benchmark:''};}
function cardioTemplateTargets(previous){
  const next=cardioDefaults();
  for(const key of ['distanceUnit','speed','speedUnit','incline','level','benchmark'])if(previous?.[key]!==undefined)next[key]=previous[key];
  return next;
}
function validateCardio(c){
  if(c===undefined)return;
  const fail=()=>{throw Error('Invalid cardio measurements');};
  if(!c||typeof c!=='object'||Array.isArray(c))fail();
  for(const key of ['distance','speed','incline','level','floors','effort','avgHeartRate']){
    const v=c[key];if(v===undefined||v==='')continue;
    if(!['string','number'].includes(typeof v)||!String(v).trim()||!Number.isFinite(Number(v))||Number(v)<0)fail();
    if(key==='effort'&&(Number(v)<1||Number(v)>10))fail();
    if(key==='avgHeartRate'&&(!Number.isInteger(Number(v))||Number(v)<1||Number(v)>300))fail();
    if(key==='incline'&&Number(v)>100)fail();
  }
  if(c.distanceUnit!==undefined&&!['mi','km'].includes(c.distanceUnit))fail();
  if(c.speedUnit!==undefined&&!['mph','km/h'].includes(c.speedUnit))fail();
  if(c.distance!==undefined&&c.distance!==''&&!['mi','km'].includes(c.distanceUnit))fail();
  if(c.speed!==undefined&&c.speed!==''&&!['mph','km/h'].includes(c.speedUnit))fail();
  if(c.benchmark!==undefined&&(typeof c.benchmark!=='string'||c.benchmark.length>100))fail();
  if(c.source!==undefined&&!['manual','machine','phone','watch'].includes(c.source))fail();
}
function hydrateCardio(d){
  for(const ex of [...CARDIO_CATALOG,...BASE_EXERCISES.filter(e=>e.category==='Cardio')])if(!d.exercises.some(e=>e.id===ex.id))d.exercises.push(deepCopy(ex));
  d.activityDays??=[];
  return d;
}
function validateActivityDays(days){
  if(days===undefined)return;
  if(!Array.isArray(days))throw Error('Invalid step history');
  const dates=new Set();
  for(const d of days){if(!d||typeof d.date!=='string'||!validActivityDate(d.date)||dates.has(d.date)||!Number.isInteger(d.steps)||d.steps<0||d.steps>100000||d.source!=='Apple Fitness (manual)')throw Error('Invalid step history');dates.add(d.date);}
}
function validActivityDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
function cardioSetSummary(s,ex){
  const c=s.cardio||{},parts=[`${s.reps||'—'} ${ex.measure}`];
  if(c.distance!==undefined&&c.distance!=='')parts.push(`${c.distance} ${c.distanceUnit}`);
  if(c.speed!==undefined&&c.speed!=='')parts.push(`${c.speed} ${c.speedUnit}`);
  if(c.incline!==undefined&&c.incline!=='')parts.push(`${c.incline}% incline`);
  if(c.level!==undefined&&c.level!=='')parts.push(`level ${c.level}`);
  if(c.floors!==undefined&&c.floors!=='')parts.push(`${c.floors} floors`);
  if(c.avgHeartRate!==undefined&&c.avgHeartRate!=='')parts.push(`${c.avgHeartRate} bpm`);
  if(c.effort!==undefined&&c.effort!=='')parts.push(`effort ${c.effort}/10`);
  if(c.benchmark)parts.push(c.benchmark);
  return parts.join(' · ');
}
function cardioRows(){
  const rows=[];
  for(const w of state.history){
    const context=w.items.some(i=>!isCardio(exById(i.exerciseId))&&i.sets.some(s=>s.done))?'With lifting':'Cardio only';
    for(const item of w.items){const ex=exById(item.exerciseId);if(!isCardio(ex))continue;
      for(const s of item.sets){if(!s.done)continue;const minutes=Number(s.reps)*(ex.measure==='seconds'?1/60:1);if(!Number.isFinite(minutes)||minutes<=0)continue;
        const c=s.cardio||{};rows.push({id:JSON.stringify([w.id,item.id,s.id]),workoutId:w.id,date:w.date,startedAt:w.startedAt||'',context,ex,c,minutes,distanceKm:c.distance!==undefined&&c.distance!==''?Number(c.distance)*(c.distanceUnit==='mi'?1.609344:1):null});
      }
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.startedAt.localeCompare(b.startedAt));
}
function cardioMinutesFor(w){return w.items.reduce((total,i)=>total+(isCardio(exById(i.exerciseId))?i.sets.filter(s=>s.done).reduce((n,s)=>n+(Number(s.reps)||0)*(exById(i.exerciseId).measure==='seconds'?1/60:1),0):0),0);}
function sessionSummary(w){const strength=w.items.filter(i=>!isCardio(exById(i.exerciseId))).reduce((n,i)=>n+i.sets.filter(s=>s.done).length,0),minutes=cardioMinutesFor(w);return [strength?`${strength} sets`:'',minutes?`${fmtWeight(minutes)} min cardio`:''].filter(Boolean).join(' · ')||'No completed entries';}
function showCardioPicker(logOnly=false){
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">${logOnly?'Log a separate cardio session':state.active?'Add cardio to this workout':'Choose cardio'}</h2><p class="subtle">${state.active?'Your lifting sets stay saved.':'Record a walk, jog or gym session without advancing A/B/C.'} Times are editable; only completed entries count.</p></div><button class="micro-btn" data-action="close-sheet" aria-label="Close">✕</button></div><div class="picker-options">${state.exercises.filter(isCardio).map(e=>`<button class="picker-option" data-action="${logOnly?'log-cardio':'select-cardio'}" data-id="${esc(e.id)}"><div><strong>${esc(e.name)}</strong><span>${esc(recentSummary(e.id))}</span></div><span aria-hidden="true">＋</span></button>`).join('')}</div>`);
}
function addCardio(id){
  const ex=exById(id);if(!isCardio(ex))return;
  let item=state.active?.items.find(i=>i.exerciseId===id&&i.sets.some(s=>!s.done));
  if(!item){item=createItem(id);if(state.active)state.active.items.push(item);else state.active={id:uid('workout'),date:localDate(),startedAt:new Date().toISOString(),endedAt:null,title:ex.name+' · cardio',planKey:null,location:state.settings.location,notes:'',restUntil:null,editingId:null,items:[item]};}
  const set=item.sets.find(s=>!s.done);focusedSetKey=`${item.id}:${set.id}`;lastSetAction=null;state.active.restUntil=null;persist();setTab('workout');
}
function showSeparateCardioLog(id){
  const ex=exById(id);if(!isCardio(ex))return;cardioLogExerciseId=id;
  showSheet(`<div class="sheet-top"><div><h2 class="sheet-title">Log ${esc(ex.name)}</h2><p class="subtle">This is a separate completed session. Any unfinished lifting workout stays unchanged.</p></div><button class="micro-btn" data-action="close-sheet" aria-label="Close">✕</button></div><div class="field-grid margin-top"><div class="field"><label for="cardio-log-date">Date</label><input id="cardio-log-date" type="date" value="${localDate()}"></div><div class="field"><label for="cardio-log-duration">Duration · ${esc(ex.measure)}</label><input id="cardio-log-duration" type="number" inputmode="decimal" min="0" step="any" placeholder="Time completed"></div></div>${cardioFields({})}<div class="field margin-top"><label for="cardio-log-note">Notes</label><input id="cardio-log-note" maxlength="500" placeholder="Optional"></div><button class="button full margin-top" data-action="save-cardio-log">Save cardio session</button>`);
}
function saveSeparateCardioLog(){
  const ex=exById(cardioLogExerciseId);if(!isCardio(ex))return;
  const date=document.getElementById('cardio-log-date')?.value||'',duration=document.getElementById('cardio-log-duration')?.value||'';
  let c;try{if(!validActivityDate(date)||!duration||!Number.isFinite(Number(duration))||Number(duration)<=0)throw Error('Enter a date and positive duration');c=readCardioFields();}catch(err){toast(err.message,5000);return;}
  state.history.push({id:uid('workout'),date,startedAt:'',endedAt:'',enteredAt:new Date().toISOString(),title:ex.name+' · cardio',planKey:null,location:state.settings.location,notes:document.getElementById('cardio-log-note')?.value||'',items:[{id:uid('item'),exerciseId:ex.id,note:'',sets:[{id:uid('set'),weight:'',reps:duration,done:true,completedAt:'',cardio:c}]}]});
  const saved=persist();cardioLogExerciseId=null;setTab('cardio');toast(saved?'Separate cardio session saved.':'Cardio is in memory only — export a backup.',5500);
}
function cardioFields(s){
  const c={...cardioDefaults(),...(s.cardio||{})};
  const input=(key,label,placeholder='',max='')=>`<div class="field"><label for="cardio-${key}">${label}</label><input id="cardio-${key}" type="number" min="0" step="any" ${max?`max="${max}"`:''} inputmode="decimal" value="${esc(c[key])}" placeholder="${placeholder}"></div>`;
  return `<p class="subtle small margin-top">Optional details from Fitness, your route or the machine display. Blank means unknown.</p><div class="field-grid margin-top">${input('distance','Distance')}<div class="field"><label for="cardio-distanceUnit">Distance unit</label><select id="cardio-distanceUnit">${['mi','km'].map(u=>`<option ${c.distanceUnit===u?'selected':''}>${u}</option>`).join('')}</select></div>${input('effort','Effort · 1 easy to 10 hardest','1–10','10')}${input('avgHeartRate','Average heart rate · bpm','Optional','300')}</div>
    <details class="margin-top"><summary>Route and machine settings · for comparisons</summary><div class="field margin-top-sm"><label for="cardio-benchmark">Route or machine name</label><input id="cardio-benchmark" maxlength="100" value="${esc(c.benchmark)}" placeholder="e.g. block loop or gym stair climber 1"></div><div class="field-grid margin-top-sm">${input('speed','Speed')}<div class="field"><label for="cardio-speedUnit">Speed unit</label><select id="cardio-speedUnit">${['mph','km/h'].map(u=>`<option ${c.speedUnit===u?'selected':''}>${u}</option>`).join('')}</select></div>${input('incline','Treadmill incline · %','','100')}${input('level','Machine level / resistance')}${input('floors','Floors climbed')}</div></details>`;
}
function readCardioFields(){const c={source:'manual'};for(const key of Object.keys(cardioDefaults()))if(key!=='source')c[key]=document.getElementById('cardio-'+key)?.value.trim()||'';validateCardio(c);return c;}
function saveActivitySteps(){
  const date=document.getElementById('steps-date')?.value||'',raw=document.getElementById('steps-count')?.value??'',steps=Number(raw);
  const entry={date,steps,source:'Apple Fitness (manual)'};
  try{if(raw==='')throw Error('Enter the total shown in Fitness');validateActivityDays([entry]);}catch(err){toast(err.message,4500);return;}
  const i=state.activityDays.findIndex(d=>d.date===date);if(i<0)state.activityDays.push(entry);else state.activityDays[i]=entry;
  const saved=persist();render();toast(saved?'Daily step total saved; walks are not added again.':'Steps are in memory only — export a backup.',5500);
}
function comparisonGroups(rows){
  const groups=new Map();
  const n=v=>v===undefined||v===''?null:Number(v);
  for(const r of rows){const c=r.c,label=(c.benchmark||'').trim();if(!label)continue;
    if(r.ex.id==='treadmill'&&(n(c.speed)===null||n(c.incline)===null))continue;
    if(r.ex.id==='stair-climber'&&n(c.level)===null)continue;
    const speed=n(c.speed)===null?null:roundWeight(n(c.speed)*(c.speedUnit==='mph'?1.609344:1));
    const key=JSON.stringify([r.ex.id,label.toLowerCase(),r.context,c.source||'recorded',speed,n(c.incline),n(c.level)]);
    if(!groups.has(key))groups.set(key,{key,label:r.ex.name+' · '+label+' · '+r.context,sessions:new Map()});
    const group=groups.get(key);if(!group.sessions.has(r.workoutId))group.sessions.set(r.workoutId,[]);group.sessions.get(r.workoutId).push(r);
  }
  return [...groups.values()].filter(g=>g.sessions.size>=2).map(g=>({...g,points:[...g.sessions.values()].map(rs=>{
    const minutes=rs.reduce((n,r)=>n+r.minutes,0),distanceKm=rs.every(r=>r.distanceKm!==null&&r.distanceKm>0)?rs.reduce((n,r)=>n+r.distanceKm,0):null;
    const weighted=field=>rs.every(r=>n(r.c[field])!==null)?rs.reduce((t,r)=>t+Number(r.c[field])*r.minutes,0)/minutes:null;
    return {date:rs[0].date,minutes,pace:distanceKm?minutes/distanceKm:null,paceMiles:distanceKm?minutes/distanceKm*1.609344:null,avgHeartRate:weighted('avgHeartRate'),effort:weighted('effort')};
  })}));
}
function cardioTrendChart(points,metric,label){
  const data=points.filter(p=>p[metric]!==null);if(data.length<2)return '<p class="subtle">Record this measurement in at least two comparable sessions to see a trend.</p>';
  const values=data.map(p=>p[metric]),low=Math.max(0,Math.min(...values)-1),high=Math.max(...values)+1;
  const x=i=>35+i*280/(data.length-1),y=v=>125-(v-low)*100/(high-low);
  return `<div class="chart-wrap"><svg role="img" aria-label="${esc(label)} over comparable cardio sessions" viewBox="0 0 350 160"><path d="${data.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(p[metric]).toFixed(1)).join(' ')}" class="chart-line"/>${data.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p[metric]).toFixed(1)}" r="4" fill="currentColor"><title>${esc(p.date)} · ${fmtWeight(p[metric])} ${esc(label)}</title></circle>`).join('')}<text x="35" y="151" class="chart-label">${esc(data[0].date)}</text><text x="315" y="151" text-anchor="end" class="chart-label">${esc(data.at(-1).date)}</text></svg></div><p class="subtle small">First: ${fmtWeight(data[0][metric])} · Latest: ${fmtWeight(data.at(-1)[metric])} ${esc(label)}. Missing readings are omitted.</p>`;
}
function weeklyCardioMinutes(rows){
  return Array.from({length:6},(_,i)=>{const end=new Date();end.setDate(end.getDate()-7*(5-i));const start=new Date(end);start.setDate(start.getDate()-6);const from=localDate(start),to=localDate(end);return {from,to,minutes:rows.filter(r=>r.date>=from&&r.date<=to).reduce((n,r)=>n+r.minutes,0)};});
}
function cardioVolume(rows){
  const weeks=weeklyCardioMinutes(rows),max=Math.max(1,...weeks.map(w=>w.minutes));
  return `<div class="card margin-top"><h2 class="section-title">Weekly activity volume</h2><p class="subtle small margin-top-sm">Logged minutes in six consecutive 7-day periods. An empty period means no entries, not necessarily no activity.</p>${weeks.map(w=>`<div class="cardio-volume-row"><span>${esc(w.from.slice(5))}–${esc(w.to.slice(5))}</span><div class="cardio-volume-track"><span style="width:${(100*w.minutes/max).toFixed(1)}%"></span></div><strong>${fmtWeight(w.minutes)} min</strong></div>`).join('')}</div>`;
}
function renderCardio(){
  const rows=cardioRows(),today=localDate(),cutoff=new Date();cutoff.setDate(cutoff.getDate()-6);const week=rows.filter(r=>r.date>=localDate(cutoff)&&r.date<=today);
  const latestSteps=[...state.activityDays].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const groups=comparisonGroups(rows);const group=groups.find(g=>g.key===cardioComparisonKey)||groups.at(-1);
  const labels={minutes:'minutes',pace:'min/km',paceMiles:'min/mi',avgHeartRate:'bpm',effort:'effort /10'};
  return pageShell(`<div class="eyebrow">MOVE · BUILD · REPEAT</div><h1 class="page-title">Cardio</h1><p class="subtle margin-bottom">Walks, jogs and gym cardio, alongside your lifting. Your entries save on this phone.</p><button class="button full margin-bottom" data-action="cardio-picker">${state.active?'＋ Add cardio to current workout':'＋ Start cardio'}</button><button class="button dark full margin-bottom" data-action="cardio-log-picker">Log a separate / completed session</button>
    <div class="kpi-grid"><div class="kpi"><strong>${fmtWeight(week.reduce((n,r)=>n+r.minutes,0))}</strong><span>Cardio min / 7d</span></div><div class="kpi"><strong>${new Set(week.map(r=>r.workoutId)).size}</strong><span>Sessions / 7d</span></div><div class="kpi"><strong>${latestSteps?latestSteps.steps.toLocaleString():'—'}</strong><span>${latestSteps?'Steps · '+esc(latestSteps.date):'No step total entered'}</span></div></div>
    ${cardioVolume(rows)}
    <div class="card margin-top"><h2 class="section-title">Performance trends</h2><p class="subtle margin-top-sm">Compare repeats of the same activity, route/machine and entered settings. With-lifting sessions stay separate from cardio-only sessions. These are performance comparisons, not VO₂ max measurements.</p>
    ${group?`<div class="field margin-top"><label for="cardio-comparison">Comparable sessions</label><select id="cardio-comparison" data-action="cardio-comparison">${groups.map(g=>`<option value="${esc(g.key)}" ${g.key===group.key?'selected':''}>${esc(g.label)}</option>`).join('')}</select></div><div class="field margin-top-sm"><label for="cardio-metric">Measurement</label><select id="cardio-metric" data-action="cardio-metric">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${key===cardioMetric?'selected':''}>${label}</option>`).join('')}</select></div>${cardioTrendChart(group.points,cardioMetric,labels[cardioMetric])}<p class="subtle small">Each point combines matching blocks within one workout. Minutes show volume; lower pace means faster. Heart rate and effort use time-weighted averages when every block has a reading. Heart rate and effort depend on conditions, stops and fatigue.</p>`:'<p class="subtle margin-top">Name a route or machine in the entry details, then log it in two workouts. For treadmill comparisons, also enter speed and incline; for stairs, enter the machine level. Unrecorded settings remain unknown.</p>'}</div>
    <div class="card margin-top"><h2 class="section-title">Steps from Apple Fitness</h2><p class="subtle margin-top-sm">No automatic Fitness connection. Optionally enter the daily total shown on your phone. This total already includes your walks; we never add their steps again.</p><div class="field-grid margin-top"><div class="field"><label for="steps-date">Date</label><input id="steps-date" type="date" value="${today}"></div><div class="field"><label for="steps-count">Daily total steps</label><input id="steps-count" type="number" inputmode="numeric" min="0" max="100000" value="${state.activityDays.find(d=>d.date===today)?.steps??''}" placeholder="Optional"></div></div><button class="button dark full margin-top-sm" data-action="save-steps">Save daily total</button>${state.activityDays.length?`<details class="margin-top"><summary>Recent daily totals</summary>${[...state.activityDays].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14).map(d=>`<p class="subtle small">${esc(d.date)} · ${d.steps.toLocaleString()} steps</p>`).join('')}</details>`:''}</div>
    <div class="section-heading"><h2 class="section-title">Cardio history</h2></div>${rows.length?[...rows].reverse().map(r=>`<article class="card margin-bottom"><strong>${esc(r.ex.name)}</strong><p class="subtle small">${formatDate(r.date)} · ${r.context} · ${esc(r.c.source||'recorded')} entry</p><p class="margin-top-sm">${esc(cardioSetSummary({reps:r.ex.measure==='seconds'?r.minutes*60:r.minutes,cardio:r.c},r.ex))}</p><button class="button dark sm margin-top-sm" data-action="edit-history" data-id="${esc(r.workoutId)}">Edit workout</button></article>`).join(''):'<div class="empty"><strong>Every bit of movement can be logged</strong><p>Start with a dog walk, jog, treadmill or stair-climber session. A watch is optional; no VO₂ max estimate is invented.</p></div>'}`);
}
