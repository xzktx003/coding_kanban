import type { Page } from "@playwright/test";
export async function makeReader(page: Page, owner: string, otherOwner: string) {
  return page.evaluateHandle(async ({ owner, otherOwner }) => {
    const paths = [
      "/src/session-mode/components/codex/stores/useCodexStore.ts",
      "/src/session-mode/components/codex/stores/useConfigStore.ts",
      "/src/session-mode/stores/useSessionDraftStore.ts",
      "/src/session-mode/stores/useWorkspaceStore.ts",
      "/src/session-mode/features/native-feedback/service.ts",
      "/src/session-mode/lib/eventStream.ts",
    ];
    // Reuse mounted resource identities. This getter never calls a setter or read API.
    const urls = paths.map((path) => {
      const found = performance.getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name;
      if (!found) throw new Error("Mounted store unavailable: " + path);
      return found;
    });
    const [{ useCodexStore }, { useConfigStore }, { useSessionDraftStore }, { useWorkspaceStore }, { feedbackUploads }, { isEventStreamConnected }] =
      await Promise.all(urls.map((url) => import(url)));
    const describe = (node: Element | null) => node ? {
      tag: node.tagName, role: node.getAttribute("role"),
      label: node.getAttribute("aria-label"), text: node.textContent?.slice(0, 200),
      className: node.getAttribute("class"),
    } : null;
    const visible = (node: Element) => {
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && css.display !== "none" &&
        css.visibility !== "hidden" && !node.closest('[inert], [aria-hidden="true"]');
    };
    return () => {
      const codex = useCodexStore.getState(), config = useConfigStore.getState();
      const thread = codex.threads.find((item: { id: string }) => item.id === codex.currentThreadId);
      const composer = document.querySelector(".session-codex-composer");
      const editor = composer?.querySelector('[contenteditable="true"]');
      const forms = [...document.querySelectorAll('.codex-native-feedback:not(.codex-feedback-report)[role="dialog"]')].filter(visible);
      const rect = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return JSON.parse(JSON.stringify({
        moduleURLs: urls, time: performance.now(),
        eventStreamConnected: isEventStreamConnected(),
        threadId: codex.currentThreadId,
        thread: thread ? { id: thread.id, cwd: thread.cwd, status: thread.status } : null,
        workspaceCwd: useWorkspaceStore.getState().cwd,
        owner: composer?.getAttribute("data-draft-owner"),
        draft: useSessionDraftStore.getState().drafts[owner] ?? { text: "", revision: 0 },
        otherDraft: useSessionDraftStore.getState().drafts[otherOwner] ?? null,
        editorText: editor?.textContent ?? null,
        defaults: {
          model: config.model, modelProvider: config.modelProvider,
          reasoningEffort: config.reasoningEffort, sandbox: config.sandbox,
          approvalPolicy: config.approvalPolicy, serviceTier: config.serviceTier,
        },
        forms: forms.map((node) => ({
          ...describe(node), rect: rect(node),
          title: node.querySelector('h1,h2,h3,[data-slot="dialog-title"]')?.textContent ?? null,
          details: [...node.querySelectorAll("textarea")].map((n) => ({ label: n.getAttribute("aria-label"), value: n.value })),
          radios: [...node.querySelectorAll('[role="radio"]')].map(describe),
        })),
        dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible).map(describe),
        commandOptions: [...document.querySelectorAll('[data-composer-suggestions="commands"] [role="option"]')].map(describe),
        menuItems: [...document.querySelectorAll('[role="menuitem"]')].filter(visible).map(describe),
        active: describe(document.activeElement),
        viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
        html: { pointerEvents: getComputedStyle(document.documentElement).pointerEvents },
        body: { pointerEvents: getComputedStyle(document.body).pointerEvents },
        language: document.documentElement.lang,
        sessionVisible: Boolean(document.querySelector(".session-mode")?.getBoundingClientRect().width),
        notices: [...document.querySelectorAll(".codex-native-alert")].filter(visible).map((n) => ({ text: n.textContent, level: n.getAttribute("data-level") })),
        reports: [...document.querySelectorAll(".codex-feedback-report")].filter(visible).map((n) => ({ text: n.textContent, retry: [...n.querySelectorAll("button")].some((b) => b.textContent === "重试") })),
        bodyText: document.body.innerText.slice(0, 16000),
        reportMetadata: feedbackUploads.getSnapshot().map((report: any) => ({ owner: report.owner, status: report.status, open: report.open, correlationId: report.correlationId })),
      }));
    };
  }, { owner, otherOwner });
}

export async function observe(page: Page) {
  return page.evaluateHandle(() => {
    const events: Array<Record<string, unknown>> = [];
    let overflow = false;
    const push = (value: Record<string, unknown>) => {
      if (events.length >= 256) { overflow = true; return; }
      events.push(value);
    };
    const input = (event: Event) => {
      const node = event.target instanceof Element ? event.target : null;
      const action = node?.closest('button,[role="option"],[role="menuitem"]');
      push({ type: event.type, trusted: event.isTrusted, time: performance.now(),
        key: event instanceof KeyboardEvent ? event.key : null,
        role: action?.getAttribute("role"), label: action?.getAttribute("aria-label"),
        text: action?.textContent?.trim().slice(0, 200) ?? null,
        inComposer: Boolean(node?.closest(".session-codex-composer")),
        inCommands: Boolean(node?.closest('[data-composer-suggestions="commands"]')),
      });
    };
    const notification = (event: Event) => push({
      type: event.type, trusted: event.isTrusted, time: performance.now(),
      hasDetail: "detail" in event,
      detail: event instanceof CustomEvent ? { threadId: event.detail?.threadId, draftOwner: event.detail?.draftOwner } : null,
    });
    const types = ["pointerdown", "click", "keydown", "focusin"];
    types.forEach((type) => document.addEventListener(type, input, true));
    // Passive audit only: no listener opens/mounts a form or changes application state.
    window.addEventListener("codex-open-feedback", notification);
    return {
      read: () => ({ events: [...events], overflow }),
      dispose: () => {
        types.forEach((type) => document.removeEventListener(type, input, true));
        window.removeEventListener("codex-open-feedback", notification);
      },
    };
  });
}
