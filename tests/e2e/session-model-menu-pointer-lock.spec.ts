import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test.use({ viewport: { width: 1440, height: 1000 } });

async function seedAdjustableModel(page: Page) {
  await seedSessionUx(page, 0);
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/useConfigStore.ts";
    const { useConfigStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
    );
    // This flow starts in simple view before switching to the model list.
    // fixture-next advertises three efforts; fixture-model only advertises one.
    useConfigStore.setState({ model: "fixture-next" });
  });
  await expect(
    page.locator(".session-codex-composer .session-native-model-trigger"),
  ).toContainText("接替模型");
}

async function pointerState(page: Page) {
  return page.evaluate(() => ({
    now: performance.now(),
    menuStates: [
      ...document.querySelectorAll(".session-native-model-menu"),
    ].map((element) => element.getAttribute("data-state")),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    sheets: document.querySelectorAll(".session-composer-sheet.is-full").length,
    html: {
      inline: document.documentElement.style.pointerEvents,
      computed: getComputedStyle(document.documentElement).pointerEvents,
    },
    body: {
      inline: document.body.style.pointerEvents,
      computed: getComputedStyle(document.body).pointerEvents,
    },
    owner: document
      .querySelector(".session-codex-composer")
      ?.getAttribute("data-draft-owner"),
  }));
}

