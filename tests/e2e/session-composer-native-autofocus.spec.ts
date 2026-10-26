import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test.setTimeout(30_000);
test.use({
  viewport: { width: 1440, height: 900 },
  hasTouch: false,
  isMobile: false,
});

const CWD = "/fixture/项目/very-long-project-path-for-ui-regression";
const editorSelector = (thread: string) =>
  `.session-mode .session-agent-view .session-codex-composer[data-owner-thread="${thread}"] .session-native-editor-slot [contenteditable="true"]`;
type Urls = {
  navigation: string;
  codex: string;
  drafts: string;
  reactDom: string;
};
type NativeEvent = {
  type: string;
  at: number;
  trusted: boolean;
  uid: number;
  rootUid: number;
  owner: string | null;
  thread: string | null;
};
type ProbeSnapshot = {
  events: NativeEvent[];
  overflow: number;
  activeUid: number;
  activeOwner: string | null;
  selectionAnchorOwner: string | null;
  selectionFocusOwner: string | null;
};
declare global {
  interface Window {
    __r30NativeFocusProbe?: {
      uid(node: Node | null): number;
      snapshot(): ProbeSnapshot;
      dispose(): ProbeSnapshot;
    };
  }
}

async function frames(page: Page, count = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  }, count);
}

async function mountedUrls(page: Page): Promise<Urls> {
  return page.evaluate(() => {
    const source = (path: string) => {
      const entry = performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path);
      if (!entry) throw new Error(`Missing mounted fixture module: ${path}`);
      return entry.name;
    };
    const reactDom = performance
      .getEntriesByType("resource")
      .findLast((e) => new URL(e.name).pathname.endsWith("/deps/react-dom.js"));
    if (!reactDom)
      throw new Error(
        "Missing mounted react-dom dependency; do not import another renderer",
      );
    return {
      navigation: source("/src/session-mode/lib/agentNav.ts"),
      codex: source("/src/session-mode/components/codex/stores/index.ts"),
      drafts: source("/src/session-mode/stores/useSessionDraftStore.ts"),
      reactDom: reactDom.name,
    };
  });
}

async function navigate(page: Page, urls: Urls, thread: string) {
  const accepted = await page.evaluate(
    async ({ url, thread, cwd }) => {
      const { navigateToAgentSession } = await import(url);
      return navigateToAgentSession({ agent: "codex", cwd, threadId: thread });
    },
    { url: urls.navigation, thread, cwd: CWD },
  );
  expect(accepted).toBe(true);
  const editor = page.locator(editorSelector(thread));
  await expect(editor).toHaveCount(1);
  await expect(editor).toBeVisible();
  const owner = await editor.evaluate(
    (node) =>
      node.closest<HTMLElement>(".session-codex-composer")?.dataset.draftOwner,
  );
  expect(owner).toBe(JSON.stringify(["codex", "", "session", thread]));
  return editor;
}

async function drafts(page: Page, urls: Urls) {
  return page.evaluate(async (url) => {
    const { readDraft, sessionDraftKey } = await import(url);
    return {
      a: { ...readDraft(sessionDraftKey("codex", "ux-0")) },
      b: { ...readDraft(sessionDraftKey("codex", "ux-1")) },
    };
  }, urls.drafts);
}

