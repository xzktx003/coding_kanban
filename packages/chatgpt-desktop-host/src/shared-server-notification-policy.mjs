// Fixed 0.166.0 ServerNotification outer shapes, aligned with the existing
// bounded follower. Classification confers no binding/authorization and keeps
// no payload references. Nested goal/settings/turn/item bodies stay opaque;
// the native consumer and existing bounded follower retain their own checks.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, required = allowed) => object(value) &&
  Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const thread = value => typeof value === 'string' && UUID.test(value);
const atom = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
const string = value => typeof value === 'string';
const nullable = check => value => value === null || check(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
// Stable 0.166.0 hook notifications carry their complete original run. These
// observations authorize no command, MCP invocation, approval, or filesystem IO.
// Keep the native signed integer/null and string contracts; the session/follower
// already enforce the full frame, byte, count, and delivery budgets.
const hookRun = value => keys(value, ['id', 'eventName', 'executionMode', 'handlerType', 'scope',
  'sourcePath', 'startedAt', 'displayOrder', 'status', 'entries', 'completedAt', 'durationMs', 'statusMessage', 'source'],
  ['id', 'eventName', 'executionMode', 'handlerType', 'scope', 'sourcePath', 'startedAt', 'displayOrder', 'status', 'entries']) &&
  string(value.id) && string(value.sourcePath) && Number.isSafeInteger(value.startedAt) && Number.isSafeInteger(value.displayOrder) &&
  ['preModelRequest', 'postModelRequest', 'preToolUse', 'permissionRequest', 'postToolUse', 'preCompact', 'postCompact',
    'sessionStart', 'sessionEnd', 'userPromptSubmit', 'subagentStart', 'subagentStop', 'stop', 'interrupt'].includes(value.eventName) &&
  ['sync', 'async'].includes(value.executionMode) && ['command', 'mcpTool', 'prompt', 'agent'].includes(value.handlerType) &&
  ['thread', 'turn'].includes(value.scope) && ['running', 'completed', 'failed', 'blocked', 'stopped'].includes(value.status) &&
  Array.isArray(value.entries) && value.entries.every(entry => keys(entry, ['kind', 'text']) &&
    ['warning', 'stop', 'feedback', 'context', 'error'].includes(entry.kind) && string(entry.text)) &&
  (!Object.hasOwn(value, 'completedAt') || nullable(Number.isSafeInteger)(value.completedAt)) &&
  (!Object.hasOwn(value, 'durationMs') || nullable(Number.isSafeInteger)(value.durationMs)) &&
  (!Object.hasOwn(value, 'statusMessage') || nullable(string)(value.statusMessage)) &&
  (!Object.hasOwn(value, 'source') || ['system', 'user', 'project', 'mdm', 'sessionFlags', 'plugin', 'cloudRequirements',
    'cloudManagedConfig', 'legacyManagedConfigFile', 'legacyManagedConfigMdm', 'unknown'].includes(value.source));
const identityObject = value => object(value) && atom(value.id);
const rpcId = value => atom(value) || integer(value);
const status = value => object(value) && (value.type === 'active'
  ? keys(value, ['type', 'activeFlags']) && Array.isArray(value.activeFlags) && value.activeFlags.length <= 64 &&
    value.activeFlags.every(flag => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag))
  : keys(value, ['type']) && ['notLoaded', 'idle', 'systemError'].includes(value.type));
const unreadPosition = value => value === null || (object(value) && (value.type === 'threadStart'
  ? keys(value, ['type']) : value.type === 'turn' && keys(value, ['type', 'turnId']) && atom(value.turnId)));
const readState = value => keys(value, ['revision', 'firstUnread'], ['revision']) && string(value.revision) &&
  (!Object.hasOwn(value, 'firstUnread') || unreadPosition(value.firstUnread));
const prediction = value => object(value) && (value.type === 'failed' ? keys(value, ['type']) :
  value.type === 'completed' && keys(value, ['type', 'text'], ['type']) &&
  (!Object.hasOwn(value, 'text') || nullable(string)(value.text)));
const rules = new Map();
function rule(method, kind, fields = {}, optional = []) {
  const validators = { threadId: thread, ...fields }, allowed = Object.keys(validators);
  const required = allowed.filter(key => !optional.includes(key));
  rules.set(method, { kind, validate: params => keys(params, allowed, required) &&
    allowed.every(key => !Object.hasOwn(params, key) || validators[key](params[key])) });
}
const metadata = (method, fields, optional) => rule(method, 'thread-metadata', fields, optional);
const stream = (method, fields, optional) => rule(method, 'thread-stream', fields, optional);
for (const method of ['hook/started', 'hook/completed']) metadata(method, { run: hookRun, turnId: nullable(string) }, ['turnId']);
metadata('thread/status/changed', { status });
metadata('thread/name/updated', { threadName: nullable(string) }, ['threadName']);
metadata('thread/readState/changed', { readState });
metadata('thread/tokenUsage/updated', { tokenUsage: object, turnId: atom });
metadata('thread/compacted', { turnId: atom });
metadata('thread/goal/updated', { goal: object, turnId: nullable(atom) }, ['turnId']);
metadata('thread/prediction/updated', { result: prediction, sourceTurnId: atom });
metadata('thread/attachment/updated', { attachmentId: atom, attachmentType: atom, identityKey: atom,
  operation: value => ['created', 'deleted'].includes(value) });
