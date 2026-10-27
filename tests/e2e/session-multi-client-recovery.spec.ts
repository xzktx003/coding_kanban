import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";

const projects = ["/fixture/recovery/project-a", "/fixture/recovery/project-b"];
const cards = [0, 1, 2].map((i) => ({
  kind: "codex",
  id: `ux-${i}`,
  cwd: projects[i === 1 ? 1 : 0],
  preview: `联合恢复会话 ${i}`,
}));
const editor = (page: Page) =>
  page.locator(".session-agent-view [contenteditable=true]");
const tab = (page: Page, i: number) =>
  page.locator(`[role=tab][data-tab-key="codex:ux-${i}"]`);
const groups = (page: Page) => page.locator("[data-session-group]");
const inputTarget = (page: Page) => page.locator(".session-native-composer");

async function visibility(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    (window as any).__recoveryHidden = hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
async function split(page: Page) {
  const body = (await groups(page)
    .first()
    .locator("[data-session-group-body]")
    .boundingBox())!;
  const source = tab(page, 1).locator(".session-identity-title");
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(body.x + body.width - 8, body.y + body.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(groups(page)).toHaveCount(2);
  await tab(page, 0).click();
}
async function anchor(viewport: Locator) {
  return viewport.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>("[data-codex-row]")].find(
      (row) => row.getBoundingClientRect().bottom > top + 20,
    );
    if (!row) throw new Error("No visible transcript row to measure");
    return {
      key: row.dataset.codexRow!,
      offset: row.getBoundingClientRect().top - top,
      scrollTop: el.scrollTop,
    };
  });
}
async function offset(viewport: Locator, key: string) {
  return viewport.evaluate((el, key) => {
    const row = [...el.querySelectorAll<HTMLElement>("[data-codex-row]")].find(
      (row) => row.dataset.codexRow === key,
    );
    if (!row) throw new Error(`Reading anchor no longer mounted: ${key}`);
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }, key);
}

