import type { Page } from "@playwright/test";

export const CWD = "/fixture/项目/very-long-project-path-for-ui-regression";
export const MAIN = ".session-codex-composer";
export const EDITOR = '[contenteditable="true"], .session-rich-draft textarea';
export const UNKNOWN = "r22-typed-unknown";
export const SELECTED = "r22-selected-second";
export const SIDE = "ux-side";
export type Initial = {
  model: string;
  effort: string | null;
  side?: boolean;
  acp?: boolean;
};

/** Initial isolated fixture hydration only; never called after the first UI action. */
export async function initialize(page: Page, initial: Initial) {
  return page.evaluate(async ({ initial, cwd, side }) => {
    const load = (path: string) => import(
      performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path,
    );
    const [config, models, drafts, cards, layout, codex, sideChat, acp] = await Promise.all([
      load("/src/session-mode/components/codex/stores/useConfigStore.ts"),
      load("/src/session-mode/stores/useThreadModelStore.ts"),
      load("/src/session-mode/stores/useSessionDraftStore.ts"),
      load("/src/session-mode/stores/useAgentCenterStore.ts"),
      load("/src/session-mode/stores/useLayoutStore.ts"),
      load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
      load("/src/session-mode/stores/useSideChatStore.ts"),
      load("/src/session-mode/stores/useAcpStore.ts"),
    ]);
    const setting = (model: string, effort: string | null, revision: number) => ({
      model, modelProvider: "openai", reasoningEffort: effort,
      providerModels: { openai: model }, serviceTier: null,
      sandbox: "workspace-write", sandboxPolicy: null,
      approvalPolicy: "on-request", approvalsReviewer: "user",
      autoReviewCapability: null, webSearchRequest: false,
      collaborationMode: "default", personality: null,
      revision, pending: false, pendingFields: [],
    });
    const a = setting(initial.model, initial.effort, 4);
    // Null is confined to an existing thread; global defaults remain valid medium.
    config.useConfigStore.setState({
      ...setting("r22-global-default", "medium", 0), personality: "friendly",
    });
    models.useThreadModelStore.setState({ threads: {
      "ux-0": a,
      "ux-1": setting("r22-other-owner-model", "high", 7),
      ...(initial.side ? { [side]: setting("r22-side-owner-model", "low", 9) } : {}),
    } });
    const owner = drafts.sessionDraftKey("codex", "ux-0");
    const otherOwner = drafts.sessionDraftKey("codex", "ux-1");
    const sideOwner = drafts.sessionDraftKey("codex", side);
    const acpOwner = drafts.sessionDraftKey("acp", "r22-owned-session", cwd, "r22-fixture-acp");
    drafts.useSessionDraftStore.getState().setText(owner, "R22 main initial draft");
    drafts.useSessionDraftStore.getState().setText(otherOwner, "R22 untouched B draft");
    drafts.useSessionDraftStore.getState().setText(sideOwner, "R22 side initial draft");
    drafts.useSessionDraftStore.getState().setText(acpOwner, "R22 ACP initial draft");
    layout.useLayoutStore.setState({ isSidebarOpen: false });
    cards.useAgentCenterStore.getState().addAgentCard(
      { kind: "codex", id: "ux-1", cwd, preview: "R22 other owner" }, { activate: false },
    );
    cards.useAgentCenterStore.getState().addAgentCard(
      { kind: "codex", id: "ux-0", cwd, preview: "R22 command owner A" }, { activate: true },
    );
    if (initial.side) {
      const state = codex.useCodexStore.getState();
      codex.useCodexStore.setState({
        threads: [...state.threads, {
          id: side, name: "R22 existing side", preview: "R22 side",
          cwd, status: { type: "idle" }, turns: [],
        }], events: { ...state.events, [side]: [] },
      });
      sideChat.useSideChatStore.setState({ chat: {
        id: side, parentId: "ux-0", title: "R22 existing side", images: [],
      } });
    } else sideChat.useSideChatStore.setState({ chat: null });
    if (initial.acp) acp.useAcpStore.setState({
      active: true, agentId: "r22-fixture-acp", connectionId: "r22-owned-connection",
      sessionId: "r22-owned-session", sessionCwd: cwd, agentTitle: "R22 isolated ACP",
      connecting: false, sessionTransition: null, sessionTransitionError: null,
      pendingSettingChanges: {}, running: false, entries: [], authMethods: [],
      models: null, modes: null, configOptions: [], reasoningEffort: null,
      permission: null, pendingPermissions: {}, authenticating: null,
    });
    return { owner, otherOwner, sideOwner, acpOwner } as {
      owner: string; otherOwner: string; sideOwner: string; acpOwner: string;
    };
  }, { initial, cwd: CWD, side: SIDE });
}

