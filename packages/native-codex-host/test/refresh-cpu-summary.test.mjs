import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRefreshCpu } from '../../../tests/e2e/codex-refresh-cpu.mjs';

test('CPU diagnostics aggregate samples by public asset and source location without URLs or function names', () => {
  const profile = {startTime: 100, endTime: 6100, nodes: [
    {id: 1, callFrame: {url: '', functionName: '(root)'}, children: [2]},
    {id: 2, callFrame: {url: 'https://private.invalid/src/codex-mode/native-surface.ts?token=secret', functionName: 'private-secret', lineNumber: 10, columnNumber: 2}, children: [3]},
    {id: 3, callFrame: {url: 'https://user:secret@file.vscode-resource.vscode-cdn.net/private/login-home/assets/app-initial-a123.js?credential=secret', functionName: 'private-secret', lineNumber: 1, columnNumber: 300}},
  ], samples: [2, 3, 3], timeDeltas: [1000, 2000, 3000]};
  const result = summarizeRefreshCpu(profile);
  assert.equal(result.sampleDurationMs, 6);
  assert.equal(result.assets.find(row => row.asset === 'native-surface.ts').inclusiveMs, 6);
  assert.equal(result.assets.find(row => row.asset === 'native-surface.ts').selfMs, 1);
  assert.equal(result.assets.find(row => row.asset === 'app-initial-a123.js').selfMs, 5);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('login-home'), false);
  assert.equal(JSON.stringify(result).includes('functionName'), false);
});

test('CPU diagnostics reject malformed or excessive profiles rather than reporting a plausible duration', () => {
  for (const input of [null, {}, {nodes: [], samples: [1], timeDeltas: []}, {nodes: [], samples: [1], timeDeltas: [Infinity]},
    {nodes: Array.from({length: 200001}, () => ({})), samples: [], timeDeltas: []}]) assert.throws(() => summarizeRefreshCpu(input));
});

test('non-monotonic native sample deltas permit an explicit count histogram without fabricated durations', () => {
  const profile = {startTime: 0, endTime: 6000, nodes: [
    {id: 1, callFrame: {url: 'https://private.invalid/app-initial-a123.js', lineNumber: 0, columnNumber: 0}},
  ], samples: [1, 1, 1], timeDeltas: [2000, -2, 4002]};
  assert.throws(() => summarizeRefreshCpu(profile), /negative/);
  const result = summarizeRefreshCpu(profile, {countsOnly: true});
  assert.equal(result.durationMetricsValid, false);
  assert.equal(result.sampleDurationMs, null);
  assert.equal(result.nonMonotonicDeltas, 1);
  assert.equal(result.assets[0].samples, 3);
  assert.equal(result.assets[0].selfMs, null);
  assert.equal(result.assets[0].inclusiveMs, null);
  assert.equal(result.assets[0].topLocations[0].selfMs, null);
});
