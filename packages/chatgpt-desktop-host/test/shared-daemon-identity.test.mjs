import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {chmod,mkdtemp,rm,unlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureSharedDaemonIdentity} from '../src/shared-daemon-identity.mjs';
const sha=createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
const fixturePath=fileURLToPath(new URL('./owned-daemon-fixture.mjs',import.meta.url));
function ticks(pid){const value=readFileSync(`/proc/${pid}/stat`,'utf8');return value.slice(value.lastIndexOf(')')+2).trim().split(/\s+/)[19];}
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'shared-daemon-test-'));await chmod(dir,0o700);const path=join(dir,'socket');
 const child=spawn(process.execPath,[fixturePath,'app-server',path],{stdio:['ignore','ignore','pipe','ipc']});
 child.stderr.on('data',()=>{});
 let timer;try{await Promise.race([new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('fixture exited')));}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture timeout')),3000);})]);}finally{clearTimeout(timer);}
 const expected={pid:child.pid,startTicks:ticks(child.pid),socketPath:path,daemonGeneration:randomUUID(),exeSha256:sha};
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
 return {dir,path,child,expected};
}
test('a real owned Unix listener is bound to the exact live process and its inode',async t=>{
 const f=await fixture(t),identity=captureSharedDaemonIdentity(f.expected);
 assert.equal(identity.assertCurrent(),undefined);
 await writeFile(join(f.dir,'unrelated-sibling'),'irrelevant');
 assert.equal(identity.assertCurrent(),undefined);
 const socket=createConnection(f.path);t.after(()=>socket.destroy());
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
 identity.assertCurrent();socket.write('only-fixture');
 assert.equal(await new Promise(resolve=>socket.once('data',x=>resolve(x.toString()))),'only-fixture');
 await unlink(f.path);
 assert.throws(()=>identity.assertCurrent(),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
});
test('mismatched PID generation and changed socket permissions fail closed',async t=>{
 const f=await fixture(t);
 assert.throws(()=>captureSharedDaemonIdentity({...f.expected,startTicks:String(Number(f.expected.startTicks)+1)}),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
 assert.throws(()=>captureSharedDaemonIdentity({...f.expected,exeSha256:'0'.repeat(64)}),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
 const identity=captureSharedDaemonIdentity(f.expected);await chmod(f.path,0o666);
 assert.throws(()=>identity.assertCurrent(),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
});
