// Explicit isolated fixture; exercises original new-chat DOM, storage and browser IME.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "../../node_modules/playwright/index.mjs";
import { iphone16Context, mobileEnvironment } from "./codex-refresh-mobile.mjs";
import { expectedRefreshHistory } from "./codex-refresh-history.mjs";
import { attachPrivateService } from "../../packages/native-codex-host/refresh-prototype/private-service.mjs";

const file = process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST;
const output = process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT;
assert.ok(
  file && output,
  "explicit private fixture and new output directory required",
);
const info = await lstat(file);
assert.ok(
  info.isFile() &&
    info.uid === process.getuid() &&
    (info.mode & 0o777) === 0o600 &&
    info.size < 65536,
);
const fixture = JSON.parse(await readFile(file, "utf8"));
const singleClientDiagnostic =
  process.env.NATIVE_CODEX_REFRESH_SINGLE_CLIENT_DIAGNOSTIC;
assert.ok(
  singleClientDiagnostic === undefined || singleClientDiagnostic === "1",
);
const clientCount = singleClientDiagnostic === "1" ? 1 : 3;
assert.equal(new Set(fixture.urls.map((url) => new URL(url).origin)).size, 3);
assert.ok(
  fixture.root.startsWith("/tmp/ck-") &&
    fixture.urls.every((url) => new URL(url).protocol === "https:"),
);
await mkdir(resolve(output), { mode: 0o700 });
const result = {
  scenario: "new-chat independent drafts",
  physicalDevice: false,
  mobileEngine: "chromium",
  fixtureApiRouting: false,
  clientCount,
  diagnosticOnly: clientCount !== 3,
  steps: [],
  errors: [],
  nativeOperations: [],
  startupSnapshots: [],
  passed: false,
};
const save = () =>
  writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
// Observe the current public tabGroups projection before closing the browser.
// Keep only exact native editor identities; never persist tokens or tab labels.
async function captureNativeGroups() {
  const snapshots = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const profile of fixture.profiles.slice(0, 3)) {
    const root = resolve(profile.root);
    assert.equal(
      resolve(fixture.root, root.slice(fixture.root.length + 1)),
      root,
    );
    assert.ok(root.startsWith(resolve(fixture.root) + "/"));
    const registries = (await readdir(root)).filter((name) =>
      /^companion-session-[0-9a-f-]{36}\.json$/.test(name),
    );
    assert.ok(registries.length <= 32);
    for (const name of registries) {
      try {
        const path = join(root, name),
          stat = await lstat(path);
        assert.ok(
          stat.isFile() &&
            stat.uid === process.getuid() &&
            (stat.mode & 0o777) === 0o600 &&
            stat.size < 65536,
        );
        const registry = JSON.parse(await readFile(path, "utf8"));
        assert.ok(
          uuid.test(registry.instanceId) &&
            name === `companion-session-${registry.instanceId}.json`,
        );
        assert.ok(
          Number.isInteger(registry.port) &&
            registry.port >= 1024 &&
            registry.port <= 65535,
        );
        assert.ok(
          typeof registry.token === "string" && registry.token.length >= 32,
        );
        const response = await fetch(
          `http://127.0.0.1:${registry.port}/status`,
          {
            headers: { authorization: `Bearer ${registry.token}` },
            signal: AbortSignal.timeout(5000),
          },
        );
        assert.equal(response.status, 200);
        const status = await response.json();
        assert.equal(status.instanceBroker.instanceId, registry.instanceId);
        assert.ok(Array.isArray(status.tabs) && status.tabs.length <= 64);
        snapshots.push({
          instanceId: registry.instanceId,
          officialVersion: status.officialVersion,
          groups: status.tabs.map((group) => ({
            column: group.column,
            active: group.active,
            tabCount: group.tabs.length,
            nativeTabs: group.tabs
              .filter((tab) => tab.viewType === "chatgpt.conversationEditor")
              .slice(0, 256)
              .map((tab) => {
                const uri = new URL(tab.uri);
                const thread = uri.pathname.match(
                  /^\/local\/([0-9a-f-]{36})$/,
                )?.[1];
                const windowId =
                  uri.pathname === "/extension/panel/new"
                    ? (uri.searchParams.get("nativeCodexPanel") ??
                      uri.search.match(
                        /^\?nativeCodexPanel%3D([0-9a-f-]{36})$/i,
                      )?.[1])
                    : null;
                return {
                  active: tab.active,
                  kind:
                    thread && uuid.test(thread)
                      ? "thread"
                      : windowId && uuid.test(windowId)
                        ? "new"
                        : "unknown",
                  targetId:
                    thread && uuid.test(thread)
                      ? thread
                      : windowId && uuid.test(windowId)
                        ? windowId
                        : null,
                };
              }),
          })),
        });
      } catch {
        snapshots.push({ registry: name, unavailable: true });
      }
    }
  }
  result.nativeTabSnapshots = snapshots;
}
const browser = await chromium.launch({
  headless: true,
  args: ["--ignore-certificate-errors-spki-list=" + fixture.spki],
});
const contexts = [],
  pages = [];
