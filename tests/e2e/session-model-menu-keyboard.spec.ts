import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const fixtureRoot = resolve("scripts/fixtures/session-model-menu-original");
const assetRoot = resolve(
  "third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets",
);
const output = resolve(
  process.env.MODEL_MENU_KEYBOARD_OUTPUT ??
    ".dev-runtime/session-model-menu-keyboard-20261027",
);
const sourceFiles = [
  "apps/web/src/session-mode/components/codex/composer/NativeModelSelector.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeModelTrigger.tsx",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/codex/composer/NativeComposerIcon.tsx",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (p) => [
        p,
        createHash("sha256")
          .update(await readFile(p))
          .digest("hex"),
      ]),
    ),
  );
const models = [
  "gpt-5.5",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
].map((model, i) => ({
  id: model,
  model,
  displayName: model,
  description: "Declared synthetic model",
  isDefault: i === 1,
  hidden: false,
  supportedReasoningEfforts: ["low", "medium", "high"].map(
    (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }),
  ),
  defaultReasoningEffort: "medium",
  inputModalities: ["text"],
  supportsPersonality: false,
}));

async function original(
  page: Page,
  origin: string,
  query = "gate=true&from=gpt-5.6-sol&selectionMode=model",
) {
  const expectedAssets = JSON.parse(
    await readFile(fixtureRoot + "/assets-manifest.json", "utf8"),
  );
  const html = await readFile(fixtureRoot + "/index.html", "utf8");
  const suffix = await readFile(fixtureRoot + "/exports.js", "utf8");
  const served: Record<string, string> = {},
    denied: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript("window.__name=v=>v");
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) {
      denied.push(u.href);
      return route.abort();
    }
    if (u.pathname === "/notice-hca.html")
      return route.fulfill({ contentType: "text/html", body: html });
    if (u.pathname.startsWith("/hca-fixture/")) {
      const file = u.pathname.split("/").at(-1)!;
      if (!/^[a-z-]+\.(?:mjs|js|json)$/.test(file))
        throw Error("Unexpected fixture file");
      return route.fulfill({
        contentType: "text/javascript",
        body: await readFile(fixtureRoot + "/" + file),
      });
    }
    if (u.pathname.startsWith("/assets/")) {
      const file = u.pathname.slice(8);
      if (!/^[\w.-]+$/.test(file)) throw Error("Unexpected asset path");
      const bytes = await readFile(assetRoot + "/" + file);
      served[file] = createHash("sha256").update(bytes).digest("hex");
      expect(served[file], `Fixed official asset ${file}`).toBe(
        expectedAssets[file],
      );
      if (file === "app-initial-fee819fe4f22.js")
        expect(served[file]).toBe(
          "460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316",
        );
      return route.fulfill({
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".woff2")
              ? "font/woff2"
              : "application/octet-stream",
        body:
          file === "app-initial-fee819fe4f22.js"
            ? Buffer.concat([bytes, Buffer.from(suffix)])
            : bytes,
      });
    }
    denied.push(u.href);
    return route.abort();
  });
  await page.goto(origin + "/notice-hca.html?" + query);
  await page.waitForFunction(() => (window as any).hcaAudit?.bootstrap);
  await expect(page.locator("#root button").first()).toBeVisible();
  return { errors, denied, served };
}
async function local(page: Page, model = "gpt-5.6-sol", effort = "medium") {
  const f = await installSessionUxFixture(page, 1);
  await page.route("**/api/codex/model/list", (r) =>
    r.fulfill({ json: { data: models, nextCursor: null } }),
  );
  await page.route(/\/api\/codex\/thread\/read(?:\?.*)?$/, (r) =>
    r.fulfill({
      json: {
        thread: f.threads[0],
        model,
        modelProvider: "openai",
        reasoningEffort: effort,
      },
    }),
  );
  await page.goto("/?mode=session&view=agent");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(
    async ({ model, effort }) => {
      const p = "/src/session-mode/stores/useThreadModelStore.ts";
      const m = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
      );
      m.hydrateThreadModel("ux-0", {
        model,
        modelProvider: "openai",
        reasoningEffort: effort,
      });
      const q =
        "/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts";
      const pref = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === q)?.name ?? q
      );
      pref.useNativeModelPickerPreferencesStore
        .getState()
        .setSelectionMode("model");
    },
    { model, effort },
  );
  await expect(
    page.locator('.session-codex-composer button[aria-label^="模型："]'),
  ).toBeVisible();
  return f;
}
async function settle(page: Page) {
  await page.waitForTimeout(450);
}
async function snapshot(page: Page, step: string) {
  return page.evaluate((step) => {
    const visible = (e: Element) =>
      !!(e as HTMLElement).getClientRects().length &&
      getComputedStyle(e).visibility !== "hidden" &&
      !e.closest("[hidden],[inert]");
    const active = document.activeElement;
    return {
      step,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      focus: {
        tag: active?.tagName,
        role: active?.getAttribute("role"),
        label: active?.getAttribute("aria-label"),
        text: active?.textContent?.slice(0, 180),
        editor: active?.getAttribute("contenteditable") === "true",
        trigger:
          active === document.querySelector("#root button") ||
          active?.matches(
            '.session-codex-composer button[aria-label^="模型："]',
          ),
      },
      menus: [...document.querySelectorAll("[role=menu]")]
        .filter(visible)
        .map((e) => ({
          text: e.textContent?.slice(0, 1000),
          rows: [...e.querySelectorAll("[role^=menuitem]")]
            .filter(visible)
            .map((r) => ({
              role: r.getAttribute("role"),
              label: r.getAttribute("aria-label"),
              text: r.textContent,
              checked: r.getAttribute("aria-checked"),
            })),
        })),
      settings: (window as any).hcaAudit?.syntheticSettingsWrites ?? [],
    };
  }, step);
}
async function exercise(
  page: Page,
  native: boolean,
  touch: boolean,
  records: any[],
) {
  const trigger = native
    ? page.locator("#root button").first()
    : page.locator('.session-codex-composer button[aria-label^="模型："]');
  const caption = () =>
    page.getByRole("menuitem", {
      name: native ? "Select model" : "选择模型",
      exact: true,
    });
  const take = async (s: string) => {
    await settle(page);
    const value = await snapshot(page, s);
    records.push(value);
    console.log(native ? "native" : "local", s, JSON.stringify(value.focus));
  };
  await trigger.focus();
  await page.keyboard.press("Enter");
  await take("trigger-enter");
  await page.keyboard.press("ArrowDown");
  await take("main-down");
  await page.keyboard.press("Home");
  await take("main-home");
  await expect(caption()).toBeFocused();
  await page.keyboard.press("Enter");
  await take("caption-enter");
  await page.keyboard.press("ArrowDown");
  await take("radio-down");
  await page.keyboard.press("ArrowUp");
  await take("radio-up");
  await page.keyboard.press("Space");
  await take("radio-space");
  await page.keyboard.press("Enter");
  await take("caption-reenter");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await take("radio-first-model");
  await page.keyboard.press("Enter");
  await take("radio-enter");
  await page.keyboard.press("Escape");
  await take("escape-after-radio");
  await trigger.focus();
  await page.keyboard.press("Space");
  await take("trigger-space");
  await page.keyboard.press("Escape");
  await take("escape-after-trigger");
  await (touch ? trigger.tap() : trigger.click());
  await take("pointer-open");
  await (touch ? caption().tap() : caption().click());
  await take("pointer-advanced");
  const radio = page.getByRole("menuitemradio", {
    name: native ? "5.6 Terra" : "gpt-5.6-terra",
    exact: true,
  });
  // Catalog labels are normalized by each real product; select the same exact model row.
  const actualRadio = radio;
  await (touch ? actualRadio.tap() : actualRadio.click());
  await take("pointer-radio");
  const point = await page.evaluate(() => {
    const menus = [...document.querySelectorAll("[role=menu]")]
      .filter((e) => (e as HTMLElement).getClientRects().length)
      .map((e) => e.getBoundingClientRect());
    for (const y of [innerHeight / 2, innerHeight - 24, 24])
      for (const x of [8, innerWidth - 8, innerWidth / 2]) {
        if (
          menus.some(
            (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
          )
        )
          continue;
        const e = document.elementFromPoint(x, y);
        if (
          e &&
          !e.closest(
            "button,a,input,textarea,[contenteditable=true],[role=menu],[role=tab]",
          )
        )
          return {
            x,
            y,
            hit: {
              tag: e.tagName,
              role: e.getAttribute("role"),
              className: e.className,
            },
          };
      }
    throw Error("No verified outside noninteractive point");
  });
  records.push({ step: "outside-hit-test", point });
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await take("outside-blank");
  return records;
}
for (const width of [1440, 375])
  test(`actual original and local model menu keyboard and touch (${width}px)`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90000);
    await mkdir(output, { recursive: true });
    const before = await hashes();
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width === 375,
      isMobile: width === 375,
      ignoreHTTPSErrors: true,
      baseURL,
    });
    context.setDefaultTimeout(7000);
    const native = await context.newPage();
    const product = await context.newPage();
    const errors: string[] = [];
    product.on("pageerror", (e) => errors.push(e.message));
    const result: any = { width, before };
    try {
      const audit = await original(native, new URL(baseURL!).origin);
      const f = await local(product);
      result.native = [];
      result.local = [];
      await exercise(native, true, width === 375, result.native);
      await exercise(product, false, width === 375, result.local);
      result.audit = audit;
      result.errors = errors;
      result.calls = f.calls;
      expect(
        result.native.find((r: any) => r.step === "main-down").focus.label,
      ).toBe("Reset to default");
      expect(
        result.local.find((r: any) => r.step === "main-down").focus.label,
      ).toBe("恢复默认");
      if (width === 375) {
        for (const step of ["pointer-advanced", "pointer-radio"]) {
          expect
            .soft(result.native.find((r: any) => r.step === step).focus.tag)
            .toBe("BODY");
          expect
            .soft(result.local.find((r: any) => r.step === step).focus.tag)
            .toBe("BODY");
        }
      }
      for (const side of [result.native, result.local]) {
        for (const step of ["escape-after-radio", "escape-after-trigger"]) {
          const row = side.find((r: any) => r.step === step);
          expect(row.menus).toHaveLength(0);
          expect(row.focus.editor).toBe(true);
        }
        expect(
          side.find((r: any) => r.step === "caption-enter").focus.role,
        ).toBe("menuitemradio");
        expect(side.find((r: any) => r.step === "radio-space").focus.role).toBe(
          "menuitem",
        );
        expect(
          side.find((r: any) => r.step === "outside-blank").menus,
        ).toHaveLength(0);
      }
      for (const side of [result.native, result.local]) {
        expect(
          side.find((r: any) => r.step === "trigger-enter").viewport.width,
        ).toBe(width);
        expect(side.find((r: any) => r.step === "radio-enter").focus.role).toBe(
          "menuitem",
        );
      }
      expect(audit.errors).toEqual([]);
      expect(audit.denied).toEqual([]);
      expect(errors).toEqual([]);
      expect(
        f.calls.filter((c) =>
          /\/(submit|turn\/start|turn\/steer)$/.test(c.path),
        ),
      ).toEqual([]);
      const originalErrors = await native.evaluate(
        () => (window as any).hcaAudit.errors,
      );
      expect(originalErrors).toEqual([]);
    } finally {
      result.after = await hashes();
      await writeFile(
        output + `/matrix-${width}.json`,
        JSON.stringify(result, null, 2),
      );
      await native
        .screenshot({ path: output + `/native-${width}.png` })
        .catch(() => {});
      await product
        .screenshot({ path: output + `/local-${width}.png` })
        .catch(() => {});
      await context.close();
      expect(result.after).toEqual(before);
    }
  });

