import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isSharedThreadCreationAuthority, inspectSharedThreadCreationReceipt } from "./shared-thread-creation.mjs";

const createdSources = new WeakMap();
const adoptions = new WeakSet();
export const isSharedCreatedThreadAdoption = value => adoptions.has(value);
const bindingKeys = ["hostId", "runtimeGeneration", "daemonGeneration", "accountRevision", "projectId", "threadId", "viewId", "clientId"];
const equal = (a, b) => !!a && !!b && Object.keys(a).length === 8 && Object.keys(b).length === 8 && bindingKeys.every(k => a[k] === b[k]);
const failure = (threadId, phase = "created-adoption") => Object.assign(new Error("Shared thread was created but its connection is not confirmed; do not resend creation"),
  { code: "SHARED_DAEMON_OUTCOME_UNKNOWN", threadId, phase });

/** The original page catalog proves existing threads. A real created thread
 * receives a separate one-use server brand after metadata/config proof instead
 * of a fabricated page token. Only the owning source authority consumes it. */
export function consumeSharedCreatedSource(token, binding, view) {
  const value = createdSources.get(token);
  if (!value || value.consumed || value.view !== view || !equal(value.binding, binding) || !value.data.verifySync()) return null;
  value.consumed = true; return value.data;
}

export function createSharedCreatedThreadAdoption({ creationAuthority, provider,
  getOwnedView, verifyOwnedViewSync, verifyCurrentSync, adoptSourceBinding, onAdopted = () => {},
} = {}) {
  if (!isSharedThreadCreationAuthority(creationAuthority) || !provider || typeof provider.resolveCreatedBinding !== "function" ||
      [provider.sharedThread?.verifyBindingSync, provider.sharedThread?.verifyHistorySync, provider.executionProof?.getAttestationSync,
        getOwnedView, verifyOwnedViewSync, verifyCurrentSync, adoptSourceBinding, onAdopted].some(x => typeof x !== "function")) throw failure(undefined);
  let closed = false;
  const current = (viewId, view) => { try { return !closed && verifyCurrentSync() === true && verifyOwnedViewSync(viewId) === true && getOwnedView(viewId) === view && view?.viewId === viewId; } catch { return false; } };
  async function adopt(receipt) {
    const before = inspectSharedThreadCreationReceipt(receipt, creationAuthority);
    if (!before || before.consumed) throw failure(receipt?.threadId);
    const { scope, threadId } = before.data, view = getOwnedView(scope.viewId);
    if (!view || !current(scope.viewId, view)) throw failure(threadId);
    const binding = await provider.resolveCreatedBinding({ hostId: scope.hostId, threadId, viewId: scope.viewId, projectId: scope.projectId }, receipt);
    const after = inspectSharedThreadCreationReceipt(receipt, creationAuthority);
    const attestation = provider.executionProof.getAttestationSync(binding);
    if (!after?.consumed || !equal(after.binding, binding) || !current(scope.viewId, view) ||
        attestation?.policyOrigin !== "native-start-response" || attestation.nativeReplyDigest !== before.data.replySha256 ||
        Object.keys(before.data.permissionRequest ?? {}).length>1 && (attestation.permissionSelectionOrigin!=="native-start-request" || attestation.nativePermissionRequestDigest!==before.data.permissionRequestSha256) ||
        provider.sharedThread.verifyBindingSync(binding) !== true || provider.sharedThread.verifyHistorySync(binding) !== true) throw failure(threadId);
    const stable = Object.freeze(Object.fromEntries(bindingKeys.map(k => [k, binding[k]])));
    const data = Object.freeze({ origin: "native-start-response", nativeReplyDigest: before.data.replySha256,
      verifySync() { try { return current(scope.viewId, view) && provider.sharedThread.verifyBindingSync(stable) === true && provider.sharedThread.verifyHistorySync(stable) === true; } catch { return false; } },
      // Provenance was minted only after the actual start reply. Continued
      // reading retains its original view/account/root scope, not write proof.
      verifyReadSync() { try { return current(scope.viewId, view) && provider.sharedThread.verifyHistorySync(stable) === true; } catch { return false; } } });
    const token = Object.freeze({}), value = { consumed: false, view, binding: stable, data };
    createdSources.set(token, value);
    // Adoption is a synchronous server Map update after all asynchronous real
    // metadata/config checks. A constant-true callback cannot mint provenance.
    if (adoptSourceBinding(stable, token) !== true || !value.consumed || !data.verifySync()) throw failure(threadId);
    onAdopted(stable, receipt);
    if (!data.verifySync()) throw failure(threadId);
    return stable;
  }
  const adoption = Object.freeze({ adopt, close() { closed = true; } });
  adoptions.add(adoption); return adoption;
}

/** Hold the validated start reply and every following WS frame until adoption.
 * No auto-resume, model/tool write, retry or replacement connection is issued.
 * releaseFollowing MUST call the normal dispatcher below its hold check.
 */
