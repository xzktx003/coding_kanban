import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  classifyLiveRequest,
  projectLiveTarget,
  projectAlreadyReadProof,
  classifyControlledNetworkFailure,
  createOwnedBrowserShutdown,
  snapshotOwnedSceneDOM,
  validateLiveUrl,
  validateNotSentResumeProof,
  webSocketMatchesHttpOrigin,
} from "../tests/e2e/session-lan-readonly-policy.mjs";

test("a shared composer uses the exact sibling transcript, never an ancestor or another card", () => {
  const { JSDOM } = createRequire(import.meta.url)(
    "../apps/web/node_modules/jsdom",
  );
  const dom = new JSDOM(
    '<section data-session-card="other"><div data-codex-row>OTHER</div></section><section data-session-card="owned"><div data-codex-transcript-shell="owned"><div data-codex-row="assistant-owned">OWN_FINAL</div></div></section><div class="session-codex-composer" data-owner-thread="owned"><div contenteditable="true"></div></div>',
  );
  const oldDocument = globalThis.document,
    oldWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  for (const element of dom.window.document.querySelectorAll("*"))
    element.getBoundingClientRect = () => ({
      width: element.closest("[hidden]") ? 0 : 100,
    });
  try {
    const state = snapshotOwnedSceneDOM({
      threadId: "owned",
      expectedText: "OWN_FINAL",
      assistantRowKey: "assistant-owned",
    });
    assert.equal(state.ownerCount, 1);
    assert.equal(state.historyRows, 1);
    assert.equal(state.finalVisible, true);
    assert.equal(state.editorEmpty, true);
    const extra = dom.window.document.createElement("div");
    extra.className = "session-codex-composer";
    extra.setAttribute("data-owner-thread", "other");
    extra.getBoundingClientRect = () => ({ width: 100 });
    dom.window.document.body.append(extra);
    assert.equal(
      snapshotOwnedSceneDOM({ threadId: "owned" }).visibleOwnerCount,
      2,
    );
    extra.remove();
    dom.window.document
      .querySelector('[data-session-card="owned"]')
      .setAttribute("hidden", "");
    const hidden = snapshotOwnedSceneDOM({
      threadId: "owned",
      expectedText: "OTHER",
    });
    assert.equal(hidden.historyRows, 0);
    assert.equal(hidden.finalVisible, false);
    assert.equal(
      snapshotOwnedSceneDOM({ threadId: "not-owned" }).ownerCount,
      0,
    );
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    dom.window.close();
  }
});

test("solo session windows scope assistant replies to the exact visible owned transcript shell", () => {
  const { JSDOM } = createRequire(import.meta.url)(
    "../apps/web/node_modules/jsdom",
  );
  const dom = new JSDOM(`
    <section data-session-group-body>
      <div data-codex-transcript-shell="sibling">
        <div data-transcript-preparing="sibling"><div data-owner-thread="sibling">OWN_FINAL</div></div>
      </div>
      <div data-codex-transcript-shell="owned">
        <div data-transcript-preparing="owned">
          <div data-owner-thread="owned" class="self-end">User asked OWN_FINAL</div>
          <div data-owner-thread="owned" class="w-full min-w-0">OWN_FINAL</div>
        </div>
      </div>
    </section>
    <button role="tab" aria-selected="true" data-tab-key="codex:owned"></button>
    <div class="session-codex-composer" data-owner-thread="owned"><div contenteditable="true"></div></div>
  `);
  const oldDocument = globalThis.document,
    oldWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  for (const element of dom.window.document.querySelectorAll("*"))
    element.getBoundingClientRect = () => ({
      width: element.hasAttribute("hidden") ? 0 : 100,
      height: element.hasAttribute("hidden") ? 0 : 20,
    });
  try {
    const state = snapshotOwnedSceneDOM({
      threadId: "owned",
      expectedText: "OWN_FINAL",
    });
    assert.equal(state.ownerCount, 1);
    assert.equal(state.ownedTranscriptShellVisible, true);
    assert.equal(state.fallbackVisible, true);
    assert.equal(state.richBodyReady, false);
    assert.equal(state.finalVisible, true);

    const shell = dom.window.document.querySelector(
      '[data-codex-transcript-shell="owned"]',
    );
    shell.setAttribute("hidden", "");
    const hidden = snapshotOwnedSceneDOM({
      threadId: "owned",
      expectedText: "OWN_FINAL",
    });
    assert.equal(hidden.finalVisible, false);
    shell.removeAttribute("hidden");

    shell.innerHTML =
      '<div data-transcript-preparing="owned"><div data-owner-thread="sibling" class="w-full min-w-0">OWN_FINAL</div></div>';
    assert.equal(
      snapshotOwnedSceneDOM({
        threadId: "owned",
        expectedText: "OWN_FINAL",
      }).finalVisible,
      false,
    );

    shell.innerHTML = '<div data-codex-row="assistant-owned">OWN_FINAL controls</div>';
    shell.querySelector("[data-codex-row]").getBoundingClientRect = () => ({
      width: 100,
      height: 20,
    });
    const loaded = snapshotOwnedSceneDOM({
      threadId: "owned",
      expectedText: "OWN_FINAL",
      assistantRowKey: "assistant-owned",
    });
    assert.equal(loaded.richBodyReady, true);
    assert.equal(loaded.finalVisible, true);
    assert.equal(
      snapshotOwnedSceneDOM({
        threadId: "owned",
        expectedText: "OWN_FINAL",
        assistantRowKey: "user-prompt-row",
      }).finalVisible,
      false,
    );
    shell.innerHTML = '<div data-codex-row="user-prompt-row" class="self-end">OWN_FINAL</div>';
    shell.querySelector("[data-codex-row]").getBoundingClientRect = () => ({
      width: 100,
      height: 20,
    });
    assert.equal(
      snapshotOwnedSceneDOM({
        threadId: "owned",
        expectedText: "OWN_FINAL",
        assistantPreviewRoleConfirmed: true,
      }).finalVisible,
      false,
    );
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    dom.window.close();
  }
});

