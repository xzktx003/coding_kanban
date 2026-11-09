import { isAbsolute, relative, resolve } from 'node:path';
import { validateRunnerConfig } from './chatgpt-desktop-container-acceptance.mjs';
const fail=code=>Object.assign(new Error(code),{code});
const canonicalString=value=>typeof value==='string'&&value.length>1&&value.length<=4096&&isAbsolute(value)&&resolve(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const contains=(parent,child)=>{const value=relative(parent,child);return value===''||(!value.startsWith('../')&&value!=='..'&&!isAbsolute(value))};
export function validateAccountConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('ACCOUNT_ACCEPTANCE_CONFIG_INVALID');
 const {accountSourceFile,accountHomeRoot,...base}=value;
 try{validateRunnerConfig(base)}catch{throw fail('ACCOUNT_ACCEPTANCE_CONFIG_INVALID')}
 if(!canonicalString(accountSourceFile)||!canonicalString(accountHomeRoot)||accountHomeRoot==='/'||accountSourceFile==='/'||[base.privateRoot,base.evidenceRoot,base.sourceRoot,base.macAsarPath,base.browserCacheRoot].some(p=>contains(p,accountSourceFile)||contains(accountSourceFile,p)||contains(p,accountHomeRoot)||contains(accountHomeRoot,p))||contains(accountHomeRoot,accountSourceFile)||contains(accountSourceFile,accountHomeRoot))throw fail('ACCOUNT_ACCEPTANCE_CONFIG_INVALID');
 return value;
}
export function classifyWorkState(state){
 if(!state||typeof state!=='object'||!Object.hasOwn(state,'environmentId'))return 'unknown';
 if(state.enabled===false&&state.ready===false&&state.environmentId===null)return 'disabled';
 if(state.enabled===true||state.ready===true||state.environmentId!=null)return 'active-or-enabled';
 return 'unknown';
}
export function authorizeAccountCleanup(v){
 return !!(v&&v.work==='disabled'&&v.execServerPeak===0&&v.processSamplingErrors===0&&Number.isSafeInteger(v.processSamples)&&v.processSamples>0&&v.workload==='no-tasks-proven'&&v.viewClosed===true&&v.sourceUnchanged===true);
}

/** Hold a source FD for the full run; emit only same/metadata, never bytes or digests. */
export async function openAccountSourceObserver(path){
 const {constants}=await import('node:fs');const {open,lstat,realpath,readdir}=await import('node:fs/promises');const {dirname,basename,join}=await import('node:path');const {createHash,timingSafeEqual}=await import('node:crypto');
 const uid=process.getuid?.();if(uid===undefined||!canonicalString(path))throw fail('ACCOUNT_SOURCE_UNSAFE');
 const parent=dirname(path),same=(a,b)=>['dev','ino','uid','gid','mode','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);let directory,handle,baseline;
 try{
  directory=await open(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const dirIdentity=await directory.stat({bigint:true});
  if(!dirIdentity.isDirectory()||dirIdentity.uid!==BigInt(uid)||(dirIdentity.mode&0o7777n)!==0o700n||await realpath(parent)!==parent)throw fail('ACCOUNT_SOURCE_UNSAFE');
  const parentPath=`/proc/self/fd/${directory.fd}`;
  handle=await open(join(parentPath,basename(path)),constants.O_RDONLY|constants.O_NOFOLLOW);
  const original=await handle.stat({bigint:true});
  if(!original.isFile()||original.uid!==BigInt(uid)||(original.mode&0o7777n)!==0o600n||original.size<1n||original.size>262144n||await realpath(path)!==path||!same(original,await lstat(path,{bigint:true})))throw fail('ACCOUNT_SOURCE_UNSAFE');
  async function digest(){const b=Buffer.alloc(Number(original.size)+1);try{let n=0;for(;;){const q=await handle.read(b,n,b.length-n,n);if(q.bytesRead===0)break;n+=q.bytesRead;if(n===b.length)throw fail('ACCOUNT_SOURCE_CHANGED')}if(n!==Number(original.size))throw fail('ACCOUNT_SOURCE_CHANGED');return createHash('sha256').update(b.subarray(0,n)).digest()}finally{b.fill(0)}}
  baseline=await digest();if(!same(original,await handle.stat({bigint:true}))||!same(original,await lstat(path,{bigint:true})))throw fail('ACCOUNT_SOURCE_CHANGED');
  let closed=false;
  return Object.freeze({
   async verify(){try{if(closed)return {same:false};const p=await lstat(path,{bigint:true}),d=await lstat(parent,{bigint:true}),h=await handle.stat({bigint:true});if(!same(original,p)||!same(original,h)||!['dev','ino','uid','gid','mode'].every(k=>dirIdentity[k]===d[k])||await realpath(path)!==path)return {same:false};const value=await digest();try{return {same:timingSafeEqual(baseline,value)&&same(original,await handle.stat({bigint:true}))&&same(original,await lstat(path,{bigint:true}))}}finally{value.fill(0)}}catch{return {same:false}}},
   async inventory(){if(closed)throw fail('ACCOUNT_SOURCE_CLOSED');const entries=await readdir(parentPath,{withFileTypes:true});if(entries.length>4096)throw fail('ACCOUNT_SOURCE_INVENTORY_LIMIT');const rows=[];for(const entry of entries){const s=await lstat(join(parentPath,entry.name),{bigint:true});rows.push({name:entry.name,type:s.isFile()?'file':s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'other',size:Number(s.size),mode:(s.mode&0o7777n).toString(8)})}return rows.sort((a,b)=>a.name.localeCompare(b.name,'en'))},
   async close(){if(closed)return;closed=true;baseline.fill(0);await Promise.allSettled([handle.close(),directory.close()])}
  });
 }catch(error){baseline?.fill(0);await Promise.allSettled([handle?.close(),directory?.close()]);throw fail(typeof error?.code==='string'&&/^ACCOUNT_SOURCE_[A-Z_]+$/.test(error.code)?error.code:'ACCOUNT_SOURCE_UNSAFE')}
}

/** Count ps argv patterns, not an authoritative task/lease inventory. */
export function countExecServerProcesses(lines){
 if(!Array.isArray(lines)||lines.length>4096||lines.some(x=>typeof x!=='string'||x.length>65536))throw fail('ACCOUNT_PROCESS_SAMPLE_INVALID');
 return lines.filter(row=>/^\s*(?:\S*\/)?codex(?:\s+\S+)*?\s+exec-server(?:\s|$)|^\s*(?:\S*\/)?codex-exec-server(?:\s|$)/.test(row)).length;
}

export function parseDockerProcessSnapshot(output){
 if(typeof output!=='string'||output.length>1024*1024)throw fail('ACCOUNT_PROCESS_SAMPLE_INVALID');
 const rows=output.trim().split('\n');if(rows.length<2||rows.length>4097||!/^\s*PID\s+(?:COMMAND|ARGS)\s*$/.test(rows[0]))throw fail('ACCOUNT_PROCESS_SAMPLE_INVALID');
 const args=rows.slice(1).map(row=>{const m=/^\s*([1-9][0-9]*)\s+(\S.*)$/.exec(row);if(!m)throw fail('ACCOUNT_PROCESS_SAMPLE_INVALID');return m[2]});
 return {processes:args.length,execServers:countExecServerProcesses(args)};
}
