import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readlinkSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const fail=()=>Object.assign(new Error('Shared daemon identity unavailable'),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
const requireValue=value=>{if(!value)throw fail();};
const pathValid=value=>typeof value==='string'&&value.length>1&&value.length<=4096&&isAbsolute(value)&&resolve(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const mode=info=>Number(info.mode)&0o7777;
const stamp=info=>Object.freeze({dev:String(info.dev),ino:String(info.ino),uid:Number(info.uid),mode:mode(info),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)});
const same=(a,b)=>Object.keys(a).every(key=>a[key]===b[key])&&Object.keys(b).every(key=>a[key]===b[key]);
function ownedDirectory(path,uid) {
  const info=lstatSync(path,{bigint:true});
  requireValue(info.isDirectory()&&!info.isSymbolicLink()&&Number(info.uid)===uid&&(mode(info)&0o022)===0&&realpathSync(path)===path);
  return Object.freeze({dev:String(info.dev),ino:String(info.ino),uid:Number(info.uid),mode:mode(info)});
}
function processStamp(pid,expectedTicks,uid,sha256,initial) {
  const root=`/proc/${pid}`;
  const statText=readFileSync(`${root}/stat`,'utf8'),end=statText.lastIndexOf(')');requireValue(end>0);
  const fields=statText.slice(end+2).trim().split(/\s+/);
  requireValue(fields[0]!=='Z'&&fields[19]===expectedTicks);
  const status=readFileSync(`${root}/status`,'utf8');
  requireValue(Number(/^Uid:\s+(\d+)/m.exec(status)?.[1])===uid);
  const executable=readlinkSync(`${root}/exe`),info=statSync(`${root}/exe`,{bigint:true});
  requireValue(pathValid(executable)&&!executable.endsWith(' (deleted)')&&info.isFile()&&(Number(info.uid)===uid||Number(info.uid)===0)&&(mode(info)&0o022)===0&&(mode(info)&0o111)!==0);
  const command=readFileSync(`${root}/cmdline`);requireValue(command.length>0&&command.length<=131072);
  requireValue(command.toString('utf8').split('\0').includes('app-server'));
  if(initial) {
    requireValue(info.size<=512n*1024n*1024n);
    requireValue(createHash('sha256').update(readFileSync(`${root}/exe`)).digest('hex')===sha256);
  }
  const finalStat=readFileSync(`${root}/stat`,'utf8'),last=finalStat.slice(finalStat.lastIndexOf(')')+2).trim().split(/\s+/);
  requireValue(last[0]!=='Z'&&last[19]===expectedTicks&&same(stamp(info),stamp(statSync(`${root}/exe`,{bigint:true}))));
  return Object.freeze({pid,startTicks:expectedTicks,exe:executable,file:stamp(info),argvHash:createHash('sha256').update(command).digest('hex')});
}
function listenerInode(paths,pid) {
  const lines=readFileSync('/proc/net/unix','utf8').split('\n').slice(1),matches=[];
  for(const line of lines){
    const fields=/^\s*[0-9a-f]+:\s+[0-9a-f]+\s+[0-9a-f]+\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(\d+)\s+(.+)$/i.exec(line);
    if(fields&&paths.includes(fields[5])&&(parseInt(fields[1],16)&0x10000)!==0&&fields[2]==='0001'&&fields[3]==='01')matches.push(fields[4]);
  }
  const unique=[...new Set(matches)];requireValue(unique.length===1);
  let owned=false;
  for(const name of readdirSync(`/proc/${pid}/fd`)){
    try{if(readlinkSync(`/proc/${pid}/fd/${name}`)===`socket:[${unique[0]}]`){owned=true;break;}}
    catch(error){if(error?.code!=='ENOENT')throw error;}
  }
  requireValue(owned);return unique[0];
}
function socketStamp(path,pid,uid) {
  const link=lstatSync(path,{bigint:true});
  requireValue((link.isSocket()||link.isSymbolicLink())&&Number(link.uid)===uid);
  const target=realpathSync(path);requireValue(pathValid(target));
  const info=statSync(target,{bigint:true});
  requireValue(info.isSocket()&&Number(info.uid)===uid&&(mode(info)&0o077)===0);
  const aliasParent=ownedDirectory(dirname(path),uid),realParent=ownedDirectory(dirname(target),uid);
  const inode=listenerInode([...new Set([path,target])],pid);
  requireValue(same(stamp(link),stamp(lstatSync(path,{bigint:true})))&&same(stamp(info),stamp(statSync(target,{bigint:true})))&&realpathSync(path)===target);
  return Object.freeze({path,target,link:stamp(link),file:stamp(info),aliasParent,realParent,listenerInode:inode});
}
function equalRecord(a,b){return JSON.stringify(a)===JSON.stringify(b);}

/**
 * Trusted-server registration only: pins a real daemon process and its owned
 * Unix listener, then repeats identity checks synchronously at final dispatch.
 * This is solely transport identity, never account, history, view or intent
 * authority and never sufficient to enable shared threads on its own.
 */
export function captureSharedDaemonIdentity({pid,startTicks,socketPath,daemonGeneration,exeSha256}={}) {
  try {
    requireValue(process.platform==='linux'&&typeof process.getuid==='function'&&Number.isSafeInteger(pid)&&pid>1&&typeof startTicks==='string'&&/^[0-9]{1,30}$/.test(startTicks)&&pathValid(socketPath)&&UUID.test(daemonGeneration??'')&&SHA.test(exeSha256??''));
    const uid=process.getuid();
    const processRecord=processStamp(pid,startTicks,uid,exeSha256,true),socketRecord=socketStamp(socketPath,pid,uid);
    requireValue(equalRecord(processRecord,processStamp(pid,startTicks,uid,exeSha256,false))&&equalRecord(socketRecord,socketStamp(socketPath,pid,uid)));
    let closed=false;
    return Object.freeze({
      daemonGeneration,
      assertCurrent(){
        try{requireValue(!closed&&equalRecord(processRecord,processStamp(pid,startTicks,uid,exeSha256,false))&&equalRecord(socketRecord,socketStamp(socketPath,pid,uid)));}
        catch{throw fail();}
      },
      close(){closed=true;},
    });
  } catch {throw fail();}
}