test("injected fault classification requires the actual affected request or a bounded exact console failure", () => {
  const offline = {
    affectedOffline: true,
    affectedRefresh: false,
    withinOfflineWindow: true,
    withinRefreshWindow: false,
  };
  assert.equal(
    classifyControlledNetworkFailure({
      ...offline,
      kind: "request",
      message: "net::ERR_INTERNET_DISCONNECTED",
    }),
    "offline",
  );
  assert.equal(
    classifyControlledNetworkFailure({
      ...offline,
      affectedOffline: false,
      kind: "request",
      message: "net::ERR_INTERNET_DISCONNECTED",
    }),
    null,
  );
  assert.equal(
    classifyControlledNetworkFailure({
      ...offline,
      kind: "console",
      message: "Failed to load resource: net::ERR_INTERNET_DISCONNECTED",
    }),
    "offline",
  );
  assert.equal(
    classifyControlledNetworkFailure({
      ...offline,
      withinOfflineWindow: false,
      kind: "console",
      message: "Failed to load resource: net::ERR_INTERNET_DISCONNECTED",
    }),
    null,
  );
  assert.equal(
    classifyControlledNetworkFailure({
      ...offline,
      kind: "console",
      message: "Recovery failed to fetch current permissions",
    }),
    null,
  );
  assert.equal(
    classifyControlledNetworkFailure({
      ...offline,
      affectedOffline: false,
      affectedRefresh: true,
      kind: "request",
      message: "net::ERR_ABORTED",
    }),
    "refresh",
  );
});

test("repeated safety-stop and final cleanup share one handled browser close", async () => {
  let closes = 0;
  const failures = [];
  const close = createOwnedBrowserShutdown(
    async () => {
      closes++;
      throw new Error("owned-close-failure");
    },
    (error) => failures.push(error.name),
  );
  assert.deepEqual(await Promise.all([close(), close(), close()]), [
    false,
    false,
    false,
  ]);
  assert.equal(await close(), false);
  assert.equal(closes, 1);
  assert.deepEqual(failures, ["Error"]);
});

test("live acceptance URLs cannot carry credentials, target parameters or alternate paths", () => {
  assert.equal(
    validateLiveUrl("https://lan.example:8443/"),
    "https://lan.example:8443",
  );
  for (const value of [
    "https://user:secret@lan.example/",
    "https://lan.example/?token=secret",
    "https://lan.example/#thread",
    "https://lan.example/other",
    "file:///tmp/local",
  ])
    assert.throws(() => validateLiveUrl(value));
});