export function createSharedCreatedReplyHold({ creationAuthority, adoption,
  verifyCurrentSync, memoryBudget, getQueuedBytes, getQueuedWrites,
  pauseInput, resumeInput, releaseReply, releaseFollowing, onFailure,
} = {}) {
  if (!isSharedThreadCreationAuthority(creationAuthority) || !isSharedCreatedThreadAdoption(adoption) ||
      [verifyCurrentSync, getQueuedBytes, getQueuedWrites, pauseInput, resumeInput, releaseReply, releaseFollowing, onFailure,
        memoryBudget?.reserveBytes, memoryBudget?.releaseBytes].some(x => typeof x !== "function")) throw failure(undefined);
  const MAX_FRAME = 2 * 1024 * 1024, MAX_QUEUE = 8 * 1024 * 1024, MAX_COUNT = 64;
  const queue = [], allocations = new Set();
  let heldBytes = 0, active = null, locked = false, draining = false, closed = false, drainScheduled, heldThreadId;
  const current = () => { try { return !closed && verifyCurrentSync() === true; } catch { return false; } };
  function reserve(bytes) {
    const queuedBytes = getQueuedBytes(), queuedWrites = getQueuedWrites();
    if (!current() || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FRAME ||
        !Number.isSafeInteger(queuedBytes) || queuedBytes < 0 || !Number.isSafeInteger(queuedWrites) || queuedWrites < 0 ||
        heldBytes + queuedBytes + bytes > MAX_QUEUE || allocations.size + queuedWrites >= MAX_COUNT || memoryBudget.reserveBytes(bytes) !== true) throw failure(active?.threadId, "created-hold-budget");
    const allocation = { bytes }; allocations.add(allocation); heldBytes += bytes; return allocation;
  }
  function release(allocation) { if (allocations.delete(allocation)) { heldBytes -= allocation.bytes; memoryBudget.releaseBytes(allocation.bytes); } }
  function close() { if (closed) return; closed = true; clearTimeout(active?.timer); clearImmediate(drainScheduled); drainScheduled = undefined; queue.length = 0; for (const allocation of allocations) release(allocation); active = null; heldThreadId = undefined; }
  function fail(error, threadId) {
    if (closed) return;
    const cause = failure(threadId ?? active?.threadId ?? heldThreadId, error?.phase ?? "created-adoption");
    close(); try { onFailure(cause); } catch {}
  }
  function scheduleDrain() {
    if (closed || drainScheduled || !locked || active) return;
    drainScheduled = setImmediate(() => { drainScheduled = undefined; drain(); });
  }
  function drain() {
    if (closed || draining || !locked || active) return;
    if (!current()) { fail(failure(heldThreadId, "created-following-scope")); return; }
    draining = true;
    try {
      if (queue.length) {
        const item = queue.shift(); release(item.allocation); const result = releaseFollowing(item.data, false);
        if (result && typeof result.then === "function") { void Promise.resolve(result).catch(() => {}); throw failure(undefined, "created-following-dispatch"); }
      }
      if (!current()) throw failure(heldThreadId, "created-following-scope");
      if (!active && queue.length === 0) { locked = false; heldThreadId = undefined; resumeInput(); }
      // Each normal dispatcher retains all of its synchronous identity and
      // permission checks. Yield between frames so those checks cannot block
      // the owned native JSONL reader (including binding and ordinary receipts).
      // The WS remains paused and every remaining frame stays charged/FIFO.
      else if (!active) scheduleDrain();
    } catch (error) { fail(error); }
    finally { draining = false; }
  }
  function begin(receipt, encodedReply) {
    const observed = inspectSharedThreadCreationReceipt(receipt, creationAuthority);
    if (!observed || observed.consumed || active || !current() || typeof encodedReply !== "string") throw failure(receipt?.threadId);
    let parsed; try { parsed = JSON.parse(encodedReply); } catch { throw failure(observed.data.threadId); }
    if (parsed.id !== observed.data.requestId || parsed.result?.thread?.id !== observed.data.threadId ||
        createHash("sha256").update(JSON.stringify(parsed)).digest("hex") !== observed.data.replySha256) throw failure(observed.data.threadId);
    const allocation = reserve(Buffer.byteLength(encodedReply)), job = { receipt, encodedReply, allocation, threadId: observed.data.threadId, timer: null };
    active = job; locked = true; heldThreadId = job.threadId;
    job.timer = setTimeout(() => fail(failure(job.threadId, "created-adoption-timeout"), job.threadId), Math.max(1, Math.min(30_000, Math.ceil(observed.deadline - performance.now())))); job.timer.unref?.();
    try { pauseInput(); } catch (error) { fail(error, job.threadId); return false; }
    void (async () => {
      try {
        const binding = await adoption.adopt(receipt);
        if (!current() || active !== job) throw failure(job.threadId);
        release(job.allocation);
        // Authorized IPC writes may await their original identity guard. Keep
        // following frames paused until this exact reply is written/consumed,
        // so their synchronous guards cannot starve the reply's continuation.
        // The original receipt deadline still covers this wait.
        const result = releaseReply(job.encodedReply, binding);
        if (result && typeof result.then === "function") await result;
        if (!current() || active !== job) throw failure(job.threadId, "created-reply-dispatch");
        clearTimeout(job.timer); active = null;
        scheduleDrain();
      } catch (error) { fail(error, job.threadId); }
    })();
    return true;
  }
  function bufferFollowing(data, binary = false) {
    if (!locked) return false;
    try {
      if (closed || binary || !(data instanceof Uint8Array)) throw failure(active?.threadId);
      const allocation = reserve(data.byteLength); queue.push({ data: Buffer.from(data), allocation }); return true;
    } catch (error) { fail(error); return true; }
  }
  return Object.freeze({ begin, bufferFollowing, close, get active() { return locked; } });
}