metadata('thread/project/updated', { projectId: nullable(atom) });
metadata('thread/settings/updated', { threadSettings: object });
for (const method of ['thread/queue/changed', 'thread/goal/cleared', 'thread/reverted',
  'thread/archived', 'thread/unarchived', 'thread/deleted', 'thread/closed']) metadata(method);
for (const method of ['turn/started', 'turn/completed']) stream(method, { turn: identityObject });
// The stable protocol declares metadata as JsonValue. The frame is already
// JSON-decoded and budgeted; classify only its thread/turn envelope, leaving the
// original opaque value for the existing bounded native follower.
stream('turn/moderationMetadata', { turnId: string, metadata: value => value !== undefined });
stream('turn/diff/updated', { turnId: atom, diff: string });
stream('turn/plan/updated', { turnId: atom, plan: Array.isArray, explanation: nullable(string) }, ['explanation']);
stream('item/started', { turnId: atom, item: identityObject, startedAtMs: integer });
stream('item/completed', { turnId: atom, item: identityObject, completedAtMs: integer });
for (const method of ['item/agentMessage/delta', 'item/plan/delta',
  'item/commandExecution/outputDelta', 'item/fileChange/outputDelta']) stream(method, { turnId: atom, itemId: atom, delta: string });
stream('item/fileChange/patchUpdated', { turnId: atom, itemId: atom, changes: Array.isArray });
stream('item/reasoning/summaryTextDelta', { turnId: atom, itemId: atom, delta: string, summaryIndex: integer });
stream('item/reasoning/summaryPartAdded', { turnId: atom, itemId: atom, summaryIndex: integer });
stream('item/reasoning/textDelta', { turnId: atom, itemId: atom, delta: string, contentIndex: integer });
stream('serverRequest/resolved', { requestId: rpcId });
export const SHARED_THREAD_NOTIFICATION_METHODS = Object.freeze([...rules.keys(), 'thread/started', 'mcpServer/startupStatus/updated'].sort());
const authModes = new Set(['apikey', 'chatgpt', 'chatgptAuthTokens', 'headers', 'agentIdentity',
  'personalAccessToken', 'bedrockApiKey', 'bedrockAccessKeys']);
const planTypes = new Set(['free', 'go', 'plus', 'pro', 'prolite', 'promax', 'team',
  'self_serve_business_prolite', 'self_serve_business_usage_based', 'business', 'ent26',
  'enterprise_cbp_automation', 'enterprise_cbp_usage_based', 'enterprise', 'edu', 'edu_plus',
  'edu_pro', 'sci', 'sci_plus', 'unknown']);
export function classifySharedServerNotification(frame) {
  try {
    if (!keys(frame, ['method', 'params', 'jsonrpc', 'emittedAtMs'], ['method', 'params']) ||
        typeof frame.method !== 'string' || !object(frame.params) ||
        (frame.jsonrpc !== undefined && frame.jsonrpc !== '2.0') ||
        (frame.emittedAtMs !== undefined && !integer(frame.emittedAtMs))) return null;
    const p = frame.params;
    if (frame.method === 'account/updated') {
      if (!keys(p, ['authMode', 'planType'], []) ||
          (p.authMode != null && !authModes.has(p.authMode)) ||
          (p.planType != null && !planTypes.has(p.planType))) return null;
      return Object.freeze({ kind: 'account' });
    }
    if (frame.method === 'account/rateLimits/updated')
      return keys(p, ['rateLimits']) && object(p.rateLimits) ? Object.freeze({ kind: 'account' }) : null;
    if (frame.method === 'mcpServer/startupStatus/updated') {
      // Stable 0.166.0 requires only name/status; threadId, error and the
      // reauthentication reason are optional/nullable. Keep the full original
      // frame for the SDK and bounded follower; no tool call is authorized.
      if (!keys(p, ['threadId', 'name', 'status', 'error', 'failureReason'], ['name', 'status']) ||
          !string(p.name) || !['starting', 'ready', 'failed', 'cancelled'].includes(p.status) ||
          (p.error != null && !string(p.error)) ||
          (p.failureReason != null && p.failureReason !== 'reauthenticationRequired') ||
          (p.threadId != null && !thread(p.threadId))) return null;
      return p.threadId == null ? Object.freeze({ kind: 'host-metadata' })
        : Object.freeze({ kind: 'thread-metadata', threadId: p.threadId });
    }
    if (frame.method === 'thread/started')
      return keys(p, ['thread']) && object(p.thread) && thread(p.thread.id)
        ? Object.freeze({ kind: 'thread-metadata', threadId: p.thread.id }) : null;
    const entry = rules.get(frame.method);
    return entry?.validate(p) ? Object.freeze({ kind: entry.kind, threadId: p.threadId }) : null;
  } catch { return null; }
}
