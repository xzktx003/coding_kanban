import { expect, test, type Page } from "@playwright/test";

const legacy = "kanban.session.followup-settings";
const fixturePath = "/followup-preferences-fixture";
async function fixture(page: Page) {
  await page.route("**/api/**", (route) => route.abort());
  await page.route(`**${fixturePath}`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><button id="mode">Steer</button><button id="enter">Command Enter</button><button id="review">Detached review</button><output></output><script type="module">
      import { useFollowupSettingsStore as store } from '/src/session-mode/stores/useFollowupSettingsStore.ts';
      window.preferences = store;
      const show = () => { const {mode,enterBehavior,reviewDelivery} = store.getState(); document.querySelector('output').textContent=JSON.stringify({mode,enterBehavior,reviewDelivery}); };
      store.subscribe(show);show();
      document.querySelector('#mode').onclick=()=>store.getState().setMode('steer');
      document.querySelector('#enter').onclick=()=>store.getState().setEnterBehavior('cmdAlways');
      document.querySelector('#review').onclick=()=>store.getState().setReviewDelivery('detached');
      window.ready=true;
    </script></body></html>`,
    }),
  );
  await page.goto(fixturePath);
  await page.waitForFunction(() => (window as any).ready);
}
const values = (page: Page) =>
  page
    .locator("output")
    .textContent()
    .then((value) => JSON.parse(value!));

test("two pages preserve independently chosen global followup fields after reload", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  const errors: string[] = [];
  for (const target of [page, other])
    target.on("pageerror", (error) => errors.push(error.message));
  try {
    await fixture(page);
    await fixture(other);
    await expect
      .poll(() => values(other))
      .toEqual({
        mode: "queue",
        enterBehavior: "enter",
        reviewDelivery: "inline",
      });
    await page.locator("#mode").click();
    await other.locator("#enter").click();
    await other.locator("#review").click();
    await page.reload();
    await page.waitForFunction(() => (window as any).ready);
    await expect
      .poll(() => values(page))
      .toEqual({
        mode: "steer",
        enterBehavior: "cmdAlways",
        reviewDelivery: "detached",
      });
    await other.reload();
    await other.waitForFunction(() => (window as any).ready);
    await expect.poll(() => values(other)).toEqual(await values(page));
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("legacy backup remains read-only and explicit same-field choices use the latest successful write", async ({
  page,
  context,
}) => {
  await fixture(page);
  const backup = JSON.stringify({
    state: {
      mode: "steer",
      enterBehavior: "cmdIfMultiline",
      reviewDelivery: "detached",
    },
    version: 0,
  });
  await page.evaluate(
    ({ legacy, backup }) => localStorage.setItem(legacy, backup),
    { legacy, backup },
  );
  await page.reload();
  await page.waitForFunction(() => (window as any).ready);
  const other = await context.newPage();
  try {
    await fixture(other);
    await page.evaluate(() =>
      (window as any).preferences.getState().setMode("queue"),
    );
    await expect.poll(() => values(other)).toMatchObject({ mode: "queue" });
    await other.locator("#mode").click();
    await expect.poll(() => values(page)).toMatchObject({ mode: "steer" });
    expect(
      await page.evaluate((key) => localStorage.getItem(key), legacy),
    ).toBe(backup);
    await page.reload();
    await page.waitForFunction(() => (window as any).ready);
    await expect
      .poll(() => values(page))
      .toEqual({
        mode: "steer",
        enterBehavior: "cmdIfMultiline",
        reviewDelivery: "detached",
      });
  } finally {
    await other.close();
  }
});

test("a failed local choice survives other-page changes and explicit retry preserves both", async ({
  page,
  context,
}) => {
  await fixture(page);
  const other = await context.newPage();
  try {
    await fixture(other);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as any).restorePreferenceStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "kanban.session.followup-settings.v1.mode")
          throw new DOMException("browser quota", "QuotaExceededError");
        original.call(this, key, value);
      };
    });
    await page.locator("#mode").click();
    await other.locator("#enter").click();
    await expect
      .poll(() => values(page))
      .toMatchObject({ mode: "steer", enterBehavior: "cmdAlways" });
    expect(
      await page.evaluate(
        () => (window as any).preferences.getState().persistenceError,
      ),
    ).toContain("browser quota");
    await page.evaluate(() => {
      (window as any).restorePreferenceStorage();
      (window as any).preferences.getState().retryPersistence();
    });
    await expect
      .poll(() => values(other))
      .toMatchObject({ mode: "steer", enterBehavior: "cmdAlways" });
    expect(
      await page.evaluate(
        () => (window as any).preferences.getState().persistenceError,
      ),
    ).toBeNull();
    await page.reload();
    await page.waitForFunction(() => (window as any).ready);
    await expect
      .poll(() => values(page))
      .toMatchObject({ mode: "steer", enterBehavior: "cmdAlways" });
  } finally {
    await other.close();
  }
});
