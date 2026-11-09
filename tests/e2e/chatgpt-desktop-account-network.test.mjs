import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAccountNetwork } from './chatgpt-desktop-account-network.mjs';
const own='https://10.30.0.26:1234';
test('only exact first-party origins from pinned app CSP and own gateway pass',()=>{
 for(const u of [own+'/x','wss://10.30.0.26:1234/x','https://ab.chatgpt.com/x','https://cdn.openai.com/x','https://cdn.platform.openai.com/x','https://learn.chatgpt.com/x','wss://chatgpt.com/x','wss://ws.chatgpt.com/x'])assert.equal(classifyAccountNetwork(u,own).allowed,true);
 for(const u of ['http://ab.chatgpt.com/x','https://bad.ab.chatgpt.com/x','https://ab.chatgpt.com.attacker.invalid/x','https://ab.chatgpt.com:8443/x','wss://bad.chatgpt.com/x','https://evil.invalid/x','https://name:secret@ab.chatgpt.com/x','not a url'])assert.equal(classifyAccountNetwork(u,own).allowed,false);
});
test('classification never returns paths, query, credential or unknown host',()=>{
 const c=classifyAccountNetwork('https://user:secret@untrusted.example/path?auth=token#fragment',own);assert.equal(c.allowed,false);const t=JSON.stringify(c);for(const part of ['user','secret','example','path','auth','token','fragment'])assert.equal(t.includes(part),false);
});

test('blocked first party static, Statsig and Sentry hosts have fixed categories only',()=>{
 for(const [u,category] of [['https://persistent.oaistatic.com/x','openai-static'],['https://api.statsig.com/x','statsig'],['https://x.sentry.io/x','sentry']]){
  const d=classifyAccountNetwork(u,own);assert.equal(d.allowed,false);assert.equal(d.category,category);
 }
});

test('request metadata exposes only origin and fixed service, never path, query or credentials',async()=>{
 const {accountRequestMetadata}=await import('./chatgpt-desktop-account-network.mjs');
 const first=accountRequestMetadata('https://user:secret@chatgpt.com/backend-api/accounts?token=sample#private');
 assert.deepEqual(first,{origin:'https://chatgpt.com',service:'backend-api'});
 const text=JSON.stringify(first);for(const part of ['user','secret','accounts','token','sample','private'])assert.equal(text.includes(part),false);
 assert.deepEqual(accountRequestMetadata('https://10.30.0.26:1234/chatgpt-desktop/a/b/webview/index.html'),{origin:'https://10.30.0.26:1234',service:'original-webview'});
 assert.deepEqual(accountRequestMetadata('not a url'),{origin:null,service:'invalid'});
});