export async function createReader(page: Page, owners: Awaited<ReturnType<typeof initialize>>) {
  return page.evaluateHandle(async (owners) => {
    const paths = [
      "/src/session-mode/components/codex/stores/useConfigStore.ts",
      "/src/session-mode/components/codex/stores/useCodexStore.ts",
      "/src/session-mode/stores/useThreadModelStore.ts",
      "/src/session-mode/stores/useSessionDraftStore.ts",
      "/src/session-mode/components/codex/hooks/useModels.ts",
      "/src/session-mode/stores/useAcpStore.ts",
      "/src/session-mode/stores/useSideChatStore.ts",
      "/src/session-mode/lib/eventStream.ts",
    ];
    const urls = paths.map((path) => {
      const url = performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (!url) throw Error("Mounted read-only module missing: " + path);
      return url;
    });
    const [config, codex, models, drafts, cacheModule, acp, sideChat, stream] =
      await Promise.all(urls.map((url) => import(url)));
    const describe = (element: Element | null) => element ? {
      tag: element.tagName, role: element.getAttribute("role"),
      label: element.getAttribute("aria-label"), text: element.textContent?.trim().slice(0, 160),
      ariaBusy: element.getAttribute("aria-busy"),
      className: element.getAttribute("class"), disabled: element.hasAttribute("disabled") ||
        element.hasAttribute("data-disabled") || element.getAttribute("aria-disabled") === "true",
    } : null;
    const visible = (node: Element) => {
      const r = node.getBoundingClientRect(), css = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && css.display !== "none" && css.visibility !== "hidden" &&
        !node.closest('[hidden], [inert], [aria-hidden="true"]');
    };
    const rect = (node: Element | null) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    let firstCatalog: { array: unknown; entries: unknown[]; efforts: unknown[] } | null = null;
    const project = (state: Record<string, unknown>) => Object.fromEntries([
      "model", "modelProvider", "reasoningEffort", "providerModels", "serviceTier", "sandbox",
      "sandboxPolicy", "approvalPolicy", "approvalsReviewer", "autoReviewCapability",
      "webSearchRequest", "collaborationMode", "personality",
    ].map((key) => [key, state[key]]));
    return () => {
      const cache = cacheModule.useModelCacheStore.getState();
      if (!firstCatalog && cache.openAiModels.length) firstCatalog = {
        array: cache.openAiModels, entries: [...cache.openAiModels],
        efforts: cache.openAiModels.map((m: any) => m.supportedReasoningEfforts),
      };
      const codexState = codex.useCodexStore.getState();
      const threadState = models.useThreadModelStore.getState();
      const draftState = drafts.useSessionDraftStore.getState();
      const active = document.activeElement;
      const main = document.querySelector(".session-codex-composer");
      const editor = main?.querySelector('[contenteditable="true"], .session-rich-draft textarea') ?? null;
      const modelMenu = [...document.querySelectorAll(".session-native-model-menu")].find(visible) ?? null;
      const activePanel = modelMenu && [...modelMenu.querySelectorAll("[data-model-picker-view]")].find(visible);
      const commandMenu = [...document.querySelectorAll('.session-composer-menu[role="menu"]')].find(visible) ?? null;
      const commandRows = commandMenu ? [...commandMenu.querySelectorAll('[role="menuitem"]')].filter(visible) : [];
      const nativeTrigger = main?.querySelector(".session-native-model-trigger") ?? null;
      const power = modelMenu?.querySelector("[data-reasoning-slider]") ?? null;
      const text = (node: Element | null) => node instanceof HTMLTextAreaElement ? node.value : node?.textContent ?? null;
      const acpState = acp.useAcpStore.getState();
      return JSON.parse(JSON.stringify({
        now: performance.now(), moduleURLs: urls, currentThreadId: codexState.currentThreadId,
        eventStreamConnected: stream.isEventStreamConnected(), owner: main?.getAttribute("data-draft-owner") ?? null,
        settings: project(models.getThreadModelSettings("ux-0")), entry: threadState.threads["ux-0"] ?? null,
        allThreads: threadState.threads, defaults: project(config.useConfigStore.getState()),
        drafts: Object.fromEntries(Object.entries(owners).map(([key, owner]) => [key, draftState.drafts[owner] ?? null])),
        editorText: text(editor), sideEditorText: text(document.querySelector('.session-side-chat textarea')),
        acpEditorText: text(document.querySelector('.session-acp-composer textarea')),
        acp: { active: acpState.active, agentId: acpState.agentId, connectionId: acpState.connectionId,
          sessionId: acpState.sessionId, sessionCwd: acpState.sessionCwd, running: acpState.running,
          entries: acpState.entries, reasoningEffort: acpState.reasoningEffort },
        sideChat: sideChat.useSideChatStore.getState().chat,
        active: describe(active), activeIsEditor: active === editor,
        activeInSide: Boolean(active?.closest(".session-side-chat")),
        activeInCommandMenu: Boolean(commandMenu?.contains(active)),
        commandMenu: commandMenu ? { text: commandMenu.textContent, rect: rect(commandMenu), rows: commandRows.map(describe) } : null,
        nativeTrigger: { ...describe(nativeTrigger), rect: rect(nativeTrigger),
          model: nativeTrigger?.querySelector(".session-native-model-label")?.textContent ?? null,
          effort: nativeTrigger?.querySelector(".session-native-model-effort")?.textContent ?? null },
        loadingControls: [...(main?.querySelectorAll("button") ?? [])].filter(visible)
          .filter((node) => /加载模型|正在加载|Loading model/i.test(node.textContent ?? "")).map(describe),
        modelMenu: modelMenu ? { rect: rect(modelMenu), view: activePanel?.getAttribute("data-model-picker-view") ?? null,
          text: modelMenu.textContent, dots: modelMenu.querySelectorAll(".session-native-power-dot").length,
          retryButtons: [...modelMenu.querySelectorAll("button")].filter(visible)
            .filter((node) => /^(重试|Retry)$/.test(node.textContent?.trim() ?? "")).length,
          alertCount: [...modelMenu.querySelectorAll('[role="alert"]')].filter(visible).length,
          sliderCount: modelMenu.querySelectorAll('[data-reasoning-slider], [role="slider"]').length,
          sliderDisabled: power?.getAttribute("aria-disabled") ?? null,
          strengthRows: [...modelMenu.querySelectorAll('[role^="menuitem"]')].filter((n) =>
            n.hasAttribute("data-reasoning-slider") || n.classList.contains("session-native-power-caption")).map(describe),
          modelRows: [...modelMenu.querySelectorAll('[role="menuitemradio"]')].map(describe),
        } : null,
        cache: { loaded: cache.loaded, loading: cache.loading, error: cache.error,
          modelStatus: cache.modelStatus ?? null,
          hasModelSnapshot: cache.modelSnapshot === cache.openAiModels,
          models: cache.openAiModels, otherModels: cache.otherModels, providers: cache.configProviders, presets: cache.presets,
          provenance: Object.fromEntries(Object.entries(cache).filter(([k, v]) =>
            /model|snapshot|pending|fetch|status/i.test(k) && ["string", "number", "boolean"].includes(typeof v))),
        },
        cacheIdentity: { captured: firstCatalog !== null,
          array: firstCatalog ? firstCatalog.array === cache.openAiModels : null,
          models: firstCatalog ? cache.openAiModels.every((m: any, i: number) => firstCatalog!.entries[i] === m) : null,
          efforts: firstCatalog ? cache.openAiModels.every((m: any, i: number) => firstCatalog!.efforts[i] === m.supportedReasoningEfforts) : null },
        sessionVisible: Boolean(document.querySelector(".session-mode") && visible(document.querySelector(".session-mode")!)),
        codexComposerVisible: Boolean(main && visible(main)),
        acpComposerVisible: Boolean(document.querySelector(".session-acp-composer") && visible(document.querySelector(".session-acp-composer")!)),
        visibleCommandEntrances: [...document.querySelectorAll('button[aria-label="当前会话的更多操作"]')].filter(visible).length,
        viewport: { width: innerWidth, height: innerHeight, coarse: matchMedia("(pointer: coarse)").matches,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth },
        pointerEvents: { html: getComputedStyle(document.documentElement).pointerEvents, body: getComputedStyle(document.body).pointerEvents },
        bodyText: document.body.innerText.slice(0, 12000),
      }));
    };
  }, owners);
}

