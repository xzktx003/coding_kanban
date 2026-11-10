// Pixel-diff comparison pipeline for the isolated official Codex webview.
//
// Baseline: openai.chatgpt 26.51021.22027, pinned by scripts/codex-goal-reference-server.mjs
// (read-only, no login, no IPC, never starts Codex). The reference server is (re)started
// here so a stale/old official build (e.g. 26.1021.22027 or 26.51007.21434) is rejected at
// startup instead of silently becoming the "oracle". See assertPixelParity helpers.
//
// Evidence tier: O-C (real official webview, mocked acquireVsCodeApi). NOT O-F. Do not
// upgrade a green O-C comparison to a full-host parity claim.

import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  startReferenceServer,
  openOfficialHomeComposer,
  openOfficialWebview,
  assertPixelParity,
  saveEvidence,
  PIXEL_BASELINE_DIR,
  PIXEL_ARTIFACT_DIR,
  type ReferenceServer,
} from "./codex-pixel-harness";

let ref: ReferenceServer;

test.beforeAll(async () => {
  ref = await startReferenceServer();
  await mkdir(PIXEL_ARTIFACT_DIR, { recursive: true });
  await mkdir(PIXEL_BASELINE_DIR, { recursive: true });
  await saveEvidence("reference-identity", {
    version: ref.version,
    urls: ref.urls,
    base: ref.base,
  });
});

test.afterAll(async () => {
  await ref?.stop();
});

test("reference server serves only the pinned 26.51021.22027 build", async () => {
  expect(ref.version).toBe("26.51021.22027");
  const identity = await (await fetch(`${ref.base}/reference.json`)).json();
  expect(identity.version).toBe("26.51021.22027");
  // A wrong build is rejected at startup (version/hash mismatch) by the server, so reaching
  // this point already proves we are driving the pinned build, not a stale one.
});

test("official 26.51021.22027 webview boot shell stays pixel-stable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOfficialWebview(page, ref.base);
  // First run stores the baseline; later runs turn red when the official build's boot
  // shell pixels change. This is the "red before green" pixel parity gate.
  await assertPixelParity(page, "#root", "official-26.51021.22027-native-app-boot.png", {
    maxDiffPixels: 24,
  });
  await saveEvidence("official-boot-shell", {
    version: ref.version,
    booted: await page.evaluate(() => (window as any).nativeAppBooted === true),
    body: await page.evaluate(() =>
      (document.getElementById("root")?.textContent ?? "").slice(0, 80),
    ),
  });
});

test("official logged-out home composer reaches a stable empty state", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await expect(page.getByRole("button", { name: "Custom Medium" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Do anything" })).toBeVisible();
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
  await assertPixelParity(
    page,
    "#root",
    "official-26.51021.22027-home-composer.png",
    { maxDiffPixels: 32 },
  );
  await saveEvidence("official-home-composer-methods", {
    methods: await page.evaluate(() => (window as any).__officialRpcMethods?.() ?? []),
  });
  await saveEvidence("official-home-composer-banner", {
    nodes: await page.evaluate(() => {
      const root = document.querySelector("[aria-label='Dismiss subagent banner']")?.closest("aside");
      const describe = (element: Element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        role: element.getAttribute("role"),
        testId: element.getAttribute("data-testid"),
        childCount: element.childElementCount,
      });
      return root
        ? [root, ...root.querySelectorAll("*")].slice(0, 24).map(describe)
        : [];
    }),
  });
  await saveEvidence("official-home-composer", {
    version: ref.version,
    text: await page.evaluate(() => document.body.innerText.trim().slice(0, 240)),
    inputs: await page.locator("textarea,[contenteditable='true']").count(),
  });
});

test("official subagent banner shows its delegate copy", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await expect(page.getByText("Subagents in Codex", { exact: true })).toBeVisible();
  await expect(page.getByText("Delegate work to subagents that work in parallel. Note: may increase token usage.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try now", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss subagent banner", exact: true })).toBeVisible();
});

test("official permission button shows the current mode without a tooltip", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const button = page.getByRole("button", { name: "Change permissions" });
  await expect(button).toHaveText("Ask for approval");
  await expect(button).not.toHaveAttribute("title", /.+/);
});

test("official IDE button shows its context label", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await expect(page.getByRole("button", { name: "Turn off IDE context" })).toHaveText("IDE context");
});

