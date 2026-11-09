import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  adaptProjectFolderPickerChunk,
} = require("../src/project-folder-picker-policy.cjs");
test("an unsupported original native chunk is rejected without a bypass", () => {
  assert.throws(
    () => adaptProjectFolderPickerChunk({ body: Buffer.from("other version") }),
    { code: "NATIVE_HOST_POLICY_DIGEST_MISMATCH" },
  );
});
test(
  "the exact original chunk retains original project validation and routes picker and Trust to its view",
  { skip: !process.env.CHATGPT_PICKER_NATIVE_CHUNK },
  async () => {
    const original = await readFile(process.env.CHATGPT_PICKER_NATIVE_CHUNK),
      result = adaptProjectFolderPickerChunk({ body: original });
    const code = result.body.toString("utf8");
    assert.match(code, /__kanbanProjectPickerOpen\(e,t\)/);
    assert.match(code, /__kanbanProjectPickerComplete\(e,s,n\)/);
    assert.match(
      code,
      /__kanbanProjectPickerConsume\(e,await this\.#r8\(e\)\)/,
    );
    assert.match(
      code,
      /__kanbanBindProjects\(this\.projectsManager,e\)\.createOrSelectLocalProjects\(\[i\]\)/,
    );
    assert.match(code, /case"kanban-project-folder-reply"/);
    assert.match(code, /case"kanban-project-folder-lifecycle"/);
    assert.match(code, /__kanbanProjectPickerLifecycle\(e,t\)/);
    assert.match(code, /await globalThis\.__kanbanCreateDefaultProjectDirectory\(i\)/);
    assert.match(code, /__kanbanDefaultProjectParent\(this\.settingsStore,el\.Szl\.defaultProjectParent\.key\)/);
    assert.doesNotMatch(code, /await em\.PCQ\.mkdir\(i,\{recursive:!0\},this\.appServerClient\)/);
    assert.match(code, /__kanbanBindProjects\(this,e\)\.createDefaultWorkspaceRoot\(t\.projectName\?\?eeR,t\.initializeGitRepository\)/);
    assert.match(code, /__kanbanBindProjects\(this,e\)\.createDefaultWorkspaceRoot\(eeR,t\)/);
    assert.match(code, /__kanbanBindProjects\(this\.projectsManager,e\)\.createOrSelectLocalProjects\(\[r\]\)/);
    assert.match(code, /t&&await this\.initializeDefaultWorkspace\(i\),i/);
    assert.match(code, /this\.#r9\(e\)/);
    assert.match(code, /async pickFiles\(/);
    assert.throws(() => adaptProjectFolderPickerChunk({ body: result.body }), {
      code: "NATIVE_HOST_POLICY_DIGEST_MISMATCH",
    });
  },
);
