'use strict';
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const CLI_SHA='6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
const denied=()=>Error('Native thread read identity unavailable');
const same=(a,b)=>['dev','ino','size','uid','gid','mode','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
function processIdentity(pid){
 const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),end=stat.lastIndexOf(')');if(end<1)throw denied();
 const fields=stat.slice(end+2).trim().split(/\s+/);if(['Z','X','x'].includes(fields[0])||!/^\d+$/.test(fields[19]??''))throw denied();
 const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');if(Number(/^Uid:\s+(\d+)/m.exec(status)?.[1])!==process.getuid())throw denied();
 const path=fs.readlinkSync(`/proc/${pid}/exe`);if(!path.startsWith('/')||path.endsWith(' (deleted)'))throw denied();
 const args=fs.readFileSync(`/proc/${pid}/cmdline`);if(!args.length||args.length>128*1024||!args.toString().split('\0').includes('app-server'))throw denied();
 return{pid,startTicks:fields[19],path,argsSha:createHash('sha256').update(args).digest('hex')};
}
const equalProcess=(a,b)=>['pid','startTicks','path','argsSha'].every(key=>a[key]===b[key]);

/** Only the original local SDK connection can select its own spawned PID.
 * Capture its exact pinned executable once, retain that FD, then verify the
 * held file, live PID/start ticks, command and executable identity on each read.
 * A version string alone never grants the missing-thread error conversion.
 */
function createNativeThreadReadIdentityGuard({verifyRuntimeSync}={}){
 if(typeof verifyRuntimeSync!=='function')throw denied();
 const byConnection=new WeakMap(),held=new Set();let closed=false;
 function release(record){if(!record||!held.delete(record))return;try{fs.closeSync(record.fd);}catch{}}
 function current(){try{return !closed&&process.platform==='linux'&&verifyRuntimeSync()===true;}catch{return false;}}
 function verify(connection){
  let record;
  try{
   if(!current()||!connection||typeof connection!=='object'||typeof connection.getLocalProcessId!=='function'||typeof connection.getConnectionState!=='function'||connection.getConnectionState()!=='connected')return false;
   const pid=connection.getLocalProcessId();if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)return false;
   const identity=processIdentity(pid);record=byConnection.get(connection);
   if(record&&!equalProcess(record.identity,identity)){release(record);byConnection.delete(connection);record=null;}
   if(!record){
    if(held.size>=16)return false;
    const fd=fs.openSync(`/proc/${pid}/exe`,fs.constants.O_RDONLY);
    try{
     const info=fs.fstatSync(fd,{bigint:true});if(!info.isFile()||info.size<=0||info.size>512n*1024n*1024n||
      ![0n,BigInt(process.getuid())].includes(info.uid)||(info.mode&0o022n)!==0n||(info.mode&0o111n)===0n)throw denied();
     const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let offset=0;
     for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,offset);if(!n)break;hash.update(buffer.subarray(0,n));offset+=n;}
     if(hash.digest('hex')!==CLI_SHA||!same(info,fs.fstatSync(fd,{bigint:true}))||!same(info,fs.statSync(`/proc/${pid}/exe`,{bigint:true}))||!equalProcess(identity,processIdentity(pid)))throw denied();
     record={fd,info,identity};held.add(record);byConnection.set(connection,record);
    }catch(error){fs.closeSync(fd);throw error;}
   }
   if(!current()||connection.getLocalProcessId()!==pid||connection.getConnectionState()!=='connected'||
      !equalProcess(record.identity,processIdentity(pid))||!same(record.info,fs.fstatSync(record.fd,{bigint:true}))||!same(record.info,fs.statSync(`/proc/${pid}/exe`,{bigint:true})))throw denied();
   return true;
  }catch{if(record){release(record);if(connection&&typeof connection==='object')byConnection.delete(connection);}return false;}
 }
 function close(){if(closed)return;closed=true;for(const record of held)release(record);}
 return Object.freeze({verify,close});
}
module.exports={createNativeThreadReadIdentityGuard};