test("official new-chat button is icon only", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const button = page.getByRole("button", { name: "New chat", exact: true });
  await expect(button).toHaveText("");
  await expect(button).not.toHaveAttribute("title", /.+/);
});

test("official recent-chats button separates its visible label", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const button = page.getByRole("button", { name: "Recent chats. 0 in progress" });
  await expect(button).toHaveText("No chats in progress");
  await expect(button).not.toHaveAttribute("title", /.+/);
});

test("official empty recent chats uses a search menu", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Recent chats. 0 in progress" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search recent chats" })).toBeVisible();
  await expect(page.getByText("No chats yet", { exact: true })).toBeVisible();
});

test("official recent-chats menu closes without retaining its query", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Recent chats. 0 in progress" }).click();
  await expect(page.getByText("No chats yet")).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search recent chats" });
  await search.fill("fixture");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Search recent chats" })).toHaveCount(0);
  expect(page.url()).toBe(before);
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
});

test("official add-files menu offers only files, goal and sketch", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await expect(page.getByText("Files and folders")).toBeVisible();
  await expect(page.getByText("Set a goal to keep pursuing")).toBeVisible();
  await expect(page.getByText("Draw a sketch")).toBeVisible();
  await expect(page.getByText("Photos", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Web search", { exact: true })).toHaveCount(0);
  await page.getByText("Goal", { exact: true }).click();
  expect(page.url()).toBe(before);
  await expect(page.getByRole("textbox", { name: "Describe your goal, define measurable outcomes for best results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear goal" })).toBeVisible();
});

test("official files action reports a picker failure without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Files and folders", { exact: true }).click();
  await expect(page.getByText("Unable to open file picker")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official sketch open reads the root skill scope once", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.getByText("Sketch editor")).toBeVisible();
  const skill = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).find((entry: { method: string }) => entry.method === "skills/list"));
  expect(skill).toEqual({ method: "skills/list", count: 1, params: { cwds: ["/"] } });
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).not.toContain("thread/start");
});

test("official sketch action opens its editor without leaving home", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  expect(page.url()).toBe(before);
  await expect(page.getByText("Sketch editor")).toBeVisible();
  await expect(page.getByText("Ink color")).toBeVisible();
  await expect(page.getByText("Choose a custom color")).toBeVisible();
});

test("official empty sketch keeps attach disabled and close returns home", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Attach sketch", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close sketch editor", exact: true }).click();
  await expect(page.getByText("Sketch editor")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).not.toContain("thread/start");
});

test("official sketch shape menu opens a dialog", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await expect(shapes).toHaveAttribute("aria-expanded", "true");
  await expect(shapes).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.getByRole("dialog", { name: "Shapes", exact: true })).toBeVisible();
});

test("official sketch line choice presses shapes and closes its dialog", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(shapes).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "Shapes", exact: true })).toHaveCount(0);
});

test("official sketch shape button closes its dialog without clearing the tool", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await shapes.click();
  await shapes.click();
  await expect(shapes).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "Shapes", exact: true })).toHaveCount(0);
});

test("official sketch pen clears the selected shape", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(shapes).toHaveAttribute("aria-pressed", "false");
});

test("official sketch text and eraser clear the selected shape", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(shapes).toHaveAttribute("aria-pressed", "false");
  await shapes.click();
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await expect(page.getByRole("button", { name: "Eraser", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(shapes).toHaveAttribute("aria-pressed", "false");
});

test("official sketch pen closes an open shape dialog", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await expect(page.getByRole("dialog", { name: "Shapes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "Shapes", exact: true })).toHaveCount(0);
  await expect(shapes).toHaveAttribute("aria-expanded", "false");
});

test("official sketch shape choices are icon buttons", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await page.getByRole("button", { name: "Shapes", exact: true }).click();
  for (const name of ["Line", "Arrow", "Rectangle", "Ellipse"]) {
    const item = page.getByRole("button", { name, exact: true });
    await expect(item).toBeVisible();
    await expect(item).toHaveText("");
    await expect(item).toHaveAttribute("title", name);
  }
});

test("official sketch eraser becomes pressed without leaving home", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const eraser = page.getByRole("button", { name: "Eraser", exact: true });
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official sketch exposes its primary tools", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  for (const name of ["Select", "Pen", "Text", "Shapes", "Eraser", "Undo", "Redo", "Close sketch editor"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach sketch", exact: true })).toBeDisabled();
});