async function installProbe(page: Page) {
  await page.evaluate(() => {
    if (window.__r30NativeFocusProbe) throw new Error("Duplicate focus probe");
    const ids = new WeakMap<Node, number>();
    let next = 0,
      overflow = 0;
    const events: NativeEvent[] = [];
    const uid = (node: Node | null) => {
      if (!node) return 0;
      let id = ids.get(node);
      if (id === undefined) {
        id = ++next;
        ids.set(node, id);
      }
      return id;
    };
    const element = (node: Node | null) =>
      node instanceof Element ? node : (node?.parentElement ?? null);
    const owner = (node: Node | null) =>
      element(node)?.closest<HTMLElement>(
        ".session-codex-composer[data-draft-owner]",
      )?.dataset.draftOwner ?? null;
    const record = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      const target = element(event.target);
      const root =
        target?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
      const composer =
        target?.closest<HTMLElement>(".session-codex-composer") ?? null;
      if (events.length === 32) {
        overflow++;
        return;
      }
      events.push({
        type: event.type,
        at: performance.now(),
        trusted: event.isTrusted,
        uid: uid(event.target),
        rootUid: uid(root),
        owner: owner(event.target),
        thread: composer?.dataset.ownerThread ?? null,
      });
    };
    document.addEventListener("focusin", record, true);
    document.addEventListener("keydown", record, true);
    const snapshot = (): ProbeSnapshot => {
      const selection = document.getSelection();
      return {
        events: events.slice(),
        overflow,
        activeUid: uid(document.activeElement),
        activeOwner: owner(document.activeElement),
        selectionAnchorOwner: owner(selection?.anchorNode ?? null),
        selectionFocusOwner: owner(selection?.focusNode ?? null),
      };
    };
    window.__r30NativeFocusProbe = {
      uid,
      snapshot,
      dispose() {
        document.removeEventListener("focusin", record, true);
        document.removeEventListener("keydown", record, true);
        const result = snapshot();
        delete window.__r30NativeFocusProbe;
        return result;
      },
    };
  });
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__r30NativeFocusProbe) throw new Error("Focus probe is absent");
    return window.__r30NativeFocusProbe.snapshot();
  });
}

