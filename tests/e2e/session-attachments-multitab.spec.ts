import { expect, test, type Page } from "@playwright/test";

// Isolated hook UI, real browser IndexedDB and real Vite modules. No app startup,
// shared-session mutations or Agent endpoints are needed for this storage race.
const fixture = String.raw`<!doctype html><html><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
// Use the exact prebundle URLs used by the loaded hooks, including Vite's
// version query; a second React module is not a valid browser fixture.
const hookSource = await (await fetch('/src/session-mode/components/common/useImageAttachments.ts')).text();
const dialogSource = await (await fetch('/src/session-mode/browser-dialog.tsx')).text();
const reactUrl = hookSource.match(/from "([^"]*\/react.js[^\"]*)"/)[1];
const domUrl = dialogSource.match(/from "([^"]*\/react-dom_client.js[^\"]*)"/)[1];
const { createElement: h, useState } = (await import(reactUrl)).default;
const { createRoot } = (await import(domUrl)).default;
const { useImageAttachments, flushAttachmentDraft, moveImageDraft } = await import('/src/session-mode/components/common/useImageAttachments.ts');
const { loadAttachmentDraft } = await import('/src/session-mode/services/sessionAttachmentStorage.ts');
let captured = [];
function App() {
  const [owner, setOwner] = useState(new URL(location.href).searchParams.get('owner'));
  const draft = useImageAttachments(owner);
  window.attachmentFixture = {
    flush: () => flushAttachmentDraft(owner),
    read: async () => Promise.all((await loadAttachmentDraft(owner)).map(async item => ({ id: item.id, name: item.name, path: item.path, bytes: item.file ? Array.from(new Uint8Array(await item.file.arrayBuffer())) : [] })))
  };
  return h('main', {},
    h('p', { role: 'status' }, draft.hydrated ? 'Ready' : 'Loading'),
    h('input', { type: 'file', 'aria-label': 'Add photo', onChange: e => draft.addFiles(Array.from(e.target.files)) }),
    h('button', { onClick: () => { captured = draft.attachments.map(item => item.id); } }, 'Capture submission'),
    h('button', { onClick: () => draft.clear(captured) }, 'Complete submission'),
    h('button', { onClick: () => draft.clear() }, 'Remove all visible'),
    h('button', { onClick: async () => { const next = owner + ':created'; await moveImageDraft(owner, next); setOwner(next); } }, 'Create session'),
    h('ul', {}, ...draft.attachments.map(item => h('li', { key: item.id, 'data-state': item.status }, item.name))),
    h('p', { role: 'alert' }, draft.storageError ?? '')
  );
}
createRoot(document.getElementById('root')).render(h(App));
</script></body></html>`;

async function install(
  page: Page,
  errors: string[],
  upload?: (name: string) => Promise<string>,
) {
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  page.on("requestfailed", (request) =>
    console.error(request.url(), request.failure()?.errorText),
  );
  await page.route("**/__attachment-multitab?**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  await page.route("**/api/**", async (route) => {
    if (
      new URL(route.request().url()).pathname !== "/api/session/files/upload"
    ) {
      errors.push(
        `Unexpected API ${route.request().method()} ${route.request().url()}`,
      );
      return route.fulfill({
        status: 403,
        json: { error: "fixture forbids Agent and app mutations" },
      });
    }
    const { name } = route.request().postDataJSON();
    return route.fulfill({
      json: { path: upload ? await upload(name) : `/fixture/${name}` },
    });
  });
}
async function ready(page: Page, owner: string) {
  await page.goto(`/__attachment-multitab?owner=${encodeURIComponent(owner)}`);
  await expect(page.getByRole("status")).toHaveText("Ready");
}
async function flush(page: Page) {
  await page.evaluate(() => (window as any).attachmentFixture.flush());
}
async function add(page: Page, name: string, bytes: number[]) {
  await page
    .getByLabel("Add photo")
    .setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(bytes) });
}

test("two same-origin pages preserve another page's bytes after a stale submission clears and a session move", async ({
  page,
  context,
}) => {
  const errors: string[] = [],
    second = await context.newPage();
  await install(page, errors);
  await install(second, errors);
  const owner = `browser-attachments:${crypto.randomUUID()}`;
  await ready(page, owner);
  await add(page, "submitted.png", [1, 2, 3]);
  await expect(page.locator('li[data-state="ready"]')).toHaveCount(1);
  await flush(page);
  await page.getByText("Capture submission", { exact: true }).click();
  await ready(second, owner);
  await add(second, "keep.png", [7, 8, 255]);
  await expect(second.locator('li[data-state="ready"]')).toHaveCount(2);
  await flush(second);
  await page.getByText("Complete submission", { exact: true }).click();
  await flush(page);
  await second.reload();
  await expect(second.getByRole("status")).toHaveText("Ready");
  await expect(second.locator("li")).toHaveText(["keep.png"]);
  expect(
    await second.evaluate(() => (window as any).attachmentFixture.read()),
  ).toMatchObject([{ name: "keep.png", bytes: [7, 8, 255] }]);
  // The stale page has never read keep.png. Moving its new file must not move
  // or erase that other page's attachment from the original owner.
  await add(page, "move.png", [9, 8, 7]);
  await expect(page.locator('li[data-state="ready"]')).toHaveCount(1);
  await flush(page);
  await page.getByText("Create session", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).attachmentFixture.read()))
    .toMatchObject([{ name: "move.png", bytes: [9, 8, 7] }]);
  expect(
    await second.evaluate(() => (window as any).attachmentFixture.read()),
  ).toMatchObject([{ name: "keep.png", bytes: [7, 8, 255] }]);
  expect(errors).toEqual([]);
});

test("another page removes an uploading photo and the original late upload cannot revive it", async ({
  page,
  context,
}) => {
  const errors: string[] = [],
    second = await context.newPage();
  let release!: (path: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  let started = false;
  await install(page, errors, () => {
    started = true;
    return pending;
  });
  await install(second, errors);
  const owner = `browser-late-upload:${crypto.randomUUID()}`;
  await ready(page, owner);
  await add(page, "removed.png", [4, 5, 6]);
  await expect.poll(() => started).toBe(true);
  await ready(second, owner);
  await expect(second.locator("li")).toHaveCount(1);
  await second.getByText("Remove all visible", { exact: true }).click();
  await flush(second);
  release("/fixture/late.png");
  await expect(page.locator("li")).toHaveCount(0);
  await flush(page);
  await second.reload();
  await expect(second.getByRole("status")).toHaveText("Ready");
  await expect(second.locator("li")).toHaveCount(0);
  expect(
    await second.evaluate(() => (window as any).attachmentFixture.read()),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