test("official empty sketch starts with undo and redo disabled", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});

test("official sketch keeps white ink separate from the purple custom picker", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Use white", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('input[type="color"]')).toHaveValue("#a855f7");
  await expect(page.locator('input[type="color"]')).not.toHaveAttribute("aria-pressed", "true");
});

test("official sketch starts with pen, white, and disabled history", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Use white", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});

test("official sketch stroke width has no visible caption", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.getByRole("slider", { name: "Stroke width", exact: true })).toBeVisible();
  await expect(page.getByText("Stroke width", { exact: true })).toHaveCount(0);
});

test("official sketch stroke width starts at twelve", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const slider = page.getByRole("slider", { name: "Stroke width", exact: true });
  await expect(slider).toHaveAttribute("aria-valuemin", "2");
  await expect(slider).toHaveAttribute("aria-valuemax", "48");
  await expect(slider).toHaveAttribute("aria-valuenow", "12");
  await expect(slider).toHaveText("");
  await expect(slider).not.toHaveAttribute("title", /.+/);
});

test("official home exposes only the subagent dismiss control", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await expect(page.getByRole("button", { name: "Dismiss subagent banner", exact: true })).toBeVisible();
  for (const name of ["Close", "Back", "Exit"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});

test("official sketch primary tools keep their hover titles", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  for (const name of ["Select", "Pen", "Text", "Shapes", "Eraser", "Undo", "Redo"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveText("");
    await expect(button).toHaveAttribute("title", name);
  }
});

test("official sketch shape button is icon only", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const shapes = page.getByRole("button", { name: "Shapes", exact: true });
  await expect(shapes).toHaveText("");
  await expect(shapes).toHaveAttribute("title", "Shapes");
});

test("official sketch has no zoom controls", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await page.getByRole("button", { name: "Pen", exact: true }).waitFor();
  for (const name of ["Zoom in", "Zoom out", "Reset view", "Fit"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});

test("official sketch primary toolbar excludes extra tools", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  for (const name of ["Pan", "Hand", "Comment", "Zoom in", "Zoom out"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toBeVisible();
});

test("official sketch close and attach report their labels", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  for (const name of ["Close sketch editor", "Attach sketch"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("title", name);
  }
  await expect(page.getByRole("button", { name: "Attach sketch", exact: true })).toHaveText("");
});

test("official sketch color buttons report their hover titles", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  for (const name of ["Use white", "Use purple", "Use pink"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveText("");
    await expect(button).not.toHaveAttribute("title", /.+/);
  }
});

test("official sketch exposes thirteen preset colors", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  for (const name of ["Use white", "Use gray", "Use brown", "Use red", "Use orange", "Use yellow", "Use green", "Use teal", "Use cyan", "Use blue", "Use indigo", "Use purple", "Use pink"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("official sketch custom color names itself from its label", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.locator('input[type="color"]')).toHaveAccessibleName("Choose a custom color");
});

test("official sketch custom color has no visible label", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  const input = page.locator('input[type="color"]');
  await expect(input).toHaveValue("#a855f7");
  await expect(input).not.toHaveAttribute("title", /.+/);
  await expect(page.getByText("Color", { exact: true })).toHaveCount(0);
});

test("official sketch starts with the purple custom color", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Sketch", { exact: true }).click();
  await expect(page.locator('input[type="color"]')).toHaveValue("#a855f7");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official permission menu shows approval choices without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Change permissions" }).click();
  await expect(page.getByText("How should Codex actions be approved?")).toBeVisible();
  await expect(page.getByText("Learn more")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Ask for approval/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Full access/ })).toBeVisible();
  expect(page.url()).toBe(before);
});