test("same-origin pages recover long split histories without moving targets, losing drafts or resending an uncertain queue item", async ({
  context,
  page,
}, info) => {
  test.setTimeout(120000);
  const other = await context.newPage();
  const pages = [page, other];
  const errors: string[] = [];
  const writes: Array<{ page: number; path: string; body: any }> = [];
  const reads: Array<{
    page: number;
    thread: string;
    at: number;
    kind: string;
    bytes?: number;
    items?: number;
  }> = [];
  const states = new Map<string, any>();
  const fixtures: Awaited<ReturnType<typeof installSessionUxFixture>>[] = [];
  const startedAt = Math.floor(Date.now() / 1000) - 60;
  let completed = false;
  let uncertainSubmission: any;
  const turns = Array.from({ length: 10 }, (_, turn) => ({
    id: `long-${turn}`,
    status: "completed",
    startedAt: startedAt - 1000 + turn,
    completedAt: startedAt - 999 + turn,
    durationMs: 1000,
    error: null,
    items: Array.from({ length: 120 }, (_, item) => ({
      id: `long-${turn}-${item}`,
      type: "agentMessage",
      phase: "final_answer",
      text: `长历史 ${turn}-${item}：${"阅读锚点保持，历史恢复不改变输入目标。".repeat(8)}`,
    })),
  }));
  try {
    await context.addInitScript(
      ({ cards, projects }) => {
        (window as any).__recoveryHidden = false;
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => (window as any).__recoveryHidden,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => ((window as any).__recoveryHidden ? "hidden" : "visible"),
        });
        // Keep a stable isolated stream; current-state recovery travels through real fetch.
        class Stream {
          onopen: (() => void) | null = null;
          onmessage = null;
          onerror = null;
          closed = false;
          constructor() {
            setTimeout(() => {
              if (!this.closed) this.onopen?.();
            }, 30);
          }
          close() {
            this.closed = true;
          }
        }
        (window as any).EventSource = Stream;
        if (!localStorage.getItem("kanban.session.agent-center-store")) {
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
            "kanban.session.workspace",
            JSON.stringify({
              version: 1,
              state: {
                projects,
                cwd: projects[0],
                projectsInitialized: true,
              },
            }),
          );
        }
      },
      { cards, projects },
    );
    for (const [index, current] of pages.entries()) {
      await current.setViewportSize({ width: 1800, height: 1000 });
      current.on("pageerror", (error) =>
        errors.push(`${index}: ${error.message}`),
      );
      const fixture = await installSessionUxFixture(current, 3);
      fixtures.push(fixture);
      fixture.threads.forEach((thread, i) =>
        Object.assign(thread, {
          cwd: cards[i].cwd,
          name: cards[i].preview,
          preview: cards[i].preview,
          createdAt: startedAt - 1000,
          updatedAt: startedAt,
        }),
      );
      Object.assign(fixture.threads[0], { turns });
      Object.assign(fixture.threads[1], {
        turns: [
          {
            id: "second-history",
            status: "completed",
            startedAt,
            completedAt: startedAt + 1,
            durationMs: 1000,
            error: null,
            items: [
              {
                id: "second-answer",
                type: "agentMessage",
                text: "项目 B 的独立历史回复",
                phase: "final_answer",
              },
            ],
          },
        ],
      });
      Object.assign(fixture.threads[2], {
        status: { type: "active", activeFlags: [] },
        turns: [
          {
            id: "background-recovery-turn",
            status: "inProgress",
            startedAt,
            completedAt: null,
            durationMs: null,
            error: null,
            items: [
              {
                id: "background-answer",
                type: "agentMessage",
                text: "后台任务正在进行",
                phase: "commentary",
              },
            ],
          },
        ],
      });
      await current.route("**/api/session/tabs", (route) => {
        const body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : null;
        return route.fulfill({
          json: {
            initialized: true,
            revision: 1,
            cards,
            sequence: body?.operations?.at(-1)?.seq ?? 0,
          },
        });
      });
      await current.route("**/api/session/projects", (route) => {
        const body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : null;
        return route.fulfill({
          json: {
            initialized: true,
            revision: 1,
            projects,
            sequence: body?.operations?.at(-1)?.seq ?? 0,
          },
        });
      });
      await current.route("**/api/**/thread/list", (route) => {
        const body = route.request().postDataJSON();
        const matching = fixture.threads.filter(
          (thread) => !body?.cwd || thread.cwd === body.cwd,
        );
        const start = Number(body?.cursor ?? 0);
        const end = start + (body?.limit ?? 50);
        return route.fulfill({
          json: {
            data: matching.slice(start, end),
            nextCursor: end < matching.length ? String(end) : null,
          },
        });
      });
      await current.route("**/api/session/followups**", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        const body =
          request.method() === "POST" ? request.postDataJSON() : null;
        const thread = body?.threadId ?? url.searchParams.get("threadId");
        let state = states.get(thread) ?? {
          revision: 0,
          items: [],
          paused: null,
        };
        if (request.method() === "GET")
          reads.push({ page: index, thread, at: Date.now(), kind: "queue" });
        else {
          writes.push({ page: index, path: url.pathname, body });
          if (url.pathname.endsWith("/submit")) {
            uncertainSubmission = body;
            state = {
              revision: state.revision + 1,
              paused: "请核对消息是否送达",
              items: [
                {
                  ...body,
                  createdAt: Date.now(),
                  status: "uncertain",
                  fingerprint: "isolated-uncertain",
                  error: "隔离夹具：送达回执未知",
                },
              ],
            };
            states.set(thread, state);
          }
        }
        await route.fulfill({ json: state });
      });
      await current.route("**/api/**/thread/turns/list?**", async (route) => {
        const body = route.request().postDataJSON();
        const thread = fixture.threads.find(
          (thread) => thread.id === body.threadId,
        )!;
        if (thread.id === "ux-2" && completed) {
          Object.assign(thread, {
            status: { type: "idle" },
            turns: [
              {
                id: "background-recovery-turn",
                status: "completed",
                startedAt,
                completedAt: startedAt + 60,
                durationMs: 60000,
                error: null,
                items: [
                  {
                    id: "background-answer",
                    type: "agentMessage",
                    text: "后台完成回复：重显后仍然未读",
                    phase: "final_answer",
                  },
                ],
              },
            ],
          });
        }
        const ordered = [
          ...(thread.turns as Array<{ items: unknown[] }>),
        ].reverse();
        const start = Number(body.cursor ?? 0),
          end = start + (body.limit ?? 10);
        const json = {
          data: ordered.slice(start, end),
          nextCursor: end < ordered.length ? String(end) : null,
          backwardsCursor: String(start),
        };
        reads.push({
          page: index,
          thread: thread.id,
          at: Date.now(),
          kind: "history",
          bytes: Buffer.byteLength(JSON.stringify(json)),
          items: json.data.reduce(
            (count, turn) => count + turn.items.length,
            0,
          ),
        });
        await route.fulfill({ json });
      });
      await current.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await expect(tab(current, 0)).toBeVisible();
      await expect(editor(current)).toBeVisible();
    }
    await split(page);
    await tab(other, 1).click();
    await expect(inputTarget(page)).toHaveAttribute(
      "data-owner-thread",
      "ux-0",
    );
    await expect(inputTarget(other)).toHaveAttribute(
      "data-owner-thread",
      "ux-1",
    );
    await expect(
      tab(page, 0)
        .locator("..")
        .getByRole("button", { name: "项目详情：project-a", exact: true }),
    ).toBeVisible();
    await expect(
      tab(other, 1)
        .locator("..")
        .getByRole("button", { name: "项目详情：project-b", exact: true }),
    ).toBeVisible();
    await expect(groups(other)).toHaveCount(1);
    await expect(page.getByText(/长历史 9-119：/)).toBeVisible();
    await editor(page).fill("A 的阅读草稿：不可被 B 的选择或回执覆盖");
    const left = groups(page).filter({ has: tab(page, 0) });
    const viewport = left
      .locator('[data-slot="scroll-area-viewport"]')
      .filter({ has: page.locator("[data-session-latest]") });
    await viewport.evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -700, bubbles: true }),
      );
      el.scrollTop = el.scrollHeight - el.clientHeight - 700;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(250);
    const reading = await anchor(viewport);
    expect(reading.scrollTop).toBeGreaterThan(0);
    await expect(tab(page, 2).locator('[data-state="running"]')).toBeVisible();
    await visibility(page, true);
    await page.waitForTimeout(100);
    const hiddenAt = Date.now();
    const initialBReads = reads.filter(
      (read) => read.page === 1 && read.kind === "queue",
    ).length;
    await editor(other).fill("B 的队列提交：只允许一次");
    await editor(other).press("Enter");
    await expect
      .poll(
        () => writes.filter((write) => write.path.endsWith("/submit")).length,
      )
      .toBe(1);
    await expect(
      other.getByText("核对送达状态", { exact: true }),
    ).toBeVisible();
    await editor(other).fill("B 的新草稿：未知回执之后仍须保留");
    completed = true;
    await other.waitForTimeout(4500);
    expect(
      reads.filter(
        (read) =>
          read.page === 0 && read.kind === "queue" && read.at >= hiddenAt,
      ),
    ).toEqual([]);
    expect(
      reads.filter((read) => read.page === 1 && read.kind === "queue").length,
    ).toBeGreaterThan(initialBReads);
    const hiddenUntil = Date.now();
    await visibility(page, false);
    await expect
      .poll(
        () =>
          reads.filter(
            (read) =>
              read.page === 0 && read.kind === "queue" && read.at >= hiddenAt,
          ).length,
      )
      .toBeGreaterThan(0);
    await expect(inputTarget(page)).toHaveAttribute(
      "data-owner-thread",
      "ux-0",
    );
    await expect(editor(page)).toHaveText(
      "A 的阅读草稿：不可被 B 的选择或回执覆盖",
    );
    await expect
      .poll(async () =>
        Math.abs((await offset(viewport, reading.key)) - reading.offset),
      )
      .toBeLessThanOrEqual(2);
    await expect(
      tab(page, 2).getByRole("img", { name: "有新的回复未读" }),
    ).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: info.outputPath("page-a-unread.png"),
      animations: "disabled",
    });
    await tab(page, 2).click();
    await expect(
      page.getByText("后台完成回复：重显后仍然未读", { exact: true }),
    ).toBeVisible();
    await expect(inputTarget(page)).toHaveAttribute(
      "data-owner-thread",
      "ux-2",
    );
    await expect(editor(page)).toBeEmpty();
    await expect(
      tab(page, 2).getByRole("img", { name: "有新的回复未读" }),
    ).toHaveCount(0);
    await tab(page, 0).click();
    await expect(editor(page)).toHaveText(
      "A 的阅读草稿：不可被 B 的选择或回执覆盖",
    );
    await expect
      .poll(async () =>
        Math.abs((await offset(viewport, reading.key)) - reading.offset),
      )
      .toBeLessThanOrEqual(2);
    await expect(inputTarget(other)).toHaveAttribute(
      "data-owner-thread",
      "ux-1",
    );
    await expect(editor(other)).toHaveText("B 的新草稿：未知回执之后仍须保留");
    await expect(
      other.getByText("核对送达状态", { exact: true }),
    ).toBeVisible();
    await expect(groups(page)).toHaveCount(2);
    await expect(groups(other)).toHaveCount(1);
    await expect(
      page.locator('[data-group-active="true"] [data-tab-key="codex:ux-0"]'),
    ).toHaveAttribute("aria-selected", "true");
    await expect(tab(other, 1)).toHaveAttribute("aria-selected", "true");
    expect(
      reads.some(
        (read) =>
          read.page === 0 && read.thread === "ux-0" && read.items === 1200,
      ),
    ).toBe(true);
    expect(uncertainSubmission.threadId).toBe("ux-1");
    expect(uncertainSubmission.parameters.cwd).toBe(projects[1]);
    expect(writes).toHaveLength(1);
    expect(
      fixtures
        .flatMap((fixture) => fixture.calls)
        .filter(
          (call) =>
            /\/(turn\/(start|steer|interrupt)|thread\/(start|resume|fork|delete|rollback|archive)|subagents\/stop|followups\/(submit|stop|change))$/.test(
              call.path,
            ) ||
            (call.path.endsWith("/thread/access") &&
              call.body?.release === true),
        ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("page-a-restored.png"),
      animations: "disabled",
    });
    await other.screenshot({
      path: info.outputPath("page-b-uncertain.png"),
      animations: "disabled",
    });
    await writeFile(
      info.outputPath("receipt.json"),
      JSON.stringify(
        {
          reading,
          restoredOffset: await offset(viewport, reading.key),
          historyItemCount: 1200,
          completed,
          hiddenWindow: {
            from: hiddenAt,
            until: hiddenUntil,
            pageAQueueReads: reads.filter(
              (read) =>
                read.page === 0 &&
                read.kind === "queue" &&
                read.at >= hiddenAt &&
                read.at < hiddenUntil,
            ).length,
          },
          finalDom: await Promise.all(
            pages.map(async (current) => ({
              owner:
                await inputTarget(current).getAttribute("data-owner-thread"),
              draft: await editor(current).innerText(),
              groups: await groups(current).count(),
              selected: await current
                .locator(
                  '[data-group-active="true"] [role=tab][aria-selected="true"]',
                )
                .getAttribute("data-tab-key"),
            })),
          ),
          historyBytes: reads
            .filter((read) => read.kind === "history")
            .map((read) => ({
              page: read.page,
              thread: read.thread,
              bytes: read.bytes,
            })),
          writes,
          reads,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await writeFile(
      info.outputPath("network.json"),
      JSON.stringify(
        {
          writes,
          reads,
          errors,
          otherApiPosts: fixtures.map((fixture) => fixture.calls),
        },
        null,
        2,
      ),
    );
    await other.close();
  }
});
