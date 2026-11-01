'use strict';
/* LiftLog v4: Private Google Sheets sync using Google Identity Services.
   No OAuth access tokens or refresh tokens are stored on disk or committed to GitHub.
   The public OAuth *client ID* is not a password.
   Offline app data always saves first; sync runs only when online and authenticated.
*/
(function () {
  // Fail closed until OAuth and the replacement sync protocol pass release gates.
  const PRODUCTION_SYNC_ENABLED = false;
  const disabledMessage = 'Google sync is disabled pending authentication and data-integrity validation.';
  const SHEET_ID = '1kqksEeg9CO4UCigEWgbBK0WldeoLzp_5Vw4TPKYHWtU';
  const CLIENT_KEY = 'liftlog.google.oauthClientId.v1';
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const API = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
  const TYPES = ['workouts', 'exercises', 'templates'];
  const remoteTab = {workouts:'Workouts',exercises:'Exercises',templates:'Routines'};
  const width = {Workouts:13,Sets:18,Exercises:13,Routines:9,'Routine Items':12};
  const lastStatus = {message:'Connect Google to enable two-way sync.',last:'',conflicts:[],connected:false,busy:false};
  let bridge=null,token=null,expires=0,client=null,timer=0,suppress=false,attempt=0;
  const now=()=>new Date().toISOString();
  const str=v=>String(v??'');
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const truth=v=>v===true||v===1||str(v).toLowerCase()==='true';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function getSyncState(){const s=bridge.getState();if(!s.sync)s.sync={baseline:{workouts:{},exercises:{},templates:{}},deletedWorkoutIds:[],lastSuccess:''};if(!s.sync.baseline)s.sync.baseline={};for(const t of TYPES)if(!s.sync.baseline[t])s.sync.baseline[t]={};if(!Array.isArray(s.sync.deletedWorkoutIds))s.sync.deletedWorkoutIds=[];for(const t of ['exercises','templates']){const key='deleted'+t[0].toUpperCase()+t.slice(1)+'Ids';if(!Array.isArray(s.sync[key]))s.sync[key]=[];}return s.sync;}
  function notify(message){lastStatus.message=message;const s=bridge?.getState();if(s&&!s.active&&bridge.tab()==='more')bridge.render();}
  function fmtTime(value){if(!value)return 'Never';try{return new Date(value).toLocaleString();}catch{return value;}}
  async function hash(obj){const buf=new TextEncoder().encode(JSON.stringify(obj));const digest=await crypto.subtle.digest('SHA-256',buf);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');}
  function vrow(row){return row.map(v=>v===null||v===undefined?'':v);}
  function escapeHTML(value){return str(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function checkToken(){return Boolean(token&&expires>Date.now()+15000);}
  function clientId(){return localStorage.getItem(CLIENT_KEY)||'';}
  function setClientId(value){const s=str(value).trim();if(!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(s))throw Error('Enter a valid Google OAuth web client ID.');localStorage.setItem(CLIENT_KEY,s);client=null;return s;}
  function makeClient(){if(!window.google?.accounts?.oauth2)throw Error('Google sign-in has not loaded; reconnect to the internet and retry.');const id=clientId();if(!id)throw Error('First enter your Google OAuth web client ID.');client=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,callback:resp=>{if(!resp?.access_token){notify('Google sign-in did not finish.');return;}token=resp.access_token;expires=Date.now()+(Number(resp.expires_in)||3000)*1000;lastStatus.connected=true;notify('Connected to Google. Syncing…');sync().catch(err=>notify('Sync failed: '+err.message));},error_callback:()=>notify('Google sign-in was cancelled or blocked.')});return client;}
  function connect(){if(!PRODUCTION_SYNC_ENABLED){notify(disabledMessage);return;}try{const v=document.getElementById('google-client-id')?.value?.trim();if(v&&v!==clientId())setClientId(v);makeClient().requestAccessToken({prompt:'select_account'});}catch(err){notify(err.message);bridge.toast(err.message,5000);}}
  function disconnect(){if(token&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(token,()=>{});token=null;expires=0;client=null;lastStatus.connected=false;notify('Disconnected. Workout logging remains offline-ready.');}
  function canonicalWorkout(w){return {id:w.id,date:w.date||'',title:w.title||'',location:w.location||'gym',startedAt:w.startedAt||'',endedAt:w.endedAt||'',notes:w.notes||'',items:(w.items||[]).map(i=>({id:i.id,exerciseId:i.exerciseId,note:i.note||'',sets:(i.sets||[]).map(s=>({id:s.id,weight:str(s.weight),reps:str(s.reps),done:!!s.done,completedAt:s.completedAt||''}))}))};}
  function canonicalExercise(e){return {id:e.id,name:e.name||'',category:e.category||'Other',equipment:e.equipment||'',measure:e.measure||'reps',defaultSets:num(e.defaultSets)||3,defaultReps:num(e.defaultReps)||10,increment:num(e.increment),incrementKg:num(e.incrementKg)||0,custom:!!e.custom};}
  function canonicalTemplate(t){return {id:t.id,name:t.name||'',location:t.location||'gym',items:(t.items||[]).map(i=>({exerciseId:i.exerciseId,sets:(i.sets||[]).map(s=>({weight:str(s.weight),reps:str(s.reps)}))}))};}
  function canonical(type,value){return type==='workouts'?canonicalWorkout(value):type==='exercises'?canonicalExercise(value):canonicalTemplate(value);}
  function makeMaps(s){return {
    workouts:new Map(s.history.map(x=>[x.id,x])),
    exercises:new Map(s.exercises.map(x=>[x.id,x])),
    templates:new Map(s.templates.map(x=>[x.id,x]))
  };}
  function rowsOf(values,name){return ((values.find(x=>str(x.range).startsWith(`'${name}'!`)||str(x.range).startsWith(`${name}!`))||{}).values||[]).map((values,i)=>({values,index:i+1})).slice(1);}
  function listToData(values){const names=['Workouts','Sets','Exercises','Routines','Routine Items'];return Object.fromEntries(names.map(name=>[name,rowsOf(values,name)]));}
  function parseRemote(data,s){
    const workouts=new Map(), setsByWorkout=new Map(),workoutRows=new Map(),setRows=new Map();
    for(const {values:r,index} of data['Sets']){if(!r[0])continue;setRows.set(str(r[0]),{row:index,data:r});if(truth(r[17]))continue;const workoutId=str(r[1]);if(!setsByWorkout.has(workoutId))setsByWorkout.set(workoutId,[]);setsByWorkout.get(workoutId).push(r);}
    for(const {values:r,index} of data.Workouts){if(!r[0])continue;const id=str(r[0]);workoutRows.set(id,{row:index,data:r});if(truth(r[12]))continue;const grouped=new Map();const rows=(setsByWorkout.get(id)||[]).slice().sort((a,b)=>num(a[5])-num(b[5])||num(a[6])-num(b[6]));for(const x of rows){const itemId=str(x[2])||`${id}:${x[3]}`;if(!grouped.has(itemId))grouped.set(itemId,{id:itemId,exerciseId:str(x[3]),note:str(x[13]),sets:[]});const item=grouped.get(itemId);const fromUnit=str(x[8])||s.settings.unit;let weight=str(x[7]);if(weight&&fromUnit!==s.settings.unit){const w=num(weight)*(fromUnit==='kg'?2.2046226218:1/2.2046226218);weight=String(Number(w.toFixed(2)));}item.sets.push({id:str(x[0]),weight,reps:str(x[9]),done:truth(x[11]),completedAt:str(x[12])});}
      workouts.set(id,{id,date:str(r[1]),title:str(r[2]),location:str(r[3])||'gym',startedAt:str(r[4]),endedAt:str(r[5]),notes:str(r[8]),items:Array.from(grouped.values())});}
    const exercises=new Map(),exRows=new Map();for(const {values:r,index} of data.Exercises){if(!r[0])continue;const id=str(r[0]);exRows.set(id,{row:index,data:r});if(truth(r[12]))continue;exercises.set(id,{id,name:str(r[1]),category:str(r[2]),equipment:str(r[3]),measure:str(r[4])||'reps',defaultSets:num(r[5])||3,defaultReps:num(r[6])||10,increment:num(r[7]),incrementKg:num(r[8]),custom:truth(r[9])});}
    const routineRows=new Map(),itemRows=new Map(),itemsByRoutine=new Map(),basePlans={gym:[],small:[]};for(const {values:r,index} of data['Routine Items']){if(!r[0])continue;itemRows.set(str(r[0]),{row:index,data:r});if(truth(r[10]))continue;const t=str(r[1]);if(!itemsByRoutine.has(t))itemsByRoutine.set(t,[]);itemsByRoutine.get(t).push(r);}
    const templates=new Map();for(const {values:r,index} of data.Routines){if(!r[0])continue;const id=str(r[0]);routineRows.set(id,{row:index,data:r});if(truth(r[8]))continue;const items=(itemsByRoutine.get(id)||[]).slice().sort((a,b)=>num(a[2])-num(b[2]));const specs=items.map(i=>{let sets;try{sets=i[11]?JSON.parse(str(i[11])):null;}catch{sets=null;}if(!Array.isArray(sets)||!sets.length){sets=Array.from({length:Math.min(16,Math.max(1,num(i[4])||3))},()=>({weight:str(i[6]),reps:str(i[5]||10)}));}const fromUnit=str(i[7])||'lb';return {exerciseId:str(i[3]),sets:sets.map(x=>({weight:str(x.weight)===''?'':String(Number((num(x.weight)*(fromUnit===s.settings.unit?1:fromUnit==='kg'?2.2046226218:1/2.2046226218)).toFixed(2))),reps:str(x.reps)}))};});
      if(id.startsWith('default-')){const location=str(r[2])==='small'?'small':'gym';const key=id.slice(-1).toUpperCase();basePlans[location].push({key,name:str(r[1]),focus:str(r[3]),description:str(r[4]),ids:specs.map(i=>i.exerciseId)});}
      else templates.set(id,{id,name:str(r[1]),location:str(r[2])||'gym',items:specs});
    }
    for(const mode of ['gym','small'])basePlans[mode].sort((a,b)=>a.key.localeCompare(b.key));
    return {maps:{workouts,exercises,templates},rows:{workouts:workoutRows,sets:setRows,exercises:exRows,templates:routineRows,items:itemRows},remotePlans:basePlans};
  }
  async function request(path,options){if(!PRODUCTION_SYNC_ENABLED)throw Error(disabledMessage);if(!checkToken())throw Error('Google sign-in expired. Tap Connect Google again.');const res=await fetch(API+path,{...options,headers:{Authorization:`Bearer ${token}`,...options?.headers}});if(res.status===401){token=null;lastStatus.connected=false;throw Error('Google session expired. Reconnect and sync again.');}if(!res.ok){let msg=await res.text();throw Error(`Google Sheets HTTP ${res.status}: ${msg.slice(0,190)}`);}return res.json();}
  async function fetchRemote(){const p=new URLSearchParams();for(const name of ['Workouts','Sets','Exercises','Routines','Routine Items'])p.append('ranges',`'${name}'!A1:${({Workouts:'M',Sets:'R',Exercises:'M',Routines:'I','Routine Items':'L'})[name]}`);const result=await request('/values:batchGet?'+p.toString());return listToData(result.valueRanges||[]);}
  function getLocal(type,s){if(type==='workouts')return s.history;if(type==='exercises')return s.exercises;return s.templates;}
  function adopt(type,item,s){const arr=getLocal(type,s);const idx=arr.findIndex(x=>x.id===item.id);if(idx>=0)arr[idx]={...arr[idx],...item};else arr.push(item);}
  function removeLocal(type,id,s){const arr=getLocal(type,s);const idx=arr.findIndex(x=>x.id===id);if(idx>=0)arr.splice(idx,1);}
  function putRow(ops,name,rowIndex,row){ops.update.push({range:`'${name}'!A${rowIndex}:${({Workouts:'M',Sets:'R',Exercises:'M',Routines:'I','Routine Items':'L'})[name]}${rowIndex}`,values:[vrow(row)]});}
  function addRow(ops,name,row){(ops.append[name]??=[]).push(vrow(row));}
  function stageWorkout(ops,w,info,s,deleted=false){const id=w.id,old=info.rows.workouts.get(id),stamp=now();const row=[id,w.date||'',w.title||'',w.location||'',w.startedAt||'',w.endedAt||'', '',deleted?'deleted':'completed',w.notes||'', 'liftlog',stamp,num(old?.data?.[11])+1,deleted];if(old)putRow(ops,'Workouts',old.row,row);else addRow(ops,'Workouts',row);
    const seen=new Set();if(!deleted)for(const [exerciseOrder,item] of (w.items||[]).entries())for(const [setOrder,x] of (item.sets||[]).entries()){const oldSet=info.rows.sets.get(x.id);seen.add(x.id);const ex=s.exercises.find(e=>e.id===item.exerciseId);const line=[x.id,id,item.id,item.exerciseId,ex?.name||item.exerciseId,exerciseOrder+1,setOrder+1,str(x.weight),s.settings.unit,str(x.reps),ex?.measure||'reps',!!x.done,x.completedAt||'',item.note||'', 'liftlog',stamp,num(oldSet?.data?.[16])+1,false];if(oldSet)putRow(ops,'Sets',oldSet.row,line);else addRow(ops,'Sets',line);}
    // Set tombstones prevent removed sets from reappearing on future pulls.
    for(const [setId,entry] of info.rows.sets){if(str(entry.data?.[1])!==id||seen.has(setId)||truth(entry.data?.[17]))continue;const line=[...entry.data];while(line.length<18)line.push('');line[17]=true;line[15]=stamp;line[16]=num(line[16])+1;putRow(ops,'Sets',entry.row,line);}
  }
  function stageExercise(ops,e,info,deleted=false){const old=info.rows.exercises.get(e.id);const row=[e.id,e.name||'',e.category||'',e.equipment||'',e.measure||'reps',num(e.defaultSets)||3,num(e.defaultReps)||10,num(e.increment),num(e.incrementKg),!!e.custom,'liftlog',now(),deleted];if(old)putRow(ops,'Exercises',old.row,row);else addRow(ops,'Exercises',row);}
  function stageTemplate(ops,t,info,deleted=false){const old=info.rows.templates.get(t.id);const row=[t.id,t.name||'',t.location||'gym','Custom', 'User routine',!deleted,'liftlog',now(),deleted];if(old)putRow(ops,'Routines',old.row,row);else addRow(ops,'Routines',row);const seen=new Set();if(!deleted)for(const [k,item] of (t.items||[]).entries()){const itemId=`${t.id}-${String(k+1).padStart(2,'0')}`,prior=info.rows.items.get(itemId);seen.add(itemId);const sets=item.sets||[],first=sets[0]||{};const itemRow=[itemId,t.id,k+1,item.exerciseId,sets.length||1,str(first.reps)||'10',str(first.weight),bridge.getState().settings.unit,'',now(),false,JSON.stringify(sets)];if(prior)putRow(ops,'Routine Items',prior.row,itemRow);else addRow(ops,'Routine Items',itemRow);}
    for(const [itemId,entry] of info.rows.items){if(str(entry.data?.[1])!==t.id||seen.has(itemId)||truth(entry.data?.[10]))continue;const line=[...entry.data];while(line.length<12)line.push('');line[10]=true;line[9]=now();putRow(ops,'Routine Items',entry.row,line);}
  }
  async function sendOps(ops){if(ops.update.length){await request('/values:batchUpdate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data:ops.update})});}for(const name of ['Sets','Routine Items','Exercises','Routines','Workouts']){const rows=ops.append[name]||[];if(!rows.length)continue;const end={Workouts:'M',Sets:'R',Exercises:'M',Routines:'I','Routine Items':'L'}[name];await request(`/values/${encodeURIComponent(`'${name}'!A:${end}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:rows})});}}
  async function sync(){if(!PRODUCTION_SYNC_ENABLED){notify(disabledMessage);return;}if(!bridge||lastStatus.busy||!navigator.onLine)return;if(!checkToken()){notify('Google session is not active. Tap Connect Google to refresh it.');return;}
    lastStatus.busy=true;notify('Synchronizing with Google Sheets…');let newCount=0,received=0,changes=0;const conflicts=[];const s=bridge.getState(),meta=getSyncState(),pending=[];
    try {const data=await fetchRemote(),remote=parseRemote(data,s),local=makeMaps(s),ops={update:[],append:{}};
      for(const type of TYPES){const base=meta.baseline[type],allIds=new Set([...local[type].keys(),...remote.maps[type].keys()]);const deletedKey=type==='workouts'?'deletedWorkoutIds':'deleted'+type[0].toUpperCase()+type.slice(1)+'Ids';for(const id of meta[deletedKey])allIds.add(id);
        for(const id of allIds){let l=local[type].get(id),r=remote.maps[type].get(id);const tomb=meta[deletedKey].includes(id);
          if(type==='exercises'&&l&&!r&&!l.custom){continue;}
          const old=base[id];const localHash=l?await hash(canonical(type,l)):null,remoteHash=r?await hash(canonical(type,r)):null;
          if(tomb){if(r&&old&&remoteHash!==old){conflicts.push({type,id,reason:'Record changed in Sheet since deletion',local:l,remote:r});continue;}if(r){if(type==='workouts')stageWorkout(ops,r,remote,s,true);else if(type==='exercises')stageExercise(ops,r,remote,true);else stageTemplate(ops,r,remote,true);}pending.push({type,id,deleted:true});continue;}
          if(l&&!r){if(old){conflicts.push({type,id,reason:'Sheet record missing or deleted',local:l,remote:null});continue;}
            if(type==='workouts')stageWorkout(ops,l,remote,s);else if(type==='exercises')stageExercise(ops,l,remote);else stageTemplate(ops,l,remote);
            pending.push({type,id,value:l});newCount++;continue;}
          if(!l&&r){if(old){if(type==='workouts'){// A local deletion must never silently erase Google history.
              conflicts.push({type,id,reason:'Workout missing on phone',local:null,remote:r});continue;}
            }
            adopt(type,r,s);pending.push({type,id,value:r});received++;changes++;continue;}
          if(!l||!r)continue;
          if(localHash===remoteHash){pending.push({type,id,value:l});continue;}
          // Pre-seeded reference exercises are authoritative on the first sync,
          // unless the user has customized their increment away from the built-in default.
          if(!old&&type==='exercises'&&!l.custom){const builtIn=bridge.baseExercises().find(e=>e.id===id);if(builtIn&&canonicalExercise(l).increment===canonicalExercise(builtIn).increment&&(!l.incrementKg||num(l.incrementKg)===num(r.incrementKg))){adopt(type,r,s);pending.push({type,id,value:r});received++;changes++;continue;}}
          if(!old){conflicts.push({type,id,reason:'Different unsynced copies',local:l,remote:r});continue;}
          const lc=localHash!==old,rc=remoteHash!==old;
          if(lc&&rc){conflicts.push({type,id,reason:'Edited on phone and in Sheet',local:l,remote:r});continue;}
          if(rc){adopt(type,r,s);pending.push({type,id,value:r});received++;changes++;}
          else if(lc){if(type==='workouts')stageWorkout(ops,l,remote,s);else if(type==='exercises')stageExercise(ops,l,remote);else stageTemplate(ops,l,remote);pending.push({type,id,value:l});newCount++;}
          else{conflicts.push({type,id,reason:'Unexpected version mismatch',local:l,remote:r});}
        }
      }
      // Default A/B/C plans are authored in Sheets and can be adjusted by ChatGPT.
      s.remotePlans=remote.remotePlans;
      // Do not mark any changes successfully synchronized until *all* writes succeed.
      if(ops.update.length||Object.keys(ops.append).length)await sendOps(ops);
      for(const p of pending){if(p.deleted){delete meta.baseline[p.type][p.id];continue;}meta.baseline[p.type][p.id]=await hash(canonical(p.type,p.value));}
      for(const type of TYPES){const key=type==='workouts'?'deletedWorkoutIds':'deleted'+type[0].toUpperCase()+type.slice(1)+'Ids';meta[key]=meta[key].filter(id=>!pending.some(p=>p.type===type&&p.id===id&&p.deleted));}
      meta.lastSuccess=now();lastStatus.last=meta.lastSuccess;lastStatus.conflicts=conflicts;lastStatus.connected=true;
      suppress=true;bridge.persist();suppress=false;
      notify(conflicts.length?`Sync saved, but ${conflicts.length} conflicting change(s) need review.`:`Synced ✓  ·  ${newCount} uploaded, ${received} downloaded`);
    }catch(err){suppress=false;lastStatus.conflicts=conflicts;lastStatus.message='Sync failed: '+err.message;lastStatus.connected=checkToken();bridge.toast(lastStatus.message,6500);}
    finally{lastStatus.busy=false;if(bridge.tab()==='more')bridge.render();}
  }
  function schedule(){if(!PRODUCTION_SYNC_ENABLED)return;if(suppress||lastStatus.busy||!checkToken()||!navigator.onLine)return;
    // Never spend time syncing after every tap while the user is actively lifting.
    if(bridge.getState().active&&bridge.tab()==='workout')return;
    clearTimeout(timer);timer=setTimeout(()=>sync(),5000);}
  async function chooseConflict(type,id,which){
    if(!PRODUCTION_SYNC_ENABLED){notify(disabledMessage);return;}
    const c=lastStatus.conflicts.find(c=>c.type===type&&c.id===id);
    if(!c)return;
    const s=bridge.getState(),meta=getSyncState();
    if(which==='sheet'){
      if(c.remote){adopt(type,c.remote,s);meta.baseline[type][id]=await hash(canonical(type,c.remote));}
      else{removeLocal(type,id,s);delete meta.baseline[type][id];}
      const deletionKey=type==='workouts'?'deletedWorkoutIds':'deleted'+type[0].toUpperCase()+type.slice(1)+'Ids';meta[deletionKey]=meta[deletionKey].filter(x=>x!==id);
    }else{
      if(c.remote)meta.baseline[type][id]=await hash(canonical(type,c.remote));
      else delete meta.baseline[type][id];
    }
    lastStatus.conflicts=lastStatus.conflicts.filter(x=>x!==c);
    bridge.persist();bridge.render();
    notify(which==='sheet'?'Using Sheet version.':'Keeping phone version; preparing an upload.');
    if(which==='phone')sync();
  }
  function renderCard(){if(!PRODUCTION_SYNC_ENABLED)return `<div class="card"><h2>Google Sheets sync paused</h2><p>${disabledMessage}</p><p>Offline logging, history and backup export remain available.</p></div>`;const connected=checkToken(),id=clientId(),c=lastStatus.conflicts;return `<div class="card"><h2 class="section-title margin-bottom">Google Sheets · two-way sync</h2><p class="subtle">Workouts save instantly on your iPhone. While connected, edits sync with your private Sheet. Reconnect periodically when Google's short-lived sign-in expires. Never paste passwords or OAuth secrets here.</p><div class="sync-indicator">${connected?'🟢 Connected':'⚪ Not connected'} · ${escapeHTML(lastStatus.message)}</div><div class="subtle small">Last successful sync: ${escapeHTML(fmtTime(lastStatus.last||getSyncState().lastSuccess))}</div><div class="field margin-top"><label for="google-client-id">Google OAuth <strong>web client ID</strong> (not a secret)</label><input id="google-client-id" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="12345-abc.apps.googleusercontent.com" value="${escapeHTML(id)}"></div><div class="stack margin-top"><button class="button full" data-action="google-connect">${connected?'Reconnect Google':'Connect Google'}</button><button class="button dark full" data-action="google-sync" ${!connected||lastStatus.busy?'disabled':''}>${lastStatus.busy?'Syncing…':'Sync now ↕'}</button>${connected?'<button class="button ghost full" data-action="google-disconnect">Disconnect</button>':''}</div><p class="subtle small margin-top-sm">Data lives in <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit" target="_blank" rel="noopener">your private LiftLog Sheet</a>. One-time Google Cloud authorization is required. <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Get OAuth client ID</a>.</p>${c.length?`<div class="notice warn margin-top">${c.length} edit conflicts — choose which copy to keep. No data was overwritten automatically.</div>${c.map(x=>`<div class="sync-conflict"><strong>${escapeHTML(x.type)} · ${escapeHTML(x.id)}</strong><p class="subtle small">${escapeHTML(x.reason)}</p><div class="row margin-top-sm"><button class="button dark sm" data-action="sync-choose-sheet" data-type="${escapeHTML(x.type)}" data-id="${escapeHTML(x.id)}">Keep Sheet</button><button class="button dark sm" data-action="sync-choose-phone" data-type="${escapeHTML(x.type)}" data-id="${escapeHTML(x.id)}">Keep phone</button></div></div>`).join('')}`:''}</div>`;}
  function init(handlers){bridge=handlers;if(!PRODUCTION_SYNC_ENABLED){lastStatus.message=disabledMessage;return;}getSyncState();lastStatus.last=bridge.getState().sync.lastSuccess||'';
    window.addEventListener('online',schedule);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    setInterval(()=>{if(!document.hidden&&checkToken()&&!lastStatus.busy&&!bridge.getState().active)sync();},5*60*1000);
  }
  window.LiftLogSync={init,renderCard,connect,disconnect,sync,schedule,chooseConflict,get status(){return {...lastStatus};}};
})();