test("same-origin WebSocket checks map secure protocols while pinning host and port", () => {
  assert.equal(
    webSocketMatchesHttpOrigin("wss://lan.example:8484/live", "https://lan.example:8484"),
    true,
  );
  assert.equal(
    webSocketMatchesHttpOrigin("ws://127.0.0.1:1234/live", "http://127.0.0.1:1234"),
    true,
  );
  for (const [socket, origin] of [
    ["wss://lan.example:8485/live", "https://lan.example:8484"],
    ["wss://other.example:8484/live", "https://lan.example:8484"],
    ["wss://lan.example:8484/live", "http://lan.example:8484"],
    ["ws://lan.example:8484/live", "https://lan.example:8484"],
    ["https://lan.example:8484/live", "https://lan.example:8484"],
  ])
    assert.equal(webSocketMatchesHttpOrigin(socket, origin), false);
});

test("a live target must have explicit native read position and matching shared latest-reply read proof", () => {
  const target = { threadId: "native-thread", cwd: "/project" };
  const metadata = {
    thread: { id: target.threadId, cwd: target.cwd },
    readState: { revision: "opaque-revision", firstUnread: null },
  };
  const latest = { data: [{ id: "turn-last", status: "completed" }] };
  const management = {
    namespaces: { codex: "shared-native-domain" },
    entries: [
      {
        namespace: "shared-native-domain",
        kind: "codex",
        id: target.threadId,
        completed: [{ id: "turn-last" }],
        read: ["turn-last"],
      },
    ],
  };
  assert.deepEqual(
    projectAlreadyReadProof(metadata, latest, management, target),
    {
      latestTurnId: "turn-last",
      latestTurnStatus: "completed",
      nativeReadConfirmed: true,
      sharedReadConfirmed: true,
    },
  );
  for (const native of [
    { revision: "opaque-revision" },
    { revision: "opaque-revision", firstUnread: { type: "threadStart" } },
    {
      revision: "opaque-revision",
      firstUnread: { type: "turn", turnId: "turn-last" },
    },
  ])
    assert.throws(() =>
      projectAlreadyReadProof(
        { ...metadata, readState: native },
        latest,
        management,
        target,
      ),
    );
  assert.throws(() =>
    projectAlreadyReadProof(
      metadata,
      latest,
      { ...management, entries: [] },
      target,
    ),
  );
  assert.throws(() =>
    projectAlreadyReadProof(
      metadata,
      latest,
      { ...management, entries: [{ ...management.entries[0], read: [] }] },
      target,
    ),
  );
  assert.throws(() =>
    projectAlreadyReadProof(
      metadata,
      { data: [{ id: "new-turn", status: "inProgress" }] },
      management,
      target,
    ),
  );
});

test("live target configuration admits only bounded source identity metadata", () => {
  const target = {
    version: 1,
    kind: "codex",
    threadId: "native-thread",
    cwd: "/project",
    runtimeInstance: "owned-runtime",
    namespace: "native-history",
    daemonIdentity: "a".repeat(64),
  };
  assert.deepEqual(projectLiveTarget(target), target);
  for (const value of [
    { ...target, token: "secret" },
    { ...target, body: "message" },
    { ...target, kind: "acp" },
    { ...target, cwd: "relative" },
    { ...target, daemonIdentity: "not-an-identity" },
    { ...target, daemonIdentity: ["a".repeat(64)] },
    { ...target, threadId: "x".repeat(513) },
  ])
    assert.throws(() => projectLiveTarget(value));
});

test("known metadata reads and empty synchronization are distinguished from actual writes", () => {
  assert.equal(classifyLiveRequest("GET", "/api/session/health"), "read");
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/skills/list", {}),
    "read",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/config/read", {}),
    "read",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/config/write", {}),
    "unknown-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/filesystem/watch", {}),
    "client-resource",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/telemetry/active", {}),
    "client-presence",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/thread/metadata", {
      threadId: "target",
    }),
    "read",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/thread/turns/list", {
      threadId: "target",
    }),
    "read",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/tabs", {
      operations: [],
      seed: [],
    }),
    "empty-sync",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/management", {
      operations: [{ action: { type: "read" } }],
    }),
    "management-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/tabs", {
      operations: [{ action: { type: "remove" } }],
    }),
    "management-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/turn/start", {
      threadId: "target",
    }),
    "task-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/thread/resume", {
      threadId: "target",
    }),
    "task-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/cc/connect", {}),
    "task-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/codex/thread/goal/set", {}),
    "task-write",
  );
  assert.equal(
    classifyLiveRequest("POST", "/api/session/unknown", {}),
    "unknown-write",
  );
});

