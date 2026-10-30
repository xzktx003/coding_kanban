/** Metadata-only policy for the explicit live LAN acceptance runner. */
export function snapshotOwnedSceneDOM({
  threadId,
  expectedText = null,
  assistantRowKey = null,
  assistantPreviewRoleConfirmed = false,
}) {
  const visible = (element) =>
    element &&
    element.getBoundingClientRect().width > 0 &&
    window.getComputedStyle(element).visibility !== "hidden";
  const visibleOwners = [
    ...document.querySelectorAll(".session-codex-composer[data-owner-thread]"),
  ].filter(visible);
  const owners = visibleOwners.filter(
    (element) => element.getAttribute("data-owner-thread") === threadId,
  );
  const owner = owners[0];
  const card = [...document.querySelectorAll("[data-session-card]")].find(
    (element) =>
      element.getAttribute("data-session-card") === threadId &&
      visible(element),
  );
  const shell = [...document.querySelectorAll("[data-codex-transcript-shell]")].find(
    (element) =>
      element.getAttribute("data-codex-transcript-shell") === threadId &&
      visible(element),
  );
  const preparing = shell?.querySelector("[data-transcript-preparing]");
  const previewAssistant = expectedText === null
    ? null
    : [...(preparing?.querySelectorAll("[data-owner-thread]") ?? [])].find(
        (element) =>
          element.getAttribute("data-owner-thread") === threadId &&
          !element.classList.contains("self-end") &&
          element.textContent?.trim() === expectedText &&
          visible(element),
      );
  const richAssistant =
    expectedText === null
      ? null
      : [...((shell ?? card)?.querySelectorAll("[data-codex-row]") ?? [])].find(
          (element) =>
            ((typeof assistantRowKey === "string" &&
              element.getAttribute("data-codex-row") === assistantRowKey) ||
              (assistantPreviewRoleConfirmed &&
                !element.classList.contains("self-end") &&
                !element.querySelector(".self-end"))) &&
            element.textContent?.includes(expectedText) &&
            visible(element),
        );
  const assistantReplyVisible = !!(previewAssistant || richAssistant);
  const richBodyReady =
    !!shell && !preparing && shell.querySelectorAll("[data-codex-row]").length > 0;
  return {
    owner: owner?.getAttribute("data-owner-thread") ?? null,
    ownerCount: owners.length,
    visibleOwnerCount: visibleOwners.length,
    editorEmpty: !owner
      ?.querySelector('[contenteditable="true"]')
      ?.textContent?.trim(),
    stop: [...(owner?.querySelectorAll(".session-composer-stop") ?? [])].some(
      visible,
    ),
    pendingQuestion: !!owner?.querySelector('[aria-label^="回答问题"]'),
    historyRows: shell
      ? shell.querySelectorAll("[data-codex-row],[data-codex-live-message]").length +
        (preparing?.querySelectorAll("[data-owner-thread]").length ?? 0)
      : (card?.querySelectorAll("[data-codex-row],[data-codex-live-message]")
          .length ?? 0),
    finalVisible: expectedText === null ? null : assistantReplyVisible,
    assistantReplyVisible:
      expectedText === null ? null : assistantReplyVisible,
    richBodyReady,
    fallbackVisible: !!preparing && visible(preparing),
    ownedTranscriptShellVisible: !!shell,
    selectedTabs: [
      ...document.querySelectorAll(
        '[role="tab"][aria-selected="true"][data-tab-key]',
      ),
    ]
      .filter(visible)
      .map((element) => element.getAttribute("data-tab-key")),
    navigation: !!document.querySelector('[data-navigation-ready="true"]'),
    interruptionSamples: window.__liveReadonlyInterruptionSamples ?? null,
    interruptionSamplesTruncated:
      window.__liveReadonlyInterruptionTruncated === true,
    canaryInterrupted: window.__canaryInterrupted ?? 0,
  };
}

