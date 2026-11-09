import { posix } from "node:path";
import { isSupportedDaemonVersion, parseDaemonInitializeVersion } from "./daemon-cli-adapter.mjs";
import { isSharedTurnItemsParams, isSharedTurnItemsPage } from "./shared-thread-history.mjs";
import { isSharedThreadCreationAuthority } from "./shared-thread-creation.mjs";
import { isSharedThreadSendAuthority } from "./shared-thread-send.mjs";
import { isSharedNativeModelSelection, observeSharedNativeModelList } from "./shared-native-model-selection.mjs";
import { classifySharedServerNotification, SHARED_THREAD_NOTIFICATION_METHODS } from "./shared-server-notification-policy.mjs";
import { isSharedThreadArtifactAuthority, isSharedThreadArtifactMethod } from "./shared-thread-artifacts.mjs";

// Server-owned, synchronous final-dispatch gate for a single already-verified
// daemon client. It is not installed by default. Its writer must initiate the
// actual socket write synchronously; transport/identity ownership remains with
// the caller. Unknown methods are denied rather than transparently forwarded.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REQUEST = 64 * 1024,
  MAX_RESPONSE = 16 * 1024 * 1024,
  MAX_REGISTRATIONS = 16,
  MAX_INFLIGHT = 64,
  MAX_USED = 8192;
const error = (code) =>
  Object.assign(new Error("Shared daemon request denied"), { code });
const denied = () => error("SHARED_DAEMON_DENIED"),
  unknown = () => error("SHARED_DAEMON_OUTCOME_UNKNOWN");
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const keys = (x, allowed, required = allowed) =>
  object(x) &&
  Object.keys(x).every((k) => allowed.includes(k)) &&
  required.every((k) => Object.hasOwn(x, k));
const atom = (x) =>
  typeof x === "string" &&
  x.length > 0 &&
  x.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(x);
const rpcId = (x) => atom(x) || (Number.isSafeInteger(x) && x >= 0);
const key = (id) => `${typeof id}:${id}`;
const cursor = (x) =>
  x == null ||
  (typeof x === "string" && x.length <= 4096 && !/[\x00-\x1f\x7f]/.test(x));
const optionalList = (x) =>
  x == null || (Array.isArray(x) && x.length <= 64 && x.every(atom));
