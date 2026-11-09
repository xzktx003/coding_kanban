import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserImageFilePicker } from '../src/browser-image-file-picker.mjs';

function fixture() {
  let token = {}, active = true, input, payloads = [];
  const notices = [], attributes = new Map();
  const document = { documentElement: { setAttribute(key, value) { attributes.set(key, value); } }, body: { appendChild(node) { input = node; node.isConnected = true; } }, createElement(type) {
    assert.equal(type, 'input');
    const handlers = new Map();
    return { type: '', style: {}, files: [], isConnected: false,
      setAttribute() {}, addEventListener(type, fn) { handlers.set(type, fn); },
      remove() { this.isConnected = false; }, click() { this.clicked = true; },
      fire(type, trusted = true) { handlers.get(type)?.({isTrusted: trusted}); },
    };
  }};
  const win = {document, navigator: {userActivation: {get isActive() {return active;}}}};
  const picker = createBrowserImageFilePicker({window: win, captureScope: () => token,
    isScopeCurrent: t => t === token, notice: text => notices.push(text)});
  const persist = async p => {payloads.push(p);return '/tmp/codex-clipboard-11111111-1111-4111-8111-111111111111.png';};
  return {picker, persist, notices, get input(){return input;}, get payloads(){return payloads;},
    get outcome(){return attributes.get('data-chatgpt-image-picker-outcome');},
    revoke(){token={};}, setActive(value){active=value;}};
}
const png = () => new File([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])], 'image.png', {type:'image/png'});

test('a trusted browser selection uses original native temporary-image API and returns original descriptor', async () => {
  const f = fixture(), pending = f.picker.pick({imagesOnly:true, persist:f.persist});
  assert.equal(f.input.clicked, true);
  assert.equal(f.input.accept, 'image/png,image/jpeg');
  f.input.files = [png()]; f.input.fire('change');
  assert.deepEqual(await pending, [{label:'image.png',path:'/tmp/codex-clipboard-11111111-1111-4111-8111-111111111111.png',fsPath:'/tmp/codex-clipboard-11111111-1111-4111-8111-111111111111.png'}]);
  assert.deepEqual([...f.payloads[0].bytes], [137,80,78,71,13,10,26,10,1,2,3]);
  assert.equal(f.payloads[0].mimeType, 'image/png');
  assert.equal(f.input.isConnected, false);
  f.picker.dispose();
});

test('scope changes, hidden/dispose and cancel never return files to a different composer', async () => {
  const f = fixture();
  let pending = f.picker.pick({imagesOnly:true,persist:f.persist});
  f.revoke(); f.input.files=[png()]; f.input.fire('change');
  assert.deepEqual(await pending, []); assert.equal(f.payloads.length,0);
  pending = f.picker.pick({imagesOnly:true,persist:f.persist});
  f.input.fire('cancel'); assert.deepEqual(await pending, []);
  pending = f.picker.pick({imagesOnly:true,persist:f.persist});
  const old=f.input; f.picker.dispose(); assert.deepEqual(await pending, []);
  old.files=[png()];old.fire('change'); assert.equal(f.payloads.length,0);
});

test('a late native result cannot attach after the original composer changes', async () => {
  const f=fixture();let finish;
  const pending=f.picker.pick({imagesOnly:true,persist:()=>new Promise(r=>{finish=r;})});
  f.input.files=[png()];f.input.fire('change');
  await new Promise(r=>setImmediate(r));assert.equal(typeof finish,'function');
  f.revoke();finish('/tmp/codex-clipboard-11111111-1111-4111-8111-111111111111.png');
  assert.deepEqual(await pending, []);f.picker.dispose();
});

test('untrusted activation, synthetic change, unsupported content and budgets fail visibly', async () => {
  const f=fixture();f.setActive(false);
  assert.deepEqual(await f.picker.pick({imagesOnly:true,persist:f.persist}),[]);
  assert.ok(f.notices.length);f.setActive(true);
  let pending=f.picker.pick({imagesOnly:true,persist:f.persist});f.input.files=[png()];f.input.fire('change',false);
  assert.deepEqual(await pending, []);assert.equal(f.payloads.length,0);
  pending=f.picker.pick({imagesOnly:true,persist:f.persist});
  f.input.files=[new File(['not an image'],'fake.png',{type:'image/png'})];f.input.fire('change');
  assert.deepEqual(await pending, []);assert.equal(f.payloads.length,0);
  pending=f.picker.pick({imagesOnly:true,persist:f.persist});f.input.files=Array.from({length:5},png);f.input.fire('change');
  assert.deepEqual(await pending, []);assert.equal(f.payloads.length,0);
  pending=f.picker.pick({imagesOnly:true,persist:f.persist});f.input.files=[new File([new Uint8Array(2*1024*1024+1)],'large.png',{type:'image/png'})];f.input.fire('change');
  assert.deepEqual(await pending, []);assert.equal(f.payloads.length,0);
  assert.ok(f.notices.length>=4);f.picker.dispose();
});