/** WebSocket URL must be the same origin as the pinned HTTP(S) application. */
export function webSocketMatchesHttpOrigin(socketUrl, httpOrigin) {
  try {
    const socket = new URL(socketUrl);
    const http = new URL(httpOrigin);
    if (
      !["ws:", "wss:"].includes(socket.protocol) ||
      !["http:", "https:"].includes(http.protocol) ||
      socket.username ||
      socket.password ||
      http.username ||
      http.password
    )
      return false;
    const mappedProtocol = socket.protocol === "wss:" ? "https:" : "http:";
    return `${mappedProtocol}//${socket.host}` === http.origin;
  } catch {
    return false;
  }
}
export function classifyControlledNetworkFailure(value) {
  if (value.kind === "request") {
    if (
      value.affectedOffline &&
      ["net::ERR_INTERNET_DISCONNECTED", "net::ERR_NETWORK_CHANGED"].includes(
        value.message,
      )
    )
      return "offline";
    if (value.affectedRefresh && value.message === "net::ERR_ABORTED")
      return "refresh";
  }
  if (value.kind === "console") {
    if (
      value.affectedOffline &&
      value.withinOfflineWindow &&
      /^Failed to load resource: net::ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED)$/.test(
        value.message,
      )
    )
      return "offline";
    if (
      value.affectedRefresh &&
      value.withinRefreshWindow &&
      value.message === "Failed to load resource: net::ERR_ABORTED"
    )
      return "refresh";
  }
  return null;
}
export function createOwnedBrowserShutdown(close, recordError) {
  let promise;
  return () =>
    (promise ??= (async () => {
      try {
        await close();
        return true;
      } catch (error) {
        recordError(error);
        return false;
      }
    })());
}
export function validateLiveUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Live acceptance requires an explicit origin without credentials, query or path",
    );
  return url.origin;
}
export function projectLiveTarget(value) {
  const allowed = [
    "version",
    "kind",
    "threadId",
    "cwd",
    "runtimeInstance",
    "namespace",
    "daemonIdentity",
    "expectNoInterruptedHistory",
  ];
  const text = (v, max) =>
    typeof v === "string" &&
    !!v.trim() &&
    v.length <= max &&
    !/[\x00-\x1f\x7f]/.test(v);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.version !== 1 ||
    value.kind !== "codex" ||
    !text(value.threadId, 512) ||
    !text(value.cwd, 4096) ||
    !(value.cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value.cwd)) ||
    !text(value.runtimeInstance, 512) ||
    !text(value.namespace, 512) ||
    typeof value.daemonIdentity !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.daemonIdentity) ||
    (value.expectNoInterruptedHistory !== undefined &&
      typeof value.expectNoInterruptedHistory !== "boolean")
  )
    throw new Error(
      "Live target must contain only confirmed bounded Codex source identity metadata",
    );
  return Object.fromEntries(
    allowed
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
}
export function classifyLiveRequest(method, pathname, body) {
  const path = pathname.replace(/^\/api\/session(?=\/)/, "");
  if (
    /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|delete|archive|unarchive|rollback|acquire|goal\/(?:set|clear))|review\/start|approval\/[^/]+|cc\/(?:connect|resume|send|interrupt|stop)|acp\/(?:connect|load-session|new-session|cancel|stop|prompt)|lifecycle\/(?:restore|archive))$/.test(
      path,
    )
  )
    return "task-write";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return "read";
  if (method !== "POST") return "unknown-write";
  if (["/tabs", "/projects", "/management"].includes(path))
    return Array.isArray(body?.operations) && body.operations.length === 0
      ? "empty-sync"
      : "management-write";
  // The legacy runtime exposes bot enumeration as POST, but this exact route
  // only calls SessionDatabase.listBots. Keep every other bot POST unknown.
  if (path === "/api/bots/list") return "read";
  if (path === "/api/codex/connect") return "connection-read";
  if (path === "/api/telemetry/active") return "client-presence";
  if (
    [
      "/api/filesystem/watch",
      "/api/filesystem/unwatch",
      "/api/sleep/prevent",
      "/api/sleep/allow",
    ].includes(path)
  )
    return "client-resource";
  if (
    new Set([
      "/api/codex/model/list",
      "/api/codex/skills/list",
      "/api/codex/config/read",
      "/api/codex/account/get",
      "/api/codex/account/rate-limits",
      "/api/codex/thread/list",
      "/api/codex/thread/read",
      "/api/codex/thread/metadata",
      "/api/codex/thread/turns/list",
      "/api/codex/thread/items/list",
      "/api/codex/thread/access",
      "/api/codex/thread/goal/get",
      "/api/codex/thread/readState/read",
      "/api/codex/thread/readState/get",
      "/api/codex/plugin/list",
      "/api/codex/plugin/read",
      "/api/codex/plugin/installed",
      "/subagents/snapshot",
      "/api/git/branch-info",
      "/api/git/status",
      "/api/git/diff-stats",
    ]).has(path)
  )
    return "read";
  return "unknown-write";
}

const NOT_SENT_TASK_PATHS = [
  "/api/session/followups/submit",
  "/api/session/api/codex/turn/start",
  "/api/session/followups/change",
  "/api/session/followups/stop",
  "/api/session/followups/review",
  "/api/session/api/codex/turn/steer",
  "/api/session/api/codex/turn/interrupt",
];

