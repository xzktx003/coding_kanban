import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { viteDocumentContinuity } from "../../scripts/vite-document-continuity.mjs";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(webRequire.resolve("vite")).href
);
const { default: react } = await import(
  pathToFileURL(webRequire.resolve("@vitejs/plugin-react")).href
);

const original = `import { useState } from 'react';
export default function App() {
  const [count] = useState(0);
  return <main><span data-testid="version">old-{count}</span>
    {!location.search.includes('no-frame') && <iframe title="ChatGPT Codex 工作区" src="/frame.html" />}</main>;
}`;
const changed = `import { useState } from 'react';
export default function App() {
  const [count] = useState(0);
  const [addedHook] = useState('new');
  return <main><span data-testid="version">{addedHook}-{count}</span>
    {!location.search.includes('no-frame') && <iframe title="ChatGPT Codex 工作区" src="/frame.html" />}</main>;
}`;

test("a potentially destructive React refresh preserves the old document and gives new pages the update", async ({
  page,
  context,
}, info) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), "chatgpt-document-guard-"));
  const notice = await readFile(
    resolve("apps/web/src/components/WorkbenchUpdateNotice.tsx"),
    "utf8",
  );
  await Promise.all([
    writeFile(
      join(root, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>',
    ),
    writeFile(
      join(root, "main.jsx"),
      "import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx'; import {WorkbenchUpdateNotice} from './WorkbenchUpdateNotice'; createRoot(document.getElementById('root')).render(<><WorkbenchUpdateNotice/><App/></>);",
    ),
    writeFile(join(root, "App.jsx"), original),
    writeFile(join(root, "WorkbenchUpdateNotice.tsx"), notice),
    writeFile(join(root, "style.css"), "body { color: rgb(1, 2, 3); }"),
    writeFile(
      join(root, "frame.html"),
      '<!doctype html><html><body><textarea aria-label="fixture composer"></textarea></body></html>',
    ),
    symlink(
      resolve("apps/web/node_modules"),
      join(root, "node_modules"),
      "dir",
    ),
  ]);
  const plugin =
    process.env.CHATGPT_HMR_GUARD_BASELINE === "1"
      ? viteDocumentContinuity()
      : (
          await import("../../scripts/vite-chatgpt-document-continuity.mjs")
        ).viteChatgptDocumentContinuity();
  let frameRequests = 0;
  const countFrames = {
    name: "fixture-frame-count",
    configureServer(server: any) {
      server.middlewares.use(
        (request: any, _response: any, next: () => void) => {
          if (request.url?.split("?")[0] === "/frame.html") frameRequests++;
          next();
        },
      );
    },
  };
  const server = await createServer({
    configFile: false,
    envFile: false,
    root,
    cacheDir: join(root, ".vite"),
    plugins: [countFrames, react(), plugin],
    server: {
      host: "0.0.0.0",
      port: 0,
      watch: { usePolling: true, interval: 50 },
    },
    logLevel: "error",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await server.listen();
    const lan = Object.values(networkInterfaces())
      .flat()
      .find(
        (address) => address?.family === "IPv4" && !address.internal,
      )?.address;
    expect(lan).toBeTruthy();
    const url = `http://${lan}:${(server.httpServer!.address() as { port: number }).port}`;
    await page.goto(url);
    const frame = page.locator('iframe[title="ChatGPT Codex 工作区"]');
    await frame.waitFor();
    const composer = page.frameLocator("iframe").getByLabel("fixture composer");
    await composer.fill("fixture-unsent-draft");
    const originalFrame = await frame.elementHandle();
    const originalDocument = await frame.evaluateHandle(
      (element: HTMLIFrameElement) => element.contentDocument,
    );
    const noFramePage = await context.newPage();
    await noFramePage.goto(`${url}/?no-frame`);
    await expect(noFramePage.getByTestId("version")).toHaveText("old-0");

    // An ordinary CSS-only update stays live until there is a blocked update.
    await writeFile(join(root, "style.css"), "body { color: rgb(4, 5, 6); }");
    await expect
      .poll(() =>
        page.locator("body").evaluate((body) => getComputedStyle(body).color),
      )
      .toBe("rgb(4, 5, 6)");
    await expect(page.getByText("界面有更新，可在方便时刷新。")).toHaveCount(0);

    const before = frameRequests;
    await writeFile(join(root, "App.jsx"), changed);
    // In the unprotected baseline, the changed hook signature replaces the iframe.
    await page.waitForFunction(
      (oldFrame) =>
        document.documentElement.dataset.workbenchUpdatePending === "true" ||
        document.querySelector('iframe[title="ChatGPT Codex 工作区"]') !==
          oldFrame,
      originalFrame,
    );
    expect(
      await frame.evaluate(
        (element, oldFrame) => element === oldFrame,
        originalFrame,
      ),
    ).toBe(true);
    await expect(page.getByText("界面有更新，可在方便时刷新。")).toBeVisible();
    await expect(
      noFramePage.getByText("界面有更新，可在方便时刷新。"),
    ).toBeVisible();
    expect(
      await frame.evaluate(
        (element: HTMLIFrameElement, oldDocument) =>
          element.contentDocument === oldDocument,
        originalDocument,
      ),
    ).toBe(true);
    await expect(composer).toHaveValue("fixture-unsent-draft");
    expect(frameRequests).toBe(before);
    await expect(page.getByTestId("version")).toHaveText("old-0");

    const fresh = await context.newPage();
    await fresh.goto(`${url}/?no-frame`);
    await expect(fresh.getByTestId("version")).toHaveText("new-0");
    await expect(fresh.getByText("界面有更新，可在方便时刷新。")).toHaveCount(
      0,
    );
    // Only an explicit gesture refreshes an existing document.
    await noFramePage.getByRole("button", { name: "刷新界面" }).click();
    await expect(noFramePage.getByTestId("version")).toHaveText("new-0");
    await expect(composer).toHaveValue("fixture-unsent-draft");
    expect(errors).toEqual([]);
    await info.attach("guard-boundary.json", {
      body: JSON.stringify({
        url,
        frameRequests,
        noAutomaticNavigation: true,
        sameFrame: true,
        sameDocument: true,
        retainedDraft: true,
        freshPageUsesNewCode: true,
      }),
      contentType: "application/json",
    });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
