import type { Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

export async function theme(page: Page, dark: boolean) {
  await page.evaluate((dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    for (const element of document.querySelectorAll<HTMLElement>(
      ".session-mode",
    )) {
      element.classList.toggle("dark", dark);
      element.classList.toggle("light", !dark);
      element.style.setProperty("color-scheme", dark ? "dark" : "light");
    }
    const tokens = {
      "--vscode-font-family": "Arial, sans-serif",
      "--vscode-font-size": "13px",
      "--vscode-font-weight": "400",
      "--vscode-editor-font-family": "monospace",
      "--vscode-editor-font-size": "12px",
      "--vscode-editor-font-weight": "400",
      "--vscode-editor-background": dark ? "#20211d" : "#ffffff",
      "--vscode-sideBar-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-descriptionForeground": dark ? "#858585" : "#717171",
      "--vscode-textLink-foreground": dark ? "#a9c5de" : "#006ab1",
      "--vscode-textLink-activeForeground": dark ? "#a9c5de" : "#006ab1",
      "--vscode-textPreformat-background": dark ? "#42443a" : "#f0f0ed",
      "--vscode-textPreformat-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-dropdown-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-dropdown-foreground": dark ? "#cccccc" : "#3b3b3b",
      "--vscode-menu-background": dark ? "#282a23" : "#f5f5f3",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-gitDecoration-addedResourceForeground": dark
        ? "#81b88b"
        : "#587c0c",
      "--vscode-gitDecoration-deletedResourceForeground": dark
        ? "#c74e39"
        : "#ad0707",
    };
    for (const [name, value] of Object.entries(tokens))
      document.documentElement.style.setProperty(name, value);
    document.body.style.background = tokens["--vscode-editor-background"];
    document.body.style.margin = "0";
    document.documentElement.style.fontSize = "16px";
    (window as any).railHostTokens = tokens;
  }, dark);
}

const compositorStates = new WeakMap<Page, { cdp: any; layers: any[] }>();
export async function startCompositor(page: Page) {
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
export async function diagnose(page: Page) {
  const { cdp, layers } = compositorStates.get(page)!;
  const { root } = await cdp.send("DOM.getDocument");
  const fonts = [];
  for (const selector of [
    '.session-queue-rich-preview strong, [role=group][aria-label^="Preview queued"] strong',
    '[role=dialog] [tabindex="0"]',
  ]) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    fonts.push({
      selector,
      result: await cdp.send("CSS.getPlatformFontsForNode", { nodeId }),
    });
  }
  const composition = [];
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
    composition.push({ layer, reasons, node });
  }
  const chains = await page.evaluate(() => {
    const keys = [
      "color",
      "background-color",
      "font-family",
      "font-weight",
      "font-size",
      "line-height",
      "font-synthesis-weight",
      "-webkit-font-smoothing",
      "opacity",
      "mask-image",
      "position",
      "transform",
      "translate",
      "box-shadow",
      "border",
      "border-radius",
      "corner-shape",
      "filter",
      "will-change",
    ];
    return [
      '.session-queue-rich-preview strong, [role=group][aria-label^="Preview queued"] strong',
      "[role=dialog]",
    ].map((selector) => {
      const chain = [];
      for (
        let node = document.querySelector(selector);
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        chain.push({
          tag: node.tagName,
          cls: node.className,
          style: Object.fromEntries(
            keys.map((key) => [key, style.getPropertyValue(key)]),
          ),
        });
      }
      return { selector, chain };
    });
  });
  return { fonts, layers: composition, chains };
}
export async function local(page: Page) {
  await startCompositor(page);
  const fixture = await installSessionUxFixture(page);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-native-composer").waitFor();
  const dependencies = await page.evaluate(() => ({
    react: (window as any).__sessionFixtureDependency("react.js"),
    client: (window as any).__sessionFixtureDependency("react-dom_client.js"),
  }));
  await page.route("**/queue-preview-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="session-mode accent-default" style="height:100vh"><div id="root" class="session-native-composer session-codex-composer" style="position:absolute;top:360px;left:100px;width:500px;padding:0;max-width:none;box-sizing:border-box"></div></main></body></html>',
    }),
  );
  await page.goto("/queue-preview-fixture");
  await page.evaluate(async ({ react, client }) => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$ = () => {};
    (window as any).$RefreshSig$ = () => (type: unknown) => type;
    (window as any).__vite_plugin_react_preamble_installed__ = true;
    const R = (await import(react)).default,
      renderer = (await import(client)).default;
    await import("/src/workbench.css");
    for (const file of [
      "App.css",
      "session-theme.css",
      "codex-presentation.css",
      "session-composer.css",
      "session-composer-v2.css",
      "session-composer-compact.css",
    ])
      await import(`/src/session-mode/${file}`);
    const { TooltipProvider } =
      await import("/src/session-mode/components/ui/tooltip.tsx");
    const { ComposerRail, ComposerRailItem } =
      await import("/src/session-mode/components/codex/composer/ComposerRail.tsx");
    const { FollowupQueueContent } =
      await import("/src/session-mode/components/codex/composer/FollowupQueue.tsx");
    const root = renderer.createRoot(document.getElementById("root"));
    (window as any).renderQueue = (
      text: string,
      visible = true,
      more?: string,
      options: {
        threadId?: string;
        revision?: number;
        statuses?: string[];
        disabled?: boolean;
        extra?: string[];
        images?: string[];
        contexts?: unknown[];
        nativeContext?: Record<string, unknown>;
      } = {},
    ) =>
      root.render(
        R.createElement(
          TooltipProvider,
          null,
          R.createElement(
            ComposerRail,
            null,
            R.createElement(
              ComposerRailItem,
              { visible },
              R.createElement(FollowupQueueContent, {
                compactShelf: true,
                threadId: options.threadId ?? "owner",
                turnId: "turn",
                snapshot: {
                  state: {
                    revision: options.revision ?? 1,
                    paused: null,
                    items: [
                      text,
                      ...(more ? [more] : []),
                      ...(options.extra ?? []),
                    ].map((text, index) => ({
                      id: text,
                      threadId: options.threadId ?? "owner",
                      text,
                      images: options.images ?? [],
                      contexts: options.contexts,
                      parameters: {},
                      status: options.statuses?.[index] ?? "queued",
                      mode: "queue",
                      createdAt: 1,
                      fingerprint: "fixture",
                    })),
                  },
                },
              }),
            ),
          ),
        ),
      );
  }, dependencies);
  return fixture;
}
export async function native(page: Page, reference: string) {
  await startCompositor(page);
  await page.goto(reference);
  await page.waitForFunction(() => (window as any).nativeLoaded);
  await page.evaluate(async () => {
    const main = await import("/assets/app-initial-fee819fe4f22.js");
    main.vf();
    const { QueuedMessageList } =
      await import("/assets/queued-message-list-172645190dd2.js");
    const { R, root, wrap } = (window as any).nativeGoalCore;
    (window as any).queueActions = [];
    (window as any).renderQueue = (
      text: string,
      _visible = true,
      more?: string,
      options: {
        threadId?: string;
        revision?: number;
        statuses?: string[];
        disabled?: boolean;
        extra?: string[];
        images?: string[];
        contexts?: unknown[];
        nativeContext?: Record<string, unknown>;
      } = {},
    ) =>
      root.render(
        wrap(
          R.createElement(
            main._f,
            null,
            R.createElement(QueuedMessageList, {
              messages: [
                text,
                ...(more ? [more] : []),
                ...(options.extra ?? []),
              ].map((text, index) => ({
                id: text,
                text,
                context: {
                  imageAttachments: [],
                  fileAttachments: [],
                  commentAttachments: [],
                  ...options.nativeContext,
                },
                submission: { status: options.statuses?.[index] ?? "queued" },
              })),
              isReorderDisabled: options.disabled,
              isMessagePaused: () => false,
              isInterrupted: false,
              isSendNowDisabled: false,
              isResponseInProgress: true,
              isQueueingEnabled: true,
              hostId: "local",
              onEditMessage: () => {
                (window as any).queueActions.push("edit");
              },
              onDeleteMessage: () => {
                (window as any).queueActions.push("delete");
              },
              onSendNowMessage: () => {
                (window as any).queueActions.push("send");
              },
              onReorderMessages: (ids: string[]) => {
                (window as any).queueActions.push({ type: "reorder", ids });
              },
              onQueueingChange: () => {},
              onResumeInterruptedQueue: () => {},
            }),
          ),
        ),
      );
    document.getElementById("root")!.style.cssText =
      "position:absolute;top:360px;left:100px;width:500px;height:auto;padding:0;max-width:none;box-sizing:border-box";
  });
}

/** Resolve fixture image URLs through the mounted app's actual Session gateway. */
export async function queueAssetURLs(page: Page, paths: readonly string[]) {
  return page.evaluate(
    async (paths) => {
      const { fileSrc } = await import("/src/session-mode/hooks/runtime.ts");
      return Object.fromEntries(
        paths.map((path) => [
          path,
          new URL(fileSrc(path), document.baseURI).href,
        ]),
      );
    },
    [...paths],
  );
}
