import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
const {adaptNativeSharedHostChunk}=createRequire(import.meta.url)('../src/native-shared-host-policy.cjs');

test('unknown shipped bytes cannot enable the original shared host factory',()=>{
 assert.throws(()=>adaptNativeSharedHostChunk({body:Buffer.from('unknown native release')}),{code:'NATIVE_APP_POLICY_DIGEST_MISMATCH'});
});

test('pinned original factory retains its actual SDK constructor and all ordinary host selection branches',
 {skip:!process.env.CHATGPT_PICKER_NATIVE_CHUNK},async()=>{
 const original=await readFile(process.env.CHATGPT_PICKER_NATIVE_CHUNK),result=adaptNativeSharedHostChunk({body:original});
 const source=result.body.toString('utf8');assert.equal(result.adaptedSha256,createHash('sha256').update(result.body).digest('hex'));
 assert.equal(result.sharedThreadSha256,'1a7ceb1f2e9321dc14bde2dab07517bc1d866bf8a2734595ed1eb7163fffe4cd');
 assert.doesNotThrow(()=>new Script(source));
 assert.equal(source.split('globalThis.__kanbanSelectSharedDesktopTransport(e.hostConfig.id,e.hostConfig,e.desktopAppTools,ex5)').length-1,1);
 assert.match(source,/function eTw\(e\)\{if\(e\.hostConfig\.id==="kanban-shared-cli"\)return globalThis\.__kanbanSelectSharedDesktopTransport\(e\.hostConfig\.id,e\.hostConfig,e\.desktopAppTools,ex5\);let t=/);
 assert.ok(!source.includes('if(e==="kanban-shared-cli")o='));
 assert.match(source,/h=new em\.R\$j\(this\.options\.messageChannel,/);
 assert.match(source,/transport:o,hostProcess:this\.options\.hostProcess/);
 assert.equal(source.split('globalThis.__kanbanReadSharedCodexHome(t)').length-1,1);
 assert.match(source,/async readCodexHome\(e\)\{let t=this\.getExecutionHost\(e\);return eI\(e==="kanban-shared-cli"\?await globalThis\.__kanbanReadSharedCodexHome\(t\):t\.isLocal\?\(0,em\.DnS\)\(\{preferWsl:jQ\}\):await t\.codexHome\(\),t\.hostConfig\.id===ar\.n&&\(0,em\.cPM\)\(ar\.a\)\)/);
});