test("official permission descriptions are visible before Learn more", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Change permissions" }).click();
  await expect(page.getByText("Always ask to edit external files and use the internet")).toBeVisible();
  await expect(page.getByText("Unrestricted access to the internet and any file on your computer")).toBeVisible();
  await page.getByText("Learn more", { exact: true }).click();
  await expect(page.getByText("Always ask to edit external files and use the internet")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
});

test("official logged-out effort starts at level three of six", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Custom Standard, 3 of 6." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select effort" }).first()).toHaveAttribute("data-selected-reasoning-effort", "medium");
});

test("official closed model button shows custom and medium", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const button = page.getByRole("button", { name: "Custom Medium" });
  await expect(button).toContainText("Custom");
  await expect(button).toContainText("Medium");
  await expect(button).not.toHaveAttribute("title", /.+/);
});

test("official model shortcut opens the model menu without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.keyboard.press("Control+Shift+KeyM");
  await expect(page.getByRole("menuitem", { name: "Select model" })).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official home IDE context opens the model shortcut without an IDE panel", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Turn off IDE context" }).click();
  await expect(page.getByRole("tooltip", { name: "Select effort Ctrl+Shift+M" })).toBeVisible();
  await expect(page.getByText("Custom", { exact: true })).toBeVisible();
  await expect(page.getByText("Medium", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official IDE context click exposes the model shortcut without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await page.getByRole("button", { name: "Turn off IDE context" }).click();
  await expect(page.getByText("Ctrl+Shift+M")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official model menu opens without changing the logged-out page", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await expect(page.getByRole("button", { name: "Select effort" }).first()).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Select model" })).toBeVisible();
  await expect(page.getByText("IDE context").first()).toBeVisible();
  expect(page.url()).toBe(before);
});

test("official locked model labels stay descriptive without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await page.getByRole("menuitem", { name: "Select model" }).click();
  await expect(page.getByText("Locked, opens access options")).toBeVisible();
  await expect(page.getByText("Usage limit reached")).toBeVisible();
  await expect(page.getByRole("button", { name: /Locked|Usage limit/ })).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official select-model item shows only the locked logged-out state", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await page.getByRole("menuitem", { name: "Select model" }).click();
  await expect(page.getByText("Custom Standard, 3 of 6.")).toBeVisible();
  await expect(page.getByText("Use Left and Right arrow keys to adjust power")).toBeVisible();
  await expect(page.getByText("Locked, opens access options")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official effort control stays on the selected medium level", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  const effort = page.getByRole("button", { name: "Select effort" }).first();
  await expect(effort).toHaveAccessibleName("Select effort");
  await expect(effort).toHaveAttribute("data-selected-reasoning-effort", "medium");
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official power item advances one level without leaving home", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await page.getByRole("menuitem", { name: "Power" }).click();
  await expect(page.getByText("Custom Extended, 4 of 6.")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official unnamed header opens settings and shortcuts", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  const target = page.locator("button").filter({ hasText: /^$/ }).first();
  await target.hover();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  await target.click();
  await expect(page.getByText("Codex settings")).toBeVisible();
  await expect(page.getByText("Keyboard shortcuts")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official goal open reads the root skill scope once", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Goal", { exact: true }).click();
  await page.getByRole("button", { name: "Clear goal" }).waitFor();
  const skill = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).find((entry: { method: string }) => entry.method === "skills/list"));
  expect(skill).toEqual({ method: "skills/list", count: 1, params: { cwds: ["/"] } });
});

test("official goal open reads skills without starting a thread", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Goal", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear goal" })).toBeVisible();
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).toContain("skills/list");
  expect(methods).not.toContain("thread/start");
  expect(page.url()).toBe(before);
});

test("official goal Enter opens the workspace dialog without starting a thread", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Goal", { exact: true }).click();
  const box = page.getByRole("textbox", { name: "Describe your goal, define measurable outcomes for best results" });
  await box.fill("ship the release");
  await box.press("Enter");
  await expect(page.getByRole("dialog", { name: "Unable to send message" })).toContainText("Please open a folder or workspace to continue");
  await expect(page.locator("body")).toContainText("ship the release");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).toContain("skills/list");
  expect(methods).not.toContain("thread/start");
});

