import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {containerServerSshOption} from '../src/container-server-ssh.mjs';
import {preparePrivateRuntime} from '../src/private-runtime.mjs';
const require=createRequire(import.meta.url);
const {installNativeServerSshBridge}=require('../src/native-server-ssh-bridge.cjs');
const profileId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',generation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('server SSH is constructor opt-in only and rejects path/factory/accessor options',()=>{
 assert.equal(containerServerSshOption({}),undefined);assert.equal(containerServerSshOption({serverSsh:false}),undefined);assert.equal(containerServerSshOption({serverSsh:true}),true);
 let reads=0;const options={};Object.defineProperty(options,'serverSsh',{get(){reads++;return true;}});
 assert.throws(()=>containerServerSshOption(options),{code:'CONTAINER_SSH_INVALID_CONFIG'});
 for(const serverSsh of ['true',{}, {create(){}},{socketPath:'/arbitrary'}])assert.throws(()=>containerServerSshOption({serverSsh}),{code:'CONTAINER_SSH_INVALID_CONFIG'});
 const target={};let verified=0;
 installNativeServerSshBridge({target,verifyRuntimeSync:()=>{verified++;return true;}}).close();
 assert.equal(Object.hasOwn(target,'__kanbanServerSshBridge'),false);assert.equal(verified,0);assert.equal(reads,0);
});

test('private runtime rejects malformed SSH settings before reading any original artifact',async()=>{
 const config={sourceRoot:'/owned/source',runtimeRoot:'/owned/runtime',profileId,generation};
 for(const serverSsh of ['true',1,{version:1},null])await assert.rejects(preparePrivateRuntime({...config,serverSsh}),{code:'PRIVATE_INVALID_SSH_CONFIG'});
 let reads=0;Object.defineProperty(config,'serverSsh',{get(){reads++;return true;}});
 await assert.rejects(preparePrivateRuntime(config),{code:'PRIVATE_INVALID_SSH_CONFIG'});assert.equal(reads,0);
});

test('explicit native settings install one immutable client and retirement cannot fall back to local',()=>{
 const target={},owner=installNativeServerSshBridge({settings:{version:1},profileId,generation,target,verifyRuntimeSync:()=>true});
 const descriptor=Object.getOwnPropertyDescriptor(target,'__kanbanServerSshBridge');
 assert.equal(descriptor.writable,false);assert.equal(descriptor.configurable,false);assert.equal(typeof descriptor.value.connect,'function');
 owner.close();owner.close();assert.equal(target.__kanbanServerSshBridge,descriptor.value);
 assert.throws(()=>installNativeServerSshBridge({settings:{version:1},profileId,generation,target,verifyRuntimeSync:()=>true}));
 assert.throws(()=>installNativeServerSshBridge({settings:{version:1,socketPath:'/arbitrary'},target:{},profileId,generation,verifyRuntimeSync:()=>true}));
});
