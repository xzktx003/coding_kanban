import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
async function details(card: Locator) {
  return card.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    const field = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect(),
        s = getComputedStyle(element);
      return {
        width: r.width,
        height: r.height,
        x: r.x - origin.x,
        y: r.y - origin.y,
        font: s.font,
        color: s.color,
        text: element.textContent,
        clamp: s.webkitLineClamp,
      };
    };
    return {
      width: origin.width,
      height: origin.height,
      title: field(root.querySelector("h3")),
      description: field(root.querySelector("p")),
    };
  });
}

for (const width of [390, 700])
  for (const theme of ["dark", "light"])
    for (const kind of ["profile", "message"])
      test(`Slack matched content from controlled MCP fields (${width}, ${theme}, ${kind})`, async ({
        page,
      }, info) => {
        test.skip(!reference, "Set original native reference URL");
        test.setTimeout(90000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const f = await setup(page, false),
          native = await page.context().newPage();
        const title =
          kind === "profile"
            ? "Alice Chen · Infrastructure and Reliability Engineering"
            : null;
        const description =
          "The deployment review checks ownership, concurrency, routing, rollback and memory boundaries before the next release. Keep the current agent and its worktree running.";
        const href =
          kind === "profile"
            ? "https://team.slack.com/team/U123"
            : "https://team.slack.com/archives/C123/p1700000000000000";
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
          await native.evaluate(
            async ({ href, title, description }) => {
              const S = await import(
                /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
              );
              S.Wb();
              const w = window as any,
                R = w.nativeModules.React;
              // D3 normally lives in the portal, outside the padded Markdown root.
              // Give the isolated content the actual native popup's 360px constraint.
              document.getElementById("root")!.style.cssText =
                "width:360px;padding:0;margin:16px";
              w.renderNativeElement(S._, {
                children: R.createElement(S.Ub, {
                  href,
                  data: { status: "ready", title, description },
                }),
              });
            },
            { href, title, description },
          );
          await page.evaluate(
            async ({ href, title, description, theme }) => {
              const module = (path: string) =>
                import(
                  performance
                    .getEntriesByType("resource")
                    .findLast((e) => new URL(e.name).pathname === path)?.name ??
                    path
                );
              const rm = await import(
                  (window as any).__sessionFixtureDependency("react.js")
                ),
                dm = await import(
                  (window as any).__sessionFixtureDependency(
                    "react-dom_client.js",
                  )
                );
              const R = rm.default ?? rm,
                { createRoot } = dm.default ?? dm;
              const { NativeSlackPreview, NativeSlackPreviewHost } =
                await module(
                  "/src/session-mode/components/codex/presentation/NativeSlackPreview.tsx",
                );
              const container = document.createElement("div");
              container.id = "slack-content-fixture";
              container.style.cssText =
                "position:fixed;left:16px;top:16px;z-index:100";
              document.querySelector(".session-mode")!.append(container);
              const response = title
                ? {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify({
                          result: `User ID: U123\nReal Name: ${title}\nTitle: ${description}`,
                        }),
                      },
                    ],
                  }
                : {
                    structuredContent: {
                      slack_data: {
                        schema_version: 1,
                        ok: true,
                        channel_id: "C123",
                        message_ts: "1700000000.000000",
                        messages: [
                          { ts: "1700000000.000000", text: description },
                        ],
                      },
                    },
                  };
              const host = {
                identity: () => "isolated-field-fixture",
                read: async (
                  _target: unknown,
                  signal: AbortSignal,
                  check: () => void,
                ) => {
                  check();
                  if (signal.aborted) throw new Error("aborted");
                  return response;
                },
              };
              createRoot(container).render(
                R.createElement(
                  NativeSlackPreviewHost.Provider,
                  { value: host },
                  R.createElement(
                    NativeSlackPreview,
                    { href },
                    R.createElement("a", { href }, "Slack content"),
                  ),
                ),
              );
            },
            { href, title, description, theme },
          );
          await page
            .getByRole("link", { name: "Slack content", exact: true })
            .focus();
          const product = page.locator(".codex-native-slack-preview"),
            original = native.locator('[class~="w-90"]');
          await expect(product.locator("p")).toHaveText(description);
          await expect(original.locator("p")).toHaveText(description);
          const actual = await details(product),
            expected = await details(original);
          await writeFile(
            info.outputPath("content-geometry.json"),
            JSON.stringify(
              {
                actual,
                expected,
                boundary:
                  "Controlled valid MCP fields; no real account, directory or remote tool call.",
              },
              null,
              2,
            ),
          );
          await page.screenshot({
            path: info.outputPath("product-slack-content.png"),
          });
          await native.screenshot({
            path: info.outputPath("native-slack-content.png"),
          });
          expect(actual).toEqual(expected);
          expect(f.errors).toEqual([]);
          expect(f.calls).toEqual([]);
        } finally {
          await native.close();
          await f.close();
        }
      });