test("official clear-goal does not read skills again or start a thread", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Goal", { exact: true }).click();
  await page.getByRole("button", { name: "Clear goal" }).click();
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).filter((entry: { method: string }) => entry.method === "skills/list" || entry.method === "thread/start"));
  expect(methods).toEqual([{ method: "skills/list", count: 1, params: { cwds: ["/"] } }]);
});

test("official clear-goal returns to the empty composer", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Add files and more" }).click();
  await page.getByText("Goal", { exact: true }).click();
  await page.getByRole("button", { name: "Clear goal" }).click();
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  await expect(page.getByRole("button", { name: "Clear goal" })).toHaveCount(0);
  expect(page.url()).toBe(before);
});

test("official logged-out model menu shows the locked access state", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await expect(page.getByText("Custom Standard, 3 of 6.")).toBeVisible();
  await expect(page.getByText("Locked, opens access options")).toBeVisible();
  await expect(page.getByText("Usage limit reached")).toBeVisible();
  expect(page.url()).toBe(before);
});

test("official IDE context control stays on the logged-out page", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Custom Medium" }).click();
  await page.getByRole("button", { name: "Turn off IDE context" }).click();
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  expect(page.url()).toBe(before);
});

test("official header menu offers settings and shortcuts", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
  await expect(page.getByText("Codex settings")).toBeVisible();
  await expect(page.getByText("Keyboard shortcuts")).toBeVisible();
  expect(page.url()).toBe(before);
});

test("official Codex settings leaves only its tooltip", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
  await page.getByText("Codex settings", { exact: true }).click();
  await expect(page.getByRole("tooltip", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official Codex settings item stays on the logged-out page", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
  await page.getByText("Codex settings", { exact: true }).click();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  expect(page.url()).toBe(before);
});

test("official keyboard shortcuts leaves only the settings tooltip", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
  await page.getByText("Keyboard shortcuts", { exact: true }).click();
  await expect(page.getByRole("tooltip", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official keyboard shortcuts item opens the titled settings shell", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button").filter({ hasText: /^$/ }).first().click();
  await page.getByText("Keyboard shortcuts", { exact: true }).click();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  expect(page.url()).toBe(before);
});

test("official permission learn-more reveals descriptions without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "Change permissions" }).click();
  await page.getByText("Learn more", { exact: true }).click();
  await expect(page.getByText("Always ask to edit external files and use the internet")).toBeVisible();
  await expect(page.getByText("Unrestricted access to the internet and any file on your computer")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official new chat stays on the empty home without starting a thread", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  const methodsBefore = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Do anything" })).toBeVisible();
  const methodsAfter = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methodsAfter.filter((method: string) => !methodsBefore.includes(method))).toEqual([]);
  expect(methodsAfter).not.toContain("thread/start");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official empty home shows no running-turn hint", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  for (const hint of ["Press Enter", "Shift+Enter", "Queue", "Steer"]) await expect(page.getByText(hint)).toHaveCount(0);
});

test("official home exposes its named controls without navigation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  for (const name of [
    "Recent chats. 0 in progress",
    "New chat",
    "Try now",
    "Dismiss subagent banner",
    "Add files and more",
    "Change permissions",
    "Turn off IDE context",
    "Send",
  ]) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official empty composer names itself without a separate placeholder", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  const editor = page.getByRole("textbox", { name: "Do anything" });
  await expect(editor).toHaveText("");
  await expect(editor).not.toHaveAttribute("aria-placeholder", /.+/);
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
});

test("official home Enter opens the workspace dialog and Shift+Enter inserts a line", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const box = page.getByRole("textbox", { name: "Do anything" });
  await openOfficialHomeComposer(page, ref.base);
  await box.fill("hello");
  await box.press("Shift+Enter");
  await expect.poll(() => box.evaluate((node) => (node as HTMLElement).innerText.includes("\n"))).toBe(true);
  await openOfficialHomeComposer(page, ref.base);
  await box.fill("hello");
  await box.press("Enter");
  await expect(page.getByRole("dialog", { name: "Unable to send message" })).toBeVisible();
  await expect(page.locator("body")).toContainText("hello");
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).not.toContain("thread/start");
});

