import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const needle = "Needle-highlight";

async function installObservation(page: Page) {
  await page.addInitScript(() => {
    const OriginalObserver = window.MutationObserver;
    const identities = new WeakMap<MutationObserver, number>();
    const active = new Map<number, string>();
    let sequence = 0,
      callbacks = 0,
      records = 0;
    // All delivery, observe, disconnect and takeRecords behavior is native.
    // Retain only numeric identities/counts and thread IDs, never DOM records,
    // target nodes, callback closures or body text in the measurement registry.
    window.MutationObserver = class extends OriginalObserver {
      constructor(callback: MutationCallback) {
        super((mutations, observer) => {
          const identity = identities.get(observer);
          if (identity !== undefined && active.has(identity)) {
            callbacks++;
            records += mutations.length;
          }
          callback.call(observer, mutations, observer);
        });
      }
      observe(target: Node, options?: MutationObserverInit) {
        super.observe(target, options);
        if (
          !(target instanceof Element) ||
          !target.matches('[data-slot="scroll-area"]') ||
          !options?.subtree ||
          !options.childList ||
          !options.characterData
        )
          return;
        const shell = target.closest("[data-codex-transcript-shell]");
        if (!shell) return;
        let identity = identities.get(this);
        if (identity === undefined) {
          identity = ++sequence;
          identities.set(this, identity);
        }
        active.set(
          identity,
          shell.getAttribute("data-codex-transcript-shell")!,
        );
      }
      disconnect() {
        super.disconnect();
        const identity = identities.get(this);
        if (identity !== undefined) active.delete(identity);
      }
    };
    (window as any).__readSearchObservation = () => ({
      registrations: sequence,
      active: [...active].map(([identity, threadId]) => ({
        identity,
        threadId,
      })),
      callbacks,
      records,
      highlights: Array.from(
        (CSS as any).highlights.get("codex-thread-search-active") ?? [],
      ).map((range: Range) => range.toString()),
    });
  });
}

async function observe(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    return (window as any).__readSearchObservation() as {
      registrations: number;
      active: Array<{ identity: number; threadId: string }>;
      callbacks: number;
      records: number;
      highlights: string[];
    };
  });
}

async function mutateReply(page: Page) {
  // Controlled DOM mutation exercises the actual observer on the actual chat
  // root. It is not presented as SSE, protocol or long-memory evidence.
  await page
    .locator(".codex-assistant-content")
    .first()
    .evaluate(async (body) => {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      const text = document.createTextNode(" 一次受控正文变化");
      body.append(text);
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      text.remove();
    });
}

for (const width of [1280, 390]) {
  test(`search observes only an active visible match at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await installObservation(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await installSessionUxFixture(page, 1);
    fixture.threads[0].turns = [
      {
        id: "highlight-turn",
        status: "completed",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
        error: null,
        items: [
          {
            type: "userMessage",
            id: "highlight-user",
            content: [
              {
                type: "text",
                text: `原始搜索正文 ${needle}`,
                text_elements: [],
              },
            ],
          },
          {
            type: "agentMessage",
            id: "highlight-assistant",
            text: "保持可见的回复正文。",
            phase: "final_answer",
          },
        ],
      } as any,
    ];
    await page.route("**/api/codex/thread/search-occurrences", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              turnId: "highlight-turn",
              itemId: "highlight-user",
              snippet: needle,
              snippetMatchRange: { start: 0, end: needle.length },
              turnCursor: null,
            },
          ],
          nextCursor: null,
        },
      }),
    );
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      const editor = page
        .locator('.session-codex-composer [contenteditable="true"]')
        .first();
      await editor.waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(async () => {
        const path = "/src/session-mode/stores/useAgentCenterStore.ts";
        const { useAgentCenterStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "高亮生命周期",
          },
          { activate: true },
        );
      });
      await page
        .locator('[data-tab-key="codex:ux-0"]')
        .first()
        .click({ position: { x: 20, y: 12 } });
      await expect(
        page.locator(".codex-assistant-content").first(),
      ).toContainText("保持可见的回复正文。");
      await editor.fill("未发送的搜索草稿");
      const noSearch = await observe(page);
      await mutateReply(page);
      const noSearchMutation = await observe(page);

      await editor.focus();
      await page.keyboard.press("Control+f");
      const search = page.getByRole("textbox", { name: "搜索会话正文" });
      const openedWithoutMatch = await observe(page);
      await search.fill(needle);
      await page.locator(".codex-thread-search-results button").first().click();
      await expect
        .poll(async () => (await observe(page)).highlights)
        .toEqual([needle]);
      const searching = await observe(page);
      await mutateReply(page);
      const searchingMutation = await observe(page);

      await page
        .getByRole("button", { name: "终端", exact: true })
        .first()
        .click();
      const hidden = await observe(page);
      await page
        .getByRole("button", { name: "会话", exact: true })
        .first()
        .click();
      await expect
        .poll(async () => (await observe(page)).highlights)
        .toEqual([needle]);
      const restored = await observe(page);
      await page.getByRole("button", { name: "关闭搜索", exact: true }).click();
      const closed = await observe(page);
      await mutateReply(page);
      const closedMutation = await observe(page);
      await expect(editor).toHaveText("未发送的搜索草稿");
      const executing = fixture.calls.filter((call) =>
        /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork)|followups\/submit|goal\/(?:set|clear))$/.test(
          call.path,
        ),
      );
      writeFileSync(
        info.outputPath("search-highlight-lifecycle.json"),
        JSON.stringify(
          {
            boundary:
              "Native MutationObserver subclass forwards all behavior; counts only. Controlled DOM mutations, isolated API/WS fixture. No forced GC, refresh, SSE or RSS conclusion.",
            width,
            noSearch,
            noSearchMutation,
            openedWithoutMatch,
            searching,
            searchingMutation,
            hidden,
            restored,
            closed,
            closedMutation,
            errors,
            executing,
          },
          null,
          2,
        ),
      );
      for (const state of [
        noSearch,
        noSearchMutation,
        openedWithoutMatch,
        hidden,
        closed,
        closedMutation,
      ]) {
        expect.soft(state.active).toEqual([]);
        expect.soft(state.highlights).toEqual([]);
      }
      expect.soft(noSearchMutation.callbacks).toBe(noSearch.callbacks);
      expect.soft(closedMutation.callbacks).toBe(closed.callbacks);
      for (const state of [searching, searchingMutation, restored]) {
        expect
          .soft(state.active.map((entry) => entry.threadId))
          .toEqual(["ux-0"]);
        expect.soft(state.highlights).toEqual([needle]);
      }
      expect
        .soft(searchingMutation.callbacks)
        .toBeGreaterThan(searching.callbacks);
      expect(errors).toEqual([]);
      expect(executing).toEqual([]);
    } finally {
      await page.goto("about:blank");
    }
  });
}