test("the explicit POST bots/list runtime route is read-only without opening other bot writes", () => {
  assert.equal(
    classifyLiveRequest("POST", "/api/session/api/bots/list", {
      include_archived: false,
    }),
    "read",
  );
  for (const path of [
    "/api/session/api/bots/listing",
    "/api/session/api/bots/create",
    "/api/session/api/bots/update",
    "/api/session/api/bots/delete",
  ])
    assert.equal(
      classifyLiveRequest("POST", path, {}),
      "unknown-write",
      path,
    );
});

test("resume-not-sent requires the fixed audit, exact original receipt, same source, and zero task ingress", () => {
  const proofSha = "a".repeat(64),
    receiptSha = "b".repeat(64),
    priorDriverSha = "c".repeat(64),
    daemonIdentity = "d".repeat(64),
    proofPath = "/private/luna-not-sent-audit.json",
    receiptPath = "/private/owned-canary.json",
    source = {
      threadId: "owned-thread",
      cwd: "/private/project",
      runtimeInstance: "runtime-instance",
      namespace: "codex-namespace",
      daemonIdentity,
    };
  const receipt = {
    threadId: source.threadId,
    cwd: source.cwd,
    approvalNonce: "original-nonce",
    phase: "submitting-unknown-until-native-turn",
    threadStarts: 1,
    hasSendReserved: true,
    uiSendGestures: 1,
    visibleModelPosts: 0,
    passed: false,
    failure: { pathname: "/api/session/api/bots/list" },
    source: {
      runtimeInstance: source.runtimeInstance,
      namespace: source.namespace,
      daemonIdentity: source.daemonIdentity,
    },
  };
  const proof = {
    classification: "transport-not-sent; original UI reservation and gesture retained",
    ownership: {
      threadId: source.threadId,
      threadStarts: 1,
      receiptPath,
      receiptSha256: receiptSha,
      receiptHasSendReserved: true,
      uiSendGestures: 1,
      visibleModelPosts: 0,
      phase: receipt.phase,
      passed: false,
    },
    deliveryPathProof: {
      taskRoute: "POST /api/session/followups/submit",
    },
    attemptDisposition: { runtimeDeliveryDisposition: "NOT_SENT" },
    gatewayLog: {
      taskPathCounts: {
        "/api/session/followups/submit": 0,
        "/api/session/api/codex/turn/start": 0,
        "/api/session/followups/change": 0,
        "/api/session/followups/stop": 0,
        "/api/session/followups/review": 0,
        "/api/session/api/codex/turn/steer": 0,
        "/api/session/api/codex/turn/interrupt": 0,
      },
    },
    stateReconciliation: {
      frontendBackendAccountDigestEqual: true,
      exactThreadAndCwdMatch: true,
      nativeTurnCount: 0,
      followupQueueCount: 0,
      scopeTokenStored: false,
    },
    identity: { officialDaemonIdentity: daemonIdentity },
    processAndBrowserCleanup: { driverProcessStillPresent: false },
    sourceHashes: {
      ".dev-runtime/lan-readonly-20261030/owned-canary.mjs": priorDriverSha,
    },
  };
  const valid = {
    proof,
    proofPath,
    expectedProofPath: proofPath,
    providedProofSha256: proofSha,
    expectedProofSha256: proofSha,
    actualProofSha256: proofSha,
    receiptPath,
    expectedReceiptPath: receiptPath,
    actualReceiptSha256: receiptSha,
    receipt,
    expectedSource: source,
    expectedAttempt1DriverSha256: priorDriverSha,
  };
  assert.equal(validateNotSentResumeProof(valid), true);
  assert.equal(
    validateNotSentResumeProof({ ...valid, actualProofSha256: "f".repeat(64) }),
    false,
  );
  assert.equal(
    validateNotSentResumeProof({ ...valid, actualReceiptSha256: "e".repeat(64) }),
    false,
  );
  assert.equal(
    validateNotSentResumeProof({ ...valid, expectedSource: { ...source, namespace: "other" } }),
    false,
  );
  assert.equal(
    validateNotSentResumeProof({ ...valid, proof: { ...proof, gatewayLog: { taskPathCounts: { "/api/session/followups/submit": 1 } } } }),
    false,
  );
  assert.equal(
    validateNotSentResumeProof({ ...valid, receipt: { ...receipt, uiSendGestures: 0 } }),
    false,
  );
});
