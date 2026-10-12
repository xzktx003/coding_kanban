import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
const launcher = new URL('../launcher.mjs', import.meta.url);
async function port() { const server = net.createServer(); await new Promise(r => server.listen(0, '0.0.0.0', r)); const result = server.address().port; await new Promise(r => server.close(r)); return result; }
async function fixture(code) {
  const base = await mkdtemp(join(tmpdir(), 'nh-launch-')); const root = join(base, 'r'); const tool = join(base, 'tool.mjs');
  await writeFile(tool, `#!/usr/bin/env node\n${code}`, { mode: 0o700 });
  await writeFile(join(base, 'official.vsix'), 'test');
  await writeFile(join(base, 'threads.json'), JSON.stringify({ threads: [{ id: '019aabcd-1234-7890-abcd-0123456789ab' }] }));
  const hostPort = await port(); let brokerPort = await port(); while (brokerPort === hostPort) brokerPort = await port();
  const args = [launcher.pathname, '--runtime-root', root, '--code-server', tool, '--official-vsix', join(base, 'official.vsix'), '--codex-cli', tool,
    '--port', String(hostPort), '--broker-port', String(brokerPort), '--user-data-dir', join(root, 'u'), '--extensions-dir', join(root, 'e'),
    '--project-dir', join(root, 'p'), '--codex-home', join(root, 'c'), '--process-home', join(root, 'h'), '--record', join(base, 'record.json'), '--threads-file', join(base, 'threads.json')];
  return { base, root, args };
}
async function run(args) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); return { code, output };
}
test('launcher SIGTERM during install cannot spawn a later installer or host', async () => {
  const code = `import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
if(process.argv.includes('--install-extension')) { process.on('SIGTERM',()=>{}); process.kill(process.ppid,'SIGTERM'); setTimeout(()=>process.exit(0),80); }
else { writeFileSync(join(process.env.HOME,'host-started'),'unsafe'); process.exit(0); }`;
  const data = await fixture(code);
  try { const result = await run([...data.args, '--unsafe-no-auth']); assert.equal(result.code, 0); await assert.rejects(lstat(join(data.root, 'h', 'host-started')), { code: 'ENOENT' }); await assert.rejects(lstat(join(data.root, 'native-codex-companion.vsix')), { code: 'ENOENT' }); }
  finally { await rm(data.base, { recursive: true, force: true }); }
});
test('password launcher writes private password config and does not expose password in args or record', async () => {
  const code = `import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
if (!process.argv.includes('--install-extension')) writeFileSync(join(process.env.HOME,'host-argv.json'),JSON.stringify(process.argv)); process.exit(0);`;
  const data = await fixture(code); const password = 'new-private-test-password-123456789'; const passwordFile = join(data.base, 'password');
  try {
    await writeFile(passwordFile, password, { mode: 0o600 });
    const result = await run([...data.args, '--password-file', passwordFile]); assert.equal(result.code, 0, result.output);
    const config = await readFile(join(data.root, 'code-server.yaml'), 'utf8'); assert.match(config, /auth: password/); assert.ok(config.includes(password));
    assert.equal((await lstat(join(data.root, 'code-server.yaml'))).mode & 0o777, 0o600);
    const record = await readFile(join(data.base, 'record.json'), 'utf8'); const argv = await readFile(join(data.root, 'h', 'host-argv.json'), 'utf8');
    for (const value of [result.output, record, argv]) assert.equal(value.includes(password), false);
    assert.equal(JSON.parse(argv).includes('password'), true); assert.equal(JSON.parse(record).authentication, 'password');
  } finally { await rm(data.base, { recursive: true, force: true }); }
});

for (const enabled of [false, true]) test(`launcher captures explicit fixture auto-open flag as private boolean ${enabled}`, async () => {
  const data = await fixture('process.exit(0);');
  const ids = ['019aabcd-1234-7890-abcd-0123456789ab', '019aabcd-1234-7890-abcd-0123456789ac'];
  try {
    await writeFile(join(data.base, 'threads.json'), JSON.stringify({ threads: ids.map(id => ({ id })) }));
    const result = await run([...data.args, '--unsafe-no-auth', ...(enabled ? ['--auto-open-fixtures'] : [])]);
    assert.equal(result.code, 0, result.output);
    const file = join(data.root, 'companion-auth.json'); const config = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(config.autoOpenFixtures, enabled); assert.deepEqual(config.threads, ids);
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
    assert.equal(result.output.includes(config.token), false);
  } finally { await rm(data.base, { recursive: true, force: true }); }
});

test('launcher refuses auto-open without two distinct captured fixtures before installing', async () => {
  const data = await fixture('process.exit(0);');
  try {
    const result = await run([...data.args, '--unsafe-no-auth', '--auto-open-fixtures']);
    assert.equal(result.code, 1); assert.match(result.output, /two distinct fixture threads/);
    await assert.rejects(lstat(join(data.root, 'install.log')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(data.root, 'companion-auth.json')), { code: 'ENOENT' });
  } finally { await rm(data.base, { recursive: true, force: true }); }
});

test('explicit live new-chat launch imports only private connection and captures two unique native window IDs', async()=>{
 const data=await fixture('process.exit(0);');const source=join(data.base,'source');
 try{
  const {mkdir}=await import('node:fs/promises');await mkdir(source,{mode:0o700});
  const auth=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'test-launch-secret'}});
  await writeFile(join(source,'auth.json'),auth,{mode:0o600});await writeFile(join(source,'config.toml'),'model="gpt-test"\n',{mode:0o600});
  const index=data.args.indexOf('--threads-file');const args=data.args.slice(0,index);
  const result=await run([...args,'--unsafe-no-auth','--auto-open-new-chats','--connection-profile-home',source]);assert.equal(result.code,0,result.output);
  const config=JSON.parse(await readFile(join(data.root,'companion-auth.json'),'utf8'));
  assert.equal(config.autoOpenNewChats,true);assert.equal(config.autoOpenFixtures,false);assert.deepEqual(config.threads,[]);
  assert.equal(config.newChatWindowIds.length,2);assert.notEqual(config.newChatWindowIds[0],config.newChatWindowIds[1]);
  const record=await readFile(join(data.base,'record.json'),'utf8');assert.equal(record.includes('test-launch-secret'),false);assert.equal(result.output.includes('test-launch-secret'),false);
  assert.equal(await readFile(join(data.root,'c','auth.json'),'utf8'),auth);assert.equal(await readFile(join(source,'auth.json'),'utf8'),auth);
 }finally{await rm(data.base,{recursive:true,force:true})}
});

test('new-chat startup cannot also open fixture threads',async()=>{
 const data=await fixture('process.exit(0);');try{
  const result=await run([...data.args,'--unsafe-no-auth','--auto-open-new-chats','--auto-open-fixtures']);assert.equal(result.code,1);assert.match(result.output,/new.chat.*fixture|exclusive/);
  await assert.rejects(lstat(join(data.root,'install.log')),{code:'ENOENT'});
 }finally{await rm(data.base,{recursive:true,force:true})}
});
