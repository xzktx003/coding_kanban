import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { local, native, theme } from "./session-queue-fixture";

const pageErrors = new WeakMap<BrowserContext, string[]>();
test.beforeEach(({ context }) => {
  const errors: string[] = [];
  pageErrors.set(context, errors);
  const watch = (page: Page) =>
    page.on("pageerror", (error) => errors.push(error.message));
  context.pages().forEach(watch);
  context.on("page", watch);
});
test.afterEach(({ context }) => expect(pageErrors.get(context)).toEqual([]));

test.beforeAll(() =>
  mkdir(".dev-runtime/session-queue-sort-20261027", { recursive: true }),
);

test.describe("phone queue details", () => {
  test.use({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  test("touch dragging uses a clear handle and commits only the captured reorder", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await local(page);
    const actions: any[] = [];
    await page.route("**/api/session/followups/change", (route) => {
      actions.push(route.request().postDataJSON());
      return route.fulfill({ json: { revision: 2, paused: null, items: [] } });
    });
    await page.evaluate(() => {
      document.getElementById("root")!.style.cssText =
        "position:absolute;top:400px;left:10px;width:373px;max-width:none;padding:0";
      (window as any).renderQueue("first", true, "second");
    });
    await page.getByRole("button", { name: "还有 1 条待发送" }).tap();
    const dialog = page.getByRole("dialog", { name: "待发送消息 · 2" });
    const handles = dialog.locator('[aria-roledescription="sortable"]');
    await expect(handles).toHaveCount(2);
    await handles.first().scrollIntoViewIfNeeded();
    const first = (await handles.first().boundingBox())!,
      second = (await handles.nth(1).boundingBox())!;
    expect(first.width).toBeGreaterThanOrEqual(44);
    expect(first.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: ".dev-runtime/session-queue-sort-20261027/phone-details.png",
    });
    const cdp = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [
      { id: 1, x, y, radiusX: 2, radiusY: 2, force: 1 },
    ];
    const x = first.x + first.width / 2,
      y = first.y + first.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(x, y),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(x + 8, y),
    });
    await expect(handles.first()).toHaveAttribute("aria-pressed", "true");
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(
          x,
          y + ((second.y + second.height / 2 - y) * step) / 10,
        ),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => actions)
      .toEqual([
        {
          threadId: "owner",
          revision: 1,
          action: { type: "reorder", ids: ["second", "first"] },
        },
      ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await cdp.detach();
  });
});

test("starting a drag closes its selectable preview without sending or reopening it", async ({
  page,
}) => {
  await local(page);
  const actions: unknown[] = [];
  await page.route("**/api/session/followups/change", (route) => {
    actions.push(route.request().postDataJSON());
    return route.fulfill({ json: { revision: 2, paused: null, items: [] } });
  });
  await page.evaluate(() =>
    (window as any).renderQueue(
      "# Heading\n\nA long prompt retained for reading and copying before the drag",
      true,
      "second",
    ),
  );
  const preview = page.getByRole("group", { name: /^预览排队消息 1/ });
  await preview.click();
  await expect(
    page.getByRole("dialog", { name: "排队消息预览" }),
  ).toBeVisible();
  const handle = page.locator('[aria-roledescription="sortable"]').first();
  await begin(page, handle);
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "排队消息预览" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "排队消息预览" })).toHaveCount(
    0,
  );
  expect(actions).toEqual([]);
});

