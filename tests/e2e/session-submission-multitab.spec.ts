import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { registerSessionFollowupRoutes } from "../../apps/server/src/routes/session-followups";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const owner = '["codex","","session","identity-thread"]';
const threadId = "identity-thread";
const payload = (text: string) => ({
  threadId,
  text,
  images: [],
  mode: "queue",
  parameters: {},
});
const html = String.raw`<!doctype html><html><body>
<textarea aria-label="Draft"></textarea><button id="send">Send captured draft</button><button id="read">Check queue</button>
<button id="photo">Add photo</button><button id="reference">Add reference</button><output id="parts"></output>
<output id="ready"></output><pre id="result"></pre>
<script type="module">
const refresh = await import('/@react-refresh');
refresh.default.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
const service = await import('/src/session-mode/services/followupService.ts');
const drafts = await import('/src/session-mode/stores/useSessionDraftStore.ts');
const attachments = await import('/src/session-mode/services/sessionAttachmentStorage.ts');
const { composerDrafts } = await import('/src/session-mode/components/codex/composer/v2/drafts.ts');
const { newSessionEditId } = await import('/src/session-mode/services/sessionEditIdentity.ts');
const { useCodexStore } = await import('/src/session-mode/components/codex/stores/index.ts');
const owner = '["codex","","session","identity-thread"]';
await composerDrafts.ensure(owner);
useCodexStore.setState({ threads: [{ id: 'identity-thread', source: 'vscode', parentThreadId: null, cwd: '/fixture' }], currentThreadId: 'identity-thread' });
window.submissionFixture = { service, drafts };
const editor = document.querySelector('textarea'), result = document.querySelector('#result');
const updateParts = async () => document.querySelector('#parts').textContent = JSON.stringify({ images: (await attachments.loadAttachmentDraft(owner)).map(item => item.id), contexts: composerDrafts.read(owner).contexts.map(item => item.id) });
document.querySelector('#photo').onclick = async () => {
  const previous = await attachments.loadAttachmentDraft(owner);
  await attachments.saveAttachmentDraft(owner, [...previous, { id: newSessionEditId(), name: 'photo.png', file: new File([new Uint8Array([1,2,255])], 'photo.png', {type:'image/png'}), path: '/fixture/photo.png', status: 'ready', preview: '' }], previous);
  await updateParts();
};
document.querySelector('#reference').onclick = async () => {
  composerDrafts.add(owner, { id: newSessionEditId(), kind: 'file', name: 'file.txt', text: 'fixture file bytes' });
  await composerDrafts.flush(owner);
  await updateParts();
};
editor.value = drafts.readDraft(owner).text;
editor.oninput = () => drafts.useSessionDraftStore.getState().setText(owner, editor.value);
document.querySelector('#send').onclick = async () => {
  const captured = drafts.readDraft(owner);
  result.textContent = 'Submitting';
  try {
    await composerDrafts.flush(owner);
    const capturedContexts = composerDrafts.capture(owner);
    const images = await attachments.loadAttachmentDraft(owner), contexts = capturedContexts.contexts;
    const receipt = await service.followupService.submit(owner, { revision: captured.revision, writeId: captured.writeId, attachmentIds: images.map(item => item.id), contextIds: contexts.map(item => item.id) }, 'identity-thread', captured.text, images.map(item => item.path), 'queue', undefined, {}, contexts);
    drafts.useSessionDraftStore.getState().clearSubmitted(owner, captured);
    await attachments.saveAttachmentDraft(owner, [], images);
    composerDrafts.clearSubmitted(owner, contexts, capturedContexts.versions);
    await composerDrafts.flush(owner);
    await updateParts();
    editor.value = drafts.readDraft(owner).text;
    result.textContent = JSON.stringify(receipt);
  } catch(error) { result.textContent = error.name + ': ' + error.message; }
};
document.querySelector('#read').onclick = async () => { result.textContent = JSON.stringify(await service.followupService.load('identity-thread')); };
await updateParts(); document.querySelector('#ready').textContent = 'Ready';
</script></body></html>`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "submission-identity-"));
  const file = join(root, "queue.json"),
    app = Fastify();
  const calls: unknown[] = [],
    posts: any[] = [],
    failures: string[] = [];
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    file,
    autoStart: false,
    runtime: {
      statuses: async () => ({ [threadId]: "active" }),
      call: async (...args) => {
        calls.push(args);
        throw new Error("fixture forbids native dispatch");
      },
    },
  });
  let loseNextResponse = false;
  return {
    app,
    queue,
    calls,
    posts,
    failures,
    file,
    loseResponse: () => {
      loseNextResponse = true;
    },
    install: async (page: Page) => {
      page.on("pageerror", (error) => failures.push(error.message));
      await page.route("**/__submission-fixture", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      await page.route("**/api/**", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.pathname.endsWith("/thread/access"))
          return route.fulfill({
            json: { state: "owned", reason: "", generation: 1 },
          });
        if (
          !["/api/session/followups", "/api/session/followups/submit"].includes(
            url.pathname,
          )
        ) {
          failures.push(
            "Unexpected API: " + request.method() + " " + url.pathname,
          );
          return route.fulfill({
            status: 403,
            json: { error: "fixture forbids real API" },
          });
        }
        const body =
          request.method() === "POST" ? request.postDataJSON() : undefined;
        if (body) posts.push(body);
        const response = await app.inject({
          method: request.method() as "GET" | "POST",
          url: url.pathname + url.search,
          ...(body ? { payload: body } : {}),
        });
        if (body && loseNextResponse) {
          loseNextResponse = false;
          return route.abort("failed");
        }
        await route.fulfill({
          status: response.statusCode,
          contentType: "application/json",
          body: response.body,
        });
      });
    },
    close: async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function ready(page: Page) {
  await page.goto("/__submission-fixture");
  await expect(page.locator("#ready")).toHaveText("Ready");
}
async function successfulSend(page: Page) {
  await page.getByText("Send captured draft", { exact: true }).click();
  await expect(page.locator("#result")).toContainText('"items"');
}

