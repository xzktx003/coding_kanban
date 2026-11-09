// Diagnostic metadata for one newly-created private project and one explicit
// browser send. This is an observer, not a native authorization mechanism.
export const CORE_EXPECTED_REPLY = 'DESKTOP_PROBE_OK';
export const CORE_PROMPT = 'Reply with exactly DESKTOP_PROBE_OK and nothing else. Do not use tools, access files, or run commands.';
export const CORE_FOLLOWUP_REPLY = 'DESKTOP_FOLLOWUP_OK';
export const CORE_FOLLOWUP_PROMPT = 'Reply with exactly DESKTOP_FOLLOWUP_OK and nothing else. Do not use tools, access files, or run commands.';

export function createCoreOwnedTurnGate(){
 let first=false,settled=false,followup=false;const required=['fixtureOwned','projectSelected','oneComposer','draftExact','buttonUnique','buttonEnabled','sameView'];
 const valid=proof=>!!proof&&required.every(key=>proof[key]===true);
 return Object.freeze({
  beginFirst(proof){if(first||!valid(proof))return false;first=true;return true},
  confirmFirst(proof){if(!first||settled||!proof||!['createdTarget','uiReply','composerCleared','idle'].every(key=>proof[key]===true))return false;settled=true;return true},
  beginFollowup(proof){if(!first||!settled||followup||!valid(proof)||proof.firstSettled!==true||proof.sameThread!==true)return false;followup=true;return true},
  snapshot(){return {first,settled,followup}},
 });
}

export function createCoreSendGate() {
  let attempted = false;
  const required = ['fixtureOwned','projectSelected','oneComposer','draftExact','buttonUnique','buttonEnabled','activityIdle','noObservedStarts','nativeCoverageConfirmed'];
  return Object.freeze({
    begin(proof) {
      if (attempted || !proof || required.some(key => proof[key] !== true)) return false;
      attempted = true; return true;
    },
    snapshot: () => ({ attempted }),
  });
}