test("official and local Reset use the same preset, tooltip lifecycle and no notice", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60000);
  await mkdir(output, { recursive: true });
  const before = await hashes();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    baseURL,
  });
  context.setDefaultTimeout(7000);
  const native = await context.newPage(),
    product = await context.newPage();
  const result: any = { before };
  try {
    result.audit = await original(
      native,
      new URL(baseURL!).origin,
      "gate=true&from=gpt-5.5&effort=high&selectionMode=model",
    );
    const f = await local(product, "gpt-5.5", "high");
    const originalState = () =>
      native.evaluate(() => {
        const w = window as any,
          c = w.hcaManager.getConversation(
            "00000000-0000-4000-8000-000000000003",
          );
        return {
          model: c.latestModel,
          effort: c.latestReasoningEffort,
          selectionMode: w.hcaScope.get(
            w.hcaModules.Main.__pickerSelectionMode,
          ),
          writes: w.hcaAudit.syntheticSettingsWrites ?? [],
          toasts: [...document.querySelectorAll("[data-sonner-toast]")].map(
            (e) => e.textContent,
          ),
          errors: w.hcaAudit.errors,
          denied: w.hcaAudit.denied,
        };
      });
    const localState = () =>
      product.evaluate(async () => {
        const path = (p: string) =>
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === p)?.name ?? p;
        const m = await import(
          path("/src/session-mode/stores/useThreadModelStore.ts")
        );
        const pref = await import(
          path(
            "/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts",
          )
        );
        const row = m.useThreadModelStore.getState().threads["ux-0"];
        return {
          model: row?.model,
          effort: row?.reasoningEffort,
          selectionMode:
            pref.useNativeModelPickerPreferencesStore.getState().selectionMode,
          pending: row?.pending,
          notice: row?.notice,
          toasts: [...document.querySelectorAll("[data-sonner-toast]")].map(
            (e) => e.textContent,
          ),
        };
      });
    result.nativeBefore = await originalState();
    result.localBefore = await localState();
    await native.locator("#root button").first().focus();
    await native.keyboard.press("Enter");
    await settle(native);
    await native.keyboard.press("ArrowDown");
    await expect(
      native.getByRole("menuitem", { name: "Reset to default", exact: true }),
    ).toBeFocused();
    await expect(
      native.getByRole("tooltip", { name: "Reset to default", exact: true }),
    ).toBeVisible();
    await native.keyboard.press("Escape");
    await settle(native);
    result.nativeTooltipEscape = await snapshot(
      native,
      "native-tooltip-escape",
    );
    await expect(
      native.getByRole("tooltip", { name: "Reset to default", exact: true }),
    ).toHaveCount(0);
    if (result.nativeTooltipEscape.menus.length)
      await native.keyboard.press("Escape");
    await expect(native.getByRole("menu")).toHaveCount(0);
    await native.locator("#root button").first().focus();
    await native.keyboard.press("Enter");
    await settle(native);
    await native.keyboard.press("ArrowDown");
    await expect(
      native.getByRole("menuitem", { name: "Reset to default", exact: true }),
    ).toBeFocused();
    result.resetFocused = await snapshot(native, "reset-focused");
    result.resetDOM = await native
      .getByRole("menuitem", { name: "Reset to default", exact: true })
      .evaluate((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e),
          icon = e.querySelector("svg"),
          ir = icon?.getBoundingClientRect();
        return {
          html: e.outerHTML,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          style: {
            display: s.display,
            width: s.width,
            height: s.height,
            padding: s.padding,
            border: s.border,
            borderRadius: s.borderRadius,
            background: s.backgroundColor,
            color: s.color,
            opacity: s.opacity,
          },
          icon: icon?.outerHTML,
          iconRect: ir
            ? { x: ir.x, y: ir.y, width: ir.width, height: ir.height }
            : null,
        };
      });
    await native.keyboard.press("Enter");
    await native.waitForTimeout(2000);
    result.nativeAfter = await originalState();
    await expect(
      native.getByRole("tooltip", { name: "Reset to default", exact: true }),
    ).toHaveCount(0);
    result.nativeFocus = await snapshot(native, "reset-after");
    await product
      .locator('.session-codex-composer button[aria-label^="模型："]')
      .focus();
    await product.keyboard.press("Enter");
    await settle(product);
    await product.keyboard.press("ArrowDown");
    const localReset = product.getByRole("menuitem", {
      name: "恢复默认",
      exact: true,
    });
    await expect(localReset).toBeFocused();
    const resetTooltip = product.getByRole("tooltip", {
      name: "恢复默认",
      exact: true,
    });
    await expect(resetTooltip).toBeVisible();
    await product.keyboard.press("Escape");
    await expect(resetTooltip).toHaveCount(0);
    result.localTooltipEscape = await snapshot(product, "local-tooltip-escape");
    expect
      .soft(result.localTooltipEscape.menus.length)
      .toBe(result.nativeTooltipEscape.menus.length);
    if (result.localTooltipEscape.menus.length)
      await product.keyboard.press("Escape");
    await expect(product.getByRole("menu")).toHaveCount(0);
    await product
      .locator('.session-codex-composer button[aria-label^="模型："]')
      .focus();
    await product.keyboard.press("Enter");
    await settle(product);
    await product.keyboard.press("ArrowDown");
    await expect(localReset).toBeFocused();
    await expect(resetTooltip).toBeVisible();
    await product.keyboard.press("Home");
    await expect(resetTooltip).toHaveCount(0);
    await localReset.hover();
    await expect(resetTooltip).toBeVisible();
    result.tooltip = {
      focusVisible: true,
      escapeRemoved: true,
      reopenVisible: true,
      blurRemoved: true,
      hoverVisible: true,
    };
    result.localResetDOM = await localReset.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        i = e.querySelector("svg"),
        ir = i?.getBoundingClientRect();
      return {
        html: e.outerHTML,
        width: r.width,
        height: r.height,
        icon: i?.outerHTML,
        iconWidth: ir?.width,
        iconHeight: ir?.height,
        path: i?.querySelector("path")?.getAttribute("d"),
      };
    });
    // Hover may preserve the previous roving focus; select via an explicit
    // keyboard route after independently checking hover visibility.
    await product.keyboard.press("Home");
    await product.keyboard.press("ArrowDown");
    await expect(localReset).toBeFocused();
    await product.keyboard.press("Enter");
    await expect
      .poll(async () => (await localState()).model)
      .toBe("gpt-5.6-sol");
    await settle(product);
    result.localAfter = await localState();
    await expect(resetTooltip).toHaveCount(0);
    result.tooltip.resetRemoved = true;
    result.localFocus = await snapshot(product, "default-after");
    result.calls = f.calls;
    expect(result.localResetDOM.width).toBe(32);
    expect(result.localResetDOM.height).toBe(32);
    expect(result.localResetDOM.iconWidth).toBe(16);
    expect(result.localResetDOM.iconHeight).toBe(16);
    expect(result.localResetDOM.path).toBe(
      result.resetDOM.icon.match(/<path d="([^"]+)"/)?.[1],
    );
    await expect(
      product.getByRole("menuitem", { name: "恢复默认", exact: true }),
    ).toHaveCount(0);
    expect(result.localFocus.focus.label).toBe("选择模型");
    for (const row of [result.nativeAfter, result.localAfter]) {
      expect(row.model).toBe("gpt-5.6-sol");
      expect(row.effort).toBe("medium");
      expect(row.selectionMode).toBe("default");
      expect(row.toasts).toEqual([]);
    }
    expect(result.nativeAfter.writes).toEqual([
      {
        threadId: "00000000-0000-4000-8000-000000000003",
        model: "gpt-5.6-sol",
        effort: "medium",
        multiAgentMode: "explicitRequestOnly",
      },
    ]);
    expect(result.nativeAfter.errors).toEqual([]);
    expect(result.nativeAfter.denied).toEqual([]);
    expect(result.audit.denied).toEqual([]);
    expect(result.audit.errors).toEqual([]);
    expect(
      f.calls.filter((c) => /\/(submit|turn\/start|turn\/steer)$/.test(c.path)),
    ).toEqual([]);
  } finally {
    result.after = await hashes();
    await writeFile(
      output + "/reset-default.json",
      JSON.stringify(result, null, 2),
    );
    await context.close();
    expect(result.after).toEqual(before);
  }
});
