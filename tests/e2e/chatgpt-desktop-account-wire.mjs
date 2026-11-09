/** Inspect only fixed AppHost lifecycle metadata from the wire graph. */
export function classifyAccountAppHostGraph(v){
 try{if(!v||!Array.isArray(v.nodes)||v.nodes.length>100000)return 'other';
  const field=(ref,key)=>{if(!Array.isArray(ref)||ref[0]!=='r'||!Array.isArray(v.nodes[ref[1]]))return undefined;const node=v.nodes[ref[1]];return node[0]==='object'||node[0]==='array'?node[2]?.find(x=>x[0]===key)?.[1]:undefined};
  const type=field(v.root,'type'),port=field(v.root,'portId');if(typeof port!=='string'||!/^app-host-[1-9][0-9]*$/.test(port))return 'other';
  if(type==='openPort'&&field(v.root,'name')==='app-host')return 'open';if(type==='closePort')return 'close';
  if(type==='portPost'){const data=field(v.root,'data'),ref=field(data,'1'),member=field(ref,'2');if(field(data,'0')==='push'&&field(ref,'0')==='pipeline'&&field(member,'0')==='services')return 'services'}
 }catch{}return 'other';
}

/** Bounded timing metadata; values and message bodies are never retained. */
export function createAccountWireTracker({maxPending=1000}={}){
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>4096)throw Error('invalid pending budget');
 const pending=new Map(),empty=()=>({open:0,close:0,services:0,sent:0,acked:0,maxAckMs:0,latencyBins:{lt100ms:0,lt1s:0,lt5s:0,ge5s:0}}),stats={before:empty(),after:empty(),dropped:0,duplicate:0,unmatched:0,maxPending:0};
 const field=(v,ref,key)=>{if(!Array.isArray(ref)||ref[0]!=='r'||!Array.isArray(v?.nodes?.[ref[1]]))return undefined;const node=v.nodes[ref[1]];return node[0]==='object'||node[0]==='array'?node[2]?.find(x=>x[0]===key)?.[1]:undefined};
 function observe(direction,v,phase,time){try{if(!['sent','received'].includes(direction)||!['before','after'].includes(phase)||!Number.isFinite(time))return;const type=field(v,v.root,'type'),id=field(v,v.root,'id');
  if(direction==='sent'){
   const kind=classifyAccountAppHostGraph(v);if(kind!=='other')stats[phase][kind]++;
   if(!['call','openPort','closePort','portPost'].includes(type)||!Number.isSafeInteger(id)||id<0)return;stats[phase].sent++;
   if(pending.has(id)){stats.duplicate++;return}if(pending.size>=maxPending){stats.dropped++;return}pending.set(id,{phase,time});stats.maxPending=Math.max(stats.maxPending,pending.size);
  }else if(['return','throw'].includes(type)&&Number.isSafeInteger(id)&&id>=0){const prior=pending.get(id);if(!prior){stats.unmatched++;return}pending.delete(id);const ms=Math.max(0,time-prior.time),r=stats[prior.phase];r.acked++;r.maxAckMs=Math.max(r.maxAckMs,ms);r.latencyBins[ms<100?'lt100ms':ms<1000?'lt1s':ms<5000?'lt5s':'ge5s']++}
 }catch{}}
 return Object.freeze({observe,snapshot:()=>({before:structuredClone(stats.before),after:structuredClone(stats.after),pending:pending.size,dropped:stats.dropped,duplicate:stats.duplicate,unmatched:stats.unmatched,maxPending:stats.maxPending})});
}
