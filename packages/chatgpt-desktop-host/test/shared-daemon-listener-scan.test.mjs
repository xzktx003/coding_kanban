import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/shared-daemon-identity.mjs',import.meta.url),'utf8');
const start=source.indexOf('function listenerInode(paths,pid) {'),end=source.indexOf('function socketStamp(',start);
assert.ok(start>=0&&end>start,'execute the actual complete private listener identity helper');
function fixture(){
 const state={rows:'0000: 00000002 00000000 00010000 0001 01 456 /owned/sock\n',links:new Map([['0','/owned/file0'],['1','socket:[456]'],['2','/owned/file2'],['3','/owned/file3'],['4','/owned/file4']]),calls:[],tableReads:0,dirReads:0};
 const requireValue=value=>{if(!value)throw Object.assign(Error('identity denied'),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});};
 const ctx=vm.createContext({Set,parseInt,requireValue,readFileSync(path,encoding){assert.equal(path,'/proc/net/unix');assert.equal(encoding,'utf8');state.tableReads++;return 'Num RefCount Protocol Flags Type St Inode Path\n'+state.rows;},readdirSync(path){assert.equal(path,'/proc/77/fd');state.dirReads++;return [...state.links.keys()];},readlinkSync(path){assert.ok(path.startsWith('/proc/77/fd/'));const fd=path.slice(path.lastIndexOf('/')+1);state.calls.push(fd);const value=state.links.get(fd);if(value instanceof Error)throw value;return value;}});
 const read=vm.runInContext(source.slice(start,end)+'\nlistenerInode',ctx);
 return {state,read:()=>read(['/owned/sock'],77)};
}
test('listener ownership stops at the first fresh exact FD match',()=>{const f=fixture();assert.equal(f.read(),'456');assert.deepEqual(f.state.calls,['0','1'],'unrelated descriptor suffix adds no ownership evidence');assert.equal(f.state.tableReads,1);assert.equal(f.state.dirReads,1);});
test('every call freshly reads the listener table, FD directory and current FD target',()=>{const f=fixture();assert.equal(f.read(),'456');f.state.calls.length=0;f.state.links.set('1','/owned/reused-file');f.state.links.set('3','socket:[456]');assert.equal(f.read(),'456');assert.deepEqual(f.state.calls,['0','1','2','3']);assert.equal(f.state.tableReads,2);assert.equal(f.state.dirReads,2);f.state.links.set('3','socket:[999]');assert.throws(f.read,{code:'SHARED_DAEMON_IDENTITY_CHANGED'});});
test('missing ownership still scans the complete current descriptor set and refuses',()=>{const f=fixture();f.state.links.set('1','socket:[999]');assert.throws(f.read,{code:'SHARED_DAEMON_IDENTITY_CHANGED'});assert.deepEqual(f.state.calls,['0','1','2','3','4']);});
test('a changed, ambiguous or non-listening native socket table is refused before FD ownership',()=>{for(const rows of ['0000: 00000002 00000000 00010000 0001 01 999 /owned/sock\n','0000: 00000002 00000000 00010000 0001 01 456 /owned/sock\n0001: 00000002 00000000 00010000 0001 01 999 /owned/sock\n','0000: 00000002 00000000 00000000 0001 01 456 /owned/sock\n']){const f=fixture();f.state.rows=rows;assert.throws(f.read,{code:'SHARED_DAEMON_IDENTITY_CHANGED'});assert.equal(f.state.tableReads,1);}});
test('ENOENT before the match is tolerated and other prefix errors remain original failures',()=>{const f=fixture();f.state.links.set('0',Object.assign(Error('gone'),{code:'ENOENT'}));assert.equal(f.read(),'456');const e=Object.assign(Error('denied'),{code:'EACCES'});f.state.links.set('0',e);assert.throws(f.read,x=>x===e);});
test('an unrelated suffix is not inspected after current listener ownership is proven',()=>{const f=fixture();f.state.links.set('4',Object.assign(Error('unrelated'),{code:'EACCES'}));assert.equal(f.read(),'456');assert.deepEqual(f.state.calls,['0','1']);});
