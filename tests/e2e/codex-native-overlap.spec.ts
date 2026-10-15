import { expect, test } from "@playwright/test";

// Real Chromium and the production adapter, with controlled native documents.
// No formal host, model request, login, or Agent is used by this regression.
const thread = "019aabcd-1234-7890-abcd-000000000003";
const nextThread = "019aabcd-1234-7890-abcd-000000000004";
const nativePath =
  "/native-codex/static/out/vs/workbench/contrib/webview/browser/pre/index.html";

test("cached native chat never overlaps or captures input from the selected history", async ({
  page,
}) => {
  await page.route("**/__codex-overlap__", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0;background:#202020"></body>',
    }),
  );
  await page.route("**/native-codex/**", (route) => {
    const url = new URL(route.request().url()),
      cached = url.searchParams.get("kind") === "cached";
    const body =
      url.pathname === nativePath
        ? `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}iframe{width:100%;height:100%;border:0}</style><iframe id="active-frame" src="/native-codex/overlap-app?kind=${cached ? "cached" : "current"}"></iframe>`
        : `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#202020;color:#ddd;font:16px system-ui}textarea{position:fixed;left:12px;bottom:20px;width:calc(100% - 32px);height:80px}</style><div id="root"><h2>${cached ? "旧新聊天" : "当前历史会话"}</h2><div data-above-composer-portal data-above-composer-conversation-id="${cached ? "" : thread}"></div><textarea>${cached ? "cached draft" : "current draft"}</textarea></div>`;
    return route.fulfill({ contentType: "text/html; charset=utf-8", body });
  });
  await page.goto("/__codex-overlap__");
  await page.evaluate(
    ({ nativePath }) => {
      const group = document.createElement("div");
      group.className = "editor-group-container";
      group.style.cssText = "width:390px;height:700px";
      const editor = document.createElement("div");
      editor.className = "editor-instance";
      editor.style.cssText = "width:390px;height:700px";
      group.append(editor);
      document.body.append(group);
      for (const kind of ["cached", "current"]) {
        const owner = document.createElement("span");
        owner.id = `owner-${kind}`;
        editor.append(owner);
        const overlay = document.createElement("div");
        overlay.setAttribute("data-parent-flow-to-element-id", owner.id);
        const frame = document.createElement("iframe");
        frame.className = "webview ready";
        frame.src = `${nativePath}?extensionId=openai.chatgpt&kind=${kind}`;
        overlay.append(frame);
        document.body.append(overlay);
      }
    },
    { nativePath },
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLIFrameElement>("iframe.webview"),
        ].every(
          (f) =>
            !!f.contentDocument
              ?.querySelector<HTMLIFrameElement>("#active-frame")
              ?.contentDocument?.getElementById("root"),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(
    async ({ thread }) => {
      // Vite transforms this module in the same way as the real workbench.
      const { mountNativeSurface } = await import(
        /* @vite-ignore */ "/src/codex-mode/native-surface.ts"
      );
      const frames = [
        ...document.querySelectorAll<HTMLIFrameElement>("iframe.webview"),
      ];
      (window as any).originals = frames.map((frame) => ({
        frame,
        parent: frame.parentElement,
        win: frame.contentWindow,
      }));
      const surface = mountNativeSurface(
        document,
        () => {},
        () => {},
      );
      (window as any).surface = surface;
      surface.start();
      surface.bindWindowAtColumn(thread, 1);
    },
    { thread },
  );
  for (const width of [390, 430, 720, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(
      ({ width, thread }) =>
        (window as any).surface.setLayout({
          frames: [{ id: thread, x: 0, y: 44, width, height: 760 }],
          interactiveId: thread,
        }),
      { width, thread },
    );
    const frames = page.locator("iframe.webview");
    await expect(frames.nth(0)).toHaveAttribute(
      "data-kanban-native-hidden",
      "true",
    );
    await expect(frames.nth(0)).toHaveCSS("visibility", "hidden");
    await expect(frames.nth(1)).toHaveAttribute(
      "data-kanban-native-interactive",
      "true",
    );
    expect(
      await frames.nth(1).evaluate((f) => {
        const r = f.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === f
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`one-composer-${width}.png`),
    });
  }
  // Reuse the same native column. Before its UUID arrives, show no wrong chat.
  await page.evaluate(() => {
    const frame = document.querySelectorAll<HTMLIFrameElement>('iframe.webview')[1]!;
    frame.contentDocument!.querySelector<HTMLIFrameElement>('#active-frame')!.contentDocument!.querySelector('[data-above-composer-portal]')!.removeAttribute('data-above-composer-conversation-id');
  });
  await expect(page.locator('iframe[data-kanban-native-hidden="false"]')).toHaveCount(0);
  await page.evaluate(
    ({ nextThread }) => {
      const surface = (window as any).surface;
      surface.bindWindowAtColumn(nextThread, 1);
      surface.setLayout({
        frames: [
          { id: nextThread, x: 0, y: 44, width: innerWidth, height: 760 },
        ],
        interactiveId: nextThread,
      });
    },
    { nextThread },
  );
  await expect(
    page.locator('iframe[data-kanban-native-hidden="false"]'),
  ).toHaveCount(0);
  await page.evaluate(
    ({ nextThread }) => {
      const frame =
        document.querySelectorAll<HTMLIFrameElement>("iframe.webview")[1]!;
      frame
        .contentDocument!.querySelector<HTMLIFrameElement>("#active-frame")!
        .contentDocument!.querySelector("[data-above-composer-portal]")!
        .setAttribute("data-above-composer-conversation-id", nextThread);
    },
    { nextThread },
  );
  await expect(
    page.locator('iframe[data-kanban-native-hidden="false"]'),
  ).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).surface.pause();
    (window as any).surface.start();
  });
  await expect(
    page.locator('iframe[data-kanban-native-hidden="false"]'),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (window as any).originals.every(
        ({ frame, parent, win }: any) =>
          frame.parentElement === parent && frame.contentWindow === win,
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector<HTMLIFrameElement>("iframe.webview")!
          .contentDocument!.querySelector<HTMLIFrameElement>("#active-frame")!
          .contentDocument!.querySelector<HTMLTextAreaElement>("textarea")!
          .value,
    ),
  ).toBe("cached draft");
});