const cases = [
  { dismissal: "open", width: 1440 },
  { dismissal: "escape-immediate", width: 1440 },
  { dismissal: "escape-detached", width: 1440 },
  { dismissal: "escape-immediate", width: 390 },
] as const;
for (const { dismissal, width } of cases) {
  test.describe(`nested model menu ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test(`browser Back restores pointer input from the expanded ${dismissal} model menu`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const fixture = await installSessionUxFixture(page, 0);
      const states: Array<{
        step: string;
        state: Awaited<ReturnType<typeof pointerState>>;
      }> = [];
      try {
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor();
        await seedAdjustableModel(page);
        const first = await pointerState(page);
        states.push({ step: "fixture-ready", state: first });
        await page
          .getByRole("button", { name: "附加文件", exact: true })
          .click();
        await page
          .getByRole("button", { name: "展开编辑", exact: true })
          .click();
        const sheet = page.getByRole("dialog", {
          name: "展开编辑",
          exact: true,
        });
        const draft = "浏览器返回保留这份未发送草稿";
        await sheet.locator(".session-rich-draft textarea").fill(draft);
        await sheet.locator(".session-native-model-trigger").click();
        const menu = page.locator(".session-native-model-menu");
        await menu
          .getByRole("menuitem", { name: "选择模型", exact: true })
          .click();
        await menu.getByRole("menuitemradio").first().waitFor();
        states.push({ step: "advanced-open", state: await pointerState(page) });

        if (dismissal !== "open") {
          await page.keyboard.press("Escape");
          if (dismissal === "escape-detached")
            await menu.waitFor({ state: "detached" });
          if (dismissal === "escape-detached")
            await expect(
              sheet.locator(".session-rich-draft textarea"),
            ).toBeFocused();
          const closed = await pointerState(page);
          states.push({ step: "menu-escape-sheet-still-open", state: closed });
          expect(closed.dialogs).toBe(1);
          expect(closed.sheets).toBe(1);
          expect(closed.body.computed).toBe("none");
        }
        // Actual browser history closes the Sheet through useComposerSheetHistory.
        // Do not dispatch popstate or change workspace/session stores here.
        await page.goBack({ waitUntil: "domcontentloaded" });
        await sheet.waitFor({ state: "detached" });
        await menu.waitFor({ state: "detached" });
        const closed = await pointerState(page);
        states.push({ step: "after-browser-back", state: closed });
        expect(closed.owner).toBe(first.owner);
        expect(closed.dialogs).toBe(0);
        expect(closed.sheets).toBe(0);
        expect(closed.menuStates).toEqual([]);
        await expect
          .poll(async () => (await pointerState(page)).body.computed, {
            timeout: 2000,
          })
          .toBe("auto");
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        await expect(editor).toHaveText(draft);
        const plus = page.getByRole("button", {
          name: "附加文件",
          exact: true,
        });
        await plus.click({ trial: true, timeout: 1000 });
        await plus.click();
        await expect(
          page.getByRole("button", { name: "展开编辑", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        expect(errors).toEqual([]);
      } finally {
        states.push({ step: "final", state: await pointerState(page) });
        const executing = fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork)|followups\/submit|goal\/(?:set|clear))$/.test(
            call.path,
          ),
        );
        const output = info.outputPath("pointer-lock.json");
        writeFileSync(
          output,
          JSON.stringify({ dismissal, states, errors, executing }, null, 2),
        );
        await info.attach("pointer-lock", {
          path: output,
          contentType: "application/json",
        });
        await page.screenshot({ path: info.outputPath("pointer-lock.png") });
        expect(executing).toEqual([]);
      }
    });
  });
}

test("model Escape restores its captured main draft without a stale modal lock", async ({
  page,
}, info) => {
  const fixture = await installSessionUxFixture(page, 0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const composer = page.locator(".session-codex-composer");
    const editor = composer.locator("[contenteditable=true]").first();
    await editor.waitFor();
    await seedAdjustableModel(page);
    const draft = "Escape保留主输入草稿";
    await editor.fill(draft);
    await composer.locator(".session-native-model-trigger").click();
    const menu = page.locator(".session-native-model-menu");
    await menu.getByRole("menuitem", { name: "选择模型", exact: true }).click();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(draft);
    expect((await pointerState(page)).body.computed).toBe("auto");
    await page
      .getByRole("button", { name: "附加文件", exact: true })
      .click({ trial: true });
    expect(errors).toEqual([]);
  } finally {
    const executing = fixture.calls.filter((call) =>
      /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork)|followups\/submit|goal\/(?:set|clear))$/.test(
        call.path,
      ),
    );
    writeFileSync(
      info.outputPath("main-escape.json"),
      JSON.stringify(
        { state: await pointerState(page), errors, executing },
        null,
        2,
      ),
    );
    expect(executing).toEqual([]);
  }
});

async function mountRemainingModal(page: Page) {
  await page.evaluate(async () => {
    const entries = performance.getEntriesByType("resource");
    const reactUrl = entries.findLast((entry) =>
      new URL(entry.name).pathname.endsWith("/react.js"),
    )?.name;
    const domUrl = entries.findLast((entry) =>
      new URL(entry.name).pathname.endsWith("/react-dom_client.js"),
    )?.name;
    const dialogUrl = entries.findLast(
      (entry) =>
        new URL(entry.name).pathname ===
        "/src/session-mode/components/ui/dialog.tsx",
    )?.name;
    if (!reactUrl || !domUrl || !dialogUrl)
      throw new Error("Mounted React/Dialog modules were not found");
    const [React, ReactDOM, Dialog] = await Promise.all([
      import(reactUrl),
      import(domUrl),
      import(dialogUrl),
    ]);
    const ReactApi = React.default ?? React;
    const ReactDomApi = ReactDOM.default ?? ReactDOM;
    const host = document.createElement("div");
    host.dataset.pointerLockFixture = "remaining-modal";
    document.querySelector(".session-mode")!.append(host);
    const root = ReactDomApi.createRoot(host);
    function RemainingModal() {
      const [open, setOpen] = ReactApi.useState(true);
      return ReactApi.createElement(
        Dialog.Dialog,
        { open, onOpenChange: setOpen },
        ReactApi.createElement(
          Dialog.DialogContent,
          { showCloseButton: false },
          ReactApi.createElement(Dialog.DialogTitle, null, "独立模态对照"),
          ReactApi.createElement(
            Dialog.DialogDescription,
            null,
            "隔离fixture持有自身的真实Dialog锁。",
          ),
          ReactApi.createElement(
            Dialog.DialogClose,
            { "aria-label": "关闭独立模态" },
            "关闭",
          ),
        ),
      );
    }
    root.render(ReactApi.createElement(RemainingModal));
    (window as any).__sessionPointerModalCleanup = () => {
      root.unmount();
      host.remove();
      delete (window as any).__sessionPointerModalCleanup;
    };
  });
}

test("closing the expanded model owner preserves another actual shared Dialog lock", async ({
  page,
}, info) => {
  const fixture = await installSessionUxFixture(page, 0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const states: Array<{
    step: string;
    state: Awaited<ReturnType<typeof pointerState>>;
  }> = [];
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-codex-composer [contenteditable=true]")
      .first()
      .waitFor();
    await seedAdjustableModel(page);
    await page.getByRole("button", { name: "附加文件", exact: true }).click();
    await page.getByRole("button", { name: "展开编辑", exact: true }).click();
    const sheet = page.locator(".session-composer-sheet.is-full");
    await sheet.locator(".session-native-model-trigger").click();
    const menu = page.locator(".session-native-model-menu");
    await menu.getByRole("menuitem", { name: "选择模型", exact: true }).click();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    await mountRemainingModal(page);
    const other = page.getByRole("dialog", {
      name: "独立模态对照",
      exact: true,
    });
    await expect(other).toBeVisible();
    states.push({
      step: "two-actual-dialogs",
      state: await pointerState(page),
    });
    await page.goBack({ waitUntil: "domcontentloaded" });
    await sheet.waitFor({ state: "detached" });
    await expect(other).toBeVisible();
    const remaining = await pointerState(page);
    states.push({ step: "only-independent-dialog-remains", state: remaining });
    expect(remaining.dialogs).toBe(1);
    expect(remaining.sheets).toBe(0);
    expect(remaining.body.computed).toBe("none");
    await expect(
      other.getByRole("button", { name: "关闭独立模态", exact: true }),
    ).toBeFocused();
    await other
      .getByRole("button", { name: "关闭独立模态", exact: true })
      .click();
    await other.waitFor({ state: "detached" });
    const closed = await pointerState(page);
    states.push({ step: "last-independent-owner-closed", state: closed });
    expect(closed.dialogs).toBe(0);
    expect(closed.body.computed).toBe("auto");
    await page
      .getByRole("button", { name: "附加文件", exact: true })
      .click({ trial: true });
    expect(errors).toEqual([]);
  } finally {
    states.push({
      step: "before-owned-fixture-cleanup",
      state: await pointerState(page),
    });
    const executing = fixture.calls.filter((call) =>
      /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork)|followups\/submit|goal\/(?:set|clear))$/.test(
        call.path,
      ),
    );
    writeFileSync(
      info.outputPath("remaining-modal.json"),
      JSON.stringify(
        {
          boundary:
            "The independent modal is the actual currently mounted shared Dialog component in its own fixture React root. This verifies lock ownership, not a claim that a normal user can open this exact modal combination.",
          states,
          errors,
          executing,
        },
        null,
        2,
      ),
    );
    await page.evaluate(() => (window as any).__sessionPointerModalCleanup?.());
    expect(executing).toEqual([]);
  }
});
