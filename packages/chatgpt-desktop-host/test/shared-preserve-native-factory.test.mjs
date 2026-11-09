import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createOwnedSharedDesktopSourceFactory} from '../src/owned-shared-desktop-source.mjs';
const registration=()=>({daemon:{pid:1,startTicks:'1',socketPath:'/owned/daemon.sock',daemonGeneration:randomUUID(),exeSha256:'a'.repeat(64)},codexHome:'/owned/codex',daemonVersion:'0.166.0',projects:[{projectId:'own',cwd:'/owned/project'}],executionDomainPolicy:'preserve-native-cli'});
test('server factory exposes real preservation proof without a caller-provided always-true callback',()=>{
 const factory=createOwnedSharedDesktopSourceFactory(registration(),{nativeAppTools:false});assert.equal(factory.requiresAppTools,false);
});
test('preserving native execution cannot inject original Desktop App Tools or replace proof with callback',()=>{
 assert.throws(()=>createOwnedSharedDesktopSourceFactory(registration(),{nativeAppTools:true}));
 assert.throws(()=>createOwnedSharedDesktopSourceFactory({...registration(),verifyExecutionDomainSync:()=>true},{nativeAppTools:false}));
});
