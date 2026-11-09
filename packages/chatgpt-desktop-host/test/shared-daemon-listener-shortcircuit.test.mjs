import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chmod,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureSharedDaemonIdentity} from '../src/shared-daemon-identity.mjs';

const executableSha=createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
const childSource=`
 import net from 'node:net';
 import fs from 'node:fs';
 const socketPath=process.argv[3],noisePath=process.argv[4],noise=[];
 const server=net.createServer();
 server.listen(socketPath,()=>{
  fs.chmodSync(socketPath,0o600);
  for(let i=0;i<128;i++)noise.push(fs.openSync(noisePath,'r'));
  process.send({ready:true,listenerFd:server._handle.fd});
 });
 process.on('message',message=>{
  if(message?.op==='close')server.close(()=>process.send({closed:true}));
 });
`;
function ticks(pid){const text=fs.readFileSync('/proc/'+pid+'/stat','utf8');return text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/)[19];}
async function ownedListener(t){
 const root=await mkdtemp(join(tmpdir(),'shared-listener-short-'));await chmod(root,0o700);
 const script=join(root,'owned-listener.mjs'),socketPath=join(root,'listener.sock'),noise=join(root,'noise');await writeFile(script,childSource,{mode:0o600});await writeFile(noise,'owned');
 const child=spawn(process.execPath,[script,'app-server',socketPath,noise],{stdio:['ignore','ignore','pipe','ipc']});child.stderr.resume();
 const ready=await Promise.race([new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('owned listener exited before readiness')));}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('owned listener startup timeout')),3000);timer.unref();})]);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(root,{recursive:true,force:true});});
 assert.equal(ready.ready,true);
 return{child,listenerFd:String(ready.listenerFd),expected:{pid:child.pid,startTicks:ticks(child.pid),socketPath,daemonGeneration:randomUUID(),exeSha256:executableSha}};
}

test('real listener checks stop at the first owned FD while refreshing the kernel listener and FD table each time',async t=>{
 const f=await ownedListener(t),identity=captureSharedDaemonIdentity(f.expected),fdRoot='/proc/'+f.child.pid+'/fd';t.after(()=>identity.close());
 const names=fs.readdirSync(fdRoot),matchIndex=names.indexOf(f.listenerFd);assert.ok(matchIndex>=0);assert.ok(names.length-matchIndex-1>=32,'the real listener must have a substantial unrelated suffix');
 const original={readlinkSync:fs.readlinkSync,readdirSync:fs.readdirSync,readFileSync:fs.readFileSync},reads=[],scans=[],listenerTables=[];
 try{
  // Transparent syscall observation: every read is performed by the real fs
  // function. No identity result, errno or returned bytes are mocked.
  fs.readlinkSync=function(path,...args){const value=original.readlinkSync.call(this,path,...args);if(String(path).startsWith(fdRoot+'/'))reads.push(String(path).slice(fdRoot.length+1));return value;};
  fs.readdirSync=function(path,...args){const value=original.readdirSync.call(this,path,...args);if(String(path)===fdRoot)scans.push(value.length);return value;};
  fs.readFileSync=function(path,...args){const value=original.readFileSync.call(this,path,...args);if(String(path)==='/proc/net/unix')listenerTables.push(1);return value;};
  syncBuiltinESMExports();
  for(let i=0;i<6;i++)identity.assertCurrent();
 }finally{Object.assign(fs,original);syncBuiltinESMExports();}
 assert.equal(listenerTables.length,6,'the live listening state must still be checked on every call');
 assert.equal(scans.length,6,'this optimization does not cache FD ownership');
 assert.equal(reads.length,6*(matchIndex+1),'an owned matching listener proves existence without probing the unrelated suffix');
 for(let i=0;i<6;i++)assert.deepEqual(reads.slice(i*(matchIndex+1),(i+1)*(matchIndex+1)),names.slice(0,matchIndex+1));
});

test('the short scan cannot bind another process listener or retain a closed listener',async t=>{
 const first=await ownedListener(t),other=await ownedListener(t);
 assert.throws(()=>captureSharedDaemonIdentity({...other.expected,socketPath:first.expected.socketPath}),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
 const identity=captureSharedDaemonIdentity(first.expected);t.after(()=>identity.close());identity.assertCurrent();
 const closed=new Promise(resolve=>first.child.once('message',resolve));first.child.send({op:'close'});assert.equal((await closed).closed,true);
 assert.throws(()=>identity.assertCurrent(),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
});