async function begin(page: Page, handle: Locator, distance = 8) {
  // Do not capture the destination while the previous native 200ms sorting
  // transition is still returning displaced rows to their layout positions.
  await expect
    .poll(() =>
      page.locator('[aria-roledescription="sortable"]').evaluateAll((handles) =>
        handles.every((handle) => {
          for (
            let node: Element | null = handle;
            node && node !== document.body;
            node = node.parentElement
          ) {
            const transform = getComputedStyle(node).transform;
            if (transform !== "none") {
              const matrix = new DOMMatrixReadOnly(transform);
              if (Math.abs(matrix.m41) > 0.01 || Math.abs(matrix.m42) > 0.01)
                return false;
            }
          }
          return true;
        }),
      ),
    )
    .toBe(true);
  await handle.hover();
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + distance, b.y + b.height / 2, {
    steps: 3,
  });
}
async function moveTo(page: Page, handle: Locator) {
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
}
test("real pointer sorting matches native activation, cancellation, and keyboard behavior", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(!reference, "Official reference required");
  await local(page);
  const actions: any[] = [];
  await page.route("**/api/session/followups/change", (route) => {
    actions.push(route.request().postDataJSON());
    return route.fulfill({ json: { revision: 2, paused: null, items: [] } });
  });
  const original = await context.newPage();
  await native(original, reference!);
  const records: any[] = [];
  for (const [kind, target] of [
    ["native", original],
    ["local", page],
  ] as const) {
    await theme(target, true);
    await target.evaluate(() =>
      (window as any).renderQueue("first", true, "second"),
    );
    const handles = target.locator('[aria-roledescription="sortable"]');
    await expect(handles).toHaveCount(2);
    const first = handles.first();
    await first.focus();
    for (const key of ["Space", "ArrowDown", "Enter"])
      await target.keyboard.press(key);
    expect(
      kind === "native"
        ? await target.evaluate(() => (window as any).queueActions)
        : actions,
    ).toEqual([]);
    await begin(target, first, 5);
    expect(await first.getAttribute("aria-pressed")).not.toBe("true");
    await target.mouse.up();
    // The native sensor retains click suppression for 50ms after release.
    await target.waitForTimeout(60);
    await begin(target, first);
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await moveTo(target, handles.nth(1));
    await target.keyboard.press("Escape");
    await target.mouse.up();
    expect(
      kind === "native"
        ? await target.evaluate(() => (window as any).queueActions)
        : actions,
    ).toEqual([]);
    await expect(first).not.toHaveAttribute("aria-pressed", "true");
    await target.waitForTimeout(60);
    await begin(target, first);
    await moveTo(target, handles.nth(1));
    await target.mouse.up();
    const expected =
      kind === "native"
        ? [{ type: "reorder", ids: ["second", "first"] }]
        : [
            {
              threadId: "owner",
              revision: 1,
              action: { type: "reorder", ids: ["second", "first"] },
            },
          ];
    await expect
      .poll(() =>
        kind === "native"
          ? target.evaluate(() => (window as any).queueActions)
          : actions,
      )
      .toEqual(expected);
    records.push({
      kind,
      keyboardWrites: 0,
      underThreshold: false,
      escapeWrites: 0,
      drop: expected,
    });
  }
  await mkdir(".dev-runtime/session-queue-sort-20261027", { recursive: true });
  await writeFile(
    ".dev-runtime/session-queue-sort-20261027/browser-sorting.json",
    JSON.stringify(records, null, 2),
  );
  await original.close();
});

test("native and local disable sorting for single and mixed-status queues", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(!reference, "Official reference required");
  await local(page);
  const original = await context.newPage();
  await native(original, reference!);
  for (const target of [original, page]) {
    await target.evaluate(() => (window as any).renderQueue("only"));
    await expect(
      target.locator('[aria-roledescription="sortable"]'),
    ).toHaveCount(0);
    for (const status of ["sending", "failed"]) {
      await target.evaluate(
        (status) =>
          (window as any).renderQueue("first", true, "second", {
            statuses: ["queued", status],
          }),
        status,
      );
      await expect(
        target.locator('[aria-roledescription="sortable"]'),
      ).toHaveCount(0);
    }
    await target.evaluate(() =>
      (window as any).renderQueue("first", true, "second"),
    );
    await expect(
      target.locator('[aria-roledescription="sortable"]'),
    ).toHaveCount(2);
  }
  await original.close();
});

test("a revision or owner change cancels captured sorting before any queue write", async ({
  page,
}) => {
  await local(page);
  const actions: unknown[] = [];
  await page.route("**/api/session/followups/change", (route) => {
    actions.push(route.request().postDataJSON());
    return route.fulfill({ json: { revision: 2, paused: null, items: [] } });
  });
  for (const change of [{ revision: 2 }, { threadId: "another-owner" }]) {
    await page.evaluate(() =>
      (window as any).renderQueue("first", true, "second"),
    );
    const handles = page.locator('[aria-roledescription="sortable"]');
    await expect(handles).toHaveCount(2);
    await begin(page, handles.first());
    await expect(handles.first()).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(
      (change) => (window as any).renderQueue("first", true, "second", change),
      change,
    );
    await expect(handles).toHaveCount(2);
    await expect(handles.nth(1)).toBeVisible();
    await moveTo(page, handles.nth(1));
    await page.mouse.up();
    await expect(handles.first()).not.toHaveAttribute("aria-pressed", "true");
    expect(actions).toEqual([]);
  }
});