export function createCoreLedger({ projectPath, maxNodes = 20000 } = {}) {
  if (typeof projectPath !== 'string' || !projectPath.startsWith('/') || projectPath.length > 4096 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 100000) throw Error('invalid fixture');
  const state = {
    coverage:'browser-visible-mcp-only',nativeCoverage:false,reliable:true, threadStartRequests:0, threadStartReceipts:0, threadReceiptMatchesProject:false,
    turnStartRequests:0, turnStartReceipts:0, turnMatchesThread:false, promptMatches:false,
    completionMatchesTurn:false, completionStatus:'unknown', expectedReplySeen:false,
    observedToolItems:0, observedUnknownItems:0, sandbox:'unknown',threadResolvedModel:'unknown',turnModel:'unknown',turnApprovalPolicy:'unknown',turnSandboxPolicy:'unknown',
  };
  let startRequest, turnRequest, thread, turn, startCwd, turnThread;
  const deferred = [];
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const validId = value => Number.isSafeInteger(value) || (typeof value === 'string' && value.length > 0 && value.length <= 256);
  const model = value => value === undefined ? 'omitted' : value === null ? 'default' : typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : 'other';
  const knownTool = new Set(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','collabAgentToolCall','webSearch','imageGeneration']);
  const benign = new Set(['userMessage','agentMessage','reasoning','plan','hookPrompt']);
  function onRequest(value) {
    if (!object(value) || !validId(value.id)) return;
    const p = object(value.params) ? value.params : {};
    if (value.method === 'thread/start') {
      state.threadStartRequests++;
      if (state.threadStartRequests !== 1) return;
      startRequest = value.id; startCwd = p.cwd === projectPath || (Array.isArray(p.runtimeWorkspaceRoots) && p.runtimeWorkspaceRoots.length === 1 && p.runtimeWorkspaceRoots[0] === projectPath);
    } else if (value.method === 'turn/start') {
      state.turnStartRequests++;
      if (state.turnStartRequests !== 1) return;
      turnRequest = value.id; turnThread = validId(p.threadId) ? p.threadId : undefined;
      state.promptMatches = Array.isArray(p.input) && p.input.length === 1 && p.input[0]?.type === 'text' && p.input[0]?.text === CORE_PROMPT;
      state.turnModel=model(p.model);state.turnApprovalPolicy=['untrusted','on-failure','on-request','never'].includes(p.approvalPolicy)?p.approvalPolicy:'unknown';state.turnSandboxPolicy=['readOnly','workspaceWrite','dangerFullAccess'].includes(p.sandboxPolicy?.type)?p.sandboxPolicy.type:'unknown';
    }
  }
  function onResponse(value) {
    if (!object(value) || !validId(value.id)) return;
    if (value.id === startRequest && startRequest !== undefined) {
      state.threadStartReceipts++;
      const r = value.result;
      if (!object(r) || !validId(r.thread?.id)) return;
      thread = r.thread.id;
      state.threadResolvedModel=model(r.model);
      state.threadReceiptMatchesProject = startCwd === true && r.cwd === projectPath;
      state.sandbox = r.sandbox?.type === 'readOnly' ? 'readOnly' : r.sandbox?.type === 'workspaceWrite' ? 'workspaceWrite' : r.sandbox?.type === 'dangerFullAccess' ? 'fullAccess' : 'unknown';
      flush();
    } else if (value.id === turnRequest && turnRequest !== undefined) {
      state.turnStartReceipts++;
      if (validId(value.result?.turn?.id)) turn = value.result.turn.id;
      flush();
    }
  }
  function processNotification(value) {
    const {method,threadId,turnId,status,kind,replyMatches} = value;
    if (method === 'turn/completed' && validId(thread) && turnThread === thread && threadId === thread && validId(turn) && turnId === turn) {
      state.completionMatchesTurn = true;
      state.completionStatus = ['completed','failed','interrupted'].includes(status) ? status : 'other';
    }
    if (['item/started','item/completed'].includes(method) && validId(thread) && turnThread === thread && threadId === thread && validId(turn) && turnId === turn) {
      if (method === 'item/started') {
        if (knownTool.has(kind)) state.observedToolItems++;
        else if (!benign.has(kind)) state.observedUnknownItems++;
      }
      if (method === 'item/completed' && kind === 'agentMessage' && replyMatches) state.expectedReplySeen = true;
    }
  }
  function flush() {
    if (!validId(thread) || !validId(turn)) return;
    for (const value of deferred.splice(0)) processNotification(value);
  }
  function onNotification(value) {
    if (!object(value) || !object(value.params)) return;
    const p = value.params, method = value.method;
    if (!['turn/completed','item/started','item/completed'].includes(method)) return;
    const kind = typeof p.item?.type === 'string' && (knownTool.has(p.item.type) || benign.has(p.item.type)) ? p.item.type : 'other';
    const status=['completed','failed','interrupted'].includes(p.turn?.status)?p.turn.status:'other';
    const meta = {method,threadId:p.threadId,turnId:method==='turn/completed'?p.turn?.id:p.turnId,status,kind,replyMatches:kind==='agentMessage'&&typeof p.item?.text==='string'&&p.item.text.trim()===CORE_EXPECTED_REPLY};
    if (!validId(meta.threadId) || !validId(meta.turnId)) return;
    if (!validId(thread) || !validId(turn)) { if (deferred.length >= 64) state.reliable=false; else deferred.push(meta); return; }
    processNotification(meta);
  }
  function observe(direction, frame) {
    if (!state.reliable || !['sent','received'].includes(direction)) return;
    try {
      const stack = [frame], seen = new Set(); let count = 0;
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object' || seen.has(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
        if (++count > maxNodes) { state.reliable = false; return; }
        seen.add(value);
        if (object(value) && value.hostId === 'local') {
          if (direction === 'sent' && value.type === 'mcp-request') onRequest(value.request);
          if (direction === 'received' && value.type === 'mcp-response') onResponse(value.message);
          if (direction === 'received' && value.type === 'mcp-notification') onNotification(value.message ?? value);
        }
        for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
      }
    } catch { state.reliable = false; }
  }
  function snapshot() {
    const result = {...state,turnMatchesThread:validId(thread) && turnThread === thread};
    if (!result.reliable) result.observedToolItems = result.observedUnknownItems = null;
    return result;
  }
  return Object.freeze({ observe, gap:() => { state.reliable = false; }, snapshot });
}