export type Reader = Awaited<ReturnType<typeof createReader>>;
export const read = (page: Page, reader: Reader) => page.evaluate((reader) => reader(), reader);

export async function observe(page: Page) {
  return page.evaluateHandle(() => {
    const events: Array<Record<string, unknown>> = [];
    let overflow = false;
    const types = ["keydown", "pointerdown", "click", "focusin", "submit"];
    const listener = (event: Event) => {
      if (events.length >= 2048) { overflow = true; return; }
      const node = event.target instanceof Element ? event.target : null;
      const control = node?.closest('button,[role^="menuitem"]');
      events.push({ type: event.type, trusted: event.isTrusted, now: performance.now(),
        key: event instanceof KeyboardEvent ? event.key : null,
        code: event instanceof KeyboardEvent ? event.code : null,
        label: control?.getAttribute("aria-label") ?? null,
        text: control?.textContent?.trim().slice(0, 160) ?? null,
        role: control?.getAttribute("role") ?? null,
        inMain: Boolean(node?.closest(".session-codex-composer")),
        inSide: Boolean(node?.closest(".session-side-chat")),
        inAcp: Boolean(node?.closest(".session-acp-composer")),
        inModelMenu: Boolean(node?.closest(".session-native-model-menu")),
        inCommandMenu: Boolean(node?.closest('.session-composer-menu[role="menu"]')),
      });
    };
    types.forEach((type) => document.addEventListener(type, listener, true));
    return { read: () => ({ events: [...events], overflow }), dispose: () =>
      types.forEach((type) => document.removeEventListener(type, listener, true)) };
  });
}