test("independent same-origin edits remain distinct through actual submit validation and durable queue", async ({
  page,
  context,
}) => {
  const f = await fixture(),
    second = await context.newPage();
  try {
    for (const p of [page, second]) {
      await f.install(p);
      await ready(p);
    }
    await page.getByLabel("Draft").fill("same text");
    await second.getByLabel("Draft").fill("same text");
    await Promise.all([successfulSend(page), successfulSend(second)]);
    expect(f.posts).toHaveLength(2);
    expect(new Set(f.posts.map((post) => post.id)).size).toBe(2);
    for (const post of f.posts)
      expect(post.id).toMatch(/^draft3_[a-f0-9]{64}$/);
    expect((await f.queue.get(threadId)).items).toHaveLength(2);
    expect(
      JSON.parse(await readFile(f.file, "utf8")).threads[threadId].items,
    ).toHaveLength(2);
    expect(f.calls).toEqual([]);
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

test("one captured edit in two pages deduplicates while a separate browser edit remains independent", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const f = await fixture(),
    second = await context.newPage();
  const separate = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
    }),
    third = await separate.newPage();
  try {
    await f.install(page);
    await ready(page);
    await page.getByLabel("Draft").fill("shared captured edit");
    await f.install(second);
    await ready(second);
    await expect(second.getByLabel("Draft")).toHaveValue(
      "shared captured edit",
    );
    await Promise.all([successfulSend(page), successfulSend(second)]);
    expect(new Set(f.posts.map((post) => post.id)).size).toBe(1);
    expect((await f.queue.get(threadId)).items).toHaveLength(1);
    await f.install(third);
    await ready(third);
    await third.getByLabel("Draft").fill("shared captured edit");
    await successfulSend(third);
    expect((await f.queue.get(threadId)).items).toHaveLength(2);
    expect(f.calls).toEqual([]);
    expect(f.failures).toEqual([]);
  } finally {
    await separate.close();
    await f.close();
  }
});

