const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createHost, createTodoCodeLenses } = require("./extension.cjs");
test("read-only editor companion can activate in a restricted workspace while project settings cannot enable LSP", () => {
  const manifest = require("./package.json");
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
  assert.ok(
    manifest.capabilities.untrustedWorkspaces.restrictedConfigurations.includes(
      "codingKanban.host.lsp",
    ),
  );
});
test("TODO CodeLens crosses the native command boundary with a URI and range rather than a live document", () => {
  const uri = { scheme: "file", fsPath: "/project/a.ts" },
    range = {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 12 },
    };
  const document = {
    uri,
    lineCount: 2,
    getText: () => "private buffer",
    lineAt: (i) => ({ text: i === 1 ? "// TODO todo" : "safe", range }),
  };
  const vscode = {
    CodeLens: class {
      constructor(range, command) {
        this.range = range;
        this.command = command;
      }
    },
  };
  const lens = createTodoCodeLenses(vscode, "/project", document)[0];
  assert.deepEqual(lens.command.arguments, [uri, range]);
  assert.equal(lens.command.arguments.includes(document), false);
  assert.deepEqual(
    createTodoCodeLenses(vscode, "/other-project", document),
    [],
  );
});
test("companion captures actual unsaved selection and opens real VS Code location/Diff APIs", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "kanban-companion-test-")),
    file = path.join(cwd, "a.ts");
  await writeFile(file, "saved");
  const calls = [];
  const position = { line: 3, character: 1 },
    range = { start: { line: 2, character: 0 }, end: position, isEmpty: false };
  const document = {
    uri: { scheme: "file", fsPath: file },
    languageId: "typescript",
    isDirty: true,
    getText: (selected) =>
      selected === range ? "unsaved selection" : "unsaved full text",
    validatePosition: (p) => p,
  };
  const editor = {
    document,
    selection: range,
    revealRange: (...args) => calls.push(["reveal", ...args]),
  };
  const vscode = {
    window: { activeTextEditor: editor, showTextDocument: async () => editor },
    workspace: {
      openTextDocument: async () => document,
      getConfiguration: () => ({ get: () => false }),
    },
    Uri: {
      file: (fsPath) => ({ fsPath, scheme: "file" }),
      parse: (value) => ({ toString: () => value }),
    },
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Selection: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
    commands: { executeCommand: async (...args) => calls.push(args) },
  };
  try {
    const host = createHost(vscode, cwd);
    const context = await host.execute({
      type: "context",
      selectionOnly: true,
    });
    assert.equal(context.text, "unsaved selection");
    assert.equal(context.dirty, true);
    assert.deepEqual(context.range, {
      start: 3,
      end: 4,
      startColumn: 1,
      endColumn: 2,
    });
    assert.equal(
      (await host.execute({ type: "context", selectionOnly: false })).text,
      "unsaved full text",
    );
    const opened = await host.execute({
      type: "openLocation",
      path: file,
      line: 4,
      column: 2,
    });
    assert.equal(opened.line, 4);
    assert.equal(editor.selection.start.character, 1);
    await host.execute({
      type: "showDiff",
      path: file,
      before: "before",
      after: "after",
    });
    assert.equal(calls.at(-1)[0], "vscode.diff");
    assert.equal(
      host.provider.provideTextDocumentContent(calls.at(-1)[1]),
      "before",
    );
    await assert.rejects(
      host.execute({ type: "definitions", path: file, line: 1, column: 1 }),
      /未启用/,
    );
    await assert.rejects(
      host.execute({
        type: "showDiff",
        path: path.join(cwd, "..", "secret"),
        before: "a",
        after: "b",
      }),
      /outside/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