for (const dark of [false, true])
  test(`sortable handle matches native hover geometry (${dark ? "dark" : "light"})`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const reference = process.env.CODEX_GOAL_REFERENCE_URL;
    test.skip(!reference, "Official reference required");
    await local(page);
    const original = await context.newPage();
    await native(original, reference!);
    const records: Record<string, unknown> = {},
      images: Record<string, Buffer> = {};
    for (const [kind, target] of [
      ["native", original],
      ["local", page],
    ] as const) {
      await theme(target, dark);
      await target.evaluate(() =>
        (window as any).renderQueue("first", true, "second"),
      );
      const handle = target
        .locator('[aria-roledescription="sortable"]')
        .first();
      await expect(handle).toBeVisible();
      const grip = handle.locator("svg").first();
      await target.mouse.move(1, 1);
      await expect(grip).toHaveCSS("opacity", "0");
      await handle.hover();
      await expect(grip).toHaveCSS("opacity", "1");
      records[kind] = await handle.evaluate((e) => {
        const css = getComputedStyle(e),
          svg = e.querySelector("svg")!,
          style = getComputedStyle(svg);
        return {
          box: e.getBoundingClientRect().toJSON(),
          padding: css.padding,
          margin: css.margin,
          cursor: css.cursor,
          gripBox: svg.getBoundingClientRect().toJSON(),
          color: style.color,
          circles: [...svg.querySelectorAll("circle")].map((c) => [
            c.getAttribute("cx"),
            c.getAttribute("cy"),
            c.getAttribute("r"),
          ]),
        };
      });
      images[kind] = await target.screenshot();
      await writeFile(
        `.dev-runtime/session-queue-sort-20261027/${dark ? "dark" : "light"}-${kind}.png`,
        images[kind],
      );
    }
    await writeFile(
      `.dev-runtime/session-queue-sort-20261027/${dark ? "dark" : "light"}-geometry.json`,
      JSON.stringify(records, null, 2),
    );
    expect(records.local).toEqual(records.native);
    expect(images.local.equals(images.native)).toBe(true);
    await original.close();
  });

test("a long queue scrolls during a pointer drag and preserves the native target order", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(!reference, "Official reference required");
  await local(page);
  const actions: any[] = [];
  await page.route("**/api/session/followups/change", (route) => {
    actions.push(route.request().postDataJSON());
    return route.fulfill({ json: { revision: 2, paused: null, items: [] } });
  });
  const original = await context.newPage();
  await native(original, reference!);
  const ids = Array.from({ length: 20 }, (_, i) => `message-${i}`);
  for (const [kind, target] of [
    ["native", original],
    ["local", page],
  ] as const) {
    await theme(target, true);
    await target.evaluate(
      (ids) =>
        (window as any).renderQueue(ids[0], true, ids[1], {
          extra: ids.slice(2),
        }),
      ids,
    );
    const handle = target.locator('[aria-roledescription="sortable"]').first();
    await expect(handle).toBeVisible();
    const scroll = await handle.evaluate((e) => {
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (
          /auto|scroll/.test(getComputedStyle(p).overflowY) &&
          p.scrollHeight > p.clientHeight
        ) {
          p.dataset.queueScrollProbe = "true";
          return p.getBoundingClientRect().toJSON();
        }
      }
      throw new Error("Missing actual overflow container");
    });
    await expect(target.locator('[data-queue-scroll-probe="true"]')).toHaveCSS("overscroll-behavior-y", "auto");
    await begin(target, handle);
    await target.mouse.move(scroll.x + 30, scroll.bottom - 2, { steps: 20 });
    try {
      await expect
        .poll(
          () =>
            target
              .locator('[data-queue-scroll-probe="true"]')
              .evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
          { timeout: 15_000 },
        )
        .toBeLessThanOrEqual(2);
    } finally {
      const state = await target
        .locator('[data-queue-scroll-probe="true"]')
        .evaluate((e) => {
          const ancestors = [];
          for (let node: Element | null = e; node; node = node.parentElement) {
            const css = getComputedStyle(node);
            ancestors.push({
              tag: node.tagName,
              className: node.className,
              rect: node.getBoundingClientRect().toJSON(),
              overflow: css.overflow,
              scrollHeight: node.scrollHeight,
              clientHeight: node.clientHeight,
              scrollTop: node.scrollTop,
            });
          }
          return { ancestors, scrollY, clientHeight: innerHeight };
        });
      await writeFile(
        `.dev-runtime/session-queue-sort-20261027/scroll-${kind}.json`,
        JSON.stringify(state, null, 2),
      );
    }
    await target.mouse.up();
    const expected = [...ids.slice(1), ids[0]];
    await expect
      .poll(() =>
        kind === "native"
          ? target.evaluate(() => (window as any).queueActions[0]?.ids)
          : actions[0]?.action.ids,
      )
      .toEqual(expected);
  }
  await original.close();
});
