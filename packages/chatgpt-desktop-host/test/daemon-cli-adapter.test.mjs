import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDaemonCliArguments, isSupportedDaemonVersion, parseDaemonInitializeVersion } from '../src/daemon-cli-adapter.mjs';

test('only the pinned version query and explicit no-override app-server command are recognized', () => {
  assert.deepEqual(classifyDaemonCliArguments(['--version']), { kind: 'version' });
  assert.deepEqual(classifyDaemonCliArguments(['app-server', '--analytics-default-enabled']), { kind: 'app-server' });
  for (const args of [[], ['-V'], ['app-server'], ['app-server', '--listen', 'ws://0.0.0.0:1'],
    ['app-server', '--analytics-default-enabled', '--listen', 'stdio'], ['app-server', 'daemon', 'start'],
    ['exec', 'ignored'], ['--version', '--help']]) {
    assert.throws(() => classifyDaemonCliArguments(args), { code: 'DAEMON_ADAPTER_UNSUPPORTED_ARGUMENTS' });
  }
});

test('desktop startup overrides fail explicitly instead of being discarded or sent to a shared server', () => {
  for (const args of [
    ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled', '-c', 'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true'],
    ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled', '-c', 'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=false'],
  ]) assert.throws(() => classifyDaemonCliArguments(args), { code: 'DAEMON_ADAPTER_UNSUPPORTED_OVERRIDES' });
  for (const args of [
    ['-c', 'features.code_mode_host=false', 'app-server', '--analytics-default-enabled'],
    ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled', '-c', 'arbitrary=true'],
    ['app-server', '--analytics-default-enabled', '-c', 'arbitrary=true'],
  ]) assert.throws(() => classifyDaemonCliArguments(args), { code: 'DAEMON_ADAPTER_UNSUPPORTED_ARGUMENTS' });
});

test('server version is read from an exact native initialize result', () => {
  assert.equal(parseDaemonInitializeVersion({ userAgent: 'codex_app_server/0.166.0-alpha.5.1 (Linux)' }), '0.166.0-alpha.5.1');
  assert.equal(parseDaemonInitializeVersion({ userAgent: 'codex/0.166.0' }), '0.166.0');
  for (const result of [{}, { userAgent: 'codex/not-a-version' }, { userAgent: '/0.166.0' }, null]) {
    assert.equal(parseDaemonInitializeVersion(result), undefined);
  }
});

test('only the explicitly audited daemon versions are eligible for attachment', () => {
  for (const version of ['0.166.0-alpha.5.1', '0.166.0']) {
    assert.equal(isSupportedDaemonVersion(version), true);
  }
  for (const version of ['0.165.0', '0.166.1', '0.166.0-alpha.5.2', '0.166.0+unverified', '', null]) {
    assert.equal(isSupportedDaemonVersion(version), false);
  }
});