const optionalId = (x) => x == null || UUID.test(x);
const serverNotifications = new Set([
  "account/updated", "account/rateLimits/updated", ...SHARED_THREAD_NOTIFICATION_METHODS,
]);
// Stable 0.166.0 schemas define these three read-only methods with only
// {path}. Unsupported host filesystem access is reported explicitly to the
// SDK; stateful watches and every filesystem write remain outside this set.
const unsupportedFilesystemReads = new Set([
  "fs/readFile", "fs/getMetadata", "fs/readDirectory",
]);
// Exact optional-host method names from stable 0.166.0 ClientRequest.json.
// These are recognized ONLY to return -32601, never dispatched or granted.
// Task, connection, approval, auth and supported-method variants are excluded.
const unsupportedHostCapabilities = new Set([
  "server/diagnostics",
  "project/list", "project/read", "project/create", "project/import", "project/update", "project/move", "project/delete",
  "threadSection/list", "threadSection/create", "threadSection/update", "threadSection/delete",
  "skills/list", "skills/extraRoots/set", "skills/config/write", "hooks/list",
  "marketplace/add", "marketplace/remove", "marketplace/upgrade",
  "plugin/list", "plugin/search", "plugin/installed", "plugin/reconcile", "plugin/read", "plugin/skill/read",
  "plugin/share/save", "plugin/share/updateTargets", "plugin/share/list", "plugin/share/checkout", "plugin/share/delete", "plugin/install", "plugin/uninstall",
  "app/read", "app/list", "app/installed",
  "fs/writeFile", "fs/createDirectory", "fs/remove", "fs/copy", "fs/watch", "fs/unwatch",
  "process/spawn", "process/writeStdin", "process/kill", "process/resizePty",
  "modelProvider/capabilities/read", "experimentalFeature/list", "permissionProfile/list",
  // Original SDK auto-syncs process-wide flags at startup; unsupported here.
  // Returning -32601 is its original caller fallback, never a flag mutation.
  "experimentalFeature/enablement/set",
  "remoteControl/status/read", "environment/info", "environment/status",
  "mcpServerStatus/list", "mcpServer/resource/read", "windowsSandbox/readiness",
  "account/usage/read", "account/workspaceMessages/read", "feedback/upload", "feedback/save",
  "externalAgentConfig/detect", "externalAgentConfig/import", "externalAgentConfig/import/recordHistory", "externalAgentConfig/import/readHistories",
  "fuzzyFileSearch", "fuzzyFileSearch/sessionStart", "fuzzyFileSearch/sessionUpdate", "fuzzyFileSearch/sessionStop",
]);
// Fixed original desktop SDK housekeeping, absent from the stable CLI schema.
// Recognized only for local -32601; never execute or compress native history.
const unsupportedSdkHousekeeping = new Set(["rollout/compress"]);
// Fixed original pX -> oJ metadata generators use a separate read-only,
// ephemeral start. Recognize that complete contract only to report capability
// absence. It never grants a creation nonce, dispatches a task, or changes flags.
const unsupportedMetadataSources = new Set(["thread_title", "thread_description", "thread_summary"]);
function unsupportedBackgroundStart(frame) {
  const p = frame.params;
  return frame.method === "thread/start" &&
    keys(p, ["model", "modelProvider", "allowProviderModelFallback", "cwd", "approvalPolicy", "permissions", "runtimeWorkspaceRoots", "config", "baseInstructions", "developerInstructions", "personality", "ephemeral", "threadSource", "experimentalRawEvents", "dynamicTools", "serviceTier", "serviceName"],
      ["model", "modelProvider", "allowProviderModelFallback", "cwd", "approvalPolicy", "permissions", "runtimeWorkspaceRoots", "config", "personality", "ephemeral", "threadSource", "experimentalRawEvents", "dynamicTools", "serviceTier"]) &&
    atom(p.model) && p.modelProvider === null && p.allowProviderModelFallback === true &&
    (p.cwd === null || (typeof p.cwd === "string" && p.cwd.length <= 4096 && !/[\x00-\x1f\x7f]/.test(p.cwd) && posix.isAbsolute(p.cwd) && posix.normalize(p.cwd) === p.cwd)) &&
    p.approvalPolicy === "never" && p.permissions === ":read-only" &&
    Array.isArray(p.runtimeWorkspaceRoots) && p.runtimeWorkspaceRoots.length === 0 && object(p.config) &&
    (p.baseInstructions === undefined || typeof p.baseInstructions === "string") &&
    (p.developerInstructions === undefined || typeof p.developerInstructions === "string") &&
    p.personality === null && p.ephemeral === true && unsupportedMetadataSources.has(p.threadSource) &&
    p.experimentalRawEvents === false && p.dynamicTools === null &&
    (p.serviceTier === null || atom(p.serviceTier)) && (p.serviceName === undefined || atom(p.serviceName));
}
const serverRequests = new Set([
  "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
  "item/permissions/requestApproval", "item/tool/requestUserInput",
]);
function startupMetadata(frame){
  if(!keys(frame,["method","params","jsonrpc","emittedAtMs"],["method","params"])||
     (frame.jsonrpc!==undefined&&frame.jsonrpc!=="2.0")||
     (frame.emittedAtMs!==undefined&&(!Number.isSafeInteger(frame.emittedAtMs)||frame.emittedAtMs<0)))return false;
  const p=frame.params;
  if(frame.method==="configWarning")return keys(p,["summary","details"])&&typeof p.summary==="string"&&p.summary.length>0&&p.summary.length<=4096&&
    (p.details===null||(typeof p.details==="string"&&p.details.length<=4096));
  return frame.method==="remoteControl/status/changed"&&keys(p,["status","serverName","installationId","environmentId"])&&
    p.status==="disabled"&&atom(p.serverName)&&UUID.test(p.installationId??"")&&p.environmentId===null;
}
function bindingCopy(x) {
  const allowed = [
    "hostId",
    "runtimeGeneration",
    "daemonGeneration",
    "accountRevision",
    "projectId",
    "threadId",
    "viewId",
    "clientId",
  ];
  if (
    !keys(x, allowed) ||
    !atom(x.hostId) ||
    !atom(x.projectId) ||
    !Number.isSafeInteger(x.accountRevision) ||
    x.accountRevision < 0 ||
    ![
      x.runtimeGeneration,
      x.daemonGeneration,
      x.threadId,
      x.viewId,
      x.clientId,
    ].every((y) => UUID.test(y ?? ""))
  )
    throw denied();
  return Object.freeze(
    Object.fromEntries(allowed.map((name) => [name, x[name]])),
  );
}
function parse(encoded, max) {
  if (typeof encoded !== "string" || Buffer.byteLength(encoded) > max)
    throw denied();
  try {
    const frame = JSON.parse(encoded);
    if (!object(frame)) throw denied();
    return frame;
  } catch {
    throw denied();
  }
}
// Fixed read-only QueuedSubmission input union. These values are passed to
// the original queue consumer; reading them grants no queue mutation or send.
function queuedInput(value) {
  if (!object(value)) return false;
  const string = x => typeof x === "string", uint = x => Number.isSafeInteger(x) && x >= 0;
  const detail = x => x == null || ["auto", "low", "high", "original"].includes(x);
  if (value.type === "text") return keys(value, ["type", "text", "text_elements"], ["type", "text"]) && string(value.text) &&
    (value.text_elements === undefined || Array.isArray(value.text_elements) && value.text_elements.every(element =>
      keys(element, ["byteRange", "placeholder"], ["byteRange"]) && keys(element.byteRange, ["start", "end"]) &&
      uint(element.byteRange.start) && uint(element.byteRange.end) && (element.placeholder == null || string(element.placeholder))));
  if (value.type === "image") return keys(value, ["type", "url", "fileId", "detail"], ["type"]) && detail(value.detail) &&
    (Object.hasOwn(value, "url") || Object.hasOwn(value, "fileId")) &&
    (!Object.hasOwn(value, "url") || string(value.url)) && (!Object.hasOwn(value, "fileId") || string(value.fileId));
  if (value.type === "localImage") return keys(value, ["type", "path", "detail"], ["type", "path"]) && string(value.path) && detail(value.detail);
  if (value.type === "audio") return keys(value, ["type", "url"]) && string(value.url);
  if (value.type === "localAudio") return keys(value, ["type", "path"]) && string(value.path);
  return ["skill", "mention"].includes(value.type) && keys(value, ["type", "name", "path"]) && string(value.name) && string(value.path);
}
function queuedPage(result, params) {
  return keys(result, ["data", "nextCursor"], ["data"]) && Array.isArray(result.data) &&
    result.data.length <= (params.limit > 0 ? params.limit : 100) && cursor(result.nextCursor) &&
    result.data.every(value => keys(value, ["id", "clientUserMessageId", "input"]) && typeof value.id === "string" &&
      typeof value.clientUserMessageId === "string" && Array.isArray(value.input) && value.input.every(queuedInput));
}
function readRequest(frame, desktop = false) {
  const p = frame.params;
  if (desktop) {
    if (["configRequirements/read", "collaborationMode/list", "account/rateLimits/read"].includes(frame.method))
      return p === undefined || p === null || keys(p, [], []);
    if (frame.method === "account/read")
      return keys(p, ["refreshToken"]) && p.refreshToken === false;
    if (frame.method === "getAuthStatus")
      return keys(p, ["includeToken", "refreshToken"]) && p.includeToken === false && p.refreshToken === false;
    if (frame.method === "config/read")
      return keys(p, ["includeLayers", "cwd"], ["includeLayers"]) &&
        typeof p.includeLayers === "boolean" &&
        (p.cwd == null || (typeof p.cwd === "string" && p.cwd.length <= 4096 &&
          !/[\x00-\x1f\x7f]/.test(p.cwd) && posix.isAbsolute(p.cwd) && posix.normalize(p.cwd) === p.cwd));
    if (frame.method === "model/list")
      return keys(p, ["includeHidden", "cursor", "limit"], []) &&
        (p.includeHidden == null || typeof p.includeHidden === "boolean") && cursor(p.cursor) &&
        (p.limit == null || (Number.isSafeInteger(p.limit) && p.limit >= 1 && p.limit <= 100));
    // The original desktop QQ query pages exactly 100 native attachments.
    // The owner's read guard must independently bind the requested thread;
    // this method never grants attachment writes or a native writer lease.
    if (frame.method === "thread/attachment/list")
      return keys(p, ["threadId", "cursor", "limit"], ["threadId"]) &&
        UUID.test(p.threadId ?? "") && cursor(p.cursor) &&
        (p.limit == null || (Number.isSafeInteger(p.limit) && p.limit >= 1 && p.limit <= 100));
    // The original queue refresh omits limit and preserves native cursors. The
    // owner must supply the exact existing thread history binding on both ends.
    if (frame.method === "thread/queue/list")
      return keys(p, ["threadId", "cursor", "limit"], ["threadId"]) && UUID.test(p.threadId ?? "") && cursor(p.cursor) &&
        (p.limit == null || Number.isSafeInteger(p.limit) && p.limit >= 0 && p.limit <= 100);
  }
  if (!object(p)) return false;
  if (frame.method === "thread/list")
    return (
      keys(
        p,
        [
          "limit",
          "cursor",
          "sortKey",
          "modelProviders",
          "sourceKinds",
          "archived",
          "sectionId",
          "useStateDbOnly",
          "originators",
          "searchTerm",
          "ancestorThreadId",
          "parentThreadId",
          "attachedToThreadId",
          "sortDirection",
        ],
        ["limit", "useStateDbOnly"],
      ) &&
      Number.isSafeInteger(p.limit) &&
      p.limit >= 1 &&
      p.limit <= 200 &&
      p.useStateDbOnly === true &&
      cursor(p.cursor) &&
      (p.sortKey == null ||
        ["updated_at", "created_at", "recency_at"].includes(p.sortKey) ||
        (desktop && p.sortKey === "section_position")) &&
      (p.sortDirection == null || ["asc", "desc"].includes(p.sortDirection)) &&
      optionalList(p.modelProviders) &&
      optionalList(p.sourceKinds) &&
      optionalList(p.originators) &&
      (p.archived == null || typeof p.archived === "boolean") &&
      (p.sectionId == null || atom(p.sectionId)) &&
      (p.searchTerm == null ||
        (typeof p.searchTerm === "string" &&
          p.searchTerm.length <= 1024 &&
          !/[\x00-\x1f\x7f]/.test(p.searchTerm))) &&
      optionalId(p.ancestorThreadId) &&
      optionalId(p.parentThreadId) &&
      optionalId(p.attachedToThreadId) &&
      (p.attachedToThreadId == null || (p.parentThreadId == null && p.ancestorThreadId == null))
    );
  if (frame.method === "thread/read")
    return (
      keys(p, ["threadId", "includeTurns"]) &&
      UUID.test(p.threadId ?? "") &&
      p.includeTurns === false
    );
  if (frame.method === "thread/turns/list")
    return (
      keys(
        p,
        ["threadId", "limit", "cursor", "sortDirection", "itemsView"],
        ["threadId", "limit", "itemsView"],
      ) &&
      UUID.test(p.threadId ?? "") &&
      Number.isSafeInteger(p.limit) &&
      p.limit >= 1 &&
      p.limit <= 100 &&
      cursor(p.cursor) &&
      (p.sortDirection == null || ["asc", "desc"].includes(p.sortDirection)) &&
      ["summary", "notLoaded"].includes(p.itemsView)
    );
  if (frame.method === "thread/items/list") return isSharedTurnItemsParams(p);
  return false;
}
function requestFrame(frame, allowNoParams = false) {
  return (
    keys(
      frame,
      ["id", "method", "params", "jsonrpc", "trace"],
      allowNoParams ? ["id", "method"] : ["id", "method", "params"],
    ) &&
    rpcId(frame.id) &&
    typeof frame.method === "string" &&
    (object(frame.params) || (allowNoParams && frame.params == null)) &&
    (frame.jsonrpc === undefined || frame.jsonrpc === "2.0")
  );
}
// Exact SDK profile from Linux ASAR 1588e6a0... .vite/build/early-bootstrap.js
// modules 41549/45068 and module 78507. No arbitrary extension keys or list
// budget growth: longer opt-out lists must equal this fixed recorded vector.
const SDK_UI_EXTENSION = "io.modelcontextprotocol/ui";
const SDK_FORM_EXTENSION = "openai/elicitation";
const SDK_UI_MIMES = ["text/html;profile=mcp-app", "text/html+skybridge"];
const SDK_NOTIFICATION_OPT_OUT = Object.freeze([
  "thread/project/updated",
  "thread/prediction/updated",
  "rawResponseItem/completed",
  "command/exec/outputDelta",
  "project/changed",
  "externalAgentConfig/import/progress",
  "thread/compacted",
  "windows/worldWritableWarning",
  "modelProvider/authRecoveryStarted",
  "modelProvider/authRecoveryCompleted",
  "authStatusChange",
  "loginChatGptComplete",
  "codex/event/task_started",
  "codex/event/agent_reasoning",
  "codex/event/agent_message",
  "codex/event/task_complete",
  "codex/event/mcp_tool_call_begin",
  "codex/event/mcp_tool_call_end",
  "codex/event/exec_command_begin",
  "codex/event/exec_command_end",
  "codex/event/exec_command_output_delta",
  "codex/event/exec_approval_request",
  "codex/event/apply_patch_approval_request",
  "codex/event/background_event",
  "codex/event/turn_diff",
  "codex/event/get_history_entry_response",
  "codex/event/agent_reasoning_delta",
  "codex/event/agent_reasoning_section_break",
  "codex/event/agent_message_delta",
  "codex/event/stream_error",
  "codex/event/error",
  "codex/event/turn_aborted",
  "codex/event/plan_delta",
  "codex/event/plan_update",
  "codex/event/patch_apply_begin",
  "codex/event/patch_apply_end",
  "codex/event/item_started",
  "codex/event/item_completed",
  "codex/event/user_message",
  "codex/event/agent_reasoning_raw_content",
  "codex/event/agent_reasoning_raw_content_delta",
  "codex/event/web_search_begin",
  "codex/event/web_search_end",
  "codex/event/mcp_list_tools_response",
  "codex/event/list_skills_response",
  "codex/event/list_remote_skills_response",
  "codex/event/remote_skill_downloaded",
  "codex/event/list_custom_prompts_response",
  "codex/event/raw_response_item",
  "codex/event/agent_message_content_delta",
  "codex/event/reasoning_content_delta",
  "codex/event/reasoning_raw_content_delta",
  "codex/event/warning",
  "codex/event/undo_started",
  "codex/event/undo_completed",
  "codex/event/shutdown_complete",
  "codex/event/entered_review_mode",
  "codex/event/exited_review_mode",
  "codex/event/view_image_tool_call",
  "codex/event/mcp_startup_update",
  "codex/event/mcp_startup_complete",
  "codex/event/remote_task_created",
  "codex/event/thread_rolled_back",
  "codex/event/thread_name_updated",
  "codex/event/elicitation_request",
  "codex/event/dynamic_tool_call_request",
  "codex/event/request_user_input",
  "codex/event/terminal_interaction",
  "codex/event/token_count",
  "codex/event/deprecation_notice",
  "thread/closed",
  "thread/reverted",
  "rawResponse/completed",
  "warning",
  "turn/diff/updated"
]);
function initializeOptOut(value) {
  return optionalList(value) || (Array.isArray(value) &&
    value.length === SDK_NOTIFICATION_OPT_OUT.length &&
    value.every((name, index) => name === SDK_NOTIFICATION_OPT_OUT[index]));
}
function initializeExtensions(value) {
  if (!keys(value, [SDK_UI_EXTENSION, SDK_FORM_EXTENSION], [SDK_UI_EXTENSION])) return false;
  const ui = value[SDK_UI_EXTENSION], mimes = ui?.mimeTypes;
  if (!keys(ui, ["mimeTypes"]) || !Array.isArray(mimes) ||
      ![2, 3].includes(mimes.length) ||
      !SDK_UI_MIMES.every((mime, index) => mimes[index] === mime) ||
      (mimes.length === 3 && mimes[2] !== "text/x-dil;profile=mcp-app")) return false;
  return !Object.hasOwn(value, SDK_FORM_EXTENSION) ||
    (keys(value[SDK_FORM_EXTENSION], ["form"]) && keys(value[SDK_FORM_EXTENSION].form, []));
}
function initializeFrame(frame) {
  const p = frame.params, info = p?.clientInfo, capabilities = p?.capabilities;
  return requestFrame(frame) && frame.method === "initialize" &&
    keys(p, ["clientInfo", "capabilities"], ["clientInfo"]) &&
    keys(info, ["name", "title", "version"], ["name", "version"]) &&
    atom(info.name) && atom(info.version) && (info.title == null || atom(info.title)) &&
    (capabilities === undefined || (keys(capabilities, ["experimentalApi", "requestAttestation", "optOutNotificationMethods", "explicitGatewayOauth", "extensions", "mcpServerOpenaiFormElicitation"], []) &&
      (capabilities.experimentalApi == null || typeof capabilities.experimentalApi === "boolean") &&
      (capabilities.requestAttestation == null || typeof capabilities.requestAttestation === "boolean") &&
      (capabilities.explicitGatewayOauth === undefined || typeof capabilities.explicitGatewayOauth === "boolean") &&
      (capabilities.extensions === undefined || initializeExtensions(capabilities.extensions)) &&
      (capabilities.mcpServerOpenaiFormElicitation === undefined ||
        (typeof capabilities.mcpServerOpenaiFormElicitation === "boolean" &&
          capabilities.mcpServerOpenaiFormElicitation === !!(capabilities.extensions && Object.hasOwn(capabilities.extensions, SDK_FORM_EXTENSION)))) &&
      initializeOptOut(capabilities.optOutNotificationMethods)));
}
function resumeFrame(frame, binding) {
  return (
    requestFrame(frame) &&
    frame.method === "thread/resume" &&
    keys(frame.params, ["threadId", "excludeTurns"]) &&
    frame.params.threadId === binding.threadId &&
    frame.params.excludeTurns === true
  );
}
// Recognize the existing canonical connect frame and the complete pinned
// SDK resumeThread DTO only to refuse an unregistered resume. No parameter is
// applied, no history is acquired, and no daemon request is written here.
function unsupportedUnregisteredResume(frame) {
  const p = frame.params;
  if (!object(p) || !UUID.test(p.threadId ?? "")) return false;
  if (resumeFrame(frame, { threadId: p.threadId })) return true;
  const allowed = ["threadId", "history", "path", "model", "modelProvider", "cwd", "approvalPolicy", "sandbox", "config", "developerInstructions", "personality", "excludeTurns"];
  const nullablePath = value => value === null || typeof value === "string" && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
  return keys(p, allowed, allowed.filter(name => name !== "developerInstructions")) &&
    ["history", "model", "modelProvider", "approvalPolicy", "sandbox", "personality"].every(name => p[name] === null) &&
    nullablePath(p.path) && nullablePath(p.cwd) && (p.config === null || object(p.config)) &&
    (p.developerInstructions === undefined || typeof p.developerInstructions === "string") && p.excludeTurns === true;
}
// Native attention metadata uses its original opaque revision CAS. This
// does not resume a thread or grant model/tool/approval or execution rights.
function readStateUpdateParams(value) {
  return keys(value, ["threadId", "expectedRevision", "operation"]) && UUID.test(value.threadId ?? "") &&
    typeof value.expectedRevision === "string" && keys(value.operation, ["type"]) &&
    ["read", "unread"].includes(value.operation.type);
}
function readStateUpdateResult(value) {
  if (!keys(value, ["readState"]) || !keys(value.readState, ["revision", "firstUnread"], ["revision"]) ||
      typeof value.readState.revision !== "string") return false;
  if (!Object.hasOwn(value.readState, "firstUnread")) return true;
  const position = value.readState.firstUnread;
  return position === null || (keys(position, ["type"]) && position.type === "threadStart") ||
    (keys(position, ["type", "turnId"]) && position.type === "turn" && typeof position.turnId === "string");
}
function historyValid(response, binding) {
  const result = response.result,
    thread = result?.thread;
  const validCursor = (name) =>
    Object.hasOwn(result ?? {}, name) && cursor(result[name]);
  return (
    object(thread) &&
    thread.id === binding.threadId &&
    thread.historyMode === "paginated" &&
    Array.isArray(thread.turns) &&
    thread.turns.length === 0 &&
    validCursor("turnsBackwardsCursor") &&
    validCursor("itemsBackwardsCursor")
  );
}