test('native failures and ordinary files are explicit and never reported as attached', async () => {
  const f=fixture();let pending=f.picker.pick({imagesOnly:false,persist:f.persist});
  assert.ok(f.notices.length);f.input.files=[new File(['ordinary'],'a.txt',{type:'text/plain'})];f.input.fire('change');
  assert.deepEqual(await pending, []);assert.equal(f.payloads.length,0);
  pending=f.picker.pick({imagesOnly:true,persist:async()=>{throw Error('sensitive details')}});
  f.input.files=[png()];f.input.fire('change');assert.deepEqual(await pending,[]);
  assert.ok(f.notices.every(n=>!n.includes('sensitive details')));f.picker.dispose();
});

test('aggregate image budget is enforced before any native persistence', async () => {
  const f = fixture();
  const header = Uint8Array.from([137,80,78,71,13,10,26,10]);
  const image = () => new File([header,new Uint8Array(1_400_000)],'image.png',{type:'image/png'});
  const pending = f.picker.pick({imagesOnly:true,persist:f.persist});
  f.input.files = [image(),image(),image()];
  f.input.fire('change');
  assert.deepEqual(await pending, []);
  assert.equal(f.payloads.length, 0);
  assert.ok(f.notices.some(text => text.includes('总计不超过 4 MiB')));
  f.picker.dispose();
});

test('scope changes during file reading and invalid native paths cannot attach', async () => {
  const f = fixture();
  let finishRead;
  const delayed = {name:'image.png',type:'image/png',size:8,
    arrayBuffer: () => new Promise(resolve => {finishRead = resolve;})};
  let pending = f.picker.pick({imagesOnly:true,persist:f.persist});
  f.input.files = [delayed];
  f.input.fire('change');
  f.revoke();
  finishRead(Uint8Array.from([137,80,78,71,13,10,26,10]).buffer);
  assert.deepEqual(await pending, []);
  assert.equal(f.payloads.length, 0);

  pending = f.picker.pick({imagesOnly:true,persist:async()=>'/tmp/unrelated.png'});
  f.input.files = [png()];
  f.input.fire('change');
  assert.deepEqual(await pending, []);
  assert.ok(f.notices.some(text => text.includes('添加图片失败')));
  f.picker.dispose();
});

test('the final bounded outcome distinguishes persistence failure from a stale selection and survives notice cleanup', async () => {
  const failed = fixture();
  const pending = failed.picker.pick({imagesOnly:true,persist:async()=>{throw Error('private native details');}});
  failed.input.files = [png()];failed.input.fire('change');
  assert.deepEqual(await pending, []);
  assert.equal(failed.outcome, 'PERSIST_FAILED');
  failed.picker.dispose();
  assert.equal(failed.outcome, 'PERSIST_FAILED');

  const stale = fixture(), selection = stale.picker.pick({imagesOnly:true,persist:stale.persist});
  stale.revoke();stale.input.files = [png()];stale.input.fire('change');
  assert.deepEqual(await selection, []);
  assert.equal(stale.outcome, 'SCOPE_REVOKED_BEFORE_READ');
  assert.equal(stale.payloads.length, 0);
  stale.picker.dispose();
});

test('successful and invalid native results have distinct retained outcome enums', async () => {
  const f = fixture();
  let pending = f.picker.pick({imagesOnly:true,persist:f.persist});
  f.input.files = [png()];f.input.fire('change');
  assert.equal((await pending).length, 1);
  assert.equal(f.outcome, 'FILES_RETURNED');
  pending = f.picker.pick({imagesOnly:true,persist:async()=>({path:'/tmp/private.png'})});
  f.input.files = [png()];f.input.fire('change');
  assert.deepEqual(await pending, []);
  assert.equal(f.outcome, 'INVALID_NATIVE_RESULT');
  f.picker.dispose();
});