test("official workspace dialog traps tab and restores the composer", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const dialog = page.getByRole("dialog", { name: "Unable to send message" });
  await page.getByRole("button", { name: "Send" }).click();
  await dialog.waitFor();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Do anything" })).toBeFocused();
});

test("official workspace dialog initially focuses OK", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  await page.getByRole("button", { name: "Send" }).click();
  const dialog = page.getByRole("dialog", { name: "Unable to send message" });
  await expect(dialog.getByRole("button", { name: "OK", exact: true })).toBeFocused();
});

test("official workspace dialog dismiss gestures only close it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  const dialog = () => page.getByRole("dialog", { name: "Unable to send message" });
  await page.getByRole("button", { name: "Send" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog()).toHaveCount(0);
  await page.getByRole("button", { name: "Send" }).click();
  await page.mouse.click(8, 8);
  await expect(dialog()).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).not.toContain("thread/start");
});

test("official workspace dialog actions only close the dialog", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const name of ["OK", "Close dialog"]) {
    await openOfficialHomeComposer(page, ref.base);
    const before = page.url();
    await page.getByRole("button", { name: "Send" }).click();
    const dialog = page.getByRole("dialog", { name: "Unable to send message" });
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(page.context().pages()).toHaveLength(1);
    expect(page.url()).toBe(before);
  }
});

test("official content without a workspace opens the workspace dialog", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("textbox", { name: "Do anything" }).fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  const dialog = page.getByRole("dialog", { name: "Unable to send message" });
  await expect(dialog).toContainText("Please open a folder or workspace to continue");
  await expect(page.locator("body")).toContainText("hello");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
  const methods = await page.evaluate(() => ((window as any).__officialRpcMethods?.() ?? []).map((entry: { method: string }) => entry.method));
  expect(methods).not.toContain("thread/start");
});

test("official idle send button has no tooltip", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const send = page.getByRole("button", { name: "Send" });
  await send.hover();
  await expect(send).not.toHaveAttribute("title", /.+/);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("official empty send stays visually idle without creating a thread", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeEnabled();
  await expect(send).toHaveClass(/opacity-50/);
  await send.click();
  const dialog = page.getByRole("dialog", { name: "Unable to send message" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Please open a folder or workspace to continue");
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toBe(before);
  const methods = await page.evaluate(() =>
    ((window as any).__officialRpcMethods?.() ?? []).map(
      (entry: { method: string }) => entry.method,
    ),
  );
  expect(methods).not.toContain("thread/start");
});

test("official new-chat action stays within the empty composer", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOfficialHomeComposer(page, ref.base);
  const before = page.url();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  expect(page.url()).toBe(before);
  const methods = await page.evaluate(() =>
    ((window as any).__officialRpcMethods?.() ?? []).map(
      (entry: { method: string }) => entry.method,
    ),
  );
  expect(methods).not.toContain("thread/start");
});

test("official subagent banner actions stay in the current empty composer", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const name of ["Try now", "Dismiss subagent banner"]) {
    await openOfficialHomeComposer(page, ref.base);
    const before = page.url();
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name: "Try now" })).toHaveCount(0);
    expect(page.url()).toBe(before);
    await expect(page.getByRole("textbox", { name: "Do anything" })).toHaveText("");
  }
});

test("local session-mode shell pixel baseline (needs PLAYWRIGHT_BASE_URL)", async ({
  page,
}) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL;
  test.skip(
    !baseURL,
    "Set PLAYWRIGHT_BASE_URL to an isolated running session-mode frontend",
  );
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseURL}/?mode=session`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  // Own-brand baseline: catches accidental regressions in the local session shell. The
  // official-vs-local *same-state* cross diff (goal card / composer / thread item) is not
  // asserted here because driving the official webview to those states needs the host-drive
  // protocol; see the pixel-diff design doc for that extension.
  await assertPixelParity(
    page,
    ".session-mode",
    "local-26.51021.22027-session-shell.png",
    { maxDiffPixels: 24 },
  );
});
