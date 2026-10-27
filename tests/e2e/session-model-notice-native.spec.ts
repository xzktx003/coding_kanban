import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installSessionUxFixture } from "./session-ux-fixture";

const output = resolve(process.env.CODEX_MODEL_NOTICE_OUTPUT ?? ".dev-runtime/session-model-notice-20261027/visual");
const message =
  "在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回 GPT-5.5。";
async function theme(page: Page, dark: boolean) {
  await page.evaluate((dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    const tokens = {
      "--vscode-font-family": "Arial, sans-serif",
      "--vscode-font-size": "13px",
      "--vscode-font-weight": "400",
      "--vscode-editor-background": dark ? "#20211d" : "#ffffff",
      "--vscode-sideBar-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-dropdown-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-descriptionForeground": dark ? "#858585" : "#717171",
      "--foreground": dark ? "#cccccc" : "#3b3b3b",
    };
    for (const el of [
      document.documentElement,
      ...document.querySelectorAll<HTMLElement>(".session-mode"),
    ]) {
      for (const [name, value] of Object.entries(tokens))
        el.style.setProperty(name, value);
      el.classList.toggle("dark", dark);
      el.classList.toggle("light", !dark);
      if (el.matches(".session-mode"))
        el.style.background = tokens["--vscode-editor-background"];
    }
    document.body.style.background = tokens["--vscode-editor-background"];
  }, dark);
}
async function measure(page: Page) {
  return page.locator("[data-sonner-toast]").evaluate((e) => {
    const card = e.querySelector(".codex-native-alert, .alert-root")!;
    const rect = e.getBoundingClientRect(),
      style = getComputedStyle(card);
    const title = e.querySelector(".codex-native-alert-title, .font-medium")!,
      ts = getComputedStyle(title);
    const button = e.querySelector("button")!,
      bs = getComputedStyle(button),
      br = button.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      text: e.textContent,
      font: style.font,
      color: style.color,
      background: style.backgroundColor,
      border: style.border,
      radius: style.borderRadius,
      padding: style.padding,
      shadow: style.boxShadow,
      title: {
        font: ts.font,
        color: ts.color,
        smoothing: ts.webkitFontSmoothing,
        rendering: ts.textRendering,
        synthesis: ts.getPropertyValue("font-synthesis-weight"),
        shadow: ts.textShadow,
      },
      button: {
        width: br.width,
        height: br.height,
        font: bs.font,
        label: button.getAttribute("aria-label"),
      },
      dpr: devicePixelRatio,
    };
  });
}
async function diagnose(page: Page) {
  return page.locator("[data-sonner-toast]").evaluate((e) => {
    const title = e.querySelector(".codex-native-alert-title, .font-medium")!;
    const properties = [
      "text-shadow",
      "-webkit-text-fill-color",
      "-webkit-text-stroke-width",
      "-webkit-text-stroke-color",
      "filter",
      "backdrop-filter",
      "opacity",
      "font-feature-settings",
      "font-variation-settings",
      "font-optical-sizing",
      "font-synthesis-weight",
      "font-synthesis-style",
      "text-rendering",
      "-webkit-font-smoothing",
      "transform",
      "translate",
      "will-change",
      "perspective",
      "backface-visibility",
      "isolation",
      "contain",
      "position",
      "z-index",
      "mix-blend-mode",
      "transition",
      "animation",
      "letter-spacing",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "color",
    ];
    const chain = [];
    for (let node: Element | null = title; node; node = node.parentElement) {
      const style = getComputedStyle(node),
        r = node.getBoundingClientRect();
      chain.push({
        tag: node.tagName,
        cls: node.className,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        styles: Object.fromEntries(
          properties.map((p) => [p, style.getPropertyValue(p)]),
        ),
        animations: node
          .getAnimations()
          .map((a) => ({
            state: a.playState,
            time: a.currentTime,
            timing: a.effect?.getComputedTiming(),
            keyframes: (a.effect as KeyframeEffect)?.getKeyframes?.(),
          })),
      });
    }
    return { chain, fonts: document.fonts.status };
  });
}
const compositorStates = new WeakMap<Page, { cdp: any; layers: any[] }>();
async function startCompositor(page: Page) {
  const cdp = await page.context().newCDPSession(page),
    state = { cdp, layers: [] as any[] };
  compositorStates.set(page, state);
  cdp.on("LayerTree.layerTreeDidChange", (event) => {
    state.layers = event.layers ?? [];
  });
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("LayerTree.enable");
}
async function compositor(page: Page) {
  const { cdp, layers } = compositorStates.get(page)!;
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".codex-native-alert-title, .alert-root .font-medium",
  });
  const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  const result = [];
  for (const layer of layers) {
    let reasons, node;
    try {
      reasons = await cdp.send("LayerTree.compositingReasons", {
        layerId: layer.layerId,
      });
    } catch {}
    try {
      if (layer.backendNodeId)
        node = await cdp.send("DOM.describeNode", {
          backendNodeId: layer.backendNodeId,
        });
    } catch {}
    result.push({ layer, reasons, node });
  }
  return { fonts, layers: result };
}
for (const dark of [true, false])
  test(`model warning uses native ${dark ? "dark" : "light"} toast surface`, async ({
    page,
    context,
  }) => {
    const reference = process.env.CODEX_GOAL_REFERENCE_URL;
    test.skip(!reference, "Unchanged 26.51007 reference is required");
    test.setTimeout(90_000);
    await mkdir(output, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await startCompositor(page);
    await installSessionUxFixture(page);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page.locator(".session-native-composer").waitFor();
    const deps = await page.evaluate(() => ({
      react: (window as any).__sessionFixtureDependency("react.js"),
      client: (window as any).__sessionFixtureDependency("react-dom_client.js"),
    }));
    await page.route("**/model-notice-fixture", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main class="session-mode" style="height:100vh"><div id="fixture"></div></main></body></html>',
      }),
    );
    await page.goto("/model-notice-fixture");
    await page.evaluate(async ({ react, client }) => {
      const refresh = (await import("/@react-refresh")).default;
      refresh.injectIntoGlobalHook(window);
      (window as any).$RefreshReg$ = () => {};
      (window as any).$RefreshSig$ = () => (type: unknown) => type;
      (window as any).__vite_plugin_react_preamble_installed__ = true;
      const R = (await import(react)).default,
        renderer = (await import(client)).default;
      await import("/src/workbench.css");
      await import("/src/session-mode/App.css");
      await import("/src/session-mode/session-theme.css");
      await import("/src/session-mode/codex-presentation.css");
      const { i18n } = await import("/src/session-mode/lib/i18n.ts");
      await i18n.changeLanguage("zh");
      const { NativeNotificationViewport } =
        await import("/src/session-mode/features/native-notifications/NativeNotificationViewport.tsx");
      const { ModelChangeNotice, commitModelSelectionWithNotice } =
        await import("/src/session-mode/components/codex/composer/ModelChangeNotice.tsx");
      const mounted = (path: string) => performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path;
      const store = await import(mounted("/src/session-mode/stores/useThreadModelStore.ts"));
      (window as any).noticeStore = store;
      store.hydrateThreadModel("fixture", { model: "GPT-5.5" });
      const { useCodexStore } = await import(mounted("/src/session-mode/components/codex/stores/useCodexStore.ts"));
      useCodexStore.setState({events:{fixture:[{method:"turn/completed",params:{threadId:"fixture",turn:{id:"turn-1",items:[],itemsView:"full",status:"completed",error:null,startedAt:1,completedAt:2,durationMs:1000}}}]}});
      (window as any).changeNotice = () => commitModelSelectionWithNotice("fixture", "recent", () =>
        store.changeThreadModel("fixture", {
          model:
            store.useThreadModelStore.getState().threads.fixture.model ===
            "GPT-5.5"
              ? "GPT-6 Sol"
              : "GPT-5.5",
        }));
      renderer
        .createRoot(document.getElementById("fixture"))
        .render(
          R.createElement(
            R.Fragment,
            null,
            R.createElement(NativeNotificationViewport),
            R.createElement(ModelChangeNotice, { threadId: "fixture" }),
          ),
        );
    }, deps);
    const native = await context.newPage();
    await startCompositor(native);
    native.on("pageerror", (e) => errors.push("native: " + e.message));
    const origin = new URL(reference!).origin;
    await native.route("**/*", (r) =>
      new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
    );
    await native.routeWebSocket(/.*/, (ws) => ws.close());
    await native.goto(reference!);
    await native.waitForFunction(() => (window as any).nativeLoaded);
    await native.evaluate(async () => {
      const M = await import("/assets/app-initial-fee819fe4f22.js");
      M.oH();
      const { R, root, wrap } = (window as any).nativeGoalCore;
      root.render(wrap(R.createElement(M.iH, null, R.createElement("span"))));
      (window as any).nativeNotice = M;
    });
    const pairs = [];
    for (const width of [900, 390]) {
      await page.setViewportSize({ width, height: 700 });
      await native.setViewportSize({ width, height: 700 });
      await theme(page, dark);
      await theme(native, dark);
      await page.evaluate(async () => {
        const s = (window as any).noticeStore;
        s.hydrateThreadModel("fixture", { model: "GPT-6 Sol" });
        s.hydrateThreadModel("fixture", { model: "GPT-5.5" });
        (window as any).changeNotice();
      });
      await native.evaluate(
        (message) =>
          (window as any).nativeNotice
            .ZUt()
            .info(message, {
              id: "composer.modelChangeDuringConversationWarning.fixture",
            }),
        message,
      );
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
      await expect(native.locator("[data-sonner-toast]")).toHaveCount(1);
      await page.waitForTimeout(400);
      const pair = {
        width,
        local: await measure(page),
        native: await measure(native),
      };
      pairs.push(pair);
      const key = `${dark ? "dark" : "light"}-${width}`;
      const localScreenshot = await page.screenshot({
        path: resolve(output, key + "-local.png"),
      });
      const nativeScreenshot = await native.screenshot({
        path: resolve(output, key + "-native.png"),
      });
      await writeFile(
        resolve(output, key + ".json"),
        JSON.stringify(pair, null, 2),
      );
      await writeFile(
        resolve(output, key + "-diagnostics.json"),
        JSON.stringify(
          { local: await diagnose(page), native: await diagnose(native) },
          null,
          2,
        ),
      );
      await writeFile(
        resolve(output, key + "-compositor.json"),
        JSON.stringify(
          { local: await compositor(page), native: await compositor(native) },
          null,
          2,
        ),
      );
      expect(
        localScreenshot.equals(nativeScreenshot),
        "Identical rendered PNG under the same host/theme/font/DPR",
      ).toBe(true);
      expect(pair.local).toEqual(pair.native);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await native.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await expect(native.locator("[data-sonner-toast]")).toHaveCount(0);
    }
    await writeFile(
      resolve(output, `${dark ? "dark" : "light"}-result.json`),
      JSON.stringify({ pairs, errors }, null, 2),
    );
    expect(errors).toEqual([]);
    await native.close();
  });
