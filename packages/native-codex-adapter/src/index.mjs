import { createConnection } from 'node:net';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

const HOST_SHA256 = 'bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c';
const VERSIONS = new Set(['26.51002.51308', '26.1002.51308']);
const INITIAL_CLIENT = 'initializing-client';
const CONSTRUCTOR_KEY = Symbol('readonly-client');
const OWNERS = new WeakMap();
const METHODS = Object.freeze({ initialize: 0, 'thread-owner-discovery': 1,
  'thread-follower-read-model-settings': 1 });
// Used only to give native-compatible denial replies, never to expose handlers.
const INBOUND_VERSIONS = Object.freeze({
  ...METHODS,
  'thread-follower-start-turn': 2,
  'thread-follower-load-complete-history': 1,
  'thread-follower-compact-thread': 1,
  'thread-follower-steer-turn': 1,
  'thread-follower-interrupt-turn': 4,
  'thread-follower-update-thread-settings': 2,
  'thread-follower-update-daybreak': 1,
  'thread-follower-edit-last-user-turn': 2,
  'thread-follower-command-approval-decision': 1,
  'thread-follower-file-approval-decision': 1,
  'thread-follower-permissions-request-approval-response': 1,
  'thread-follower-submit-user-input': 1,
  'thread-follower-submit-mcp-server-elicitation-response': 1,
  'thread-follower-set-queued-follow-ups-state': 1,
  'thread-follower-remove-queued-message': 1,
  'thread-follower-clear-queued-messages': 1,
});

function compatible(compatibility) {
  if (!VERSIONS.has(compatibility?.extensionVersion) || compatibility?.hostSha256 !== HOST_SHA256) {
    throw new Error('unsupported-extension');
  }
  return Object.freeze({ extensionVersion: compatibility.extensionVersion, hostSha256: HOST_SHA256 });
}

/** Hash the actual unmodified host file; no source bytes or credentials are retained. */
export async function verifyExtensionHost({ extensionHostPath, extensionVersion }) {
  if (typeof extensionHostPath !== 'string' || !isAbsolute(extensionHostPath)) {
    throw new Error('extension-host-path-required');
  }
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(extensionHostPath)) digest.update(bytes);
  return compatible({ extensionVersion, hostSha256: digest.digest('hex') });
}

function identity(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new Error(`invalid-${label}`);
  }
  return value;
}

function boundedInteger(value, fallback, maximum, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`invalid-${name}`);
  return result;
}

