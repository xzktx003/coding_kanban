// Explicit owned, no-login loopback fixtures only. Never route a model call or
// approval through a mocked browser API or replace the official webview DOM.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "../../node_modules/playwright/index.mjs";
import { attachPrivateService } from "../../packages/native-codex-host/refresh-prototype/private-service.mjs";
import { captureProcessIdentity } from "../../packages/native-codex-host/refresh-prototype/resources.mjs";
import {
  verifyRefreshProfileRoot,
  selectRefreshClientProfile,
} from "./codex-refresh-fixture.mjs";
import { iphone16Context, mobileEnvironment } from "./codex-refresh-mobile.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function openLifecycleFixture(scenario) {
  const manifestPath = process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST;
  const outputPath = process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT;
  assert.ok(
    manifestPath && outputPath,
    "explicit private manifest and fresh output required",
  );
  const info = await lstat(manifestPath);
  assert.ok(
    info.isFile() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o600 &&
      info.size < 65536,
  );
  assert.equal(await realpath(manifestPath), resolve(manifestPath));
  const fixture = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(fixture.noLoginCopied, true);
  assert.equal(fixture.managedStartup, true);
  const profile = selectRefreshClientProfile(fixture, 0);
  for (const candidate of fixture.profiles)
    await verifyRefreshProfileRoot(fixture.root, candidate.root);
  assert.ok(fixture.root.startsWith("/tmp/ck-ui-life-"));
  assert.ok(UUID.test(profile.id) && UUID.test(profile.startupId));
  assert.equal(fixture.urls.length, 3);
  assert.equal(new Set(fixture.urls.map((url) => new URL(url).origin)).size, 3);
  assert.ok(fixture.urls.every((url) => new URL(url).protocol === "https:"));
  for (const key of ["idle", "running", "approval"])
    assert.ok(UUID.test(fixture.scenes[key]?.threadId));
  assert.equal(
    new Set(Object.values(fixture.scenes).map((scene) => scene.threadId)).size,
    3,
  );
  const provider = await readFile(
    join(fixture.root, "native-home/config.toml"),
    "utf8",
  );
  assert.match(provider, /requires_openai_auth\s*=\s*false/);
  assert.match(provider, /base_url\s*=\s*"http:\/\/127\.0\.0\.1:[0-9]+\/v1"/);
  const owned = JSON.parse(
    await readFile(join(dirname(manifestPath), "owned-processes.json"), "utf8"),
  );
  assert.equal(owned.root, fixture.root);
  const gateway = owned.processes.find(
    (record) => record.pid === fixture.gatewayPid,
  );
  assert.ok(gateway);
  assert.equal(
    (await captureProcessIdentity(gateway.pid)).startTicks,
    gateway.startTicks,
  );
  const output = resolve(outputPath);
  await mkdir(output, { mode: 0o700 });
  const result = {
    scenario,
    physicalDevice: false,
    mobileEngine: "chromium",
    fixtureApiRouting: false,
    measuresRecoveryPerformance: false,
    seedCreatorConnectionRetained: true,
    independentHostProfiles: fixture.profiles.length === 3,
    steps: [],
    errors: [],
    passed: false,
  };
  const save = () =>
    writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), {
      mode: 0o600,
    });
  let observer,
    browser,
    desktop,
    mobile,
    closing = false;
  const pages = [],
    events = [],
    intentionalCloses = new WeakSet();
  const fail = (kind, message) => {
    if (result.errors.length < 64)
      result.errors.push({ kind, message: String(message).slice(0, 400) });
  };
  const wait = async (check, label, max = 15000) => {
    const end = Date.now() + max;
    while (Date.now() < end) {
      if (result.errors.length)
        throw Error(label + ": prior asynchronous error");
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error(label);
  };
  const close = async () => {
    closing = true;
    await desktop?.close().catch(() => {});
    await mobile?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await observer?.close().catch(() => {});
    await save();
  };
  try {
    const metadata = JSON.parse(
      await readFile(join(fixture.root, "manager/bridge.json"), "utf8"),
    );
    const service = await attachPrivateService({
      metadata,
      domain: fixture.domain,
    });
    for (const key of ["generation", "pid", "startTicks"])
      assert.equal(service.record[key], fixture.service[key]);
    observer = await service.connect({
      name: "official_ui_lifecycle_oracle",
      onLifecycle: (event) => {
        if (events.length < 256)
          events.push({ ...event, receivedAt: Date.now() });
        else if (
          !result.errors.some((error) => error.kind === "oracle-overflow")
        )
          fail("oracle-overflow", "Bounded metadata oracle exhausted");
      },
    });
    observer.closed.then(
      () => {
        if (!closing) fail("oracle-closed", "Owned native observer closed");
      },
      () => {
        if (!closing) fail("oracle-closed", "Owned native observer failed");
      },
    );
    const titles = {
      approval: "Private approval",
      running: "Private running",
      idle: "Private idle",
    };
    const threads = Object.entries(titles).map(([key, title]) => ({
      id: fixture.scenes[key].threadId,
      cwd: fixture.project,
      title,
    }));
    const prepared = await fetch(
      "http://127.0.0.1:" + fixture.gatewayPort + "/api/native-codex/tabs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: "lifecycle_" + randomUUID(),
          operations: threads.map((thread, index) => ({
            seq: index + 1,
            action: { type: "add", thread },
          })),
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    assert.ok(prepared.ok);
    assert.equal((await prepared.json()).threads.length, 3);
    browser = await chromium.launch({
      headless: true,
      args: ["--ignore-certificate-errors-spki-list=" + fixture.spki],
    });
    result.browserVersion = browser.version();
    desktop = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    });
    mobile = await browser.newContext({
      ...iphone16Context,
      ignoreHTTPSErrors: true,
    });
    const createPage = async (index, selected = "approval") => {
      const profile = selectRefreshClientProfile(fixture, index);
      const page = await (index === 2 ? mobile : desktop).newPage();
      pages[index] = page;
      page.on("pageerror", (error) => fail("pageerror", error.message));
      page.on("crash", () => fail("crash", index));
      page.on("close", () => {
        if (!closing && !intentionalCloses.has(page))
          fail("unexpected-close", index);
      });
      await page.addInitScript(
        ({ profile, threads, id }) => {
          if (
            window !== window.top ||
            sessionStorage.getItem("lifecycle-view-seeded")
          )
            return;
          const state = {
            version: 2,
            hostKey: profile.startupId,
            activeId: id,
            activeGroupId: "g",
            tree: {
              type: "group",
              id: "g",
              keys: threads.map((thread) => thread.id),
              selected: id,
            },
            windows: threads.map((thread) => ({
              ...thread,
              kind: "thread",
              threadId: thread.id,
            })),
          };
          sessionStorage.setItem(
            "kanban.codex.tab-view.v1:kanban.codex.multiwindow.v2:" +
              profile.id,
            JSON.stringify(JSON.stringify(state)),
          );
          sessionStorage.setItem("lifecycle-view-seeded", "1");
        },
        { profile, threads, id: fixture.scenes[selected].threadId },
      );
      await page.goto(
        fixture.urls[index] + "/?mode=codex&nativeClient=" + profile.id,
      );
      if (index === 2) result.mobileEnvironment = await mobileEnvironment(page);
      return page;
    };
    const frame = async (page, threadId) =>
      wait(
        async () => {
          for (const candidate of page.frames()) {
            try {
              if (
                !(await candidate
                  .locator(
                    '[data-above-composer-conversation-id="' + threadId + '"]',
                  )
                  .count())
              )
                continue;
              const parent = candidate.parentFrame();
              if (!parent) continue;
              const wrapper = await parent.frameElement();
              if (
                (await wrapper.getAttribute(
                  "data-kanban-native-interactive",
                )) === "true" &&
                (await wrapper.getAttribute("data-kanban-native-hidden")) ===
                  "false"
              )
                return candidate;
            } catch {
              /* Native frame navigation. */
            }
          }
        },
        "Correct interactive official thread did not recover",
        90000,
      );
    const switchTo = async (index, key) => {
      const tab = pages[index].getByRole("tab", {
        name: titles[key],
        exact: true,
      });
      if (index === 2) await tab.tap();
      else await tab.click();
      return frame(pages[index], fixture.scenes[key].threadId);
    };
    const closePage = async (index) => {
      intentionalCloses.add(pages[index]);
      await pages[index].close();
    };
    const snapshot = async (scene, includeTurns = false) => {
      const { thread } = await observer.request("thread/read", {
        threadId: fixture.scenes[scene].threadId,
        includeTurns,
      });
      assert.equal(thread.id, fixture.scenes[scene].threadId);
      assert.equal(thread.cwd, fixture.project);
      return thread;
    };
    return {
      fixture,
      profile,
      result,
      output,
      save,
      wait,
      observer,
      events,
      pages,
      createPage,
      frame,
      switchTo,
      closePage,
      snapshot,
      close,
    };
  } catch (error) {
    fail("setup", error.message);
    await close();
    throw error;
  }
}
