import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  adaptProjectFolderPickerChunk,
} = require("../src/project-folder-picker-policy.cjs");
const {
  createProjectFolderPicker,
} = require("../src/project-folder-picker-native.cjs");
const {
  createProjectConsentRouter,
} = require("../src/project-consent-routing.cjs");

test(
  "fixed original XJ runs picker, directory recheck and the correct per-view Trust routing",
  { skip: !process.env.CHATGPT_PICKER_NATIVE_CHUNK },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "desktop-picker-chain-")),
      home = join(dir, "home"),
      project = join(dir, "project");
    await mkdir(home, { mode: 0o700 });
    await mkdir(project, { mode: 0o775 });
    const records = new Map(),
      owned = new WeakMap(),
      sent = [],
      nativeMessages = [],
      selections = [];
    const sender = { id: 1, isDestroyed: () => false },
      window = { webContents: sender, isDestroyed: () => false };
    const record = { viewId: randomUUID(), senderId: 1, window, failed: false };
    records.set(1, record);
    owned.set(sender, record);
    const getRecord = (id) => records.get(id),
      getOwnedRecord = (sender) => owned.get(sender);
    const consent = createProjectConsentRouter({ getRecord, getOwnedRecord });
    const picker = createProjectFolderPicker({
      homeRoot: home,
      projectRoots: [project],
      getRecord,
      getOwnedRecord,
      verifyAuthority: async () => true,
      verifyAuthoritySync: () => true,
      sendToView: (record, message) => sent.push({ record, message }),
    });
    const activationEpoch = randomUUID();
    assert.equal(
      picker.lifecycle(sender, {
        type: "kanban-project-folder-lifecycle",
        sequence: 1,
        epoch: activationEpoch,
      }),
      true,
    );
    const projects = {
      getLocalProjects: () => ({}),
      async createOrSelectLocalProjects(paths) {
        await Promise.resolve();
        selections.push({ paths, window: consent.selectWindow() });
        return [{ id: "created" }];
      },
    };
    const wm = {
      sendInlineMessageForView: (origin, message) =>
        nativeMessages.push({ origin, message }),
      sendMessageToWebContents() {},
    };
    const original = await readFile(process.env.CHATGPT_PICKER_NATIVE_CHUNK),
      text = adaptProjectFolderPickerChunk({ body: original }).body.toString(
        "utf8",
      );
    const start = text.indexOf("class XJ{"),
      end = text.indexOf("class XQ{", start);
    assert.ok(start >= 0 && end > start);
    const sandbox = {
      em: { vB9: () => () => ({ warning() {} }), cPM: () => false },
      ar: { n: "local", a: {} },
      el: { ycq: (values) => values[0] },
      eF: async (value) => value,
      eS: { stat },
      en: { resolve },
      eI: (value) => value,
      process,
      AbortController,
      setTimeout,
      clearTimeout,
      __kanbanBindProjects: consent.bindProjects,
      __kanbanProjectPickerOpen: picker.open,
      __kanbanProjectPickerDirect: picker.direct,
      __kanbanProjectPickerComplete: picker.complete,
      __kanbanProjectPickerConsume: picker.consume,
      __kanbanProjectPickerReply: picker.reply,
      __kanbanProjectPickerLifecycle: picker.lifecycle,
    };
    const XJ = runInNewContext("(" + text.slice(start, end) + ")", sandbox),
      native = new XJ({ id: "local" }, wm, projects);
    async function waitOpen(count) {
      for (
        let i = 0;
        i < 100 &&
        sent.filter(
          (item) => item.message.type === "kanban-project-folder-open",
        ).length < count;
        i++
      )
        await new Promise((resolve) => setImmediate(resolve));
      const opens = sent.filter(
        (item) => item.message.type === "kanban-project-folder-open",
      );
      assert.equal(opens.length, count);
      return opens[count - 1].message;
    }
    try {
      const operation = native.createOrSelectProject(sender),
        request = await waitOpen(1);
      await picker.reply(sender, {
        type: "kanban-project-folder-reply",
        requestId: request.requestId,
        epoch: activationEpoch,
        action: "select",
        paths: [project],
      });
      await operation;
      assert.equal(selections.length, 1);
      assert.equal(selections[0].paths.length, 1);
      assert.equal(selections[0].paths[0], project);
      assert.equal(selections[0].window, window);
      assert.deepEqual(
        nativeMessages.map((item) => item.message.type),
        ["workspace-root-option-added", "navigate-to-route"],
      );
      const pick = native.pickProjectSources(sender, true),
        next = await waitOpen(2);
      await picker.reply(sender, {
        type: "kanban-project-folder-reply",
        requestId: next.requestId,
        epoch: activationEpoch,
        action: "cancel",
      });
      await pick;
      assert.equal(selections.length, 1);
      await native.createOrSelectProject(sender, "/etc");
      assert.equal(
        selections.length,
        1,
        "direct out-of-root path must not reach projects",
      );
      assert.equal(
        nativeMessages.at(-1).message.type,
        "workspace-root-option-add-canceled",
      );
      await native.createOrSelectProject(sender, project);
      assert.equal(selections.length, 2);
      assert.equal(selections.at(-1).paths[0], project);
      assert.equal(selections.at(-1).window, window);

      const routeStart = text.indexOf(
          'case"electron-update-workspace-root-options":',
        ),
        routeEnd = text.indexOf('case"open-in-browser":', routeStart);
      assert.ok(routeStart >= 0 && routeEnd > routeStart);
      const route = runInNewContext(
        "(async function(e,t){switch(t.type){" +
          text.slice(routeStart, routeEnd) +
          "}})",
        sandbox,
      );
      await route.call({ projectsManager: projects }, sender, {
        type: "electron-update-workspace-root-options",
        roots: ["/etc"],
      });
      assert.equal(
        selections.length,
        2,
        "direct root updates must stay inside fixed roots",
      );
      await route.call({ projectsManager: projects }, sender, {
        type: "electron-update-workspace-root-options",
        roots: [project],
      });
      assert.equal(selections.length, 3);
      assert.equal(selections.at(-1).paths[0], project);
    } finally {
      picker.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
