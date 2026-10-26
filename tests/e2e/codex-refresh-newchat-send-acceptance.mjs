// Explicit no-login loopback fixture only; one real official-composer submission.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "../../node_modules/playwright/index.mjs";
import { attachPrivateService } from "../../packages/native-codex-host/refresh-prototype/private-service.mjs";
import { verifyRefreshProfileRoot } from "./codex-refresh-fixture.mjs";

const manifestPath = process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST;
const outputPath = process.env.NATIVE_CODEX_REFRESH_BROWSER_OUTPUT;
assert.ok(
  manifestPath && outputPath,
  "explicit private manifest and fresh output required",
);
const file = await lstat(manifestPath);
assert.ok(
  file.isFile() &&
    file.uid === process.getuid() &&
    (file.mode & 0o777) === 0o600 &&
    file.size < 65536,
);
const fixture = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(fixture.managedStartup, true);
assert.equal(fixture.noLoginCopied, true);
const profile = fixture.profiles[0];
await verifyRefreshProfileRoot(fixture.root, profile.root);
assert.ok(fixture.root.startsWith("/tmp/ck-"));
const provider = await readFile(
  join(fixture.root, "native-home/config.toml"),
  "utf8",
);
assert.match(provider, /requires_openai_auth\s*=\s*false/);
assert.match(provider, /base_url\s*=\s*"http:\/\/127\.0\.0\.1:[0-9]+\/v1"/);
const url = new URL(fixture.urls[0]);
assert.equal(url.protocol, "https:");
const output = resolve(outputPath);
await mkdir(output, { mode: 0o700 });
const result = {
  scenario: "first new-chat send and exact history recovery",
  fixtureApiRouting: false,
  model: "owned loopback",
  sendClicks: 0,
  steps: [],
  errors: [],
  passed: false,
};
const save = () =>
  writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const browser = await chromium.launch({
  headless: true,
  args: ["--ignore-certificate-errors-spki-list=" + fixture.spki],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on("pageerror", (e) =>
  result.errors.push({ kind: "pageerror", message: e.message.slice(0, 500) }),
);
let reader;
async function composer(threadId = null) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      try {
        const parent = frame.parentFrame();
        if (!parent) continue;
        const wrapper = await parent.frameElement();
        if (
          (await wrapper.getAttribute("data-kanban-native-interactive")) !==
          "true"
        )
          continue;
        const editor = frame
          .locator('#root [contenteditable="true"]:visible')
          .first();
        if (!(await editor.count())) continue;
        const portal = frame
          .locator("[data-above-composer-conversation-id]")
          .first();
        const id = (await portal.count())
          ? await portal.getAttribute("data-above-composer-conversation-id")
          : null;
        if (threadId ? id === threadId : !id) return { frame, editor };
      } catch {
        /* Official frame navigation. */
      }
    }
    await page.waitForTimeout(50);
  }
  throw Error("Correct official composer did not recover");
}
async function selected() {
  return page.evaluate((profileId) => {
    const raw = sessionStorage.getItem(
      "kanban.codex.tab-view.v1:kanban.codex.multiwindow.v2:" + profileId,
    );
    const state = raw && JSON.parse(JSON.parse(raw));
    const window = state?.windows?.find((item) => item.id === state.activeId);
    return (
      window && {
        id: window.id,
        kind: window.kind,
        ...(window.threadId ? { threadId: window.threadId } : {}),
      }
    );
  }, profile.id);
}
try {
  const metadata = JSON.parse(
    await readFile(join(fixture.root, "manager/bridge.json"), "utf8"),
  );
  const service = await attachPrivateService({
    metadata,
    domain: fixture.domain,
  });
  assert.equal(service.record.generation, fixture.service.generation);
  assert.equal(service.record.pid, fixture.service.pid);
  assert.equal(service.record.startTicks, fixture.service.startTicks);
  reader = await service.connect({ name: "newchat_first_send_readonly" });
  await page.goto(url.origin + "/?mode=codex&nativeClient=" + profile.id);
  const initial = await composer();
  assert.deepEqual(await selected(), {
    id: "new:" + profile.startupId,
    kind: "new",
  });
  result.steps.push("initial managed new chat");
  await save();
  await initial.editor.fill("REFRESH_IDLE");
  const send = initial.frame
    .locator("#root")
    .getByRole("button", { name: "Send", exact: true });
  result.sendClicks++;
  await save();
  await send.click();
  const end = Date.now() + 30000;
  let threadId;
  while (Date.now() < end) {
    const candidate = await selected();
    if (candidate?.threadId && uuid.test(candidate.threadId)) {
      threadId = candidate.threadId;
      break;
    }
    await page.waitForTimeout(50);
  }
  assert.ok(threadId, "actual native thread identity missing; never resubmit");
  assert.notEqual(threadId, fixture.threadId);
  const sent = await composer(threadId);
  await sent.frame.getByText("REFRESH_IDLE_DONE", { exact: true }).waitFor();
  const before = (
    await reader.request("thread/read", { threadId, includeTurns: true })
  ).thread;
  assert.equal(before.cwd, fixture.project);
  assert.equal(before.turns.length, 1);
  assert.equal(before.turns[0].status, "completed");
  result.threadId = threadId;
  result.turnId = before.turns[0].id;
  await save();
  const user = before.turns[0].items.filter(
    (item) => item.type === "userMessage",
  );
  assert.equal(user.length, 1);
  assert.match(
    user[0].content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join(""),
    /^REFRESH_IDLE\n?$/,
  );
  result.steps.push("one native completed turn after one official send");
  await save();
  await page.reload({ waitUntil: "domcontentloaded" });
  const recovered = await composer(threadId);
  await recovered.frame
    .getByText("REFRESH_IDLE_DONE", { exact: true })
    .waitFor();
  assert.deepEqual(await selected(), {
    id: threadId,
    kind: "thread",
    threadId,
  });
  const after = (
    await reader.request("thread/read", { threadId, includeTurns: true })
  ).thread;
  assert.equal(after.turns.length, 1);
  assert.equal(after.turns[0].id, result.turnId);
  assert.equal(after.turns[0].status, "completed");
  result.steps.push(
    "reload restores exact native history without duplicate send",
  );
  await page.screenshot({ path: join(output, "first-send-recovered.png") });
  result.passed =
    result.steps.length === 3 &&
    result.sendClicks === 1 &&
    result.errors.length === 0;
} catch (error) {
  result.errors.push({
    kind: "assertion",
    message: error.message.slice(0, 1000),
  });
  await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
} finally {
  await context.close();
  await browser.close();
  await reader?.close();
  await save();
}
console.log(
  JSON.stringify({
    passed: result.passed,
    sendClicks: result.sendClicks,
    steps: result.steps.length,
    errors: result.errors.length,
  }),
);
if (!result.passed) process.exitCode = 1;