test("a lost HTTP acknowledgement retains its edit and explicit post-reload retry reuses the original ID", async ({
  page,
}) => {
  const f = await fixture();
  try {
    await f.install(page);
    await ready(page);
    await page.getByLabel("Draft").fill("lost acknowledgement");
    f.loseResponse();
    await page.getByText("Send captured draft", { exact: true }).click();
    await expect(page.locator("#result")).toContainText("Error:");
    await expect(page.getByLabel("Draft")).toHaveValue("lost acknowledgement");
    expect(f.posts).toHaveLength(1);
    await page.reload();
    await expect(page.locator("#ready")).toHaveText("Ready");
    await expect(page.getByLabel("Draft")).toHaveValue("lost acknowledgement");
    expect(f.posts).toHaveLength(1);
    await successfulSend(page);
    expect(f.posts).toHaveLength(2);
    expect(f.posts[0].id).toBe(f.posts[1].id);
    expect((await f.queue.get(threadId)).items).toHaveLength(1);
    expect(f.calls).toEqual([]);
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

test("old ambiguous edit stays intact before POST, queue inspection and explicit edit restore normal sending", async ({
  page,
}) => {
  const f = await fixture();
  try {
    await f.install(page);
    await ready(page);
    const data = payload("old delivery");
    await f.app.inject({
      method: "POST",
      url: "/api/session/followups/submit",
      payload: { ...data, id: "legacy-known-id" },
    });
    const hash = createHash("sha256")
      .update(JSON.stringify({ owner, revision: 1, data }))
      .digest("hex");
    await page.evaluate(
      ({ hash, owner }) => {
        localStorage.setItem(
          "kanban.session.followup-submissions",
          JSON.stringify({ [hash]: "legacy-known-id" }),
        );
        (window as any).submissionFixture.drafts.useSessionDraftStore.setState({
          drafts: {
            [owner]: {
              text: "old delivery",
              revision: 1,
              writeId: "old-ordinary-uuid",
            },
          },
        });
        document.querySelector("textarea")!.value = "old delivery";
      },
      { hash, owner },
    );
    await page.getByText("Send captured draft", { exact: true }).click();
    await expect(page.locator("#result")).toContainText(
      "MutationNotStartedError: 旧版本消息提交身份无法核实",
    );
    await expect(page.getByLabel("Draft")).toHaveValue("old delivery");
    expect(f.posts).toHaveLength(0);
    await page.getByText("Check queue", { exact: true }).click();
    await expect(page.locator("#result")).toContainText("legacy-known-id");
    await page.getByLabel("Draft").fill("old delivery edit");
    await page.getByLabel("Draft").fill("old delivery");
    await successfulSend(page);
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].id).not.toBe("legacy-known-id");
    expect((await f.queue.get(threadId)).items).toHaveLength(2);
    expect(f.calls).toEqual([]);
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

for (const kind of ["photo", "reference"] as const)
  test(`a pure ${kind} edit preserves its creation identity on reload and a lost receipt`, async ({
    page,
  }) => {
    const f = await fixture();
    try {
      await f.install(page);
      await ready(page);
      await page
        .getByText(kind === "photo" ? "Add photo" : "Add reference", {
          exact: true,
        })
        .click();
      await expect(page.locator("#parts")).toContainText("edit3_");
      const parts = await page.locator("#parts").textContent();
      await page.reload();
      await expect(page.locator("#ready")).toHaveText("Ready");
      await expect(page.locator("#parts")).toHaveText(parts!);
      f.loseResponse();
      await page.getByText("Send captured draft", { exact: true }).click();
      await expect(page.locator("#result")).toContainText("Error:");
      expect(f.posts).toHaveLength(1);
      await page.reload();
      await expect(page.locator("#ready")).toHaveText("Ready");
      await expect(page.locator("#parts")).toHaveText(parts!);
      await successfulSend(page);
      expect(f.posts).toHaveLength(2);
      expect(f.posts[0].id).toBe(f.posts[1].id);
      expect((await f.queue.get(threadId)).items).toHaveLength(1);
      // A new user addition of exactly the same path/content is a different edit.
      await page
        .getByText(kind === "photo" ? "Add photo" : "Add reference", {
          exact: true,
        })
        .click();
      await expect(page.locator("#parts")).toContainText("edit3_");
      expect(await page.locator("#parts").textContent()).not.toBe(parts);
      await successfulSend(page);
      expect((await f.queue.get(threadId)).items).toHaveLength(2);
      expect(f.posts[2].id).not.toBe(f.posts[0].id);
      expect(f.calls).toEqual([]);
      expect(f.failures).toEqual([]);
    } finally {
      await f.close();
    }
  });

test("reordered object keys in concurrent captured submissions use one ID and one real server fingerprint", async ({
  page,
  context,
}) => {
  const f = await fixture(),
    second = await context.newPage();
  try {
    await f.install(page);
    await ready(page);
    await page.getByLabel("Draft").fill("canonical payload");
    await f.install(second);
    await ready(second);
    const results = await Promise.all(
      [page, second].map((p, index) =>
        p.evaluate(
          async ({ owner, index }) => {
            const { service, drafts } = (window as any).submissionFixture;
            const snapshot = drafts.readDraft(owner);
            const parameters =
              index === 0
                ? { model: "fixture", cwd: "/fixture" }
                : { cwd: "/fixture", model: "fixture" };
            return service.followupService.submit(
              owner,
              { revision: snapshot.revision, writeId: snapshot.writeId },
              "identity-thread",
              snapshot.text,
              [],
              "queue",
              undefined,
              parameters,
            );
          },
          { owner, index },
        ),
      ),
    );
    expect(f.posts).toHaveLength(2);
    expect(f.posts[0].id).toBe(f.posts[1].id);
    expect(Object.keys(f.posts[0].parameters)).toEqual(
      Object.keys(f.posts[1].parameters),
    );
    expect(results.every((result) => result.items.length === 1)).toBe(true);
    expect((await f.queue.get(threadId)).items).toHaveLength(1);
    expect(f.calls).toEqual([]);
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

test("two pages retain all 400 deterministic submission identities without a shared map overwrite", async ({
  page,
  context,
}) => {
  const f = await fixture(),
    second = await context.newPage();
  try {
    for (const p of [page, second]) {
      await f.install(p);
      await ready(p);
    }
    const records = await Promise.all(
      [page, second].map((p, index) =>
        p.evaluate(
          async ({ index }) => {
            const { service } = (window as any).submissionFixture;
            const { newSessionEditId } =
              await import("/src/session-mode/services/sessionEditIdentity.ts");
            const records = [];
            for (let item = 0; item < 200; item++) {
              const owner = "parallel-" + index + "-" + item,
                edit = { revision: 1, writeId: newSessionEditId() },
                data = { text: owner };
              records.push({
                owner,
                edit,
                data,
                id: await service.stableSubmissionId(owner, edit, data),
              });
            }
            return records;
          },
          { index },
        ),
      ),
    );
    for (let index = 0; index < 2; index++) {
      const changed = await [page, second][index].evaluate(async (records) => {
        const { service } = (window as any).submissionFixture;
        const changed = [];
        for (const record of records)
          if (
            (await service.stableSubmissionId(
              record.owner,
              record.edit,
              record.data,
            )) !== record.id
          )
            changed.push(record.owner);
        return changed;
      }, records[index]);
      expect(changed).toEqual([]);
    }
    expect(f.posts).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

for (const version of ["legacy", "v2"] as const)
  test(`a confirmed ${version} binding retries its original ID through the unchanged server fingerprint`, async ({
    page,
  }) => {
    const f = await fixture();
    try {
      await f.install(page);
      await ready(page);
      const data = payload("old accepted payload");
      const writeId = "edit2_00000000-0000-4000-8000-000000000001";
      const hash = createHash("sha256")
        .update(
          JSON.stringify(
            version === "legacy"
              ? { owner, revision: 1, data }
              : { version: 2, owner, revision: 1, identity: { writeId }, data },
          ),
        )
        .digest("hex");
      const id = version === "legacy" ? "known-legacy-retry" : "draft_" + hash;
      const initial = await f.app.inject({
        method: "POST",
        url: "/api/session/followups/submit",
        payload: { ...data, id },
      });
      expect(initial.statusCode).toBe(200);
      await page.evaluate(
        ({ owner, hash, id, version, writeId }) => {
          if (version === "legacy")
            localStorage.setItem(
              "kanban.session.followup-submissions",
              JSON.stringify({ [hash]: id }),
            );
          else localStorage.setItem("kanban.session.submission.v2." + hash, id);
          (
            window as any
          ).submissionFixture.drafts.useSessionDraftStore.setState({
            drafts: {
              [owner]: {
                text: "old accepted payload",
                revision: 1,
                ...(version === "v2" ? { writeId } : {}),
              },
            },
          });
          document.querySelector("textarea")!.value = "old accepted payload";
        },
        { owner, hash, id, version, writeId },
      );
      await successfulSend(page);
      expect(f.posts).toHaveLength(1);
      expect(f.posts[0].id).toBe(id);
      expect((await f.queue.get(threadId)).items).toHaveLength(1);
      expect(f.calls).toEqual([]);
      expect(f.failures).toEqual([]);
    } finally {
      await f.close();
    }
  });
