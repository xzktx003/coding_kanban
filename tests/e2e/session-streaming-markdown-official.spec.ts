import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";

// An explicit installed extension supplies read-only assets. The browser's
// synthetic origin cannot reach an account, IPC, or any other network host.
const assets = process.env.CODEX_VSIX_ORACLE_ASSETS;
const files = {
  initial: "app-initial-13f932cb2f13.js",
  scope: "app-scope-2dce3358324c.js",
  markdown: "chatgpt-markdown-view-f3ebe0eb574c.js",
};

test("the installed official renderer keeps formatting across reference updates", async ({
  page,
}, info) => {
  test.skip(
    !assets,
    "Set CODEX_VSIX_ORACLE_ASSETS to the inspected 26.1021.22027 webview assets",
  );
  test.setTimeout(60_000);
  const hashes = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, file]) => [
        name,
        createHash("sha256")
          .update(await readFile(join(assets!, file)))
          .digest("hex"),
      ]),
    ),
  );
  await page.addInitScript(() => {
    (window as any).acquireVsCodeApi = () => ({
      postMessage() {},
      getState() {
        return null;
      },
      setState() {},
    });
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://oracle.invalid") return route.abort();
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    const name = url.pathname.startsWith("/assets/")
      ? url.pathname.slice(8)
      : "";
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || basename(name) !== name)
      return route.abort();
    try {
      const body = await readFile(join(assets!, name));
      return route.fulfill({
        body,
        contentType: name.endsWith(".js")
          ? "text/javascript"
          : name.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
      });
    } catch {
      return route.abort();
    }
  });
  await page.goto("https://oracle.invalid/");
  await page.evaluate(async (entry) => {
    const app = await import(`/assets/${entry.initial}`);
    const scope = await import(`/assets/${entry.scope}`);
    const markdown = await import(`/assets/${entry.markdown}`);
    scope.n();
    const react = app.rS();
    const root = app.gm().createRoot(document.getElementById("root"), {
      onUncaughtError: (error: Error) => {
        (window as any).__oracleError = String(error);
      },
    });
    (window as any).__renderOfficial = (text: string, streaming: boolean) =>
      root.render(
        react.createElement(
          scope.d,
          { scope: scope.t, value: {} },
          react.createElement(markdown.ChatGptMarkdown, {
            isStreaming: streaming,
            renderCodeBlocksImmediately: true,
            children: text,
          }),
        ),
      );
  }, files);
  const complete =
    "**标题**\n\n查看 [资料][来源]\n\n[来源]: https://example.test";
  const stages = [
    { text: "**标题**\n\n查看 [资料]", streaming: true },
    { text: "**标题**\n\n查看 [资料][来源]", streaming: true },
    { text: complete, streaming: true },
    { text: complete, streaming: false },
  ];
  const observed = [];
  for (const stage of stages) {
    await page.evaluate(
      ({ text, streaming }) =>
        (window as any).__renderOfficial(text, streaming),
      stage,
    );
    await page.waitForTimeout(180);
    observed.push(
      await page.locator("#root").evaluate((node) => ({
        text: node.textContent,
        strong: [...node.querySelectorAll("strong")].map(
          (element) => element.textContent,
        ),
        links: [...node.querySelectorAll("a")].map((element) => ({
          text: element.textContent,
          href: element.href,
        })),
      })),
    );
  }
  expect(
    await page.evaluate(() => (window as any).__oracleError ?? null),
  ).toBeNull();
  expect(observed.map((stage) => stage.strong)).toEqual([
    ["标题"],
    ["标题"],
    ["标题"],
    ["标题"],
  ]);
  expect(observed[0].text).not.toContain("[资料]");
  expect(observed[1].text).toContain("[资料][来源]");
  expect(observed[2].text).toContain("[资料][来源]");
  expect(observed[3].links).toContainEqual({
    text: "资料",
    href: "https://example.test/",
  });
  const evidence = info.outputPath("official-markdown-oracle.json");
  await writeFile(
    evidence,
    JSON.stringify(
      { version: "26.1021.22027", hashes, stages: observed },
      null,
      2,
    ),
  );
  await info.attach("official-markdown-oracle.json", {
    path: evidence,
    contentType: "application/json",
  });
});