async function endpoint(options) {
  const home = options?.isolatedCodexHome;
  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\0')) throw new Error('isolated-home-required');
  const defaultHomes = [resolve(homedir(), '.codex')];
  if (process.env.CODEX_HOME) defaultHomes.push(resolve(process.env.CODEX_HOME));
  const resolvedHome = resolve(home);
  for (const defaultHome of defaultHomes) {
    if (resolvedHome === defaultHome || resolvedHome.startsWith(defaultHome + sep)) throw new Error('default-home-forbidden');
  }
  const socket = options.socketPath;
  if (typeof socket !== 'string' || !isAbsolute(socket) || socket.includes('\0') ||
      resolve(socket) !== join(resolvedHome, 'ipc', 'ipc.sock')) throw new Error('socket-outside-isolated-home');
  const canonicalHome = await realpath(home);
  for (const defaultHome of defaultHomes) {
    let canonicalDefault;
    try { canonicalDefault = await realpath(defaultHome); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (canonicalDefault && (canonicalHome === canonicalDefault || canonicalHome.startsWith(canonicalDefault + sep))) {
      throw new Error('default-home-forbidden');
    }
  }
  // An explicit canonical path prevents aliases through any parent symlink.
  if (canonicalHome !== resolvedHome || await realpath(socket) !== resolve(socket)) throw new Error('symlink-path-forbidden');
  const uid = process.getuid?.();
  if (uid == null) throw new Error('unix-socket-required');
  for (const [path, kind, label] of [[resolvedHome, 'isDirectory', 'isolated-home'],
    [join(resolvedHome, 'ipc'), 'isDirectory', 'ipc-directory'], [socket, 'isSocket', 'socket']]) {
    const stat = await lstat(path);
    if (!stat[kind]() || stat.uid !== uid || (stat.mode & 0o077) !== 0) throw new Error(`insecure-${label}`);
  }
  return socket;
}

function versionFor(method, hostId) {
  const base = METHODS[method];
  return base == null ? null : base + (method.startsWith('thread-follower-') && hostId != null ? 1 : 0);
}

/** Explicit isolated Unix socket only. No router creation, fallback, reconnect or general method proxy. */
export class NativeCodexReadonlyClient {
  #socket;
  #clientId = INITIAL_CLIENT;
  #closed = false;
  #pending = new Map();
  #header = Buffer.alloc(4);
  #headerRead = 0;
  #body = null;
  #bodyRead = 0;
  #frameTimer = null;
  #limits;
  #connectReject = null;
  #closeReason = null;

  constructor(key, limits) {
    if (key !== CONSTRUCTOR_KEY) throw new Error('use-static-connect');
    this.#limits = limits;
  }

  static async connect(options = {}) {
    compatible(options.compatibility);
    const socketPath = await endpoint(options);
    const limits = {
      timeoutMs: boundedInteger(options.timeoutMs, 5000, 60000, 'timeout'),
      frameTimeoutMs: boundedInteger(options.frameTimeoutMs, 5000, 60000, 'frame-timeout'),
      maxFrameBytes: boundedInteger(options.maxFrameBytes, 1024 * 1024, 4 * 1024 * 1024, 'frame-limit'),
      maxPendingRequests: boundedInteger(options.maxPendingRequests, 16, 64, 'pending-limit'),
      maxQueuedBytes: boundedInteger(options.maxQueuedBytes, 2 * 1024 * 1024, 8 * 1024 * 1024, 'queue-limit'),
    };
    const client = new NativeCodexReadonlyClient(CONSTRUCTOR_KEY, limits);
    try {
      await client.#open(socketPath);
      const response = await client.#request('initialize', { clientType: 'vscode' });
      client.#success(response);
      if (client.#closed) throw client.#closeReason;
      if (client.#clientId === INITIAL_CLIENT) throw new Error('not-initialized');
      return client;
    } catch (error) {
      client.#fail(error);
      throw error;
    }
  }

  get diagnostics() {
    return Object.freeze({ closed: this.#closed, pendingRequests: this.#pending.size,
      bufferedBytes: this.#headerRead + (this.#body?.length ?? 0), frameTimerActive: this.#frameTimer != null });
  }

  async findOwner({ hostId, conversationId }) {
    identity(hostId, 'host');
    identity(conversationId, 'conversation');
    const response = await this.#request('thread-owner-discovery', { hostId, conversationId });
    if (response.resultType === 'error' && response.error === 'no-client-found') return null;
    this.#success(response);
    const owner = Object.freeze({ hostId, conversationId, targetClientId: response.handledByClientId,
      methodVersions: Object.freeze({ ownerDiscovery: 1, readModelSettings: hostId === 'local' ? 1 : 2 }) });
    // Weak tokens preserve scope without retaining an ever-growing owner/history map.
    OWNERS.set(owner, this);
    return owner;
  }

  async readModelSettings(owner) {
    if (OWNERS.get(owner) !== this) throw new Error('invalid-owner');
    const { hostId, conversationId, targetClientId } = owner;
    const check = await this.#request('thread-owner-discovery', { hostId, conversationId }, { targetClientId });
    this.#success(check);
    const response = await this.#request('thread-follower-read-model-settings', { conversationId },
      { targetClientId, ...(hostId === 'local' ? {} : { hostId }) });
    this.#success(response);
    if (response.result == null || typeof response.result !== 'object' || Array.isArray(response.result)) {
      throw new Error('response-result-invalid');
    }
    return response.result;
  }

  close() { this.#fail(new Error('client-closed')); }

  #open(socketPath) {
    return new Promise((resolveOpen, rejectOpen) => {
      this.#connectReject = rejectOpen;
      const timer = setTimeout(() => this.#fail(new Error('connect-timeout')), this.#limits.timeoutMs);
      const finish = () => { clearTimeout(timer); this.#connectReject = null; };
      const socket = createConnection({ path: socketPath });
      this.#socket = socket;
      socket.once('connect', () => { finish(); resolveOpen(); });
      socket.once('close', () => { this.#fail(new Error('connection-closed')); finish(); });
      socket.on('error', () => { this.#fail(new Error('connection-error')); finish(); });
      socket.on('data', (bytes) => {
        try { this.#receive(bytes); } catch (error) { this.#fail(error); }
      });
    });
  }

  #request(method, params, { targetClientId, hostId } = {}) {
    if (this.#closed) return Promise.reject(this.#closeReason ?? new Error('client-closed'));
    if (!this.#socket?.writable) return Promise.reject(new Error('not-connected'));
    if (method !== 'initialize' && this.#clientId === INITIAL_CLIENT) return Promise.reject(new Error('not-initialized'));
    if (this.#pending.size >= this.#limits.maxPendingRequests) return Promise.reject(new Error('pending-request-limit'));
    const version = versionFor(method, hostId);
    if (version == null) return Promise.reject(new Error('method-not-allowed'));
    const request = { type: 'request', requestId: randomUUID(), sourceClientId: this.#clientId,
      version, method, params, ...(targetClientId == null ? {} : { targetClientId }),
      ...(hostId == null ? {} : { hostId }), timeoutMs: this.#limits.timeoutMs };
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId);
        rejectRequest(new Error('timeout'));
      }, this.#limits.timeoutMs);
      this.#pending.set(request.requestId, { request, resolve: resolveRequest, reject: rejectRequest, timer });
      try { this.#write(request); } catch (error) { this.#fail(error); }
    });
  }

  #write(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length === 0 || body.length > this.#limits.maxFrameBytes) throw new Error('outgoing-frame-limit');
    if (!this.#socket?.writable || this.#socket.writableLength + body.length + 4 > this.#limits.maxQueuedBytes) {
      throw new Error('socket-write-limit');
    }
    const wire = Buffer.allocUnsafe(4 + body.length);
    wire.writeUInt32LE(body.length, 0);
    body.copy(wire, 4);
    this.#socket.write(wire);
  }

  #receive(bytes) {
    let offset = 0;
    while (!this.#closed && offset < bytes.length) {
      if (this.#frameTimer == null) this.#frameTimer = setTimeout(() => this.#fail(new Error('frame-timeout')), this.#limits.frameTimeoutMs);
      if (this.#body == null) {
        const size = Math.min(4 - this.#headerRead, bytes.length - offset);
        bytes.copy(this.#header, this.#headerRead, offset, offset + size);
        offset += size;
        this.#headerRead += size;
        if (this.#headerRead !== 4) continue;
        const length = this.#header.readUInt32LE(0);
        this.#headerRead = 0;
        if (length === 0 || length > this.#limits.maxFrameBytes) throw new Error('invalid-frame-length');
        this.#body = Buffer.allocUnsafe(length);
      }
      const size = Math.min(this.#body.length - this.#bodyRead, bytes.length - offset);
      bytes.copy(this.#body, this.#bodyRead, offset, offset + size);
      this.#bodyRead += size;
      offset += size;
      if (this.#bodyRead !== this.#body.length) continue;
      let body;
      try { body = new TextDecoder('utf-8', { fatal: true }).decode(this.#body); }
      catch { throw new Error('invalid-utf8'); }
      this.#body = null;
      this.#bodyRead = 0;
      clearTimeout(this.#frameTimer);
      this.#frameTimer = null;
      let message;
      try { message = JSON.parse(body); } catch { throw new Error('invalid-json'); }
      this.#handle(message);
    }
  }

  #handle(message) {
    if (message == null || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid-message');
    switch (message.type) {
      case 'broadcast': return; // No subscriptions/history cache/body retention in this client.
      case 'client-discovery-request':
        identity(message.requestId, 'request-id');
        this.#write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
        return;
      case 'request': {
        identity(message.requestId, 'request-id');
        identity(message.method, 'request-method');
        const expected = (INBOUND_VERSIONS[message.method] ?? 0) +
          (message.hostId != null && message.method.startsWith('thread-follower-') ? 1 : 0);
        const version = message.version ?? 0;
        const matches = expected === version || (message.hostId == null &&
          message.method === 'thread-follower-interrupt-turn' && version === 3);
        this.#write({ type: 'response', requestId: message.requestId, resultType: 'error',
          error: matches ? 'no-handler-for-request' : 'request-version-mismatch' });
        return;
      }
      case 'response': {
        const pending = this.#pending.get(message.requestId);
        if (!pending) return; // Duplicate/late/unknown responses do not allocate retained records.
        this.#pending.delete(message.requestId);
        clearTimeout(pending.timer);
        try {
          this.#validateResponse(message, pending.request);
          if (pending.request.method === 'initialize' && message.resultType === 'success') this.#clientId = message.result.clientId;
          pending.resolve(message);
        } catch (error) { pending.reject(error); }
        return;
      }
      default: throw new Error('invalid-message-type');
    }
  }

  #validateResponse(response, request) {
    if (!['success', 'error'].includes(response.resultType)) throw new Error('response-type-invalid');
    // Native response frames omit version; reject a mismatching version if a peer adds one.
    if (response.version != null && response.version !== request.version) throw new Error('response-version-mismatch');
    if (response.resultType === 'error') {
      if (typeof response.error !== 'string' || !/^[a-z][a-z0-9-]{0,127}$/u.test(response.error)) throw new Error('response-error-invalid');
      return;
    }
    if (response.method !== request.method) throw new Error('response-method-mismatch');
    identity(response.handledByClientId, 'response-client');
    if (request.method === 'initialize') {
      if (typeof response.result?.clientId !== 'string' || response.result.clientId === INITIAL_CLIENT ||
          response.result.clientId !== response.handledByClientId) throw new Error('response-initialize-invalid');
      identity(response.result.clientId, 'response-client');
    } else if (response.handledByClientId === this.#clientId ||
        (request.targetClientId != null && response.handledByClientId !== request.targetClientId)) {
      throw new Error('response-owner-mismatch');
    }
  }

  #success(response) {
    if (response.resultType !== 'success') throw new Error(`native-request-error:${response.error}`);
  }

  #fail(error) {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeReason = error;
    this.#connectReject?.(error);
    this.#connectReject = null;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
    clearTimeout(this.#frameTimer);
    this.#frameTimer = null;
    this.#body = null;
    this.#bodyRead = 0;
    this.#headerRead = 0;
    this.#socket?.removeAllListeners('data');
    this.#socket?.destroy();
  }
}