let expectedHistoryToken;
async function captureStartup(page, index, phase) {
  if (result.startupSnapshots.length >= 24) return;
  for (const frame of page.frames()) {
    try {
      if (!(await frame.locator(".monaco-workbench").count())) continue;
      const snapshot = await frame.evaluate(() => ({
        timeOrigin: performance.timeOrigin,
        observedMs: performance.now(),
        groupCount: document.querySelectorAll(".editor-group-container").length,
        marks: performance
          .getEntriesByType("mark")
          .filter((entry) =>
            /^code\/(?:didStartWorkbench|didRestoreEditors|willRestoreEditors|willStartWorkbench)$/.test(
              entry.name,
            ),
          )
          .slice(0, 16)
          .map((entry) => ({ name: entry.name, at: entry.startTime })),
      }));
      if (result.startupSnapshots.length < 24)
        result.startupSnapshots.push({ index, phase, ...snapshot });
    } catch {
      /* Native navigation may detach a document. */
    }
  }
}
async function composer(page, kind) {
  const end = Date.now() + 90000;
  let onboardingClicks = 0;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      try {
        const parent = frame.parentFrame();
        if (!parent) continue;
        const wrapper = await parent.frameElement();
        if (
          (await wrapper.getAttribute("data-kanban-native-hidden")) !== "false"
        )
          continue;
        const next = frame.getByRole("button", { name: "Next", exact: true });
        if ((await next.count()) && (await next.isVisible())) {
          const content = (await frame.locator("#root").innerText())
            .replace(/\b(?:Back|Next)\b/g, "")
            .trim();
          if (!content || onboardingClicks >= 12) continue;
          await next.click({ timeout: 1500 });
          onboardingClicks++;
          result.onboardingClicks = (result.onboardingClicks || 0) + 1;
          await save();
          // Let the official animated scene settle before another human-like
          // click. Repeated 50 ms clicks can keep restarting its transition.
          await page.waitForTimeout(1000);
          continue;
        }
        if (
          (await wrapper.getAttribute("data-kanban-native-interactive")) !==
          "true"
        )
          continue;
        const editor = frame
          .locator('#root [contenteditable="true"]:visible')
          .first();
        if (!(await editor.count())) continue;
        const portal = frame
          .locator("[data-above-composer-conversation-id]")
          .first();
        const id = (await portal.count())
          ? await portal.getAttribute("data-above-composer-conversation-id")
          : null;
        if (
          (kind === "thread" &&
            id === fixture.threadId &&
            (await frame
              .getByText(expectedHistoryToken, { exact: true })
              .count())) ||
          (kind === "new" && !id)
        )
          return editor;
      } catch {
        /* Native frame navigation. */
      }
    }
    await page.waitForTimeout(50);
  }
  throw Error("Correct selected native " + kind + " composer did not recover");
}
async function selected(page) {
  return page.evaluate((id) => {
    const key = "kanban.codex.tab-view.v1:kanban.codex.multiwindow.v2:" + id;
    const raw = sessionStorage.getItem(key),
      view = raw && JSON.parse(JSON.parse(raw));
    const item = view?.windows?.find((window) => window.id === view.activeId);
    return item && { id: item.id, kind: item.kind };
  }, fixture.profiles[0].id);
}
const drafts = [
  "新聊天 A 独立草稿",
  "新聊天 B 独立草稿",
  "iPhone 16 新聊天独立草稿",
];
try {
  const metadata = JSON.parse(
    await readFile(join(fixture.root, "manager/bridge.json"), "utf8"),
  );
  const service = await attachPrivateService({
    metadata,
    domain: fixture.domain,
  });
  const reader = await service.connect({
    name: "refresh_newchat_history_evidence",
  });
  try {
    const { thread } = await reader.request("thread/read", {
      threadId: fixture.threadId,
      includeTurns: true,
    });
    result.historyEvidence = expectedRefreshHistory(thread, {
      threadId: fixture.threadId,
      cwd: fixture.project,
    });
    expectedHistoryToken = result.historyEvidence.token;
  } finally {
    await reader.close();
  }
  const desktop = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const mobile = await browser.newContext({
    ...iphone16Context,
    ignoreHTTPSErrors: true,
  });
  contexts.push(desktop, mobile);
  const profile = fixture.profiles[0],
    identities = [];
  for (let index = 0; index < clientCount; index++) {
    const page = await (index === 2 ? mobile : desktop).newPage();
    pages.push(page);
    const operationPath = (path) =>
      /\/(?:new-beside|resume-beside|focus)$/.test(path);
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (!operationPath(path) || result.nativeOperations.length >= 256) return;
      if (!path.endsWith("/focus"))
        void captureStartup(page, index, path.split("/").at(-1));
      try {
        const body = JSON.parse(request.postData() || "{}");
        result.nativeOperations.push({
          index,
          phase: "request",
          path,
          at: Date.now(),
          instanceId: body.instanceId,
          windowId: body.windowId,
          targetId: body.targetId,
          threadId: body.threadId,
        });
      } catch {
        /* Only bounded native target metadata is relevant. */
      }
    });
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (!operationPath(path) || result.nativeOperations.length >= 256) return;
      void response
        .json()
        .then((body) => {
          if (result.nativeOperations.length < 256)
            result.nativeOperations.push({
              index,
              phase: "response",
              path,
              at: Date.now(),
              status: response.status(),
              column: body.column,
              opened: body.opened,
              focused: body.focused,
            });
        })
        .catch(() => {});
    });
    page.on("pageerror", (error) => {
      if (result.errors.length < 128)
        result.errors.push({
          index,
          kind: "pageerror",
          message: error.message.slice(0, 500),
        });
    });
    page.on("crash", () => result.errors.push({ index, kind: "crash" }));
    await page.addInitScript(
      ({ profile, threadId, cwd }) => {
        if (
          window !== window.top ||
          sessionStorage.getItem("newchat-fixture-seeded")
        )
          return;
        const data = JSON.stringify({
          version: 2,
          hostKey: profile.startupId,
          activeId: threadId,
          activeGroupId: "saved",
          tree: {
            type: "group",
            id: "saved",
            keys: [threadId],
            selected: threadId,
          },
          windows: [
            {
              id: threadId,
              kind: "thread",
              threadId,
              cwd,
              title: "Private shared native thread",
            },
          ],
        });
        sessionStorage.setItem(
          "kanban.codex.tab-view.v1:kanban.codex.multiwindow.v2:" + profile.id,
          JSON.stringify(data),
        );
        sessionStorage.setItem("newchat-fixture-seeded", "1");
      },
      { profile, threadId: fixture.threadId, cwd: fixture.project },
    );
    result.stage = "navigate-" + index;
    await save();
    await page.goto(
      fixture.urls[index] + "/?mode=codex&nativeClient=" + profile.id,
    );
    await composer(page, "thread");
    result.stage = "new-chat-" + index;
    await save();
    const newChat = page.getByRole("button", { name: "+ 新聊天", exact: true });
    if (index === 2) await newChat.tap();
    else await newChat.click();
    const editor = await composer(page, "new"),
      identity = await selected(page);
    assert.equal(identity?.kind, "new");
    identities.push(identity);
    if (index === 0) {
      result.stage = "engine-composition";
      await save();
      await editor.click();
      await editor.evaluate((el) => {
        const evidence = [];
        el.__acceptanceComposition = evidence;
        for (const name of [
          "compositionstart",
          "compositionupdate",
          "compositionend",
        ])
          el.addEventListener(name, (event) =>
            evidence.push({
              type: event.type,
              trusted: event.isTrusted,
              length: event.data?.length ?? 0,
            }),
          );
      });
      const cdp = await desktop.newCDPSession(page);
      try {
        await cdp.send("Input.imeSetComposition", {
          text: "你好",
          selectionStart: 2,
          selectionEnd: 2,
        });
        await cdp.send("Input.insertText", { text: "你好" });
      } finally {
        await cdp.detach();
      }
      result.composition = {
        textMatches: (await editor.innerText()) === "你好",
        events: await editor.evaluate((el) => el.__acceptanceComposition),
        systemKeyboard: false,
        engineComposition: true,
      };
      assert.ok(result.composition.textMatches);
      assert.ok(
        result.composition.events.some(
          (event) => event.type === "compositionstart" && event.trusted,
        ),
      );
      assert.ok(
        result.composition.events.some(
          (event) =>
            event.type === "compositionupdate" &&
            event.trusted &&
            event.length === 2,
        ),
      );
      assert.ok(
        result.composition.events.some(
          (event) => event.type === "compositionend" && event.length === 2,
        ),
      );
      result.composition.trustedEndObserved = result.composition.events.some(
        (event) => event.type === "compositionend" && event.trusted,
      );
      // Input.insertText commits through the original editor; this engine/editor
      // reports an untrusted end event. Keep that boundary instead of fabricating it.
    }
    if (index === 2) {
      await editor.tap();
      result.mobileEnvironment = await mobileEnvironment(page);
    }
    await editor.fill(drafts[index]);
    await page.waitForTimeout(500);
    const pass = (await editor.innerText()) === drafts[index];
    result.steps.push({ step: "type", index, identity, pass });
    await save();
    assert.ok(pass);
  }
  assert.equal(
    new Set(identities.map((identity) => identity.id)).size,
    clientCount,
  );
  for (let index = 0; index < clientCount; index++) {
    const pass =
      (await (await composer(pages[index], "new")).innerText()) ===
      drafts[index];
    result.steps.push({ step: "concurrent", index, pass });
    await save();
    assert.ok(pass);
  }
  for (let index = 0; index < clientCount; index++) {
    result.stage = "reload-" + index;
    await save();
    await pages[index].reload({ waitUntil: "domcontentloaded" });
    const editor = await composer(pages[index], "new");
    const identity = await selected(pages[index]),
      pass =
        (await editor.innerText()) === drafts[index] &&
        identity?.id === identities[index].id;
    result.steps.push({ step: "reload", index, identity, pass });
    await save();
    await pages[index].screenshot({
      path: join(output, "new-chat-" + index + ".png"),
    });
    assert.ok(pass);
  }
  result.scenarioPassed =
    result.steps.length === clientCount * 3 &&
    result.steps.every((step) => step.pass) &&
    result.errors.length === 0;
  result.passed = clientCount === 3 && result.scenarioPassed;
} catch (error) {
  result.errors.push({
    kind: "assertion",
    message: error.message.slice(0, 1000),
  });
  result.frameDiagnostics = [];
  for (let index = 0; index < pages.length; index++) {
    for (const frame of pages[index].frames()) {
      try {
        const parent = frame.parentFrame(),
          wrapper = parent && (await parent.frameElement());
        result.frameDiagnostics.push({
          index,
          name: frame.name(),
          path: new URL(frame.url()).pathname,
          editors: await frame
            .locator('#root [contenteditable="true"]')
            .count(),
          next: await frame
            .getByRole("button", { name: "Next", exact: true })
            .count(),
          wrapper:
            wrapper &&
            (await wrapper.evaluate((el) => ({
              class: el.className,
              id: el.id,
              hidden: el.getAttribute("data-kanban-native-hidden"),
              interactive: el.getAttribute("data-kanban-native-interactive"),
            }))),
        });
      } catch {
        /* Detached frame metadata. */
      }
    }
    result.nativeGroups ??= [];
    for (const frame of pages[index].frames()) {
      try {
        const groups = await frame
          .locator(".editor-group-container")
          .evaluateAll((elements) =>
            elements.map((el) => {
              const box = el.getBoundingClientRect();
              return {
                id: el.getAttribute("data-groupid"),
                attributes: Object.fromEntries(
                  Array.from(el.attributes).map(({ name, value }) => [
                    name,
                    value,
                  ]),
                ),
                parentAttributes:
                  el.parentElement &&
                  Object.fromEntries(
                    Array.from(el.parentElement.attributes).map(
                      ({ name, value }) => [name, value],
                    ),
                  ),
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              };
            }),
          );
        if (groups.length) result.nativeGroups.push({ index, groups });
      } catch {
        /* Detached native group document. */
      }
    }
  }
  for (let index = 0; index < pages.length; index++)
    await pages[index]
      .screenshot({ path: join(output, "failure-" + index + ".png") })
      .catch(() => {});
} finally {
  for (let index = 0; index < pages.length; index++)
    await captureStartup(pages[index], index, "final");
  await captureNativeGroups().catch(() => {
    result.nativeTabSnapshotUnavailable = true;
  });
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await save();
}
console.log(
  JSON.stringify({
    output,
    passed: result.passed,
    diagnosticOnly: result.diagnosticOnly,
    scenarioPassed: result.scenarioPassed,
    steps: result.steps.length,
    errors: result.errors.length,
  }),
);
if (!result.passed) process.exitCode = 1;
