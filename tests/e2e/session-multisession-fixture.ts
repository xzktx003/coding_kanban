import type { Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

// Shared by both transport experiments. This module registers no tests and
// installs the same thirty sessions, four panes, metrics and native SSE.
export async function installDiagnosticReadTimeline(page: Page) {
  await page.addInitScript(() => {
    const rows: Array<Record<string, unknown>> = [];
    (window as any).__readCriticalTimeline = rows;
    const record = (entry: Record<string, unknown>) => {
      if (rows.length < 1500) rows.push(entry);
    };
    const parse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const start = performance.now();
      const value = parse(text, reviver);
      if (typeof text === "string" && text.length > 512) {
        const data = Array.isArray(value?.data) ? value.data : [];
        record({
          kind: "parse",
          start,
          end: performance.now(),
          chars: text.length,
          keys:
            value && typeof value === "object"
              ? Object.keys(value).slice(0, 8)
              : [],
          rows: data.length,
          ids: data
            .slice(0, 3)
            .map((row: any) => row?.id ?? row?.uuid ?? row?.method ?? null),
          thread: value?.thread?.id ?? null,
        });
      }
      return value;
    };
    const fetch = window.fetch;
    window.fetch = function (input, init) {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        location.href,
      );
      const start = performance.now();
      let target: string | null = null;
      if (typeof init?.body === "string") {
        try {
          const body = parse(init.body);
          target = body?.threadId ?? body?.session_id ?? null;
        } catch {
          /* Non-JSON request bodies are not inspected. */
        }
      }
      if (url.pathname.startsWith("/api/"))
        record({ kind: "fetch", start, path: url.pathname, target });
      return fetch.call(this, input, init).then((response) => {
        if (url.pathname.startsWith("/api/"))
          record({
            kind: "headers",
            start,
            end: performance.now(),
            path: url.pathname,
            target,
          });
        return response;
      });
    };
    const decode = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = function (input, options) {
      const start = performance.now();
      const result = decode.call(this, input, options);
      const bytes = input?.byteLength ?? 0;
      if (bytes > 128)
        record({ kind: "decode", start, end: performance.now(), bytes });
      return result;
    };
  });
}

export async function installThirtyFollowedFourPanes(
  page: Page,
  baseURL: string,
  options: { observeReads?: boolean } = {},
) {
  const fixture = await installSessionUxFixture(page, 30);
  if (options.observeReads) await installDiagnosticReadTimeline(page);
  for (const thread of fixture.threads)
    (thread as any).turns = [
      {
        id: `${thread.id}-turn`,
        status: "completed",
        startedAt: 1,
        durationMs: 1,
        items: [
          {
            id: `${thread.id}-reply`,
            type: "agentMessage",
            text: `four-pane ${thread.id}`,
          },
        ],
      },
    ];
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await page.addInitScript((cards) => {
    const longTasks = ((window as any).__multisessionLongTasks = []);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (longTasks.length >= 500) break;
          longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    }
    const group = (index: number, keys: string[]) => ({
      type: "group",
      id: `performance-group-${index}`,
      keys,
      selected: keys[0],
    });
    const split = (
      id: string,
      first: unknown,
      second: unknown,
      direction = "horizontal",
    ) => ({
      type: "split",
      id,
      first,
      second,
      direction,
      ratio: 50,
    });
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 5,
        state: {
          cards,
          currentAgentCardId: "ux-0",
          currentAgentCardKind: "codex",
          cardsViewMode: "solo",
          sharedTabsInitialized: true,
        },
      }),
    );
    localStorage.setItem(
      "kanban.session.split-layout",
      JSON.stringify({
        version: 1,
        state: {
          activeGroupId: "performance-group-0",
          tree: split(
            "performance-root",
            split(
              "performance-left",
              group(
                0,
                cards.slice(0, 27).map((card) => `codex:${card.id}`),
              ),
              group(1, ["codex:ux-27"]),
              "vertical",
            ),
            split(
              "performance-right",
              group(2, ["codex:ux-28"]),
              group(3, ["codex:ux-29"]),
              "vertical",
            ),
          ),
        },
      }),
    );
    localStorage.setItem(
      "kanban.session.layout-storage",
      JSON.stringify({
        version: 0,
        state: {
          view: "agent",
          isSidebarOpen: false,
          isRightPanelOpen: false,
        },
      }),
    );
    const metrics = ((window as any).__multisessionPerformance = {
      navigation: 0,
      composer: 0,
      target: 0,
      ready: 0,
      groups: 0,
      firstShell: 0,
      preview: 0,
      body: 0,
      inputTwoFrames: 0,
    });
    const observer = new MutationObserver(() => {
      const editor = document.querySelector<HTMLElement>(
        ".session-codex-composer [contenteditable=true]",
      );
      if (!metrics.navigation && document.querySelector(".session-top-nav"))
        metrics.navigation = performance.now();
      if (
        !metrics.composer &&
        editor?.getClientRects().length &&
        editor.isContentEditable
      )
        metrics.composer = performance.now();
      if (
        !metrics.target &&
        document.querySelector(
          '.session-codex-composer[data-owner-thread="ux-0"]',
        )
      )
        metrics.target = performance.now();
      if (
        !metrics.ready &&
        metrics.navigation &&
        metrics.composer &&
        metrics.target
      )
        metrics.ready = performance.now();
      const bodies = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-codex-transcript-shell]",
        ),
      ].filter((element) => element.getClientRects().length);
      if (
        !metrics.groups &&
        document.querySelectorAll("[data-session-group]").length === 4
      )
        metrics.groups = performance.now();
      if (!metrics.firstShell && bodies.length)
        metrics.firstShell = performance.now();
      if (
        !metrics.preview &&
        document.querySelector("[data-transcript-preparing]")
      )
        metrics.preview = performance.now();
      if (
        !metrics.body &&
        ["ux-0", "ux-27", "ux-28", "ux-29"].every((id) =>
          bodies.some(
            (element) =>
              element.dataset.codexTranscriptShell === id &&
              !element.querySelector("[data-transcript-preparing]") &&
              element
                .querySelector(".thread-surface")
                ?.textContent?.includes(`four-pane ${id}`),
          ),
        )
      )
        metrics.body = performance.now();
      if (metrics.body && metrics.ready) observer.disconnect();
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    document.addEventListener(
      "keydown",
      (event) => {
        const element = event.target as HTMLElement;
        if (event.key !== "x" || !element.closest(".session-codex-composer"))
          return;
        const start = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (element.textContent === "x")
              metrics.inputTwoFrames = performance.now() - start;
          }),
        );
      },
      true,
    );
  }, cards);
  return { fixture, stream: await liveStream(page, baseURL) };
}
