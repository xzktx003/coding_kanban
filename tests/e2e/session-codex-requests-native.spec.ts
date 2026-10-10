import { expect, test, type Page, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const imageFixture =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ0AAAAASUVORK5CYII=";

async function moduleState(page: Page, name: string, value: any) {
  await page.evaluate(
    async ({ name, value }) => {
      const path = `/src/session-mode/components/codex/stores/${name}.ts`;
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const store = (await import(url))[name];
      store.setState(value);
    },
    { name, value },
  );
}
async function themeState(page: Page, theme: string) {
  await page.evaluate(async (theme) => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const { useThemeStore } = await module(
      "/src/session-mode/stores/settings/useThemeStore.ts",
    );
    const { useLayoutStore } = await module(
      "/src/session-mode/stores/useLayoutStore.ts",
    );
    const { useAgentCenterStore } = await module(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    const { useCodexStore } = await module(
      "/src/session-mode/components/codex/stores/index.ts",
    );
    useThemeStore.getState().setTheme(theme);
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: false,
      isRightPanelOpen: false,
    });
    const card = {
      kind: "codex",
      id: "ux-0",
      cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
      preview: "请求验收",
    };
    // Persist the fixture attention card too: focus/picker reconciliation must
    // see the same synthetic authoritative tabs as the mounted frontend.
    await fetch("/api/session/tabs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: "native-requests-fixture",
        operations: [{ seq: 1, action: { type: "add", card } }],
      }),
    });
    useAgentCenterStore.setState({
      cards: [card],
      currentAgentCardId: "ux-0",
      cardsViewMode: "solo",
    });
    useCodexStore.setState({
      currentThreadId: "ux-0",
      events: {
        "ux-0": [
          {
            method: "item/completed",
            params: {
              threadId: "ux-0",
              turnId: "requests-turn",
              completedAtMs: 1,
              item: {
                type: "agentMessage",
                id: "fixture-message",
                text: "请求呈现验收",
                phase: null,
                memoryCitation: null,
              },
            },
          },
        ],
      },
      historyLoadedMap: { "ux-0": true },
      historyLoadingMap: {},
    });
  }, theme);
}
const profiles = [
  { name: "desktop", width: 1440, height: 1000, touch: false },
  { name: "narrow-pane", width: 768, height: 900, touch: false },
  { name: "small-pane", width: 480, height: 900, touch: true },
  { name: "phone", width: 390, height: 1000, touch: true },
  { name: "phone-landscape", width: 844, height: 390, touch: true },
  { name: "reduced-viewport", width: 390, height: 420, touch: true },
];
async function fitsViewport(
  page: Page,
  surface: Locator,
  receipt: string,
  onlyTarget = false,
) {
  const viewport = page.viewportSize()!,
    box = (await surface.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  // Requests are inline transcript items. A card taller than the remaining
  // chat viewport can scroll; its controls must remain normally reachable.
  const frame = await surface.evaluate((element) => {
    const scroll = element.closest<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!scroll) throw new Error("Request has no transcript scroll viewport");
    const r = scroll.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      bottom: r.bottom,
      scrollHeight: scroll.scrollHeight,
    };
  });
  expect(frame.y).toBeGreaterThanOrEqual(0);
  expect(frame.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(frame.height).toBeGreaterThan(0);
  const browserType = page.context().browser()?.browserType().name();
  const coarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  const touchScroll = browserType === "chromium" && coarse;
  const mobileWebKit = browserType === "webkit" && coarse;
  const cdp = touchScroll ? await page.context().newCDPSession(page) : null;
  const cdpLayout = cdp ? await cdp.send("Page.getLayoutMetrics") : null;
  if (cdp)
    await surface.evaluate((element) => {
      const viewport = element.closest<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      )!;
      const state = window as any;
      state.__requestTouchCleanup?.();
      state.__requestTouchEvents = [];
      state.__requestTouchFirstEvents = [];
      state.__requestTouchStats = {};
      const events = [
        "touchstart",
        "touchmove",
        "touchcancel",
        "touchend",
        "scroll",
      ];
      const record = (e: Event) => {
        const touch = (e as TouchEvent).touches?.[0];
        const detail = {
          type: e.type,
          trusted: e.isTrusted,
          y: touch?.clientY,
          target: (e.target as HTMLElement).className,
          top: viewport.scrollTop,
        };
        state.__requestTouchEvents.push(detail);
        if (state.__requestTouchFirstEvents.length < 20)
          state.__requestTouchFirstEvents.push(detail);
        state.__requestTouchStats[e.type] =
          (state.__requestTouchStats[e.type] ?? 0) + 1;
        if (state.__requestTouchEvents.length > 100)
          state.__requestTouchEvents.shift();
      };
      events.forEach((type) =>
        document.addEventListener(type, record, {
          capture: true,
          passive: true,
        }),
      );
      state.__requestTouchCleanup = () =>
        events.forEach((type) =>
          document.removeEventListener(type, record, true),
        );
    });
  const controls = [];
  try {
    const targets = onlyTarget
      ? [surface]
      : await surface
          .locator(
            'button:enabled:visible,input:enabled:visible,textarea:enabled:visible,[role="radio"]:visible',
          )
          .all();
    for (const control of targets) {
      // A real reader gesture marks intent. scrollIntoView alone is a
      // layout scroll and correctly does not cancel following the latest reply.
      await expect
        .poll(
          async () => {
            const r = await control.boundingBox();
            if (!r) return false;
            if (
              await control.evaluate((element) => {
                const r = element.getBoundingClientRect(),
                  bounds = element
                    .closest<HTMLElement>("[data-radix-scroll-area-viewport]")!
                    .getBoundingClientRect(),
                  y = r.y + r.height / 2,
                  hit = document.elementFromPoint(r.x + r.width / 2, y);
                return (
                  y >= bounds.top &&
                  y <= bounds.bottom &&
                  (element === hit || element.contains(hit))
                );
              })
            )
              return true;
            const delta = r.y + r.height / 2 - (frame.y + frame.height / 2);
            // Use the transcript gutter. A wheel over a focused number field
            // belongs to that control rather than to the transcript scroll.
            if (cdp && Math.abs(delta) >= 8) {
              // Dispatch actual touch input: synthesizeScrollGesture can drive
              // compositor scrolling without the DOM touchmove used to record
              // reader intent. Keep each swipe within this chat viewport.
              // Start well inside the transcript: Chromium touch adjustment can
              // select a nearby tab if a swipe begins beside the top boundary.
              const travel = Math.min(Math.abs(delta), frame.height / 2 - 20),
                start = frame.y + frame.height / 2,
                direction = delta > 0 ? -1 : 1;
              const touch = (y: number) => [
                { x: frame.x + 2, y, id: 0, radiusX: 1, radiusY: 1, force: 1 },
              ];
              await cdp.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: touch(start),
              });
              for (let step = 1; step <= 8; step++) {
                await cdp.send("Input.dispatchTouchEvent", {
                  type: "touchMove",
                  touchPoints: touch(start + (direction * travel * step) / 8),
                });
                await page.evaluate(() => new Promise(requestAnimationFrame));
              }
              await page.evaluate(() => new Promise(requestAnimationFrame));
              await cdp.send("Input.dispatchTouchEvent", {
                type: "touchEnd",
                touchPoints: [],
              });
            } else if (mobileWebKit) {
              // Playwright explicitly does not support mouse.wheel in mobile
              // WebKit and exposes tap, not a native swipe. Audit DOM gesture
              // handling plus actual viewport layout here; Chromium above
              // separately tests trusted native touch input. This is not an
              // OS Safari finger-gesture receipt.
              await surface.evaluate((element, delta) => {
                const scroll = element.closest<HTMLElement>(
                  "[data-radix-scroll-area-viewport]",
                )!;
                const bounds = scroll.getBoundingClientRect();
                // WebKit's Touch constructor is not exposed. These untrusted
                // DOM events deliberately test only the reader-intent handler.
                let lastDy = 0;
                const emit = (type: string, dy: number | null) => {
                  const event = new Event(type, { bubbles: true });
                  if (dy !== null) lastDy = dy;
                  const touch = {
                    identifier: 0,
                    target: scroll,
                    clientX: bounds.left + 2,
                    clientY: (bounds.top + bounds.bottom) / 2 + lastDy,
                  };
                  // Include all TouchEvent lists. Other listeners, such as the
                  // scroll area's scrollbar, legitimately read changedTouches.
                  Object.defineProperties(event, {
                    touches: { value: dy === null ? [] : [touch] },
                    targetTouches: { value: dy === null ? [] : [touch] },
                    changedTouches: { value: [touch] },
                  });
                  scroll.dispatchEvent(event);
                };
                emit("touchstart", 0);
                emit("touchmove", delta < 0 ? 16 : -16);
                scroll.scrollTop += delta;
                emit("touchend", null);
              }, delta);
            } else if (!cdp) {
              await page.mouse.move(frame.x + 2, frame.y + frame.height / 2);
              await page.mouse.wheel(0, delta);
            }
            const witness = await control.evaluate((element) => {
              const r = element.getBoundingClientRect();
              const scroll = element.closest<HTMLElement>(
                "[data-radix-scroll-area-viewport]",
              )!;
              const bounds = scroll.getBoundingClientRect();
              const x = r.x + r.width / 2,
                y = r.y + r.height / 2;
              const hit = document.elementFromPoint(x, y);
              return {
                text: element.textContent,
                x,
                y,
                bounds: { top: bounds.top, bottom: bounds.bottom },
                scrollTop: scroll.scrollTop,
                touchEvents: (window as any).__requestTouchEvents,
                touchFirstEvents: (window as any).__requestTouchFirstEvents,
                touchEventStats: (window as any).__requestTouchStats,
                scrollHeight: scroll.scrollHeight,
                clientHeight: scroll.clientHeight,
                hit: hit?.outerHTML.slice(0, 600),
                wheelTarget: document
                  .elementFromPoint(
                    bounds.left + 2,
                    (bounds.top + bounds.bottom) / 2,
                  )
                  ?.outerHTML.slice(0, 600),
                scrollers: [
                  ...scroll.querySelectorAll<HTMLElement>(
                    ".codex-elicitation__fields",
                  ),
                ].map((field) => ({
                  rect: field.getBoundingClientRect().toJSON(),
                  scrollTop: field.scrollTop,
                  scrollHeight: field.scrollHeight,
                  clientHeight: field.clientHeight,
                  overflow: getComputedStyle(field).overflowY,
                  overscroll: getComputedStyle(field).overscrollBehaviorY,
                })),
                reachable:
                  y >= bounds.top &&
                  y <= bounds.bottom &&
                  (element === hit || element.contains(hit)),
              };
            });
            await writeFile(
              receipt.replace(".json", "-scroll-witness.json"),
              JSON.stringify({ ...witness, cdpLayout }, null, 2),
            );
            if (!witness.reachable)
              await page.screenshot({
                path: receipt.replace(".json", "-scroll-witness.png"),
              });
            return witness.reachable;
          },
          { timeout: 10000, intervals: [50, 100, 150] },
        )
        .toBe(true);
      const actual = await control.evaluate((element) => {
        const r = element.getBoundingClientRect(),
          x = r.x + r.width / 2,
          y = r.y + r.height / 2,
          hit = document.elementFromPoint(x, y);
        return {
          tag: element.tagName,
          x,
          y,
          width: r.width,
          height: r.height,
          hit: element === hit || element.contains(hit),
        };
      });
      controls.push(actual);
      await writeFile(
        receipt,
        JSON.stringify({ viewport, box, frame, controls }, null, 2),
      );
      expect(actual.y).toBeGreaterThanOrEqual(frame.y);
      expect(actual.y).toBeLessThanOrEqual(frame.bottom);
      expect(actual.hit).toBe(true);
    }
  } finally {
    await cdp?.detach();
    if (touchScroll)
      await page.evaluate(() => {
        (window as any).__requestTouchCleanup?.();
        delete (window as any).__requestTouchCleanup;
      });
  }
  await writeFile(
    receipt,
    JSON.stringify(
      {
        viewport,
        box,
        frame,
        input: touchScroll
          ? "chromium-touch-gesture"
          : mobileWebKit
            ? "webkit-synthetic-touch-handler-and-viewport-scroll"
            : "browser-wheel",
        controls,
      },
      null,
      2,
    ),
  );
}
for (const { name, width, height, touch } of profiles)
  test.describe(`${name} ${width}x${height} requests`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    for (const theme of ["dark", "light"])
      test(`native requests retain identity, navigate and validate (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90_000);
        const fixture = await installSessionUxFixture(page);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.setViewportSize({ width, height });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60_000 });
        await seedSessionUx(page);
        await themeState(page, theme);
        const context = {
          threadId: "ux-0",
          turnId: "requests-turn",
          itemId: "request-item",
          requestToken: "fixture-instance",
        };
        const approval = {
          ...context,
          type: "commandExecution",
          requestId: 901,
          startedAtMs: 1,
          environmentId: null,
          command: "curl https://example.invalid/fixture",
          cwd: "/fixture/owner",
          reason: "隔离网络请求",
          networkApprovalContext: {
            host: "example.invalid",
            protocol: "https",
          },
          availableDecisions: ["accept", "acceptForSession", "decline"],
        };
        await moduleState(page, "useApprovalStore", {
          pendingApprovals: [approval],
          currentApproval: approval,
        });
        const card = page.locator("[data-codex-approval-surface]");
        await expect(card).toBeVisible();
        await expect(card.locator("svg").first()).toHaveAttribute(
          "viewBox",
          "0 0 20 20",
        );
        await fitsViewport(
          page,
          card,
          info.outputPath("approval-geometry.json"),
        );
        await card.screenshot({
          path: info.outputPath(`approval-native-${width}-${theme}.png`),
        });
        await card.focus();
        await page.keyboard.press("Escape");
        await expect(card.getByRole("button")).toHaveCount(1);
        expect(
          fixture.calls.filter((c) => c.path.includes("/approval/")),
        ).toHaveLength(0);
        await card.getByRole("button").click();
        await card.focus();
        await page.keyboard.press("Enter");
        await expect(card).toHaveCount(0);
        expect(
          fixture.calls.find((c) =>
            c.path.endsWith("approval/command-execution"),
          )?.body,
        ).toMatchObject({
          request_id: 901,
          request: { ...context, requestId: 901 },
          decision: "accept",
        });
        const request = {
          ...context,
          requestId: 902,
          questions: [
            {
              id: "environment",
              question: "选择环境",
              isOther: true,
              options: [
                {
                  label: "隔离 (Recommended)",
                  description: "保留所有当前 Agent",
                },
                { label: "生产" },
              ],
            },
            { id: "notes", question: "补充要求", options: null },
          ],
        };
        await page.evaluate(async (request) => {
          const path =
            "/src/session-mode/components/codex/stores/useRequestUserInputStore.ts";
          const url =
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
          (await import(url)).useRequestUserInputStore
            .getState()
            .addRequest(request);
        }, request);
        const questions = page.locator("[data-session-user-question]");
        await expect(questions.getByText("选择环境")).toBeVisible();
        await fitsViewport(
          page,
          questions,
          info.outputPath("questions-geometry.json"),
        );
        await questions.screenshot({
          path: info.outputPath(`questions-native-${width}-${theme}.png`),
        });
        if (touch)
          expect(
            await questions
              .getByRole("radio")
              .first()
              .evaluate((e) => e.getBoundingClientRect().height),
          ).toBeGreaterThanOrEqual(44);
        const environmentChoice = questions.getByRole("radio", {
          name: /隔离 \(Recommended\)/,
        });
        await fitsViewport(
          page,
          environmentChoice,
          info.outputPath("choice-action-geometry.json"),
          true,
        );
        if (touch) await environmentChoice.tap();
        else await environmentChoice.click();
        await expect(questions.getByText("补充要求")).toBeVisible();
        const answer = questions.getByPlaceholder("请输入你的回答");
        await fitsViewport(
          page,
          answer,
          info.outputPath("answer-action-geometry.json"),
          true,
        );
        await answer.fill("保存原项目草稿");
        await questions.focus();
        await page.keyboard.press("Control+Enter");
        await expect(questions).toHaveCount(0);
        expect(
          fixture.calls.find((c) => c.path.endsWith("approval/user-input"))
            ?.body,
        ).toMatchObject({
          request_id: 902,
          request: { ...context, requestId: 902 },
          response: {
            answers: {
              environment: { answers: ["隔离 (Recommended)"] },
              notes: { answers: ["保存原项目草稿"] },
            },
          },
        });
        const elicitation = {
          ...context,
          requestId: 903,
          mode: "form",
          serverName: "fixture",
          message: "填写数量",
          requestedSchema: {
            type: "object",
            properties: {
              count: { type: "integer", title: "数量", minimum: 2, maximum: 4 },
            },
            required: ["count"],
          },
        };
        await moduleState(page, "useElicitationStore", {
          pendingRequests: [elicitation],
          drafts: {},
        });
        const form = page.locator(".codex-elicitation");
        await expect(form).toBeVisible();
        await fitsViewport(
          page,
          form.getByRole("spinbutton"),
          info.outputPath("number-action-geometry.json"),
          true,
        );
        await form.getByRole("spinbutton").fill("1");
        await fitsViewport(
          page,
          form.getByRole("button", { name: "提交", exact: true }),
          info.outputPath("invalid-submit-action-geometry.json"),
          true,
        );
        await form.getByRole("button", { name: "提交", exact: true }).click();
        await expect(form.locator('[aria-invalid="true"]')).toHaveCount(1);
        expect(
          fixture.calls.filter((c) =>
            c.path.endsWith("approval/mcp-elicitation"),
          ),
        ).toHaveLength(0);
        await fitsViewport(page, form, info.outputPath("form-geometry.json"));
        await form.screenshot({
          path: info.outputPath(`elicitation-native-${width}-${theme}.png`),
        });
        await page.screenshot({
          path: info.outputPath(`requests-page-${width}-${theme}.png`),
          fullPage: true,
        });
        await fitsViewport(
          page,
          form.getByRole("spinbutton"),
          info.outputPath("valid-number-action-geometry.json"),
          true,
        );
        await form.getByRole("spinbutton").fill("3");
        await fitsViewport(
          page,
          form.getByRole("button", { name: "提交", exact: true }),
          info.outputPath("valid-submit-action-geometry.json"),
          true,
        );
        await form.getByRole("button", { name: "提交", exact: true }).click();
        await expect(form).toHaveCount(0);
        expect(
          fixture.calls.find((c) => c.path.endsWith("approval/mcp-elicitation"))
            ?.body,
        ).toMatchObject({
          request_id: 903,
          request: { ...context, requestId: 903 },
          action: "accept",
          content: { count: 3 },
        });
        const uploads: any[] = [];
        await page.route("**/api/session/files/upload", async (route) => {
          uploads.push(route.request().postDataJSON());
          await route.fulfill({
            json: { path: "/tmp/session-uploads/fixture selected.png" },
          });
        });
        const imageRequest = {
          ...context,
          requestId: 906,
          requestToken: "image-picker-instance",
          mode: "openai/form",
          serverName: "fixture",
          message: "选择原生图片模板",
          requestedSchema: {
            type: "object",
            properties: {
              image: {
                type: "openai/imagePicker",
                title: "图片模板",
                items: [
                  {
                    id: "actual-template-id",
                    title: "原生模板",
                    image: `data:image/png;base64,${imageFixture}`,
                  },
                ],
                file: { title: "本地图片", accept: ["image/png"] },
              },
            },
            required: ["image"],
          },
        };
        await moduleState(page, "useElicitationStore", {
          pendingRequests: [imageRequest],
          drafts: {},
        });
        const picker = page.locator(".codex-elicitation");
        await fitsViewport(
          page,
          picker.getByText("原生模板", { exact: true }),
          info.outputPath("template-action-geometry.json"),
          true,
        );
        await picker.getByText("原生模板", { exact: true }).click();
        await expect(
          picker.getByRole("radio", { name: "原生模板", exact: true }),
        ).toBeChecked();
        await expect(picker.locator("img")).toHaveJSProperty("naturalWidth", 1);
        await fitsViewport(
          page,
          picker,
          info.outputPath("picker-geometry.json"),
        );
        await picker.screenshot({
          path: info.outputPath(`image-picker-${width}-${theme}.png`),
        });
        await expect(
          picker.getByRole("button", { name: "本地图片", exact: true }),
        ).toHaveCount(0);
        await fitsViewport(
          page,
          picker.getByRole("button", { name: "提交", exact: true }),
          info.outputPath("template-submit-action-geometry.json"),
          true,
        );
        await picker.getByRole("button", { name: "提交", exact: true }).click();
        await expect(picker).toHaveCount(0);
        expect(
          fixture.calls
            .filter((c) => c.path.endsWith("approval/mcp-elicitation"))
            .at(-1)?.body,
        ).toMatchObject({
          request_id: 906,
          request: {
            ...context,
            requestId: 906,
            requestToken: "image-picker-instance",
          },
          action: "accept",
          content: { image: "actual-template-id" },
        });
        const fileRequest = {
          ...imageRequest,
          threadId: "picker-fixture",
          requestId: 907,
          requestToken: "explicit-picker-capability",
        };
        await page.evaluate(
          async ({ theme, fileRequest }) => {
            const module = (path: string) => {
              const dependency = path.startsWith("/node_modules/.vite/deps/");
              if (dependency)
                return import(
                  (window as any).__sessionFixtureDependency(
                    path.split("/").at(-1),
                  )
                );
              const mounted = performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path);
              return import(mounted?.name ?? path);
            };
            const react = await module("/node_modules/.vite/deps/react.js"),
              dom = await module(
                "/node_modules/.vite/deps/react-dom_client.js",
              );
            const R = react.default ?? react,
              { createRoot } = dom.default ?? dom;
            const { ElicitationItem } = await module(
              "/src/session-mode/components/codex/items/ElicitationItem.tsx",
            );
            const { useElicitationStore } = await module(
              "/src/session-mode/components/codex/stores/useElicitationStore.ts",
            );
            const { pickBrowserFiles } = await module(
              "/src/session-mode/browser-dialog.tsx",
            );
            const fixture = document.createElement("div");
            fixture.id = "file-picker-adapter-fixture";
            fixture.className = `session-mode ${theme === "dark" ? "dark" : ""}`;
            document.body.append(fixture);
            useElicitationStore.setState({
              pendingRequests: [fileRequest],
              drafts: {},
            });
            createRoot(fixture).render(
              R.createElement(ElicitationItem, {
                currentThreadId: "picker-fixture",
                onPickFile: async (_request: any, field: any) => {
                  const files = await pickBrowserFiles({
                    multiple: false,
                    accept: field.schema.file.accept.join(","),
                  });
                  return files?.[0] ?? null;
                },
              }),
            );
          },
          { theme, fileRequest },
        );
        const adapter = page.locator("#file-picker-adapter-fixture");
        expect(errors).toEqual([]);
        try {
          await expect(
            adapter.getByRole("button", { name: "本地图片", exact: true }),
          ).toBeVisible();
        } catch (error) {
          await writeFile(
            info.outputPath("file-adapter-failure.json"),
            JSON.stringify(
              {
                errors,
                diagnostic: await page.evaluate(() => ({
                  html: document.getElementById("file-picker-adapter-fixture")
                    ?.innerHTML,
                  reactResources: performance
                    .getEntriesByType("resource")
                    .filter((e) =>
                      /\/(react|react-dom_client)\.js$/.test(
                        new URL(e.name).pathname,
                      ),
                    )
                    .map((e) => e.name),
                })),
              },
              null,
              2,
            ),
          );
          throw error;
        }
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser"),
          adapter
            .getByRole("button", { name: "本地图片", exact: true })
            .click(),
        ]);
        await chooser.setFiles({
          name: "selected.png",
          mimeType: "image/png",
          buffer: Buffer.from(imageFixture, "base64"),
        });
        await expect(
          adapter.getByText("fixture selected.png", { exact: true }),
        ).toBeVisible();
        expect(uploads).toEqual([{ name: "selected.png", data: imageFixture }]);
        await adapter
          .getByRole("button", { name: "提交", exact: true })
          .click();
        await expect(adapter.locator(".codex-elicitation")).toHaveCount(0);
        expect(
          fixture.calls
            .filter((c) => c.path.endsWith("approval/mcp-elicitation"))
            .at(-1)?.body,
        ).toMatchObject({
          request_id: 907,
          request: {
            ...context,
            threadId: "picker-fixture",
            requestId: 907,
            requestToken: "explicit-picker-capability",
          },
          action: "accept",
          content: {
            image: "file:///tmp/session-uploads/fixture%20selected.png",
          },
        });
        expect(errors).toEqual([]);
        const foreign = fixture.calls.filter(
          (c) =>
            c.path.includes("/codex/") &&
            c.body?.threadId &&
            c.body.threadId !== "ux-0",
        );
        expect(foreign).toEqual([]);
      });
    for (const theme of ["dark", "light"])
      test(`request patches, secrets and expired async rounds stay isolated (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90_000);
        const fixture = await installSessionUxFixture(page);
        await page.setViewportSize({ width, height });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60_000 });
        await seedSessionUx(page);
        await themeState(page, theme);
        const context = {
          threadId: "ux-0",
          turnId: "requests-turn",
          itemId: "patch",
          requestToken: "patch-instance",
        };
        const patch = {
          ...context,
          type: "fileChange",
          requestId: 904,
          startedAtMs: 1,
        };
        const snapshot = {
          method: "item/started",
          params: {
            threadId: "ux-0",
            turnId: "requests-turn",
            item: {
              id: "patch",
              type: "fileChange",
              status: "inProgress",
              changes: [
                {
                  path: "src/owner.ts",
                  kind: { type: "update", move_path: null },
                  diff: "@@ -42,1 +42,1 @@\n-old = 1\n+new = 2\n",
                },
              ],
            },
          },
        };
        await moduleState(page, "useCodexStore", {
          events: { "ux-0": [snapshot] },
        });
        await moduleState(page, "useApprovalStore", {
          pendingApprovals: [patch],
          currentApproval: patch,
        });
        const card = page.locator("[data-codex-approval-surface]");
        await card.locator("summary").click();
        await expect(card.locator('[data-new-line="42"]')).toContainText(
          "new = 2",
        );
        await fitsViewport(page, card, info.outputPath("patch-geometry.json"));
        await card.screenshot({
          path: info.outputPath(`patch-request-${width}-${theme}.png`),
        });
        await moduleState(page, "useApprovalStore", {
          pendingApprovals: [],
          currentApproval: null,
        });
        const request = {
          ...context,
          itemId: "secret-item",
          requestToken: "secret-instance",
          requestId: 905,
          questions: [
            {
              id: "secret",
              question: "输入秘密字段",
              isSecret: true,
              options: null,
            },
          ],
        };
        await page.evaluate(async (request) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const { useRequestUserInputStore } = await module(
            "/src/session-mode/components/codex/stores/useRequestUserInputStore.ts",
          );
          useRequestUserInputStore.getState().addRequest(request);
        }, request);
        const secret = page.locator(
          '[data-session-user-question] input[type="password"]',
        );
        await secret.fill("fixture-memory-only-secret");
        expect(
          await page.evaluate(
            () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
          ),
        ).not.toContain("fixture-memory-only-secret");
        await page.evaluate(async (request) => {
          const path =
            "/src/session-mode/components/codex/stores/rpcLifecycle.ts";
          const module = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          module.useRpcDeliveryStore.setState({
            states: {
              [module.rpcKey(request)]: {
                phase: "uncertain",
                message: "fixture ambiguous delivery",
              },
            },
          });
        }, request);
        const questions = page.locator("[data-session-user-question]");
        await expect(secret).toBeDisabled();
        await expect(
          questions.getByRole("button", { name: "提交回答", exact: true }),
        ).toBeDisabled();
        await fitsViewport(
          page,
          questions,
          info.outputPath("secret-geometry.json"),
        );
        await questions.screenshot({
          path: info.outputPath(`uncertain-secret-${width}-${theme}.png`),
        });
        await moduleState(page, "useRequestUserInputStore", {
          pendingRequests: [],
          currentRequest: null,
          drafts: {},
        });
        const asyncItem = {
          method: "item/completed",
          params: {
            threadId: "ux-0",
            turnId: "requests-turn",
            completedAtMs: 1,
            item: {
              id: "async-fixture",
              type: "agentMessage",
              text: "",
              questions: [
                { title: "异步选择", options: ["隔离", "生产"] },
                { title: "异步补充" },
              ],
            },
          },
        };
        await moduleState(page, "useCodexStore", {
          events: { "ux-0": [asyncItem] },
          currentTurnId: "requests-turn",
          turnTimingMap: {
            "ux-0": {
              turnId: "requests-turn",
              status: "inProgress",
              startedAtMs: 1,
              durationMs: null,
            },
          },
        });
        await page.evaluate(async () => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const { collectQuestions } = await module(
            "/src/session-mode/features/async-questions/model.ts",
          );
          const { useAsyncQuestionStore } = await module(
            "/src/session-mode/features/async-questions/store.ts",
          );
          const { useCodexStore } = await module(
            "/src/session-mode/components/codex/stores/useCodexStore.ts",
          );
          useAsyncQuestionStore
            .getState()
            .open(
              "ux-0",
              collectQuestions(useCodexStore.getState().events["ux-0"], "ux-0"),
            );
        });
        const panel = page.locator("[data-session-async-panel]");
        await expect(panel).toBeVisible();
        await panel.getByRole("radio", { name: "隔离", exact: true }).check();
        await expect(
          panel.getByText("异步补充", { exact: true }),
        ).toBeVisible();
        await panel.getByRole("textbox").fill("异步原实例草稿");
        await panel.screenshot({
          path: info.outputPath(`async-request-${width}-${theme}.png`),
        });
        await moduleState(page, "useCodexStore", {
          currentTurnId: "new-turn",
          turnTimingMap: {
            "ux-0": {
              turnId: "new-turn",
              status: "inProgress",
              startedAtMs: 2,
              durationMs: null,
            },
          },
        });
        await expect(panel).toHaveCount(0);
        expect(
          fixture.calls.filter(
            (call) =>
              call.path.includes("/approval/") ||
              call.path.endsWith("/turn/start") ||
              call.path.endsWith("/turn/steer"),
          ),
        ).toEqual([]);
      });
  });
