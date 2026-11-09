import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openWebviewArchive } from "../src/assets.mjs";
import { createDesktopSurfaceAssetAdapter } from "../src/desktop-surface-assets.mjs";
import { SHARED_THREAD_NAVIGATION_REFERENCE } from "../src/shared-thread-navigation-assets.mjs";

const archiveSha256 =
  "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95";
const members = [
  "webview/assets/app-runtime-b179428fcc1e.js",
  "webview/assets/local-conversation-page-50ae20551907.js",
  "webview/assets/local-conversation-thread-2f594f841b07.js",
  "webview/assets/codex-composer-adapter-d1ca952732ea.js",
  "webview/assets/create-project-dialog-5d973a8dd7a1.js",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("requires the pinned Mac identity and offers a fixed immutable five-member composition", () => {
  for (const options of [
    undefined,
    {},
    { archiveSha256: "0".repeat(64) },
    { archiveSha256, member: "other" },
    { archiveSha256, splitPane: "true" },
    { archiveSha256, splitPane: true, sharedThread: "true" },
  ]) {
    assert.throws(() => createDesktopSurfaceAssetAdapter(options), {
      code: "DESKTOP_SURFACE_UNSUPPORTED_ARCHIVE",
    });
  }
  const adapter = createDesktopSurfaceAssetAdapter({ archiveSha256 });
  assert.deepEqual(adapter.members, members);
  assert.ok(Object.isFrozen(adapter) && Object.isFrozen(adapter.members));
  assert.equal(
    adapter.adapt({
      member: "webview/assets/other.js",
      body: Buffer.from("untouched"),
    }),
    null,
  );
});

test("combined shared submit/navigation/host choice and split panes use ten fixed members", () => {
  const sharedMembers = Object.keys(SHARED_THREAD_NAVIGATION_REFERENCE.members);
  const combined = createDesktopSurfaceAssetAdapter({ archiveSha256, sharedThread: true, splitPane: true });
  assert.deepEqual(combined.members, [...members.slice(0, 4), "webview/assets/composer-content-b926d24ef280.js", ...sharedMembers, "webview/assets/location-menu-68c55551634b.js"]);
  assert.equal(combined.members.length, 10);
  assert.equal(combined.adapt({member:members[4],body:Buffer.from("original project dialog")}), null);
  // Shared-only adds exactly the pinned submit member to its previous recipe.
  const shared = createDesktopSurfaceAssetAdapter({ archiveSha256, sharedThread: true });
  assert.deepEqual(shared.members, [...members.slice(0,4), "webview/assets/composer-content-b926d24ef280.js", members[4], ...sharedMembers, "webview/assets/location-menu-68c55551634b.js"]);
});

test("combined fixed members adapt actual original resources independently", {
  skip: !process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR && "Requires the explicitly supplied pinned Mac archive",
}, async () => {
  const archive = await openWebviewArchive({ asarPath: process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR, sha256: archiveSha256 });
  try {
    const combined = createDesktopSurfaceAssetAdapter({ archiveSha256, sharedThread: true, splitPane: true });
    for (const member of combined.members) {
      const asset = await archive.acquireAsset(member);
      try {
        const original = Buffer.from(asset.body);
        const adapted = combined.adapt({member,body:asset.body});
        assert.deepEqual(asset.body,original);
        assert.equal(adapted.originalSha256,hash(original));
        assert.equal(adapted.adaptedSha256,hash(adapted.body));
        assert.notEqual(adapted.adaptedSha256,adapted.originalSha256);
        if(member===members[1]) assert.ok(adapted.body.toString().includes("DesktopSplitPaneBoundary"));
      } finally { asset.release(); }
    }
    const originalDialog = await archive.acquireAsset(members[4]);
    try { assert.equal(combined.adapt({member:members[4],body:originalDialog.body}),null); }
    finally { originalDialog.release(); }
  } finally { await archive.close(); }
});

test("rejects malformed or oversized selected input before adapting any original bytes", () => {
  const adapter = createDesktopSurfaceAssetAdapter({ archiveSha256 });
  assert.throws(() => adapter.adapt({ member: undefined }), {
    code: "DESKTOP_SURFACE_INVALID_MEMBER",
  });
  for (const member of members) {
    assert.throws(() => adapter.adapt({ member, body: "not bytes" }), {
      code: "DESKTOP_SURFACE_INVALID_BODY",
    });
    assert.throws(
      () => adapter.adapt({ member, body: Buffer.alloc(512 * 1024 + 1) }),
      { code: "DESKTOP_SURFACE_RESOURCE_LIMIT" },
    );
    assert.throws(() =>
      adapter.adapt({ member, body: Buffer.from("different build") }),
    );
  }
  assert.throws(() => adapter.adapt({member:members[4],body:Buffer.alloc(64 * 1024 + 1)}),{code:"DESKTOP_SURFACE_RESOURCE_LIMIT"});
});

test(
  "composes the five actual original assets without chaining patches or changing the archive",
  {
    skip:
      !process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR &&
      "Requires the explicitly supplied pinned Mac archive",
  },
  async () => {
    const archive = await openWebviewArchive({
      asarPath: process.env.CHATGPT_DESKTOP_TEST_MAC_ASAR,
      sha256: archiveSha256,
    });
    const adapter = createDesktopSurfaceAssetAdapter({ archiveSha256 });
    try {
      const outputs = new Map();
      for (const member of members) {
        const asset = await archive.acquireAsset(member);
        try {
          const original = Buffer.from(asset.body),
            result = adapter.adapt({ member, body: asset.body });
          assert.deepEqual(asset.body, original);
          assert.equal(result.originalSha256, hash(original));
          assert.equal(result.adaptedSha256, hash(result.body));
          assert.notEqual(result.originalSha256, result.adaptedSha256);
          assert.ok(result.body.byteLength <= 512 * 1024);
          assert.throws(
            () => adapter.adapt({ member, body: result.body }),
            "already adapted bytes cannot be accepted as upstream",
          );
          outputs.set(member, result.body.toString("utf8"));
        } finally {
          asset.release();
        }
      }
      assert.ok(
        outputs.get(members[0]).includes("__kanbanCodexOnlySurface===true"),
      );
      assert.ok(outputs.get(members[1]).includes("DesktopLayoutBoundary"));
      assert.ok(
        outputs.get(members[2]).includes("__chatgptDesktopComposerScope"),
      );
      assert.ok(outputs.get(members[3]).includes("OriginalComposerRegistrar"));
      assert.ok(outputs.get(members[4]).includes("chatgptDesktop.project.createRootHint"));
      assert.ok(outputs.get(members[4]).includes("ge.length===0?"));
      const originalPage = await archive.acquireAsset(members[1]);
      try {
        const split = createDesktopSurfaceAssetAdapter({ archiveSha256, splitPane: true })
          .adapt({ member: members[1], body: originalPage.body });
        assert.ok(split.body.toString("utf8").includes("DesktopSplitPaneBoundary"));
        assert.ok(!split.body.toString("utf8").includes("DesktopSelectedPaneBoundary"));
        assert.notEqual(split.adaptedSha256, hash(Buffer.from(outputs.get(members[1]))));
      } finally {
        originalPage.release();
      }
    } finally {
      await archive.close();
    }
  },
);

test('v4 includes exactly the pinned image picker without changing the v2 recipe', () => {
  const member='webview/assets/use-file-picker-ed94b8e7bfdc.js';
  const normal=createDesktopSurfaceAssetAdapter({archiveSha256});
  const split=createDesktopSurfaceAssetAdapter({archiveSha256,splitPane:true});
  assert.equal(normal.members.includes(member),false);
  assert.equal(split.members.includes(member),true);
  assert.ok(split.members.length<=8);
  assert.throws(()=>split.adapt({member,body:Buffer.from('not the pinned original')}));
});
