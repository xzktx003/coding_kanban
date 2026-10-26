import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../launcher.mjs', import.meta.url));
// No tools, login, service, or output directories are supplied: validation must
// reject these invocations before any host process can be created.
for (const [label, args, expected] of [
  ['visible startup', ['--restore-visible-windows'], /visible-window startup requires explicit controlled refresh/],
  ['shared workspace', ['--refresh-workspace-dir', '/private/workspace'], /refresh workspace requires explicit visible-window startup/],
  ['controlled visible startup', ['--restore-visible-windows', '--refresh-service-config', '/private/service.json', '--refresh-domain', '019aabcd-1234-7890-abcd-0123456789ab', '--refresh-control-root', '/private/control'], /runtimeRoot must be an absolute path/],
]) {
  test(`launcher routes ${label} arguments through the host validation contract`, () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NATIVE_CODEX_')));
    const result = spawnSync(process.execPath, [launcher, ...args], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  });
}