/** Pure admission guard for a root-reviewed transport NOT_SENT audit. */
export function validateNotSentResumeProof(value) {
  const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!value || typeof value !== "object") return false;
  const {
    proof,
    proofPath,
    expectedProofPath,
    providedProofSha256,
    expectedProofSha256,
    actualProofSha256,
    receiptPath,
    expectedReceiptPath,
    actualReceiptSha256,
    receipt,
    expectedSource,
    expectedAttempt1DriverSha256,
  } = value;
  if (
    !proof ||
    typeof proof !== "object" ||
    !receipt ||
    typeof receipt !== "object" ||
    typeof expectedSource !== "object" ||
    !hash(providedProofSha256) ||
    !hash(expectedProofSha256) ||
    !hash(actualProofSha256) ||
    !hash(actualReceiptSha256) ||
    !hash(expectedAttempt1DriverSha256) ||
    proofPath !== expectedProofPath ||
    receiptPath !== expectedReceiptPath ||
    providedProofSha256 !== expectedProofSha256 ||
    actualProofSha256 !== expectedProofSha256 ||
    proof.classification !==
      "transport-not-sent; original UI reservation and gesture retained"
  )
    return false;
  const ownership = proof.ownership,
    source = receipt.source,
    state = proof.stateReconciliation,
    gateway = proof.gatewayLog,
    identity = proof.identity;
  if (
    !ownership ||
    !source ||
    !state ||
    !gateway ||
    !identity ||
    proof.attemptDisposition?.runtimeDeliveryDisposition !== "NOT_SENT" ||
    proof.deliveryPathProof?.taskRoute !==
      "POST /api/session/followups/submit" ||
    proof.sourceHashes?.[
      ".dev-runtime/lan-readonly-20261030/owned-canary.mjs"
    ] !== expectedAttempt1DriverSha256 ||
    ownership.receiptPath !== expectedReceiptPath ||
    ownership.receiptSha256 !== actualReceiptSha256 ||
    ownership.threadId !== receipt.threadId ||
    ownership.threadStarts !== 1 ||
    ownership.receiptHasSendReserved !== true ||
    ownership.uiSendGestures !== 1 ||
    ownership.visibleModelPosts !== 0 ||
    ownership.passed !== false ||
    receipt.phase !== "submitting-unknown-until-native-turn" ||
    receipt.threadStarts !== 1 ||
    receipt.hasSendReserved !== true ||
    receipt.uiSendGestures !== 1 ||
    receipt.visibleModelPosts !== 0 ||
    receipt.nativeAccepted === true ||
    receipt.turnId !== undefined ||
    receipt.passed !== false ||
    receipt.failure?.pathname !== "/api/session/api/bots/list" ||
    receipt.threadId !== expectedSource.threadId ||
    source.runtimeInstance !== expectedSource.runtimeInstance ||
    source.namespace !== expectedSource.namespace ||
    source.daemonIdentity !== expectedSource.daemonIdentity ||
    identity.officialDaemonIdentity !== expectedSource.daemonIdentity ||
    state.frontendBackendAccountDigestEqual !== true ||
    state.exactThreadAndCwdMatch !== true ||
    state.nativeTurnCount !== 0 ||
    state.followupQueueCount !== 0 ||
    state.scopeTokenStored !== false ||
    proof.processAndBrowserCleanup?.driverProcessStillPresent !== false
  )
    return false;
  const counts = gateway.taskPathCounts;
  return (
    !!counts &&
    NOT_SENT_TASK_PATHS.every((path) => counts[path] === 0)
  );
}
export function projectAlreadyReadProof(metadata, recent, management, target) {
  const latest = recent?.data?.[0];
  const namespace = management?.namespaces?.codex;
  const entry = management?.entries?.find(
    (value) =>
      value.kind === "codex" &&
      value.id === target.threadId &&
      value.namespace === namespace,
  );
  if (
    metadata?.thread?.id !== target.threadId ||
    metadata.thread.cwd !== target.cwd ||
    typeof metadata.readState?.revision !== "string" ||
    !metadata.readState.revision ||
    metadata.readState.firstUnread !== null ||
    !latest ||
    typeof latest.id !== "string" ||
    !latest.id ||
    latest.id.length > 512 ||
    !["completed", "failed", "interrupted"].includes(latest.status) ||
    typeof namespace !== "string" ||
    !namespace ||
    !Array.isArray(entry?.completed) ||
    !entry.completed.some((reply) => reply.id === latest.id) ||
    !Array.isArray(entry?.read) ||
    !entry.read.includes(latest.id)
  )
    throw new Error(
      "Native and shared latest-reply read state must both be explicitly confirmed before browser entry",
    );
  return {
    latestTurnId: latest.id,
    latestTurnStatus: latest.status,
    nativeReadConfirmed: true,
    sharedReadConfirmed: true,
  };
}
