import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
test("GitHub Markdown icon is native with the rich-preview gate disabled", async ({
  page,
}, info) => {
  test.skip(!reference, "Set native reference URL");
  const f = await setup(page, false),
    native = await page.context().newPage();
  const text = "[Review](https://github.com/OpenAI/Codex/pull/42)";
  try {
    f.fixture.threads[0].turns = [
      {
        id: "github-icon",
        status: "completed",
        items: [
          {
            type: "agentMessage",
            id: "github-icon-message",
            text,
            phase: "final_answer",
          },
        ],
      },
    ] as never;
    await page.reload();
    await renderNativeMarkdownReference(native, reference!, text, "dark", 700);
    const product = page
        .locator(".codex-markdown")
        .getByRole("link", { name: "Review", exact: true }),
      original = native.getByRole("link", { name: "Review", exact: true });
    await expect(product).toBeVisible();
    await expect(original).toBeVisible();
    expect(await product.locator("img").count()).toBe(0);
    const paths = (link: Locator) =>
      link
        .locator("svg path")
        .evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
    expect(await paths(product)).toEqual(await paths(original));
    await product.focus();
    await original.focus();
    await expect(page.locator(".codex-native-github-preview")).toHaveCount(0);
    await expect(page.getByRole("tooltip")).toContainText(
      "https://github.com/OpenAI/Codex/pull/42",
    );
    await page.screenshot({
      path: info.outputPath("product-github-gate-off.png"),
    });
    await native.screenshot({
      path: info.outputPath("native-github-gate-off.png"),
    });
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await native.close();
    await f.close();
  }
});
test("GitHub native tooltip keyboard dismissal focus boundary", async ({
  page,
}, info) => {
  test.skip(!reference, "Set native reference URL");
  await renderNativeMarkdownReference(page, reference!, "ready", "dark", 700);
  await page.evaluate(async () => {
    const S = await import(
      /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
    );
    S.Ab();
    const w = window as any,
      R = w.nativeModules.React;
    w.renderNativeElement(S._, {
      children: R.createElement(
        S.H,
        {},
        R.createElement(
          S.kb,
          {
            href: "https://github.com/OpenAI/Codex/pull/42",
            pullRequest: {
              hostname: "github.com",
              owner: "OpenAI",
              repository: "Codex",
              number: 42,
            },
          },
          R.createElement(
            "a",
            { href: "https://github.com/OpenAI/Codex/pull/42" },
            "Review PR",
          ),
        ),
      ),
    });
  });
  const trigger = page.getByRole("link", { name: "Review PR", exact: true });
  await trigger.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "打开网站" })).toBeFocused();
  await page.screenshot({
    path: info.outputPath("native-github-keyboard.png"),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await writeFile(
    info.outputPath("native-dismissal-focus.json"),
    JSON.stringify(
      await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent,
      })),
      null,
      2,
    ),
  );
});
async function measure(card: Locator) {
  return card.evaluate((root) => {
    const b = root.getBoundingClientRect();
    const field = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e);
      return {
        x: r.x - b.x,
        y: r.y - b.y,
        width: r.width,
        height: r.height,
        font: s.font,
        color: s.color,
        text: e.textContent,
        clamp: s.webkitLineClamp,
      };
    };
    return {
      width: b.width,
      height: b.height,
      title: field(root.querySelector("h3")),
      description: field(root.querySelector("p")),
      icon: root.querySelector("svg")?.outerHTML,
      symbol: field(root.querySelector("svg")),
    };
  });
}
for (const width of [390, 700])
  for (const theme of ["dark", "light"])
    test(`GitHub PR native states and keyboard (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Set native reference URL");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const f = await setup(page, false),
        native = await page.context().newPage();
      try {
        await page.evaluate(
          (theme) =>
            localStorage.setItem(
              "kanban.session.theme-storage",
              JSON.stringify({
                version: 1,
                state: { theme, accent: "default" },
              }),
            ),
          theme,
        );
        await page.reload();
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor();
        await native.setViewportSize({ width, height: 900 });
        await native.emulateMedia({ reducedMotion: "reduce" });
        await renderNativeMarkdownReference(
          native,
          reference!,
          "ready",
          theme,
          width,
        );
        const href = "https://github.com/OpenAI/Codex/pull/42/files",
          pullRequest = {
            hostname: "github.com",
            owner: "OpenAI",
            repository: "Codex",
            number: 42,
          };
        const title =
          "Fix account routing and preserve the previous session while reviewing concurrent pull request changes";
        const measurements = [];
        for (const state of [
          "unavailable",
          "draft",
          "open",
          "closed",
          "merged",
        ]) {
          await native.evaluate(
            async ({ href, pullRequest, state, title }) => {
              const S = await import(
                /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
              );
              S.Mb();
              const w = window as any,
                R = w.nativeModules.React;
              document.getElementById("root")!.style.cssText =
                "width:360px;padding:0;margin:16px";
              w.renderNativeElement(S._, {
                children: R.createElement(S.jb, {
                  href,
                  pullRequest,
                  data:
                    state === "unavailable" ? null : { title, status: state },
                }),
              });
            },
            { href, pullRequest, state, title },
          );
          await page.evaluate(
            async ({ href, state, title }) => {
              const module = (path: string) =>
                import(
                  performance
                    .getEntriesByType("resource")
                    .findLast((e) => new URL(e.name).pathname === path)?.name ??
                    path
                );
              const w = window as any,
                rm = await import(w.__sessionFixtureDependency("react.js")),
                dm = await import(
                  w.__sessionFixtureDependency("react-dom_client.js")
                ),
                R = rm.default ?? rm;
              const { NativeGithubPreview, NativeGithubPreviewHost } =
                await module(
                  "/src/session-mode/components/codex/presentation/NativeGithubPreview.tsx",
                );
              w.githubPreviewRoot?.unmount();
              document.getElementById("github-preview-fixture")?.remove();
              const container = document.createElement("div");
              container.id = "github-preview-fixture";
              container.style.cssText =
                "position:fixed;left:16px;top:16px;z-index:100";
              document.querySelector(".session-mode")!.append(container);
              const transport =
                state === "unavailable"
                  ? null
                  : {
                      identity: () => "isolated-account",
                      read: async () => ({
                        structuredContent: {
                          base: "main",
                          head: "fix",
                          number: 42,
                          state: state === "draft" ? "open" : state,
                          title,
                          draft: state === "draft",
                          merged: state === "merged",
                        },
                      }),
                    };
              w.githubPreviewRoot = (dm.default ?? dm).createRoot(container);
              w.githubPreviewRoot.render(
                R.createElement(
                  NativeGithubPreviewHost.Provider,
                  { value: { enabled: true, transport } },
                  R.createElement(
                    NativeGithubPreview,
                    { href },
                    R.createElement("a", { href }, "Review PR"),
                  ),
                ),
              );
            },
            { href, state, title },
          );
          const trigger = page.getByRole("link", {
            name: "Review PR",
            exact: true,
          });
          await trigger.focus();
          const product = page.locator(".codex-native-github-preview"),
            original = native.locator('[class~="w-90"]');
          await expect(product.locator("p")).toContainText(
            "OpenAI/Codex · #42",
          );
          await expect(original.locator("p")).toContainText(
            "OpenAI/Codex · #42",
          );
          if (state !== "unavailable") {
            await expect(product.locator("h3")).toHaveText(title);
            await expect(original.locator("h3")).toHaveText(title);
          }
          await page.keyboard.press("Tab");
          await expect(
            page.getByRole("link", { name: "打开网站" }),
          ).toBeFocused();
          await page.screenshot({
            path: info.outputPath(`product-${state}.png`),
          });
          await native.screenshot({
            path: info.outputPath(`native-${state}.png`),
          });
          const actual = await measure(product),
            expected = await measure(original);
          measurements.push({ state, actual, expected });
          await writeFile(
            info.outputPath("geometry.json"),
            JSON.stringify(measurements, null, 2),
          );
          expect(actual.width).toBe(expected.width);
          expect(actual.height).toBe(expected.height);
          expect(actual.title).toEqual(expected.title);
          expect(actual.description).toEqual(expected.description);
          expect(actual.symbol).toEqual(expected.symbol);
          const actualPaths = await product
            .locator("svg")
            .first()
            .locator("path")
            .evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
          const expectedPaths = await original
            .locator("svg")
            .first()
            .locator("path")
            .evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
          expect(actualPaths).toEqual(expectedPaths);
          await page.keyboard.press("Escape");
          await expect(product).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
        expect(f.errors).toEqual([]);
        expect(f.calls).toEqual([]);
      } finally {
        await native.close();
        await f.close();
      }
    });
