import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = process.env.CHATGPT_DESKTOP_TEST_MAC_MODULE_DIR;
const hashes = {
  "rolldown-runtime-428824ca0286.js":
    "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e",
  "app-shared-601019a330d7.js":
    "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116",
  "app-initial-18b189e867e7.js":
    "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032",
};

test(
  "split browser imports before original scope initializers and defers the original transcript chunk",
  {
    skip:
      !moduleDir &&
      "Set CHATGPT_DESKTOP_TEST_MAC_MODULE_DIR to reviewed Mac modules",
  },
  (t) => {
    for (const [member, expected] of Object.entries(hashes))
      assert.equal(
        createHash("sha256")
          .update(readFileSync(join(moduleDir, member)))
          .digest("hex"),
        expected,
      );
    const root = mkdtempSync(join(tmpdir(), "chatgpt-split-import-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const assets = join(root, "assets"),
      host = join(root, "__host");
    mkdirSync(assets);
    mkdirSync(host);
    for (const member of Object.keys(hashes))
      symlinkSync(join(moduleDir, member), join(assets, member));
    const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
    for (const name of [
      "desktop-split-pane-core.mjs",
      "desktop-split-pane-browser.mjs",
      "desktop-layout-core.mjs",
      "desktop-layout-browser.mjs",
      "desktop-pane-layout.mjs",
      "wire-value.mjs",
    ])
      copyFileSync(join(sourceRoot, name), join(host, name));
    const probe = `
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [assets, host] = process.argv.slice(1);
Object.defineProperty(globalThis, '__chatgptDesktopLayoutEnabled', { value: true, writable: false, configurable: false });
const initial = await import(pathToFileURL(assets + '/app-initial-18b189e867e7.js'));
assert.equal(typeof initial.B5n, 'undefined');
assert.equal(typeof initial.p5n, 'undefined');
assert.equal(typeof initial.w6n, 'undefined');
const browser = await import(pathToFileURL(host + '/desktop-split-pane-browser.mjs'));
assert.equal(typeof browser.DesktopSplitPaneBoundary, 'function');
assert.equal(typeof initial.B5n, 'undefined');
const owner = {};
const release = browser.desktopSplitPaneRegistry.attach(owner, {hostId:'local',conversationId:null,clientThreadId:'fresh-home'});
assert.equal(browser.desktopSplitPaneRegistry.getSnapshot().selected.owner, owner);
release(); browser.desktopSplitPaneRegistry.dispose();
process.stdout.write('ok'); process.exit(0);
`;
    const browserPath = join(host, "desktop-split-pane-browser.mjs");
    const original = readFileSync(browserPath, "utf8");
    writeFileSync(
      browserPath,
      `import { n as premature } from '../assets/local-conversation-thread-2f594f841b07.js';\n${original}`,
    );
    const eager = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", probe, assets, host],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.notEqual(
      eager.status,
      0,
      "the missing original transcript must detect an eager import",
    );
    assert.match(eager.stderr, /ERR_MODULE_NOT_FOUND/);
    writeFileSync(browserPath, original);
    const lazy = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", probe, assets, host],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(lazy.status, 0, lazy.stderr || String(lazy.error));
    assert.equal(lazy.stdout, "ok");
  },
);
