import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,symlink,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CORE_PROMPT,CORE_FOLLOWUP_PROMPT} from './chatgpt-desktop-account-core-ledger.mjs';
import {createHash} from 'node:crypto';
const root=process.env.CORE_DIAGNOSTIC_SNAPSHOT;
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=async()=>Object.fromEntries(await Promise.all(['launcher.mjs','observer.mjs','strict-json.mjs','create-wrapper.mjs'].map(async name=>{const body=await readFile('/tmp/chatgpt-cli-observer-CYsGskfz/'+name);return [name,{body,sha256:hash(body)}]})));

test('private launcher installs only four fixed owned observer files before native spawn',async()=>{
 const {adaptCoreNativeObserverBootstrap}=await import('./chatgpt-desktop-native-observer-bootstrap.mjs');const input=await readFile(root+'/packages/chatgpt-desktop-host/src/container-native.mjs'),fixed=await files();const out=adaptCoreNativeObserverBootstrap({body:input,files:fixed,cliRealPath:'/fixed/resources/codex'});const source=out.body.toString();
 assert.equal(out.originalSha256,hash(input));assert.notEqual(out.adaptedSha256,out.originalSha256);assert.match(source,/CODEX_CLI_PATH:.*fixture-codex/);assert.ok(source.indexOf('observer-config.json')<source.indexOf('const native = spawn('));assert.match(source,/O_NOFOLLOW/);assert.match(source,/O_EXCL/);assert.match(source,/viewId: null/);assert.match(source,/moduleSha256/);for(const name of ['launcher.mjs','observer.mjs','strict-json.mjs'])assert.ok(source.includes(fixed[name].sha256));
 assert.throws(()=>adaptCoreNativeObserverBootstrap({body:Buffer.concat([input,Buffer.from('x')]),files:fixed,cliRealPath:'/fixed/resources/codex'}));const bad={...fixed,'observer.mjs':{body:Buffer.from('replacement'),sha256:hash(Buffer.from('replacement'))}};assert.throws(()=>adaptCoreNativeObserverBootstrap({body:input,files:bad,cliRealPath:'/fixed/resources/codex'}));assert.throws(()=>adaptCoreNativeObserverBootstrap({body:input,files:{...fixed,'evil.mjs':{body:Buffer.from('x'),sha256:hash(Buffer.from('x'))}},cliRealPath:'/fixed/resources/codex'}));
});

test('the real pinned observer bootstrap builds a usable private wrapper with valid JSON configuration',async()=>{
 const {adaptCoreNativeObserverBootstrap}=await import('./chatgpt-desktop-native-observer-bootstrap.mjs');
 const sourceDir='/tmp/chatgpt-cli-observer-CYsGskfz',names=['launcher.mjs','observer.mjs','strict-json.mjs','create-wrapper.mjs'],actual={};
 for(const name of names){const body=await readFile(join(sourceDir,name));actual[name]={body,sha256:hash(body)}}
 const dir=await mkdtemp(join(tmpdir(),'cg-observer-bootstrap-test-'));
 try{
  const bridge=join(dir,'bridge'),runtime=join(dir,'runtime'),home=join(runtime,'home'),cli=join(dir,'fake-cli.mjs');await mkdir(bridge,{mode:0o700});await mkdir(join(runtime,'resources'),{recursive:true,mode:0o700});await mkdir(home,{mode:0o700});
  await writeFile(cli,'#!/usr/bin/env node\nprocess.stdout.write("fake-version\\n")\n',{mode:0o700});await symlink(cli,join(runtime,'resources','codex'));
  const input=await readFile(root+'/packages/chatgpt-desktop-host/src/container-native.mjs');let output=adaptCoreNativeObserverBootstrap({body:input,files:actual,cliRealPath:cli}).body.toString();
  const start=output.indexOf('  try {\n    const observerDir = "/bridge/observer"');const end=output.indexOf('  const env = {',start);assert.ok(start>=0&&end>start);
  let setup=output.slice(start,end).replaceAll('/bridge/',bridge+'/').replaceAll('/opt/private-node',process.execPath);
  setup=setup.replace('return fail();','throw Error("bootstrap failed")');
  const harness=`import {lstatSync,mkdirSync,openSync,writeFileSync,closeSync,fchmodSync,realpathSync,constants} from 'node:fs';import {createHash} from 'node:crypto';import {join} from 'node:path';\nconst runtimeRoot=${JSON.stringify(runtime)},home=${JSON.stringify(home)},profileId='11111111-1111-4111-8111-111111111111',generation='22222222-2222-4222-8222-222222222222';\n${setup}`;
  const harnessPath=join(dir,'harness.mjs');await writeFile(harnessPath,harness,{mode:0o600});await promisify(execFile)(process.execPath,[harnessPath]);
  const configPath=join(bridge,'observer-config.json'),cfg=JSON.parse(await readFile(configPath,'utf8'));assert.equal(cfg.cliPath,join(runtime,'resources','codex'));assert.equal(cfg.cliRealPath,cli);assert.equal(cfg.scope.viewId,null);assert.equal(cfg.expected.prompt,CORE_PROMPT+'\n');assert.equal(cfg.expected.followupPrompt,CORE_FOLLOWUP_PROMPT+'\n');
  cfg.cliSha256=hash(await readFile(cli));await writeFile(configPath,JSON.stringify(cfg)+'\n');await chmod(configPath,0o600);
  const call=await promisify(execFile)(join(bridge,'fixture-codex'),['--version']);assert.equal(call.stdout,'fake-version\n');
 }finally{await rm(dir,{recursive:true,force:true})}
});