export function createSharedDaemonRpcGate({
  verifyReadSync,
  verifyBindingSync,
  verifyHistorySync,
  write: writeNow,
  desktop,
  executionDomain,
  creation,
  turn,
  modelSelection,
  artifacts,
} = {}) {
  if (
    [verifyReadSync, verifyBindingSync, verifyHistorySync, writeNow].some(
      (x) => typeof x !== "function",
    )
  )
    throw denied();
  if(executionDomain!==undefined&&(!keys(executionDomain,['beforeResumeWriteSync','observeResumeReplySync'])||
     typeof executionDomain.beforeResumeWriteSync!=='function'||typeof executionDomain.observeResumeReplySync!=='function'))throw denied();
  if(creation!==undefined&&!isSharedThreadCreationAuthority(creation))throw denied();
  if(turn!==undefined&&!isSharedThreadSendAuthority(turn))throw denied();
  if(modelSelection!==undefined&&!isSharedNativeModelSelection(modelSelection))throw denied();
  if(artifacts!==undefined&&!isSharedThreadArtifactAuthority(artifacts))throw denied();
  if (desktop !== undefined &&
      (!keys(desktop, ["daemonVersion", "verifyInitializeSync", "verifyServerEventSync", "authorizeServerReplySync", "verifyInitialAccountNotificationSync", "verifyStartupNotificationSync", "registerInitializeConsumptionSync", "deliverUnsupportedReadSync", "deliverUnsupportedCapabilitySync", "resolveThreadNameBindingSync"], ["daemonVersion", "verifyInitializeSync"]) ||
       !isSupportedDaemonVersion(desktop.daemonVersion) || typeof desktop.verifyInitializeSync !== "function" ||
       (desktop.verifyServerEventSync !== undefined && typeof desktop.verifyServerEventSync !== "function") ||
       (desktop.authorizeServerReplySync !== undefined && typeof desktop.authorizeServerReplySync !== "function") ||
       (desktop.verifyInitialAccountNotificationSync !== undefined && typeof desktop.verifyInitialAccountNotificationSync !== "function") ||
       (desktop.verifyStartupNotificationSync !== undefined && typeof desktop.verifyStartupNotificationSync !== "function") ||
       (desktop.registerInitializeConsumptionSync !== undefined && typeof desktop.registerInitializeConsumptionSync !== "function") ||
       (desktop.deliverUnsupportedReadSync !== undefined && typeof desktop.deliverUnsupportedReadSync !== "function") ||
       (desktop.deliverUnsupportedCapabilitySync !== undefined && typeof desktop.deliverUnsupportedCapabilitySync !== "function") ||
       (desktop.resolveThreadNameBindingSync !== undefined && typeof desktop.resolveThreadNameBindingSync !== "function")))
    throw denied();
  const registered = new Map(),
    inflight = new Map(),
    used = new Set(),
    uncertain = new Set(),
    incoming = new Map(),
    incomingUsed = new Set();
  let closed = false, desktopState = desktop ? "fresh" : "ready", initialAccountNotificationSeen = false;
  const scopeKey = (b) =>
    `${b.hostId}\u0000${b.daemonGeneration}\u0000${b.threadId}`;
  function bindingLive(binding) {
    try {
      return !closed && verifyBindingSync(binding) === true;
    } catch {
      return false;
    }
  }
  // This is a synchronous check of an independently obtained, scoped history
  // capability; the UI or an HTTP parameter may not provide that capability.
  function historyLive(binding) {
    try {
      return !closed && verifyHistorySync(binding) === true;
    } catch {
      return false;
    }
  }
  function threadNameLive(value) {
    try {
      const currentBinding = bindingCopy(value.threadNameOwner);
      return readLive(value.frame) && desktop.resolveThreadNameBindingSync(value.frame.params.threadId) === value.threadNameOwner &&
        Object.keys(value.threadNameBinding).every(name => currentBinding[name] === value.threadNameBinding[name]) &&
        bindingLive(value.threadNameBinding) && historyLive(value.threadNameBinding) && readLive(value.frame);
    } catch { return false; }
  }
  function readLive(frame) {
    try {
      return !closed && verifyReadSync(frame) === true;
    } catch {
      return false;
    }
  }
  function eventLive(frame) {
    try {
      return !closed && readLive(frame) && desktop?.verifyServerEventSync?.(frame) === true;
    } catch { return false; }
  }
  function retire(value) {
    if (!value) return;
    if (registered.get(value.key) === value) registered.delete(value.key);
    if (inflight.get(value.key) === value) inflight.delete(value.key);
    clearTimeout(value.timer);
    value.control?.signal.removeEventListener("abort", value.abort);
  }
  function markUnknown(value) {
    if (value?.binding && value.dispatched)
      uncertain.add(scopeKey(value.binding));
    retire(value);
  }
  function registerConnect(rawBinding, frame, control) {
    const binding = bindingCopy(rawBinding);
    if (
      closed ||
      desktopState !== "ready" ||
      !resumeFrame(frame, binding) ||
      !control ||
      !UUID.test(control.attemptId ?? "") ||
      !(control.signal instanceof AbortSignal) ||
      !Number.isFinite(control.deadline) ||
      control.signal.aborted ||
      control.deadline <= performance.now() ||
      control.deadline - performance.now() > 30000 ||
      !bindingLive(binding) ||
      !historyLive(binding) ||
      uncertain.has(scopeKey(binding))
    )
      return false;
    const id = key(frame.id);
    if (
      registered.size >= MAX_REGISTRATIONS ||
      inflight.size >= MAX_INFLIGHT ||
      registered.has(id) ||
      inflight.has(id) ||
      used.has(id) ||
      used.size >= MAX_USED
    )
      return false;
    const value = {
      key: id,
      binding,
      control,
      dispatched: false,
      timer: null,
      abort: null,
    };
    value.abort = () => markUnknown(value);
    registered.set(id, value);
    control.signal.addEventListener("abort", value.abort, { once: true });
    value.timer = setTimeout(
      value.abort,
      Math.max(1, Math.ceil(control.deadline - performance.now())),
    );
    value.timer.unref?.();
    if (
      control.signal.aborted ||
      performance.now() >= control.deadline ||
      !bindingLive(binding) ||
      !historyLive(binding)
    ) {
      retire(value);
      return false;
    }
    return true;
  }
  function write(encoded) {
    const frame = parse(encoded, MAX_REQUEST);
    if (closed) throw denied();
    // Server requests and client requests have independent JSON-RPC id spaces.
    // A response may be written only for a delivered request and an explicit,
    // separately consumed server-side authorization for its exact scope.
    if (desktop && !Object.hasOwn(frame, "method")) {
      if (desktopState !== "ready" || !rpcId(frame.id) ||
          !keys(frame, ["id", "result", "error", "jsonrpc"], ["id"]) ||
          Object.hasOwn(frame, "result") === Object.hasOwn(frame, "error") ||
          (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0")) throw denied();
      const id = key(frame.id), request = incoming.get(id);
      if (!request) throw denied();
      incoming.delete(id);
      let allowed = false;
      try { allowed = eventLive(request) && desktop.authorizeServerReplySync?.(request, frame) === true && eventLive(request); } catch {}
      if (!allowed) throw denied();
      try {
        const result = writeNow(encoded);
        if (result && typeof result.then === "function") { Promise.resolve(result).catch(() => {}); throw unknown(); }
      } catch { throw unknown(); }
      return;
    }
    if (desktop && frame.method === "initialized" && !Object.hasOwn(frame, "id")) {
      if (desktopState !== "awaiting-initialized" || !keys(frame, ["method", "params", "jsonrpc"], ["method"]) ||
          !(frame.params === undefined || keys(frame.params, [], [])) ||
          (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0") || !readLive(frame)) throw denied();
      desktopState = "unavailable";
      try {
        const result = writeNow(encoded);
        if (result && typeof result.then === "function") { Promise.resolve(result).catch(() => {}); throw unknown(); }
        if (!readLive(frame)) throw unknown();
        desktopState = "ready";
      } catch { throw unknown(); }
      return;
    }
    if (!requestFrame(frame, !!desktop)) throw denied();
    const id = key(frame.id),
      registration = registered.get(id);
    let threadNameOwner = null, threadNameBinding = null;
    if (used.size >= MAX_USED || used.has(id) || inflight.has(id))
      throw denied();
    if (desktopState === "fresh") {
      if (!initializeFrame(frame) || !readLive(frame)) throw denied();
    } else if (desktopState !== "ready") throw denied();
    else if (desktop?.deliverUnsupportedCapabilitySync && unsupportedBackgroundStart(frame)) {
      if (registration || !readLive(frame) || inflight.size >= MAX_INFLIGHT) throw denied();
      used.add(id);
      const response = Object.freeze({ id: frame.id, error: Object.freeze({ code: -32601,
        message: "Shared desktop policy does not support background thread/start",
        data: Object.freeze({ source: "kanban-shared-policy", code: "SHARED_CAPABILITY_NOT_SUPPORTED", method: frame.method }) }) });
      try {
        const delivered = desktop.deliverUnsupportedCapabilitySync(response);
        if (delivered && typeof delivered.then === "function") { Promise.resolve(delivered).catch(() => {}); throw denied(); }
        if (!readLive(frame)) throw denied();
      } catch { throw unknown(); }
      return;
    }
    else if (frame.method === "thread/readState/update") {
      // The source must supply the exact current history binding, independently
      // of execution preferences. Keep all request fields and the native CAS.
      if (!desktop || registration || !readStateUpdateParams(frame.params) || !readLive(frame)) throw denied();
    }
    else if (frame.method === "thread/name/set") {
      if (!desktop?.resolveThreadNameBindingSync || registration ||
          !keys(frame.params, ["threadId", "name"]) || !UUID.test(frame.params.threadId ?? "") ||
          typeof frame.params.name !== "string" || !readLive(frame)) throw denied();
      try {
        threadNameOwner = desktop.resolveThreadNameBindingSync(frame.params.threadId);
        threadNameBinding = bindingCopy(threadNameOwner);
      } catch { throw denied(); }
      if (threadNameBinding.threadId !== frame.params.threadId) throw denied();
    }
    else if (frame.method === "thread/start") {
      if (!desktop || !creation || registration || !readLive(frame)) throw denied();
    } else if (frame.method === "turn/start") {
      if (!desktop || !turn || registration || !readLive(frame)) throw denied();
    } else if (artifacts && isSharedThreadArtifactMethod(frame.method) && artifacts.handlesRequestSync(frame)) {
      if (!desktop || registration || !readLive(frame)) throw denied();
    } else if (frame.method === "thread/resume") {
      if (!registration && desktop?.deliverUnsupportedCapabilitySync && unsupportedUnregisteredResume(frame)) {
        if (!readLive(frame) || inflight.size >= MAX_INFLIGHT) throw denied();
        used.add(id);
        const response = Object.freeze({ id: frame.id, error: Object.freeze({ code: -32601,
          message: "Shared desktop policy requires an explicit thread/resume intent",
          data: Object.freeze({ source: "kanban-shared-policy", code: "SHARED_RESUME_INTENT_REQUIRED", method: frame.method }) }) });
        try {
          const delivered = desktop.deliverUnsupportedCapabilitySync(response);
          if (delivered && typeof delivered.then === "function") { Promise.resolve(delivered).catch(() => {}); throw denied(); }
          if (!readLive(frame)) throw denied();
        } catch { throw unknown(); }
        return;
      }
      if (
        !registration ||
        !resumeFrame(frame, registration.binding) ||
        registration.control.signal.aborted ||
        performance.now() >= registration.control.deadline ||
        !bindingLive(registration.binding) ||
        !historyLive(registration.binding) ||
        uncertain.has(scopeKey(registration.binding))
      ) {
        retire(registration);
        throw denied();
      }
    } else {
      if (registration) {
        retire(registration);
        throw denied();
      }
      if(desktop&&unsupportedFilesystemReads.has(frame.method)&&desktop.deliverUnsupportedReadSync){
        const p=frame.params;
        if(!keys(p,["path"])||typeof p.path!=="string"||p.path.length>4096||/[\x00-\x1f\x7f]/.test(p.path)||!posix.isAbsolute(p.path)||posix.normalize(p.path)!==p.path||!readLive(frame)||inflight.size>=MAX_INFLIGHT)throw denied();
        used.add(id);
        // This is an explicit adapter capability error, never a fabricated
        // native success/ENOENT. No filesystem operation or daemon write occurs.
        const response=Object.freeze({id:frame.id,error:Object.freeze({code:-32601,message:`Shared desktop policy does not support ${frame.method}`,data:Object.freeze({source:"kanban-shared-policy",code:"SHARED_READ_NOT_SUPPORTED"})})});
        try{const delivered=desktop.deliverUnsupportedReadSync(response);if(delivered&&typeof delivered.then==="function")throw denied();if(!readLive(frame))throw denied();}
        catch{throw unknown();}
        return;
      }
      if (desktop?.deliverUnsupportedCapabilitySync && (unsupportedHostCapabilities.has(frame.method) || unsupportedSdkHousekeeping.has(frame.method))) {
        if (unsupportedSdkHousekeeping.has(frame.method) && !(frame.params == null || keys(frame.params, [], []))) throw denied();
        if (!readLive(frame) || inflight.size >= MAX_INFLIGHT) throw denied();
        used.add(id);
        // Capability absence is distinct from broken authority/transport. No
        // params are interpreted, no route/handle is minted, no operation runs.
        const response = Object.freeze({ id: frame.id, error: Object.freeze({ code: -32601,
          message: `Shared desktop policy does not support ${frame.method}`,
          data: Object.freeze({ source: "kanban-shared-policy", code: "SHARED_CAPABILITY_NOT_SUPPORTED", method: frame.method }) }) });
        try {
          const delivered = desktop.deliverUnsupportedCapabilitySync(response);
          if (delivered && typeof delivered.then === "function") { Promise.resolve(delivered).catch(() => {}); throw denied(); }
          if (!readLive(frame)) throw denied();
        } catch { throw unknown(); }
        return;
      }
      if (!readRequest(frame, !!desktop) || !readLive(frame)) throw denied();
    }
    if (inflight.size >= MAX_INFLIGHT) throw denied();
    used.add(id);
    const value = registration ?? {
      key: id,
      frame,
      dispatched: false,
      timer: null,
      control: null,
    };
    if (registration) registered.delete(id);
    value.frame = frame;
    if (threadNameBinding) { value.threadNameOwner = threadNameOwner; value.threadNameBinding = threadNameBinding; }
    if(value.binding&&executionDomain){
      let proven=false;try{proven=executionDomain.beforeResumeWriteSync(value.binding,frame)===true;}catch{}
      if(!proven){retire(value);throw denied();}
    }
    if(frame.method==='thread/start'||frame.method==='turn/start'){
      let allowed=false,cause;
      try{allowed=readLive(frame)&&(frame.method==='thread/start'?creation:turn).beforeWriteSync(frame)===true;}catch(error){cause=error;}
      if(!allowed){retire(value);const failure=denied();if(cause instanceof Error)Object.defineProperty(failure,'cause',{value:cause});throw failure;}
    }
    if (artifacts && isSharedThreadArtifactMethod(frame.method) && artifacts.handlesRequestSync(frame)) {
      let allowed=false,cause;
      try {allowed=readLive(frame)&&artifacts.beforeWriteSync(frame)===true;} catch(error) {cause=error;}
      if(!allowed){retire(value);const failure=denied();if(cause instanceof Error)Object.defineProperty(failure,'cause',{value:cause});throw failure;}
      value.artifact=true;
    }
    if (value.threadNameBinding && !threadNameLive(value)) { retire(value); throw denied(); }
    value.dispatched = true;
    inflight.set(id, value);
    if (desktopState === "fresh") desktopState = "initializing";
    try {
      // No asynchronous boundary is allowed between the final guard and write.
      const result = writeNow(encoded);
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch(() => {});
        markUnknown(value);
        throw unknown();
      }
      if (
        value.binding &&
        (inflight.get(id) !== value ||
          value.control.signal.aborted ||
          performance.now() >= value.control.deadline ||
          !bindingLive(value.binding) ||
          !historyLive(value.binding))
      ) {
        markUnknown(value);
        throw unknown();
      }
      if (value.threadNameBinding && !threadNameLive(value)) { markUnknown(value); throw unknown(); }
    } catch (cause) {
      if (frame.method === "initialize") desktopState = "unavailable";
      markUnknown(value);
      throw cause?.code === "SHARED_DAEMON_OUTCOME_UNKNOWN" ? cause : unknown();
    }
  }
  function receive(encoded) {
    let frame;
    try {
      frame = parse(encoded, MAX_RESPONSE);
    } catch {
      for (const value of inflight.values()) markUnknown(value);
      throw unknown();
    }
    if (desktop && ["configWarning", "remoteControl/status/changed"].includes(frame.method)) {
      let allowed=false;
      try { allowed=!closed&&["awaiting-initialized","ready"].includes(desktopState)&&startupMetadata(frame)&&
        readLive(frame)&&desktop.verifyStartupNotificationSync?.(frame)===true&&readLive(frame); } catch {}
      if(!allowed)throw denied();return encoded;
    }
    if (desktop && Object.hasOwn(frame, "method")) {
      // The real native daemon may emit its initial account observation after
      // initialize.result, before the desktop has consumed it and sent
      // initialized. This grants no metadata/task access: the existing account
      // anchor hook must confirm the first notice; every subsequent one revokes.
      const earlyAccount=desktopState==="awaiting-initialized"&&frame.method==="account/updated"&&!Object.hasOwn(frame,"id");
      if (closed || (desktopState !== "ready"&&!earlyAccount) || typeof frame.method !== "string" ||
          !keys(frame, ["id", "method", "params", "jsonrpc", "emittedAtMs"], ["method", "params"]) ||
          (frame.emittedAtMs!==undefined&&(!Number.isSafeInteger(frame.emittedAtMs)||frame.emittedAtMs<0)) ||
          !object(frame.params) || (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0") || !eventLive(frame)) throw denied();
      if (Object.hasOwn(frame, "id")) {
        const id = key(frame.id);
        if (!rpcId(frame.id) || !serverRequests.has(frame.method) || incoming.size >= MAX_INFLIGHT ||
            incomingUsed.size >= MAX_USED || incomingUsed.has(id)) throw denied();
        incomingUsed.add(id);
        incoming.set(id, frame);
      } else {
        if (!serverNotifications.has(frame.method) || !classifySharedServerNotification(frame)) throw denied();
        // Only the first initialized notification may be confirmed against an
        // independently verified owner account anchor. Missing/async/false proof
        // keeps the old revoke behavior; every later notification still revokes.
        if (frame.method === "account/updated") {
          const first = !initialAccountNotificationSeen;
          initialAccountNotificationSeen = true;
          let initialConfirmed = false;
          try { initialConfirmed = first && desktop.verifyInitialAccountNotificationSync?.(frame) === true && eventLive(frame); } catch {}
          if (!initialConfirmed) close();
        }
      }
      return encoded;
    }
    if (
      closed ||
      !rpcId(frame.id) ||
      !keys(frame, ["id", "result", "error", "jsonrpc"], ["id"]) ||
      Object.hasOwn(frame, "result") === Object.hasOwn(frame, "error") ||
      (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0")
    )
      throw denied();
    const value = inflight.get(key(frame.id));
    if (!value) throw denied();
    if (desktop && value.frame.method === "initialize") {
      if (!readLive(value.frame)) { retire(value); desktopState = "unavailable"; throw denied(); }
      if (Object.hasOwn(frame, "error")) { retire(value); desktopState = "unavailable"; return encoded; }
      let valid = false;
      try {
        valid = parseDaemonInitializeVersion(frame.result) === desktop.daemonVersion &&
          desktop.verifyInitializeSync(frame.result) === true && readLive(value.frame);
      } catch {}
      retire(value);
      if (!valid) { desktopState = "unavailable"; throw error("SHARED_DAEMON_UNSUPPORTED"); }
      desktopState = "awaiting-initialized";
      if(desktop.registerInitializeConsumptionSync){
        let consumed=false;
        const receipt=Object.freeze({responseId:frame.id,consumeSync(){
          if(consumed)return false;consumed=true;
          try{if(closed||desktopState!=="awaiting-initialized"||!readLive(value.frame)||desktop.verifyInitializeSync(frame.result)!==true||!readLive(value.frame))return false;}
          catch{return false;}
          desktopState="ready";return true;
        }});
        try{const registered=desktop.registerInitializeConsumptionSync(receipt);if(registered&&typeof registered.then==="function")throw denied();}
        catch{desktopState="unavailable";throw denied();}
      }
      return encoded;
    }
    if (value.threadNameBinding) {
      if (!threadNameLive(value) || (!Object.hasOwn(frame, "error") && !object(frame.result)) || !threadNameLive(value)) {
        markUnknown(value); throw unknown();
      }
      retire(value); return encoded;
    }
    if (value.artifact) {
      try {
        if(!readLive(value.frame))throw denied();
        artifacts.observeReplySync(value.frame,frame);
        if(!readLive(value.frame))throw denied();
      } catch(cause) {markUnknown(value);const failure=unknown();if(cause instanceof Error)Object.defineProperty(failure,'cause',{value:cause});throw failure;}
      retire(value);return encoded;
    }
    if (value.frame.method === "turn/start") {
      try { turn.observeReplySync(value.frame, frame); } catch { markUnknown(value); throw unknown(); }
      retire(value); return encoded;
    }
    if (value.frame.method === "thread/start") {
      try { creation.observeReplySync(value.frame, frame); } catch { markUnknown(value); throw unknown(); }
      retire(value); return encoded;
    }
    if (value.binding) {
      if (
        !bindingLive(value.binding) ||
        !historyLive(value.binding) ||
        value.control.signal.aborted ||
        performance.now() >= value.control.deadline ||
        (Object.hasOwn(frame, "result") && !historyValid(frame, value.binding))
      ) {
        markUnknown(value);
        throw unknown();
      }
      if(executionDomain){
        let attested=false;try{attested=executionDomain.observeResumeReplySync(value.binding,value.frame,frame)===true;}catch{}
        if(!attested){markUnknown(value);throw unknown();}
      }
    } else {
      if (!readLive(value.frame)) {
        retire(value);
        throw denied();
      }
      if (value.frame.method === 'model/list' && modelSelection && !observeSharedNativeModelList(modelSelection, value.frame, frame)) {
        retire(value); throw denied();
      }
      if (Object.hasOwn(frame, "result") && value.frame.method === "thread/items/list" && !isSharedTurnItemsPage(frame.result, value.frame.params)) {
        retire(value);
        throw denied();
      }
      if (Object.hasOwn(frame, "result") && value.frame.method === "thread/readState/update" && !readStateUpdateResult(frame.result)) {
        retire(value); throw denied();
      }
      if (Object.hasOwn(frame, "result") && value.frame.method === "thread/queue/list" && !queuedPage(frame.result, value.frame.params)) {
        retire(value); throw denied();
      }
      if (Object.hasOwn(frame, "result") && value.frame.method === "thread/attachment/list") {
        const result = frame.result;
        if (!keys(result, ["data", "nextCursor"], ["data"]) || !Array.isArray(result.data) ||
            result.data.length > (value.frame.params.limit ?? 100) || !cursor(result.nextCursor) ||
            !result.data.every(attachment => keys(attachment, ["id", "attachmentType", "identityKey", "createdAt", "payload"]) &&
              typeof attachment.id === "string" && typeof attachment.attachmentType === "string" &&
              typeof attachment.identityKey === "string" && Number.isSafeInteger(attachment.createdAt))) {
          retire(value); throw denied();
        }
      }
      if (
        Object.hasOwn(frame, "result") &&
        value.frame.method === "thread/list" &&
        (!object(frame.result) ||
          !Array.isArray(frame.result.data) ||
          frame.result.data.length > value.frame.params.limit ||
          !cursor(frame.result.nextCursor))
      ) {
        retire(value);
        throw denied();
      }
    }
    retire(value);
    return encoded;
  }
  function close() {
    if (closed) return;
    closed = true;
    desktopState = "unavailable";
    incoming.clear();
    creation?.close();
    turn?.close();
    modelSelection?.close();
    artifacts?.close();
    for (const value of registered.values()) retire(value);
    for (const value of inflight.values()) markUnknown(value);
  }
  return Object.freeze({ registerConnect, write, receive, close });
}
