// Private fixture-only review gate. The browser container mounts its control
// directory read-only; no HTTP endpoint exposes this file or its nonce.
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function validateCoreReadyGrant(bytes,identity,onJsonError){
 try{
  if(!Buffer.isBuffer(bytes)||bytes.length>1024||!identity||!['nonce','scopeHash','projectHash'].every(k=>sha(identity[k])))return false;
  const value=JSON.parse(bytes.toString('utf8'));
  if(!value||Object.keys(value).sort().join(',')!=='nonce,projectHash,scopeHash,version'||value.version!==1||!['nonce','scopeHash','projectHash'].every(k=>sha(value[k])))return false;
  const canonical=Buffer.from(JSON.stringify({version:1,nonce:value.nonce,scopeHash:value.scopeHash,projectHash:value.projectHash})+'\n');
  return bytes.equals(canonical)&&['nonce','scopeHash','projectHash'].every(k=>timingSafeEqual(Buffer.from(value[k],'hex'),Buffer.from(identity[k],'hex')));
 }catch(error){if(error instanceof SyntaxError&&typeof onJsonError==='function')try{onJsonError(error)}catch{}return false}
}
export async function waitForCoreReadyGrant({file,identity,timeoutMs=120000,intervalMs=1000,onJsonError}={}){
 if(typeof file!=='string'||!file.startsWith('/')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(intervalMs)||intervalMs<1||intervalMs>10000)return false;
 const deadline=performance.now()+timeoutMs;
 while(performance.now()<deadline){
  let fd;
  try{
   fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await fd.stat({bigint:true});
   if(!before.isFile()||before.uid!==BigInt(process.getuid())||(before.mode&0o7777n)!==0o600n||before.nlink!==1n||before.size>1024n)return false;
   const bytes=await fd.readFile(),after=await fd.stat({bigint:true}),named=await lstat(file,{bigint:true});
   if(!['dev','ino','uid','mode','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k]&&before[k]===named[k]))return false;
   return validateCoreReadyGrant(bytes,identity,onJsonError);
  }catch(error){if(error?.code!=='ENOENT')return false}finally{await fd?.close().catch(()=>{})}
  await delay(Math.min(intervalMs,Math.max(1,deadline-performance.now())));
 }
 return false;
}
export function createCoreReadyGrantGate(){
 let inFlight=false,consumed=false;
 return Object.freeze({async wait(options){if(inFlight||consumed)return false;inFlight=true;try{const allowed=await waitForCoreReadyGrant(options);if(allowed)consumed=true;return allowed}finally{inFlight=false}}});
}
