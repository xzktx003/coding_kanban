import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createDesktopSurfaceAssetAdapter } from "../src/desktop-surface-assets.mjs";
import {
  createSharedThreadNavigationAssetAdapter,
  SHARED_THREAD_NAVIGATION_REFERENCE,
} from "../src/shared-thread-navigation-assets.mjs";

const directory = process.env.CHATGPT_DESKTOP_SIDEBAR_ASSET_DIR;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archiveSha256 =
  "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95";

test("the explicit shared-navigation adapter stays inside the existing member and byte budgets", () => {
  assert.throws(
    () => createSharedThreadNavigationAssetAdapter({ archiveSha256: "other" }),
    { code: "SHARED_NAV_UNSUPPORTED_ARCHIVE" },
  );
  const adapter = createSharedThreadNavigationAssetAdapter({ archiveSha256 });
  const existing = createDesktopSurfaceAssetAdapter({ archiveSha256 });
  assert.equal(adapter.members.length, 4);
  assert.equal(
    new Set([...existing.members, ...adapter.members]).size,
    existing.members.length + 4,
  );
  assert.equal(existing.members.length + adapter.members.length, 9);
  assert.equal(
    adapter.adapt({
      member: "webview/assets/unknown.js",
      body: Buffer.from(""),
    }),
    null,
  );
  assert.throws(
    () =>
      adapter.adapt({
        member: adapter.members[0],
        body: Buffer.from("unsupported"),
      }),
    { code: "SHARED_NAV_DIGEST_MISMATCH" },
  );
  assert.throws(
    () =>
      adapter.adapt({
        member: adapter.members[0],
        body: Buffer.alloc(512 * 1024 + 1),
      }),
    { code: "SHARED_NAV_RESOURCE_LIMIT" },
  );
  const integrated = createDesktopSurfaceAssetAdapter({
    archiveSha256,
    sharedThread: true,
  });
  assert.deepEqual(integrated.members, [
    ...existing.members.slice(0,4),
    "webview/assets/composer-content-b926d24ef280.js",
    existing.members[4],
    ...adapter.members,
    "webview/assets/location-menu-68c55551634b.js",
  ]);
  assert.throws(
    () =>
      createDesktopSurfaceAssetAdapter({ archiveSha256, sharedThread: "true" }),
    { code: "DESKTOP_SURFACE_UNSUPPORTED_ARCHIVE" },
  );
});

test(
  "the fixed Mac assets carry the provider's exact route attempt to the original resume call",
  { skip: !directory },
  async () => {
    const adapter = createSharedThreadNavigationAssetAdapter({ archiveSha256 });
    const adapted = new Map();
    for (const [member, expected] of Object.entries(
      SHARED_THREAD_NAVIGATION_REFERENCE.members,
    )) {
      const original = await readFile(
        join(directory, member.split("/").at(-1)),
      );
      assert.equal(hash(original), expected.originalSha256);
      const output = adapter.adapt({ member, body: original });
      assert.equal(output.originalSha256, expected.originalSha256);
      assert.equal(output.adaptedSha256, hash(output.body));
      assert.ok(output.body.length <= 512 * 1024);
      assert.throws(() => adapter.adapt({ member, body: output.body }), {
        code: "SHARED_NAV_DIGEST_MISMATCH",
      });
      adapted.set(member, output.body.toString("utf8"));
    }
    const [main, provider, resume] = adapter.members.map((member) =>
      adapted.get(member),
    );
    assert.match(
      main,
      /__kanbanSharedThreadNavigation\.createRoot\(\(0,u\.createRoot\),d\)/,
    );
    assert.match(
      provider,
      /navigateToLocalConversation:globalThis\.__kanbanSharedThreadNavigation\.wrapNavigation\(_\)/,
    );
    assert.match(resume, /ofr as __kanbanSharedLocation/);
    assert.match(resume, /__kanbanSharedThreadNavigation\.consumeRoute\(/);
    assert.match(resume, /__kanbanSharedConnectAttempt:__kanbanConnectAttempt/);
    assert.match(
      resume,
      /w\.current!==e\|\|!o\.get\(_e,e\)\|\|o\.get\(ye,e\)!==r/,
    );
  },
);

test(
  "the adapted original resume expression rejects auto navigation and rechecks identity after the await",
  { skip: !directory },
  async () => {
    const adapter = createSharedThreadNavigationAssetAdapter({ archiveSha256 }),
      member = adapter.members[2];
    const original = await readFile(join(directory, member.split("/").at(-1)));
    const source = adapter
        .adapt({ member, body: original })
        .body.toString("utf8"),
      start = source.indexOf("r=o.get(ye,e);let __kanbanConnectAttempt"),
      stop = source.indexOf(");a?.(p.status", start);
    assert.ok(start >= 0 && stop > start);
    const originalExpression = source.slice(start, stop + 2);
    const run = new Function(
      "context",
      `return (async()=>{let {globalThis,o,e,ye,__kanbanSharedLocation,w,_e,me,n,i,t,ne,u,d,te,c,De,ve,Pe}=context;let r,a;${originalExpression};return p})()`,
    );
    const ye = {},
      location = {},
      enabled = {},
      catalog = {},
      threadId = "550e8400-e29b-41d4-a716-446655440000",
      attemptId = "77f4e48c-872e-44fd-a1f6-8a7fb101148f";
    let host = "local",
      token = null,
      calls = 0,
      received;
    const context = {
      globalThis: {
        __kanbanSharedThreadNavigation: { consumeRoute: async () => token },
      },
      o: {
        get: (key) =>
          key === ye
            ? host
            : key === location
              ? { state: {} }
              : key === enabled
                ? true
                : key === catalog
                  ? null
                  : null,
      },
      e: threadId,
      ye,
      __kanbanSharedLocation: location,
      w: { current: threadId },
      _e: enabled,
      me: catalog,
      n: null,
      i: {},
      t: "local",
      ne: [],
      u: false,
      d: null,
      te: null,
      c: false,
      De: () => ({
        resumeConversation: async (value) => {
          calls++;
          received = value;
          return { status: "ready" };
        },
      }),
      ve: () => null,
      Pe: () => null,
    };
    await run(context);
    assert.equal(calls, 1, 'private original resumes through its unmodified route');
    assert.equal(Object.hasOwn(received,'__kanbanSharedConnectAttempt'),false);
    host='kanban-shared-cli';
    assert.equal(await run(context), undefined);
    assert.equal(calls, 1, 'shared thread must wait for its own trusted intent');
    token = attemptId;
    await run(context);
    assert.equal(calls, 2);
    assert.equal(received.conversationId, threadId);
    assert.equal(received.__kanbanSharedConnectAttempt, attemptId);
    let release;
    context.globalThis.__kanbanSharedThreadNavigation.consumeRoute = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = run(context);
    host = "other";
    release(attemptId);
    assert.equal(await pending, undefined);
    assert.equal(calls, 2);
  },
);
