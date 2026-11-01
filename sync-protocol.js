'use strict';
/* Experimental immutable journal protocol. Not wired to production Google sync.
   Storage and network adapters are injected; no token or Sheet ID belongs here. */
(function(root){
  const copy=x=>JSON.parse(JSON.stringify(x));
  const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
  async function digest(value){const bytes=new TextEncoder().encode(canonical(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
  function check(op){
    if(!op||op.version!==1||!['workout','exercise','routine'].includes(op.kind)||typeof op.entity!=='string'||!op.entity||typeof op.id!=='string'||!op.id||typeof op.device!=='string'||!op.device||!Array.isArray(op.parents)||op.parents.some(p=>typeof p!=='string'||!p)||new Set(op.parents).size!==op.parents.length||typeof op.deleted!=='boolean'||(op.deleted?op.value!==null:!op.value||typeof op.value!=='object'||Array.isArray(op.value)))throw Error('Invalid journal operation');
    if(op.parents.includes(op.id))throw Error('Operation cannot parent itself');
  }
  async function sign(op){check(op);return {...copy(op),checksum:await digest(op)};}
  async function verify(op){check(op);const {checksum,...body}=op;if(checksum!==await digest(body))throw Error('Journal checksum mismatch');return copy(op);}
  // Stable operation IDs make an append safe to retry after a lost response.
  // Conflicting heads remain visible; no timestamp chooses a silent winner.
  async function replay(rows){
    const ops=new Map();
    for(const row of rows){const op=await verify(row),old=ops.get(op.id);if(old&&canonical(old)!==canonical(op))throw Error('Operation ID reused with different content');ops.set(op.id,op);}
    const groups=new Map(),visited=new Set(),visiting=new Set();
    function visit(op){
      if(visited.has(op.id))return;if(visiting.has(op.id))throw Error('Journal cycle');visiting.add(op.id);
      for(const parent of op.parents){const p=ops.get(parent);if(!p)throw Error('Journal parent missing');if(p.kind!==op.kind||p.entity!==op.entity)throw Error('Journal parent belongs to another entity');visit(p);}
      visiting.delete(op.id);visited.add(op.id);
    }
    for(const op of ops.values()){
      visit(op);const key=JSON.stringify([op.kind,op.entity]);if(!groups.has(key))groups.set(key,new Map());groups.get(key).set(op.id,op);
    }
    const records=[];
    for(const group of groups.values()){
      const heads=new Map(group);for(const op of group.values())for(const parent of op.parents)heads.delete(parent);
      const versions=[...heads.values()].sort((a,b)=>a.id.localeCompare(b.id));const first=versions[0];
      records.push({kind:first.kind,entity:first.entity,conflict:versions.length>1,versions:copy(versions)});
    }
    return records.sort((a,b)=>a.kind.localeCompare(b.kind)||a.entity.localeCompare(b.entity));
  }
  function outbox({load,save,device,newId}){
    let busy=false,writes=Promise.resolve();
    function read(){const d=load();if(!d||d.version!==1||!Array.isArray(d.pending))throw Error('Invalid outbox');return copy(d);}
    function mutate(fn){const task=writes.then(async()=>{const d=read();const result=fn(d);await save(d);return result;});writes=task.catch(()=>{});return task;}
    return {
      async enqueue({kind,entity,parents=[],value=null,deleted=false}){
        const op=await sign({version:1,id:newId(),device,kind,entity,parents:[...parents].sort(),deleted,value:deleted?null:copy(value)});
        return mutate(d=>{if(d.pending.some(x=>x.id===op.id))throw Error('Operation ID collision');d.pending.push(op);return copy(op);});
      },
      async flush(transport){
        if(busy)throw Error('Sync already running');busy=true;
        try{
          // Readback verification is mandatory, even after an acknowledged append.
          // A failed append may still have committed: retry reads before sending.
          for(const op of read().pending){
            let remote=await transport.read();await replay(remote);
            let found=remote.find(x=>x.id===op.id);
            if(!found){await transport.append(copy(op));remote=await transport.read();await replay(remote);found=remote.find(x=>x.id===op.id);}
            if(!found||canonical(found)!==canonical(op))throw Error('Upload not verified');
            await mutate(d=>{const current=d.pending.find(x=>x.id===op.id);
              if(!current||canonical(current)!==canonical(op))throw Error('Pending operation changed during upload');
              d.pending=d.pending.filter(x=>x.id!==op.id);});
          }
        }finally{busy=false;}
      }
    };
  }
  const api={sign,verify,replay,outbox};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LiftLogJournal=api;
})(globalThis);
