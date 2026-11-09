import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateWebEnvironment} from './prepare-chatgpt-candidate-web-env.mjs';
const candidate = {CHATGPT_DESKTOP_CANDIDATE_PORT:'49120',WEB_PORT:'8513',VITE_DEV_HTTPS:'1',VITE_DEV_HTTPS_CERT:'/tmp/cert.pem',VITE_DEV_HTTPS_KEY:'/tmp/key.pem'};
test('explicit candidate configuration inherits only existing Kanban backend host and port',()=>{
  const actual=candidateWebEnvironment({...candidate,WEB_BACKEND_HOST:'stale',WEB_BACKEND_PORT:'1234'}, {WEB_BACKEND_HOST:'127.0.0.1',WEB_BACKEND_PORT:'4000',SECRET:'must-not-copy'});
  assert.equal(actual.WEB_BACKEND_HOST,'127.0.0.1');
  assert.equal(actual.WEB_BACKEND_PORT,'4000');
  assert.equal(actual.CHATGPT_DESKTOP_CANDIDATE_PORT,'49120');
  assert.equal(actual.WEB_HOST,'0.0.0.0');
  assert.ok(!Object.hasOwn(actual,'SECRET'));
});
test('missing or malformed backend and unsafe candidate configuration fail closed',()=>{
  for(const backend of [{},{WEB_BACKEND_HOST:'http://bad/path',WEB_BACKEND_PORT:'4000'},{WEB_BACKEND_HOST:'127.0.0.1',WEB_BACKEND_PORT:'99999'}])
    assert.throws(()=>candidateWebEnvironment(candidate,backend));
  assert.throws(()=>candidateWebEnvironment({...candidate,VITE_DEV_HTTPS:'0'},{WEB_BACKEND_HOST:'localhost',WEB_BACKEND_PORT:'4000'}));
});

test('generated private dotenv is usable by Node, cannot overwrite, and never copies other settings', async t=>{
  const {mkdtemp,mkdir,writeFile,readFile,stat,rm} = await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const {prepareCandidateWebEnv}=await import('./prepare-chatgpt-candidate-web-env.mjs');
  const root=await mkdtemp(join(tmpdir(),'candidate-env-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'private');await mkdir(dir,{mode:0o700});
  const input=join(dir,'input.env'),main=join(root,'kanban.env'),output=join(dir,'prepared.env');
  await writeFile(input,Object.entries({...candidate,VITE_DEV_HTTPS_CERT:'/tmp/cert with spaces',WEB_BACKEND_PORT:'23'}).map(([k,v])=>`${k}="${v}"`).join('\n'),{mode:0o600});
  await writeFile(main,'WEB_BACKEND_HOST=127.0.0.1\nWEB_BACKEND_PORT=4000\nSECRET=must-not-copy\n');
  await prepareCandidateWebEnv(input,main,output);
  assert.equal((await stat(output)).mode & 0o777,0o600);
  const text=await readFile(output,'utf8');assert.ok(!text.includes('must-not-copy'));
  const child=spawnSync(process.execPath,[`--env-file=${output}`,'-e','process.stdout.write(JSON.stringify([process.env.WEB_BACKEND_HOST,process.env.WEB_BACKEND_PORT,process.env.VITE_DEV_HTTPS_CERT]))'],{env:{PATH:process.env.PATH},encoding:'utf8'});
  assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),['127.0.0.1','4000','/tmp/cert with spaces']);
  await assert.rejects(prepareCandidateWebEnv(input,main,output),{code:'EEXIST'});
});