async function runCase(
  page: Page,
  info: TestInfo,
  body: (urls: Urls) => Promise<void>,
) {
  const errors: string[] = [],
    consoleErrors: Array<{ text: string; url: string }> = [],
    cleanupErrors: string[] = [];
  const failures: unknown[] = [];
  let receipt: ProbeSnapshot | null = null;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  const fixture = await installSessionUxFixture(page, 2);
  let origin = "";
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    origin = new URL(page.url()).origin;
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page, 2);
    const urls = await mountedUrls(page);
    // seedSessionUx alone is not a selected followed session. Use the actual
    // navigation entry and then verify the mounted owner before any input.
    await navigate(page, urls, "ux-0");
    await frames(page);
    await installProbe(page);
    await body(urls);
  } catch (error) {
    failures.push(error);
  } finally {
    if (!page.isClosed()) {
      try {
        receipt = await page.evaluate(() => {
          const result = window.__r30NativeFocusProbe?.dispose() ?? null;
          document
            .querySelectorAll('[data-r30-focus-peer="owned"]')
            .forEach((node) => node.remove());
          return result;
        });
      } catch (error) {
        cleanupErrors.push(`probe: ${String(error)}`);
      }
      try {
        await page.close();
      } catch (error) {
        cleanupErrors.push(`page.close: ${String(error)}`);
      }
    } else cleanupErrors.push("Page closed before explicit observer disposal");
  }
  const business = fixture.calls.filter((call) =>
    /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|archive|unarchive|compact)|followups\/(?:submit|stop|change)|goals?\/(?:set|clear|materialize)|subagents\/stop)(?:\/|$)/.test(
      call.path,
    ),
  );
  const unexpectedConsole = consoleErrors.filter(
    (item) =>
      !(
        (item.url === `${origin}/@vite/client` &&
          item.text.startsWith("[vite] failed to connect to websocket.")) ||
        (item.url === `${origin}/?mode=session` &&
          item.text ===
            'Viewport argument key "interactive-widget" not recognized and ignored.')
      ),
  );
  for (const assertion of [
    () =>
      expect(
        receipt,
        "a real mounted probe must be explicitly disposed",
      ).not.toBeNull(),
    () => expect(receipt?.overflow).toBe(0),
    () => expect(cleanupErrors).toEqual([]),
    () => expect(errors).toEqual([]),
    () => expect(unexpectedConsole).toEqual([]),
    () => expect(business).toEqual([]),
  ]) {
    try {
      assertion();
    } catch (error) {
      failures.push(error);
    }
  }
  await info.attach("native-composer-focus", {
    body: JSON.stringify(
      {
        receipt,
        errors,
        consoleErrors,
        cleanupErrors,
        businessPaths: business.map((call) => call.path),
        failureCount: failures.length,
        failures: failures.map((error) =>
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { message: String(error) },
        ),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  if (failures.length)
    throw new AggregateError(failures, "Native composer focus control failed");
}

test("desktop A to B replaces the real Lexical root and routes the first keyboard input only to B", async ({
  page,
}, info) => {
  await runCase(page, info, async (urls) => {
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(false);
    const a = page.locator(editorSelector("ux-0"));
    await expect(a).toBeFocused();
    await a.fill("A 独立草稿");
    const before = await drafts(page, urls);
    expect(before.a.text).toBe("A 独立草稿");
    expect(before.b.text).toBe("");
    const oldRoot = await a.elementHandle();
    if (!oldRoot) throw new Error("A native root disappeared");
    try {
      const b = await navigate(page, urls, "ux-1");
      await frames(page);
      const identity = await oldRoot.evaluate((old, selector) => {
        const next = document.querySelector<HTMLElement>(selector);
        if (!next) throw new Error("B root is absent");
        return {
          oldConnected: old.isConnected,
          replaced: old !== next,
          nextActive: document.activeElement === next,
        };
      }, editorSelector("ux-1"));
      expect(identity).toEqual({
        oldConnected: false,
        replaced: true,
        nextActive: true,
      });
      const focused = await snapshot(page);
      const bOwner = JSON.stringify(["codex", "", "session", "ux-1"]);
      expect(focused.activeOwner).toBe(bOwner);
      expect(focused.selectionAnchorOwner).toBe(bOwner);
      expect(focused.selectionFocusOwner).toBe(bOwner);
      const eventIndex = focused.events.length;
      await page.keyboard.type("B");
      await expect(b).toHaveText("B");
      const after = await drafts(page, urls);
      expect(after.a).toEqual(before.a);
      expect(after.b.text).toBe("B");
      const keys = (await snapshot(page)).events
        .slice(eventIndex)
        .filter((event) => event.type === "keydown");
      expect(keys).toHaveLength(1);
      expect(keys[0].trusted).toBe(true);
      expect(keys[0].owner).toBe(bOwner);
    } finally {
      await oldRoot.dispose();
    }
  });
});

test("a focus-trigger request does not override the other real input chosen in the same evaluation", async ({
  page,
}, info) => {
  await runCase(page, info, async (urls) => {
    const a = page.locator(editorSelector("ux-0"));
    await expect(a).toBeFocused();
    await a.fill("A 焦点控制草稿");
    const before = await drafts(page, urls);
    const trigger = await page.evaluate(
      async ({ codex, reactDom, selector }) => {
        const { useCodexStore } = await import(codex);
        const renderer = await import(reactDom);
      const flushSync = renderer.flushSync ?? renderer.default?.flushSync;
        if (typeof flushSync !== "function")
          throw new Error("Mounted renderer has no flushSync");
        const root = document.querySelector<HTMLElement>(selector);
        if (!root || document.activeElement !== root)
          throw new Error("Expected the actual focused A editor");
        const other = document.createElement("input");
        other.id = "r30-native-focus-peer";
        other.dataset.r30FocusPeer = "owned";
        other.setAttribute("aria-label", "R30 independent focus target");
        other.style.cssText =
          "position:fixed;top:8px;left:8px;width:180px;height:32px;z-index:9999";
        document.body.append(other);
        if (!other.getClientRects().length)
          throw new Error("Fixture input has no real layout");
        const before = useCodexStore.getState().inputFocusTrigger;
        // Real React commit/effects, not a mock scheduler or direct editor.focus.
        flushSync(() => useCodexStore.getState().triggerInputFocus());
        other.focus();
        return {
          before,
          after: useCodexStore.getState().inputFocusTrigger,
          otherActive: document.activeElement === other,
        };
      },
      {
        codex: urls.codex,
        reactDom: urls.reactDom,
        selector: editorSelector("ux-0"),
      },
    );
    expect(trigger.after).toBe(trigger.before + 1);
    expect(trigger.otherActive).toBe(true);
    await frames(page);
    await expect(
      page.getByRole("textbox", {
        name: "R30 independent focus target",
        exact: true,
      }),
    ).toBeFocused();
    expect((await snapshot(page)).activeOwner).toBeNull();
    expect(await drafts(page, urls)).toEqual(before);
  });
});

test("two real A to B to A commits cancel the intermediate owner's pending native focus", async ({
  page,
}, info) => {
  await runCase(page, info, async (urls) => {
    const a = page.locator(editorSelector("ux-0"));
    await expect(a).toBeFocused();
    await a.fill("A 快速切换草稿");
    const before = await drafts(page, urls);
    const race = await page.evaluate(
      async ({ navigation, codex, reactDom, cwd }) => {
        const { navigateToAgentSession } = await import(navigation);
        const { useCodexStore } = await import(codex);
        const renderer = await import(reactDom);
      const flushSync = renderer.flushSync ?? renderer.default?.flushSync;
        const probe = window.__r30NativeFocusProbe;
        if (!probe || typeof flushSync !== "function")
          throw new Error("Missing real fixture dependencies");
        const currentRoot = (id: string) => {
          const composer = document.querySelector<HTMLElement>(
            `.session-mode .session-agent-view .session-codex-composer[data-owner-thread="${id}"]`,
          );
          const root = composer?.querySelector<HTMLElement>(
            '.session-native-editor-slot [contenteditable="true"]',
          );
          if (
            !root ||
            !root.isConnected ||
            useCodexStore.getState().currentThreadId !== id
          )
            throw new Error(`Missing committed owner ${id}`);
          return root;
        };
        const oldA = currentRoot("ux-0"),
          index = probe.snapshot().events.length;
        const go = (threadId: string) => {
          let accepted = false;
          flushSync(() => {
            accepted = navigateToAgentSession({
              agent: "codex",
              cwd,
              threadId,
            });
          });
          if (!accepted)
            throw new Error("Real navigation refused fixture thread");
          return currentRoot(threadId);
        };
        const intermediateB = go("ux-1");
        const finalA = go("ux-0");
        return {
          index,
          oldUid: probe.uid(oldA),
          intermediateUid: probe.uid(intermediateB),
          finalUid: probe.uid(finalA),
          oldConnected: oldA.isConnected,
          intermediateConnected: intermediateB.isConnected,
          threeDistinct:
            oldA !== intermediateB &&
            oldA !== finalA &&
            intermediateB !== finalA,
        };
      },
      {
        navigation: urls.navigation,
        codex: urls.codex,
        reactDom: urls.reactDom,
        cwd: CWD,
      },
    );
    expect(race.threeDistinct).toBe(true);
    expect(race.oldConnected).toBe(false);
    expect(race.intermediateConnected).toBe(false);
    await frames(page);
    const after = await snapshot(page);
    expect(after.activeUid).toBe(race.finalUid);
    expect(after.activeOwner).toBe(
      JSON.stringify(["codex", "", "session", "ux-0"]),
    );
    const focusEvents = after.events
      .slice(race.index)
      .filter((event) => event.type === "focusin");
    expect(focusEvents.some((event) => event.rootUid === race.finalUid)).toBe(
      true,
    );
    expect(
      focusEvents.filter(
        (event) =>
          event.rootUid === race.intermediateUid ||
          event.rootUid === race.oldUid,
      ),
    ).toEqual([]);
    expect(await drafts(page, urls)).toEqual(before);
  });
});

test.describe("native coarse-pointer policy", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("switching a coarse-pointer owner does not autofocus and an explicit tap still edits only B", async ({
    page,
  }, info) => {
    await runCase(page, info, async (urls) => {
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      const a = page.locator(editorSelector("ux-0"));
      expect(
        await a.evaluate((root) => root.contains(document.activeElement)),
      ).toBe(false);
      const before = await drafts(page, urls);
      const index = (await snapshot(page)).events.length;
      const b = await navigate(page, urls, "ux-1");
      await frames(page);
      expect(
        await b.evaluate((root) => root.contains(document.activeElement)),
      ).toBe(false);
      const focusedEditors = (await snapshot(page)).events
        .slice(index)
        .filter((event) => event.type === "focusin" && event.rootUid !== 0);
      expect(focusedEditors).toEqual([]);
      expect(await drafts(page, urls)).toEqual(before);
      await b.tap();
      await expect(b).toBeFocused();
      await page.keyboard.type("T");
      await expect(b).toHaveText("T");
      const after = await drafts(page, urls);
      expect(after.a).toEqual(before.a);
      expect(after.b.text).toBe("T");
    });
  });
});
