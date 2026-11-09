const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES=64*1024;
const fail=()=>Object.assign(new Error('SSH alias discovery unavailable'),{code:'SSH_ALIAS_DISCOVERY_UNAVAILABLE'});

/** Invoked by the fixed original SSH settings query; accepts no host/path/command. */
export async function discoverServerSshAliases() {
  if(arguments.length)throw fail();
  const win=globalThis.window,raw=win?.document?.getElementById('chatgpt-host-manifest')?.textContent;
  let manifest;
  try{if(typeof raw!=='string'||raw.length>4096)throw fail();manifest=JSON.parse(raw);}catch{throw fail();}
  if(!manifest||!UUID.test(manifest.profileId??'')||!UUID.test(manifest.generation??'')||![2,3,4,5].includes(manifest.version))throw fail();
  const response=await win.fetch(`/api/chatgpt-desktop/${manifest.profileId}/${manifest.generation}/ssh/discover`,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json'}});
  if(response.status!==200||!response.body?.getReader)throw fail();
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;if(!(item.value instanceof Uint8Array)||(size+=item.value.byteLength)>MAX_BYTES){await reader.cancel();throw fail();}chunks.push(item.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail();}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Array.isArray(value.sshAliases)||value.sshAliases.length>512||value.sshAliases.some(alias=>typeof alias!=='string'||!alias.length))throw fail();
  return {sshAliases:value.sshAliases};
}
