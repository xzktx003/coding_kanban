import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanionVsix } from '../vsix.mjs';
test('self package is a separate VSIX with original editor companion only', async () => {
  const bytes = await buildCompanionVsix();
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const files = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18); const nameLength = bytes.readUInt16LE(offset + 26); const extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra;
    files.set(name, bytes.subarray(start, start + size).toString()); offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.ok(files.has('[Content_Types].xml')); assert.ok(files.has('extension.vsixmanifest'));
  assert.ok(files.has('extension/extension.cjs')); assert.ok(files.has('extension/control.cjs'));
  const manifest = JSON.parse(files.get('extension/package.json'));
  assert.equal(manifest.publisher, 'agent-orchestrator'); assert.equal(manifest.name, 'native-codex-companion');
  assert.ok(![...files.keys()].some(path => path.startsWith('extension/out/')));
});
