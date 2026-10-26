'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SUPPORTED_OFFICIAL_VERSION = '26.51002.51308';
const SUPPORTED_OFFICIAL_VERSIONS = Object.freeze([SUPPORTED_OFFICIAL_VERSION, '26.51007.21434']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TEXT = 200_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 1000;

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode });
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function exactKeys(value, expected) {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
function validPath(value, { optional = false } = {}) {
  return optional && value === undefined || typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
}
function validateMention(value) {
  const mention = object(value);
  if (!mention || !exactKeys(mention, ['name', 'path']) || typeof mention.name !== 'string' || !mention.name.trim() || mention.name.length > 160 || /[\x00-\x1f]/.test(mention.name) || typeof mention.path !== 'string') return false;
  return /^(agent|subagent):\/\/-[a-zA-Z0-9_:]{1,160}$/.test(mention.path) ||
    /^(agent|subagent):\/\/[a-zA-Z0-9_:]{1,160}$/.test(mention.path) ||
    /^plugin:\/\/[a-zA-Z0-9_:.@]{1,512}$/.test(mention.path) && !mention.path.includes('..');
}
function validateContext(value) {
  const context = object(value);
  if (!context || Object.keys(context).some(key => !['id', 'kind', 'name', 'text', 'path', 'range', 'sourceThreadId', 'sourceItemId'].includes(key))) return false;
  if (typeof context.id !== 'string' || !context.id || context.id.length > 160 || /[\x00-\x1f]/.test(context.id) ||
      !['file', 'paste', 'quote'].includes(context.kind) || typeof context.name !== 'string' || context.name.length > 512 || /[\x00-\x1f]/.test(context.name) ||
      typeof context.text !== 'string' || context.text.length > MAX_TEXT || context.text.includes('\0')) return false;
  if (context.path !== undefined && !validPath(context.path)) return false;
  for (const key of ['sourceThreadId', 'sourceItemId']) if (context[key] !== undefined && (typeof context[key] !== 'string' || context[key].length > 160 || /[\x00-\x1f]/.test(context[key]))) return false;
  if (context.range !== undefined) {
    const range = object(context.range);
    if (!range || !exactKeys(range, ['start', 'end']) || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start) return false;
  }
  return true;
}
function composeText(text, contexts) {
  return [text, ...contexts.map(context => {
    const label = context.kind === 'paste' ? '粘贴的文本' : context.kind === 'quote' ? '引用的回答' : '文件快照';
    const source = context.path ?? context.sourceThreadId;
    const fence = '`'.repeat(Math.max(3, ...((context.text.match(/`+/g) || []).map(run => run.length + 1))));
    return `[${label}：${context.name}${source ? ` · ${source}` : ''}${context.range ? `:${context.range.start}-${context.range.end}` : ''}]\n${fence}\n${context.text}\n${fence}`;
  })].filter(Boolean).join('\n\n');
}
function validateSend(value) {
  const body = object(value);
  const allowed = ['threadId', 'column', 'cwd', 'submissionId', 'text', 'images', 'contexts', 'mentions'];
  if (!body || Object.keys(body).some(key => !allowed.includes(key))) fail(400, '无效的原生 Codex 消息请求');
  if (typeof body.threadId !== 'string' || !UUID.test(body.threadId) || typeof body.submissionId !== 'string' || !UUID.test(body.submissionId) ||
      !Number.isInteger(body.column) || body.column < 1 || body.column > 3 || !validPath(body.cwd) ||
      typeof body.text !== 'string' || body.text.length > MAX_TEXT || body.text.includes('\0') ||
      !Array.isArray(body.images) || body.images.length > 8 || body.images.some(image => !validPath(image)) ||
      !Array.isArray(body.contexts) || body.contexts.length > 32 || body.contexts.some(context => !validateContext(context)) ||
      !Array.isArray(body.mentions) || body.mentions.length > 32 || body.mentions.some(mention => !validateMention(mention)))
    fail(400, '无效的原生 Codex 消息请求');
  const contextIds = body.contexts.map(context => context.id);
  if (new Set(contextIds).size !== contextIds.length) fail(400, '重复的上下文引用');
  const text = composeText(body.text, body.contexts);
  if (text.length > MAX_TEXT || (!text.trim() && body.images.length === 0 && body.mentions.length === 0)) fail(400, '消息为空或超过长度限制');
  const input = [
    ...body.mentions.map(mention => ({ type: 'mention', name: mention.name, path: mention.path })),
    ...(text.trim() ? [{ type: 'text', text, text_elements: [] }] : []),
    ...body.images.map(image => ({ type: 'localImage', path: image })),
  ];
  const normalized = { threadId: body.threadId, column: body.column, cwd: body.cwd, submissionId: body.submissionId, input };
  const hash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return { ...normalized, hash };
}
function editorUri(threadId) {
  return `openai-codex://route/local/${threadId}`;
}
function targetIsOpen(vscode, request) {
  return (vscode.window.tabGroups?.all || []).some(group => group.viewColumn === request.column && group.tabs?.some(tab =>
    tab.isActive === true && tab.input?.viewType === 'chatgpt.conversationEditor' && tab.input?.uri?.toString() === editorUri(request.threadId)));
}
function readReceiptFile(file) {
  const parent = path.dirname(file);
  const directory = fs.lstatSync(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) throw new Error('private send receipt directory required');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > 512 * 1024) throw new Error('private send receipts required');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data) || data.length > MAX_RECEIPTS || data.some(item => !item || typeof item !== 'object' || !UUID.test(item.submissionId) || !UUID.test(item.threadId) || !/^[a-f0-9]{64}$/.test(item.hash) || !['pending', 'accepted'].includes(item.status) || typeof item.createdAt !== 'number' || item.turnId !== undefined && !UUID.test(item.turnId))) throw new Error('invalid private send receipts');
  return data;
}
function writeReceiptFile(file, receipts) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(receipts.slice(-MAX_RECEIPTS))); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
  fs.chmodSync(file, 0o600);
}

function createNativeAppServerSender({ provider, officialVersion, vscode, receiptFile, timeoutMs = 20_000, now = Date.now }) {
  if (!SUPPORTED_OFFICIAL_VERSIONS.includes(officialVersion)) return { available: false, reason: 'official Codex version is not supported', dispose() {} };
  const connection = provider?.codexMcpConnection;
  if (!connection || typeof connection.registerProvider !== 'function' || typeof connection.sendRequest !== 'function')
    return { available: false, reason: 'official Codex app-server bridge is unavailable', dispose() {} };
  let receipts;
  try { receipts = readReceiptFile(receiptFile); }
  catch { return { available: false, reason: 'private send receipt store is unavailable', dispose() {} }; }
  const providerName = `coding-kanban-native-${crypto.randomUUID()}`;
  const pending = new Map();
  const disposable = connection.registerProvider(providerName, {
    onResult(response) {
      const request = pending.get(String(response.id));
      if (!request) return;
      pending.delete(String(response.id)); clearTimeout(request.timer);
      if (response.error) request.reject(Object.assign(new Error(String(response.error.message || 'Codex rejected the message').slice(0, 300)), { statusCode: 409, knownRejected: true }));
      else request.resolve(response.result);
    },
    onRequestDelivery(update) {
      const id = update?.delivery?.requestId;
      const request = pending.get(String(id));
      if (!request) return;
      if (update.type === 'failed') {
        pending.delete(String(id)); clearTimeout(request.timer);
        request.reject(Object.assign(new Error('原生 Codex 尚未接收消息'), { statusCode: 503, knownRejected: true }));
      } else if (update.type === 'outcome-unknown') {
        pending.delete(String(id)); clearTimeout(request.timer);
        request.reject(Object.assign(new Error('消息回执待核对；请先检查原生 Codex 窗口'), { statusCode: 409, uncertain: true }));
      }
    },
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Object.assign(new Error('原生 Codex 响应超时；请先检查目标窗口'), { statusCode: 409, uncertain: true }));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    try { connection.sendRequest(providerName, requestId, method, params, true); }
    catch (error) { pending.delete(requestId); clearTimeout(timer); reject(error); }
  });
  const persist = () => writeReceiptFile(receiptFile, receipts);
  const sender = {
    available: true,
    async send(value) {
      const request = validateSend(value);
      if (!targetIsOpen(vscode, request)) fail(409, '所选 thread 未在对应原生 Codex 列中打开');
      const previous = receipts.find(item => item.submissionId === request.submissionId);
      if (previous) {
        if (previous.hash !== request.hash || previous.threadId !== request.threadId) fail(409, '消息 ID 已用于另一条请求');
        if (previous.status === 'accepted' && previous.turnId) return { accepted: true, turnId: previous.turnId };
        fail(409, '消息回执待核对；请先检查原生 Codex 窗口');
      }
      const metadata = await rpc('thread/read', { threadId: request.threadId, includeTurns: false });
      const thread = metadata?.thread;
      if (!thread || thread.id !== request.threadId || thread.cwd !== request.cwd) fail(409, '原生 thread 与所选项目不匹配');
      if (thread.status?.type !== 'idle') fail(409, '目标 Codex 会话正在运行或等待交互，请在原生窗口处理当前轮次');
      receipts.push({ submissionId: request.submissionId, threadId: request.threadId, hash: request.hash, status: 'pending', createdAt: now() });
      receipts = receipts.slice(-MAX_RECEIPTS);
      persist();
      let result;
      try {
        result = await rpc('turn/start', { threadId: request.threadId, input: request.input, clientUserMessageId: request.submissionId });
      } catch (error) {
        if (error.knownRejected) { receipts = receipts.filter(item => item.submissionId !== request.submissionId); persist(); }
        throw error;
      }
      const turnId = result?.turn?.id;
      if (typeof turnId !== 'string' || !UUID.test(turnId)) fail(409, 'Codex 未返回可核对的轮次回执');
      const receipt = receipts.find(item => item.submissionId === request.submissionId);
      receipt.status = 'accepted'; receipt.turnId = turnId; persist();
      return { accepted: true, turnId };
    },
    dispose() { disposable?.dispose?.(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('native Codex sender disposed')); } pending.clear(); },
  };
  return sender;
}

module.exports = { SUPPORTED_OFFICIAL_VERSION, SUPPORTED_OFFICIAL_VERSIONS, MAX_BODY_BYTES, validateSend, createNativeAppServerSender };
