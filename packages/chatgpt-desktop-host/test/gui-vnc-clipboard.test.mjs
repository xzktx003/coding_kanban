import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clipboardPasteFrom, patchFixedNoVncClipboard } from '../gui-vnc-prototype/clipboard-adapter.mjs';

function fixture({ notify = false, provide = true, text = true, maximum = 1024 * 1024, connected = true, viewOnly = false } = {}) {
  const calls = [];
  const context = vm.createContext({
    extendedClipboardFormatText: 1, extendedClipboardActionNotify: 1 << 27,
    extendedClipboardActionProvide: 1 << 28,
    encodeUTF8: value => Buffer.from(value, 'utf8').toString('latin1'),
    RFB: { messages: {
      extendedClipboardNotify: (...args) => calls.push(['notify', ...args]),
      extendedClipboardProvide: (...args) => calls.push(['provide', ...args]),
      clientCutText: (...args) => calls.push(['legacy', ...args]),
    } },
  });
  const send = vm.runInContext(`(${clipboardPasteFrom.toString()})`, context);
  const receiver = { _rfbConnectionState: connected ? 'connected' : 'closed', _viewOnly: viewOnly,
    _sock: {}, _clipboardServerCapabilitiesFormats: { 1: text },
    _clipboardServerCapabilitiesActions: { [1 << 27]: notify, [1 << 28]: provide },
    _cgClipboardUnsolicitedTextMaximum: maximum };
  return { calls, receiver, send: value => send.call(receiver, value) };
}

test('sends complete Unicode as UTF8 ClientCutText when Text/Provide is supported without Notify', () => {
  const f = fixture();
  const value = '只回复“中文链路通过”。不要调用工具，不要执行命令，不要读写文件。' + Array.from({length: 200}, (_, i) => String.fromCharCode(0x4e00 + i)).join('') + '🧪🙂';
  f.send(value);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'legacy');
  assert.deepEqual(Buffer.from(f.calls[0][2]), Buffer.from(value, 'utf8'));
  assert.equal(f.receiver._clipboardText, undefined);
});

test('keeps Notify/request negotiation unchanged and preserves legacy ASCII', () => {
  const f = fixture({ notify: true }); f.send('中文');
  assert.equal(f.calls[0][0], 'notify'); assert.equal(f.receiver._clipboardText, '中文');
  const legacy = fixture({ provide: false }); legacy.send('ASCII');
  assert.equal(legacy.calls[0][0], 'legacy');
  assert.deepEqual(Array.from(legacy.calls[0][2]), [65,83,67,73,73]);
});

test('does not send while closed or view-only and never emits key/Enter events', () => {
  for (const options of [{connected: false}, {viewOnly: true}]) {
    const f = fixture(options); f.send('中文'); assert.equal(f.calls.length, 0);
  }
});

test('bounds unsolicited UTF8 by the advertised maximum and 1MiB including NUL', () => {
  const f = fixture({maximum: 7}); f.send('中文'); assert.equal(f.calls.length, 1);
  for (const [options, text] of [
    [{maximum: 6}, '中文'], [{maximum: 0}, 'a'], [{maximum: 2}, 'a\n'],
    [{maximum: 4 * 1024 * 1024}, 'a'.repeat(1024 * 1024)],
    [{maximum: 10}, 'a\0b'], [{maximum: 10}, '\ud800'],
  ]) {
    const r = fixture(options); assert.throws(() => r.send(text), /UTF8 clipboard/); assert.equal(r.calls.length, 0);
  }
});

test('rejects an unknown or changed noVNC source instead of applying a best-effort patch', () => {
  for (const body of [Buffer.from('clipboardPasteFrom(text) {}'), Buffer.alloc(0), Buffer.from('unexpected source')]) {
    assert.throws(() => patchFixedNoVncClipboard(body), /NOVNC_CLIPBOARD_SOURCE_UNSUPPORTED/);
  }
});


test('preserves line breaks and all distinct characters instead of changing or truncating clipboard data', () => {
  const f = fixture(); const value = '独立甲乙丙丁\n下一行\r\n末尾🙂'; f.send(value);
  assert.deepEqual(Buffer.from(f.calls[0][2]), Buffer.from(value, 'utf8'));
});
