"use strict";

// This file is copied into our wrapper ASAR; the upstream ASAR and executable
// are never modified. These exact Linux hashes gate the version-specific shim.
const fs = require("node:fs");
// Electron's patched fs treats an ASAR as a virtual directory. Verify the
// physical archive with original-fs and read its members with patched fs.
const rawFs = require("original-fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const PINS = Object.freeze({
  binary: "45751964e5d517169752c50748fca162c4eb156e2e362749e57447bf1489859b",
  asar: "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e",
  entry: "466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf",
  chunk: "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333",
  preload: "aa8be920fd14a9b98eca16c91d97a55105b196698fda36d5063e966620a0c54a",
});
const CHUNK = "early-bootstrap-439-a0f25ba32c465de1.js";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const VIEW_URL = "app://-/__kanban_owned_desktop_view__.html";
const VIEW_SCRIPT_URL = "app://-/__kanban_owned_desktop_view__.js";
const CALLS = new Set(["sendMessageFromView","startLinkDrag","acknowledgeChunkedMessage","connectGitWorker",
  "sendWorkerMessageFromView","showContextMenu","getFastModeRolloutMetrics","workerSubscribe","workerUnsubscribe"]);
const BOOTSTRAP_SCRIPT = `(() => {
  const b = globalThis.electronBridge;
  if (!b || typeof b.getOwnedSharedObjectSnapshot !== "function") throw Error("Private preload is unavailable");
  return {windowType:b.windowType, getters:{
    getInitialSidebarBootstrap:b.getInitialSidebarBootstrap(),
    getSentryInitOptions:b.getSentryInitOptions(),
    getDesktopUserAgent:b.getDesktopUserAgent(),
    getAppSessionId:b.getAppSessionId(),
    getBuildFlavor:b.getBuildFlavor(),
    getSystemThemeVariant:b.getSystemThemeVariant()
  }, sharedObjects:b.getOwnedSharedObjectSnapshot()};
})()`;

function hashBytes(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function hashFile(filename) {
  const fd = rawFs.openSync(filename, rawFs.constants.O_RDONLY | rawFs.constants.O_NOFOLLOW);
  try {
    const before = rawFs.fstatSync(fd, {bigint:true});
    if (!before.isFile() || before.size < 1n || before.size > 4n * 1024n ** 3n) throw Error("Invalid pinned file");
    const hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) { const n = rawFs.readSync(fd, buffer, 0, buffer.length, position); if (!n) break; hash.update(buffer.subarray(0,n)); position += n; }
    const after = rawFs.fstatSync(fd, {bigint:true}), named = rawFs.lstatSync(filename, {bigint:true});
    for (const key of ["dev","ino","size","mtimeNs","ctimeNs","mode","uid"]) if (before[key] !== after[key] || before[key] !== named[key]) throw Error("Pinned file identity changed");
    return hash.digest("hex");
  } finally { rawFs.closeSync(fd); }
}
function privateDirectory(dir) {
  const stat = fs.lstatSync(dir);
  if (fs.realpathSync(dir) !== dir || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) throw Error("Unsafe private runtime directory");
}
function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw Error("Version-pinned patch target differs");
  return source.replace(before, after);
}

function createDefaultProjectDirectoryHandler({selectWindow, picker}) {
  if (typeof selectWindow !== "function" || typeof picker?.createDefault !== "function") throw Error("Private project directory unavailable");
  return target => {
    const window = selectWindow();
    if (!window || window.isDestroyed() || !window.webContents || window.webContents.isDestroyed()) throw Error("Private project directory unavailable");
    return picker.createDefault(window.webContents, target);
  };
}

function defaultProjectParent(store, key, projectRoots) {
  const effective = store?.getEffective?.(key);
  if (effective != null || projectRoots.length !== 1 ||
      typeof store?.get !== "function" || typeof store?.getDesktopConfig !== "function") return effective;
  const configured = store.get(key), raw = store.getDesktopConfig();
  return configured === undefined && raw != null && typeof raw === "object" && !Object.hasOwn(raw,key)
    ? projectRoots[0] : effective;
}

// Preserve the original broadcast and supplement only current private views
// missing from Electron's window enumeration. Use the original per-window
// sender so its renderer-ready queue and message semantics remain intact.
function installPrivateWindowBroadcast(manager, {getNativeWindows, records, owners, registry}) {
  const original = manager.sendMessageToAllWindows;
  if (typeof original !== "function" || typeof getNativeWindows !== "function") throw Error("Private window broadcast unavailable");
  manager.sendMessageToAllWindows = function(message) {
    let nativeWindows;
    try {
      const value = getNativeWindows();
      if (!Array.isArray(value)) throw Error("Native windows unavailable");
      nativeWindows = new Set(value);
    } catch { return Reflect.apply(original, this, arguments); }
    const result = Reflect.apply(original, this, arguments);
    if (this !== manager) return result;
    for (const record of records.values()) {
      try {
        const window = record.window, contents = window.webContents;
        if (record.failed || window.isDestroyed() || contents.isDestroyed() ||
            record.senderId !== contents.id || records.get(record.senderId) !== record ||
            owners.get(contents) !== record || registry.get(record.viewId) !== record ||
            nativeWindows.has(window) || !manager.isAppServiceWindow(window) ||
            (manager.isAvatarOverlayWindow(window) && !window.isVisible() &&
             message?.type !== "avatar-overlay-open-state-changed")) continue;
        manager.sendMessageToWindow(window, message);
      } catch { /* a retiring view must not prevent delivery to other views */ }
    }
    return result;
  };
}

// Only the owned container process supplies this fixed bridge root. Never
// record a payload, identifier, error string, stack, or mutable path.
function writeFirstCause(phase, enabled) {
  if (!enabled || typeof phase !== "string" || !/^(?:container_(?:output_frame_bytes|output_queue_bytes|stdout_error|native_error|native_frame_invalid|native_frame_bytes|native_wire_error|native_ready_invalid|native_shared_invalid|input_not_ready|input_poisoned|input_disconnected|input_frame_bytes|input_queue_bytes|input_wire_error|input_frame_invalid|input_scope_invalid|input_send_error|input_stream_error|input_jsonl_bytes|input_jsonl_invalid)|native_(?:wire_unsupported|wire_budget|wire_error|ipc_queue_bytes|ipc_send_error|ipc_callback_error|view_queue_count|view_queue_bytes|renderer_frame_error|renderer_ack_error|shared_host_unavailable|control_error|create_request|create_registry|create_factory|create_missing|create_reused|create_bootstrap)|renderer_(?:awaiting_count|awaiting_bytes|unsupported_value|value_budget|estimate_error|emit_error|unexpected_ack|overflow_unknown))$/.test(phase)) return;
  try {
    const info = fs.lstatSync("/bridge");
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o700 || fs.realpathSync("/bridge") !== "/bridge") return;
    const fd = fs.openSync("/bridge/first-cause.json", fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, JSON.stringify({v:1,phase}) + "\n"); }
    finally { fs.closeSync(fd); }
  } catch { /* First-cause telemetry is best effort; preserve the original path. */ }
}

async function launch() {
  const {app, BrowserWindow} = require("electron");
  let wire;
  try {
    if (process.platform !== "linux" || typeof process.getuid !== "function") throw Error("Linux only");
    const {createViewRegistry,assertSafeLaunch,recoveryStatusFrame} = require("./native-view-registry.cjs");
    const {createOwnedAppHostPorts} = require("./native-apphost-ports.cjs");
    const {assertCodexOnlyEnvironment} = require("./codex-surface-policy.cjs");
    const {createProjectConsentRouter} = require("./project-consent-routing.cjs");
    const {createProjectFolderPicker} = require("./project-folder-picker-native.cjs");
    const {createDynamicToolsRouter} = require("./dynamic-tools-routing.cjs");
    const {adaptNativeAppChunk} = require("./native-app-policy.cjs");
    assertSafeLaunch(process.argv,process.env);
    assertCodexOnlyEnvironment(process.env);
    const resourceRoot = process.resourcesPath, runtimeRoot = path.dirname(resourceRoot);
    privateDirectory(runtimeRoot); privateDirectory(resourceRoot);
    if (fs.realpathSync(process.execPath) !== path.join(runtimeRoot, "ChatGPT")) throw Error("Unexpected executable");
    const configPath = path.join(resourceRoot, "private-config.json"), info = fs.lstatSync(configPath);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o600 || info.size > 16384) throw Error("Unsafe private configuration");
    const configBytes = fs.readFileSync(configPath), configDigest = hashBytes(configBytes);
    const config = JSON.parse(configBytes.toString("utf8"));
    const expectedKeys = ["version","profileId","generation","runtimeRoot","home","projectRoots","originalAsar","originalMain","binarySha256","asarSha256","entrySha256","chunkSha256","preloadSha256","privatePreloadSha256",
      ...(config && Object.hasOwn(config,"sharedThread") ? ["sharedThread"] : []),
      ...(config && Object.hasOwn(config,"serverSsh") ? ["serverSsh"] : [])].sort();
    if (!config || Object.keys(config).sort().join("\0") !== expectedKeys.join("\0") || config.version !== 1 ||
        (Object.hasOwn(config,"sharedThread") && (!config.sharedThread || Object.keys(config.sharedThread).join(",") !== "version" || ![1,2].includes(config.sharedThread.version))) ||
        (Object.hasOwn(config,"serverSsh") && (!config.serverSsh || Object.keys(config.serverSsh).join(",") !== "version" || config.serverSsh.version !== 1)) ||
        !UUID.test(config.profileId) || !UUID.test(config.generation) || config.runtimeRoot !== runtimeRoot ||
        config.home !== path.join(runtimeRoot,"home") || process.env.HOME !== config.home ||
        !Array.isArray(config.projectRoots) || config.projectRoots.length > 8 || config.projectRoots.some(root => typeof root !== "string" ||
          root.length < 2 || root.length > 4096 || !path.isAbsolute(root) || path.resolve(root) !== root || /[\x00-\x1f\x7f]/.test(root)) ||
        !path.isAbsolute(config.originalAsar) || path.resolve(config.originalAsar) !== config.originalAsar ||
        rawFs.realpathSync(config.originalAsar) !== config.originalAsar || config.originalMain !== ".vite/build/early-bootstrap.js" ||
        config.binarySha256 !== PINS.binary || config.asarSha256 !== PINS.asar || config.entrySha256 !== PINS.entry ||
        config.chunkSha256 !== PINS.chunk || config.preloadSha256 !== PINS.preload) throw Error("Invalid private runtime configuration");
    const firstCauseEnabled = process.env.KANBAN_FIRST_CAUSE_ROOT === "/bridge";
    privateDirectory(config.home);
    if (hashFile(process.execPath) !== PINS.binary || hashFile(config.originalAsar) !== PINS.asar ||
        hashFile(path.join(resourceRoot,"private-preload.js")) !== config.privatePreloadSha256) throw Error("Pinned artifact mismatch");
    const entry = config.originalAsar + "/" + config.originalMain;
    const chunk = config.originalAsar + "/.vite/build/" + CHUNK;
    const originalPreload = config.originalAsar + "/.vite/build/preload.js";
    if (hashBytes(fs.readFileSync(entry)) !== PINS.entry || hashBytes(fs.readFileSync(chunk)) !== PINS.chunk ||
        hashBytes(fs.readFileSync(originalPreload)) !== PINS.preload) throw Error("Pinned source member mismatch");
    // Register the upstream app:// scheme before Electron's ready event. Do
    // not await module loading until after the original entry has run.
    const wirePromise = import(pathToFileURL(path.join(__dirname,"wire-value.mjs")).href);
    let manager = null, creatingId = null, queuedIpcBytes = 0;
    let readySent = false, ownerRetired = false;
    const bySender = new Map(), provisional = new Map(), ownedSenders = new WeakMap();
    const projectConsent = createProjectConsentRouter({getRecord: senderId => bySender.get(senderId),getOwnedRecord: sender => ownedSenders.get(sender)});
    Object.defineProperty(globalThis,"__kanbanSelectConsentWindow",{value:projectConsent.selectWindow,writable:false,configurable:false});
    Object.defineProperty(globalThis,"__kanbanBindProjects",{value:projectConsent.bindProjects,writable:false,configurable:false});
    let sharedThread = null, sharedHost = null, sharedHostState = "unavailable", threadReadIdentity = null;
    const dynamicTools = createDynamicToolsRouter({getRecord: senderId => bySender.get(senderId),getOwnedRecord: sender => ownedSenders.get(sender),
      ...(config.sharedThread ? {withResume:(...args) => sharedThread.withResume(...args),withStart:(...args) => sharedThread.withStart(...args),withSend:(...args) => sharedThread.withSend(...args)} : {})});
    Object.defineProperty(globalThis,"__kanbanSelectDynamicToolsWindow",{value:dynamicTools.selectWindow,writable:false,configurable:false});
    Object.defineProperty(globalThis,"__kanbanBindAppServerManagers",{value:dynamicTools.bindManagers,writable:false,configurable:false});
    Object.defineProperty(globalThis,"__kanbanRunSharedPreparedSend",{value:(start,invoke)=>sharedThread?sharedThread.runPreparedSend(start,invoke):invoke(),writable:false,configurable:false});
    const pickerDirectories = [runtimeRoot,resourceRoot,config.home].map(dir => ({dir,info:fs.lstatSync(dir,{bigint:true})}));
    const pickerAuthority = () => {
      if (ownerRetired || !process.connected || !wire || !manager) return false;
      try {
        for (const {dir,info:before} of pickerDirectories) {
          privateDirectory(dir);
          const now = fs.lstatSync(dir,{bigint:true});
          if (["dev","ino","uid","gid","mode"].some(key => now[key] !== before[key])) return false;
        }
        const current = fs.lstatSync(configPath);
        return ["dev","ino","uid","gid","mode","size","mtimeMs","ctimeMs"].every(key => current[key] === info[key]) && hashFile(configPath) === configDigest;
      } catch { return false; }
    };
    const serverSsh = config.serverSsh ? require("./native-server-ssh-bridge.cjs").installNativeServerSshBridge({
      settings:config.serverSsh,profileId:config.profileId,generation:config.generation,verifyRuntimeSync:pickerAuthority
    }) : null;
    const projectPicker = createProjectFolderPicker({homeRoot:config.home,projectRoots:config.projectRoots,
      getRecord: senderId => bySender.get(senderId),getOwnedRecord: sender => ownedSenders.get(sender),
      verifyAuthority:async () => pickerAuthority(),verifyAuthoritySync:pickerAuthority,
      sendToView:(record,data) => output(record,{type:"viewMessage",data})});
    Object.defineProperty(globalThis,"__kanbanDefaultProjectParent",{value:(store,key) => defaultProjectParent(store,key,config.projectRoots),writable:false,configurable:false});
    Object.defineProperty(globalThis,"__kanbanCreateDefaultProjectDirectory",{value:createDefaultProjectDirectoryHandler({
      selectWindow:projectConsent.selectWindow,picker:projectPicker
    }),writable:false,configurable:false});
    if (config.sharedThread) {
      const {createNativeSharedThreadIntegration} = require("./native-shared-thread-integration.cjs");
      threadReadIdentity = require("./native-thread-read-identity.cjs").createNativeThreadReadIdentityGuard({verifyRuntimeSync:pickerAuthority});
      sharedThread = createNativeSharedThreadIntegration({profileId:config.profileId,generation:config.generation,
        getRecord:senderId => bySender.get(senderId),getOwnedRecord:sender => ownedSenders.get(sender),verifyRuntimeSync:pickerAuthority,
        desktopAccountObservation:true,requireSourceToken:true,enableSubmission:true,verifyThreadReadCliIdentitySync:threadReadIdentity.verify,sendToView:(record,data) => output(record,{type:"viewMessage",data}),sendFrame:frame => send(frame)});
      const {createNativeSharedHostFactory} = require("./native-shared-host-factory.cjs");
      sharedHost = createNativeSharedHostFactory({profileId:config.profileId,generation:config.generation,
        verifyRuntimeSync:pickerAuthority,sendFrame:frame => send(frame),
        enableAppTools:config.sharedThread.version===2,verifyAppToolsSync:()=>pickerAuthority()&&sharedThread.verifyAccountSync()===true,
        onState:state => {sharedHostState=state;for(const record of bySender.values()) { try {output(record,{type:"viewMessage",data:{type:"kanban-shared-host-state",state}});}catch{}}},
        onFailure:() => writeFirstCause("native_shared_host_unavailable",firstCauseEnabled)});
      Object.defineProperty(globalThis,"__kanbanRegisterSharedSource",{value:sharedHost.registerOwner,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSelectSharedDesktopTransport",{value:sharedHost.selectTransport,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanReadSharedCodexHome",{value:sharedHost.readCodexHome,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedConnectLifecycle",{value:sharedThread.lifecycle,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedConnectIntent",{value:sharedThread.intent,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedCreateIntent",{value:sharedThread.createIntent,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedSendIntent",{value:sharedThread.sendIntent,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedApprovalIntent",{value:sharedThread.approvalIntent,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedCatalogRequest",{value:sharedThread.catalogRequest,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedCatalogAck",{value:sharedThread.catalogAck,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanSharedCatalogCancel",{value:sharedThread.catalogCancel,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanGuardSharedThreadRequest",{value:sharedThread.guardRequest,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanPrepareSharedThreadRequest",{value:sharedThread.prepareRequest,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanRegisterSharedHostEvents",{value:sharedThread.registerHostEvents,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanIsSharedServerResponse",{value:sharedThread.isSharedServerResponse,writable:false,configurable:false});
      Object.defineProperty(globalThis,"__kanbanExchangeSharedThreadRequest",{value:async (hostId,frame) => {
        if (hostId !== "local" && hostId !== "kanban-shared-cli") throw Error("Shared host unavailable");
        return JSON.parse(await sharedThread.exchangeRequest(frame));
      },writable:false,configurable:false});
    }
    for (const [name,method] of [["Lifecycle","lifecycle"],["Open","open"],["Reply","reply"],["Complete","complete"],["Consume","consume"],["Direct","direct"]])
      Object.defineProperty(globalThis,"__kanbanProjectPicker"+name,{value:projectPicker[method],writable:false,configurable:false});
    const appHostPorts = createOwnedAppHostPorts({
      getOwnedRecord:sender => { const record = ownedSenders.get(sender); return record && bySender.get(sender.id) === record ? record : undefined; },
      output, fail:record => {
        writeFirstCause("native_renderer_frame_error", firstCauseEnabled);
        record.failed = true; void registry.destroy(record.viewId);
        try { send({v:1,type:"error",viewId:record.viewId,code:"PRIVATE_FRAME_ERROR"}); } catch {}
      },
    });
    const registry = createViewRegistry({dispose: record => {
      appHostPorts.retire(record);
      projectPicker.retire(record.window.webContents);
      if (sharedThread) sharedThread.retire(record.window.webContents);
      bySender.delete(record.senderId);
      if (!record.window.isDestroyed()) record.window.destroy();
    }});
    function encode(value) {
      try { return wire.encodeWireValue(value); }
      catch (error) {
        let code;
        try { code = Object.getOwnPropertyDescriptor(error,"code")?.value; } catch {}
        writeFirstCause(code === "unsupported" ? "native_wire_unsupported" : code === "limit" ? "native_wire_budget" : "native_wire_error", firstCauseEnabled);
        throw error;
      }
    }
    const send = value => {
      if (!process.connected) return;
      const encoded = encode(value), bytes = Buffer.byteLength(encoded);
      if (queuedIpcBytes + bytes > 8 * 1024 * 1024) {
        writeFirstCause("native_ipc_queue_bytes", firstCauseEnabled);
        throw Error("Private IPC queue full");
      }
      queuedIpcBytes += bytes;
      try { process.send(encoded, error => { queuedIpcBytes -= bytes; if (error) writeFirstCause("native_ipc_callback_error", firstCauseEnabled); }); }
      catch (error) { queuedIpcBytes -= bytes; writeFirstCause("native_ipc_send_error", firstCauseEnabled); throw error; }
    };
    const maybeReady = () => {
      if (!readySent && wire && manager && process.connected) {
        readySent = true;
        send({v:1,type:"ready",profileId:config.profileId,generation:config.generation,pid:process.pid});
        if (sharedHost) sharedHost.activate();
      }
    };
    Object.defineProperty(globalThis, "__kanbanCaptureWindowManager", { value(candidate) {
      if (!manager) {
        manager = candidate;
        installPrivateWindowBroadcast(manager, {getNativeWindows:() => PrivateWindow.getAllWindows(), records:bySender, owners:ownedSenders, registry});
      }
      queueMicrotask(maybeReady);
    }, writable:false, configurable:false });
    const extension = Module._extensions[".js"];
    Module._extensions[".js"] = function(mod, filename) {
      if (filename !== entry && filename !== chunk) return extension(mod, filename);
      const bytes = fs.readFileSync(filename);
      if (hashBytes(bytes) !== (filename === entry ? PINS.entry : PINS.chunk)) throw Error("Pinned source changed before compilation");
      let source = bytes.toString("utf8");
      if (filename === entry) {
        const before = 'l.protocol.handle("app",async t=>{var a;';
        const after = `l.protocol.handle("app",async t=>{if(t.url==="${VIEW_URL}")return new Response("<!doctype html><html><head><script defer src='${VIEW_SCRIPT_URL}'></script></head><body></body></html>",{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; script-src 'self'"}});if(t.url==="${VIEW_SCRIPT_URL}")return new Response(globalThis.__kanbanOwnedViewScript,{status:200,headers:{"Content-Type":"text/javascript; charset=utf-8"}});var a;`;
        source = replaceOnce(source,before,after);
      } else {
        source = (sharedThread ? require("./native-shared-host-policy.cjs").adaptNativeSharedHostChunk({body:bytes}) : adaptNativeAppChunk({body:bytes})).body.toString("utf8");
        if (serverSsh) source = require("./native-server-ssh-policy.cjs").adaptNativeServerSshChunk({original:bytes,base:Buffer.from(source)}).body.toString("utf8");
        const before = 'registerWindow(e,t,r,n,i){let s=e.id,a=e.webContents.id;this.windowAppearances.set(s,n),this.registeredWindowIds.add(s),this.registeredWebContentsIds.add(a)';
        const after = 'registerWindow(e,t,r,n,i){globalThis.__kanbanCaptureWindowManager(this);let s=e.id,a=e.webContents.id;this.windowAppearances.set(s,n),this.registeredWindowIds.add(s),this.registeredWebContentsIds.add(a)';
        source = replaceOnce(source,before,after);
      }
      return mod._compile(source,filename);
    };
    class PrivateWindow extends BrowserWindow {
      constructor(options = {}) {
        const isPrivate = options.webPreferences?.preload === originalPreload;
        super(isPrivate ? {...options, show:false, webPreferences:{...options.webPreferences, preload:path.join(resourceRoot,"private-preload.js")}} : options);
        this.__kanbanPrivate = isPrivate;
        if (isPrivate) {
          const contents = this.webContents, load = contents.loadURL.bind(contents);
          Object.defineProperty(contents,"loadURL",{value:(url,...options) => url === VIEW_URL ? load(url,...options) : Promise.reject(Error("Private view navigation denied")),writable:false,configurable:false});
          const guard = (event, detail) => {
            const url = typeof detail === "string" ? detail : detail?.url;
            if (url !== VIEW_URL) event.preventDefault();
          };
          contents.on("will-navigate",guard); contents.on("will-redirect",guard); contents.on("will-frame-navigate",guard);
          contents.on("did-navigate",(_event,url) => { if (url !== VIEW_URL && !this.isDestroyed()) this.destroy(); });
        }
        if (isPrivate && creatingId) {
          const record = {viewId:creatingId, window:this, senderId:this.webContents.id, inSeq:0, outSeq:0, lastId:0, pending:new Map(), ports:new Set(),
            bootstrapped:false, queued:[], queuedBytes:0, failed:false};
          bySender.set(this.webContents.id,record); ownedSenders.set(this.webContents,record); provisional.set(creatingId,record);
        }
      }
      loadURL(url, ...options) {
        if (!this.__kanbanPrivate) return super.loadURL(url,...options);
        if (typeof url !== "string" || !url.startsWith("app://-/")) return Promise.reject(Error("Private view navigation denied"));
        return super.loadURL(VIEW_URL,...options);
      }
      show() { if (!this.__kanbanPrivate) return super.show(); }
      showInactive() { if (!this.__kanbanPrivate) return super.showInactive(); }
    }
    const electron = require("electron"), facade = {};
    for (const key of Reflect.ownKeys(electron)) {
      const descriptor = Object.getOwnPropertyDescriptor(electron,key);
      Object.defineProperty(facade,key,{enumerable:descriptor.enumerable,configurable:true,
        get:() => key === "BrowserWindow" ? PrivateWindow : Reflect.get(electron,key,electron)});
    }
    const originalLoad = Module._load;
    Module._load = function(request,parent,isMain) {
      const result = originalLoad.call(this,request,parent,isMain);
      return request === "electron" ? facade : result;
    };
    const scope = viewId => ({profileId:config.profileId,generation:config.generation,viewId});
    Object.defineProperty(globalThis,"__kanbanOwnedViewScript",{value:fs.readFileSync(path.join(__dirname,"native-view-shim.js"),"utf8"),writable:false,configurable:false});
    function output(record, frame) {
      if (!record.bootstrapped) {
        const bytes = Buffer.byteLength(encode(frame));
        if (record.queued.length >= 64) { writeFirstCause("native_view_queue_count", firstCauseEnabled); throw Error("Private event queue full"); }
        if (record.queuedBytes + bytes > 8 * 1024 * 1024) { writeFirstCause("native_view_queue_bytes", firstCauseEnabled); throw Error("Private event queue full"); }
        record.queued.push(frame); record.queuedBytes += bytes; return;
      }
      send({v:1,scope:scope(record.viewId),seq:++record.outSeq,...frame});
    }
    electron.ipcMain.on("kanban-owned:app-host-port", (event, payload) => { appHostPorts.adopt(event,payload); });
    electron.ipcMain.on("kanban-owned:event", (event, frame) => {
      const record = bySender.get(event.sender.id);
      if (!record || record.failed || record.window.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame || !frame || typeof frame !== "object") return;
      let phase = "native_renderer_frame_error";
      try {
        if (Object.getOwnPropertyDescriptor(frame,"type")?.value === "overflow") {
          const kind = Object.getOwnPropertyDescriptor(frame,"kind")?.value;
          const allowed = new Set(["awaiting_count","awaiting_bytes","unsupported_value","value_budget","estimate_error","emit_error","unexpected_ack"]);
          writeFirstCause("renderer_" + (allowed.has(kind) ? kind : "overflow_unknown"), firstCauseEnabled);
        }
        if (frame.type === "return" || frame.type === "throw") {
          const pending = record.pending.get(frame.id);
          if (!pending) throw Error("Unexpected response");
          if (pending.type === "openPort" && frame.type === "return") throw Error("AppHost transfer not adopted");
          record.pending.delete(frame.id);
          if (pending.type === "openPort" && frame.type === "throw") record.ports.delete(pending.portId);
          if (pending.type === "closePort" && frame.type === "return") record.ports.delete(pending.portId);
          output(record,frame.type === "return" ? {type:"return",id:frame.id,value:frame.value} : {type:"throw",id:frame.id});
        } else if (frame.type === "portMessage") {
          if (!record.ports.has(frame.portId) || !/^git-[1-9][0-9]*$/.test(frame.portId)) throw Error("Unknown port");
          output(record,{type:"portMessage",portId:frame.portId,data:frame.data});
        } else if (frame.type === "portClosed") {
          if (!/^git-[1-9][0-9]*$/.test(frame.portId) || !record.ports.delete(frame.portId)) throw Error("Unknown port");
          output(record,{type:"portClosed",portId:frame.portId});
        } else if (frame.type === "gitPort") {
          if (!frame.closed) {
            if (typeof frame.portId !== "string" || !/^git-[1-9][0-9]*$/.test(frame.portId) || record.ports.has(frame.portId) || record.ports.size >= 16) throw Error("Invalid Git port");
            record.ports.add(frame.portId);
          }
          output(record,{type:"gitPort",requestId:frame.requestId,closed:!!frame.closed,...(frame.closed?{}:{portId:frame.portId})});
        } else if (frame.type === "theme") {
          if (frame.value !== "light" && frame.value !== "dark") throw Error("Invalid theme");
          output(record,{type:"theme",value:frame.value});
        } else if (frame.type === "viewMessage") output(record,{type:"viewMessage",data:frame.data});
        else if (frame.type === "workerMessage" && typeof frame.workerId === "string") output(record,{type:"workerMessage",workerId:frame.workerId,data:frame.data});
        else throw Error("Unknown renderer event");
        phase = "native_renderer_ack_error";
        event.sender.send("kanban-owned:command",{type:"ack"});
      } catch {
        writeFirstCause(phase, firstCauseEnabled);
        record.failed = true;
        void registry.destroy(record.viewId);
        try { send({v:1,type:"error",viewId:record.viewId,code:"PRIVATE_FRAME_ERROR"}); } catch {}
      }
    });
    process.on("message", async encoded => {
      let message, record, phase = "native_control_error";
      try {
        if (typeof encoded !== "string") throw Error("Control message must be wire encoded");
        message = wire.decodeWireValue(encoded);
        if (!message || message.v !== 1 || typeof message.type !== "string") throw Error("Invalid control message");
        if ((message.type.startsWith("shared-desktop-") || message.type.startsWith("shared-mcp-")) && sharedHost) {sharedHost.receive(message);return;}
        if ((message.type === "shared-reply" || message.type === "shared-rpc-chunk" || message.type === "shared-event-chunk" || message.type === "shared-directory-request" || message.type === "shared-directory-ack" || message.type === "shared-directory-close" || message.type === "shared-catalog-chunk" || message.type === "shared-catalog-error" || message.type === "shared-create-reply" || message.type === "shared-send-reply") && sharedThread) { sharedThread.receive(message); return; }
        if (message.type === "recoveryStatus") {
          send(recoveryStatusFrame({message,registry,profileId:config.profileId,generation:config.generation,
            provisionalCount:provisional.size,queuedIpcBytes,ready:!!manager && !!wire && readySent && !ownerRetired && process.connected}));
        } else if (message.type === "createView") {
          phase = "native_create_request";
          if (Object.keys(message).sort().join(",") !== "type,v,viewId" || !UUID.test(message.viewId ?? "") || !manager) throw Error("View unavailable");
          phase = "native_create_registry";
          record = await registry.create(message.viewId,async () => {
            let window, createPhase = "native_create_factory";
            try {
              let creation;
              creatingId = message.viewId;
              try { creation = manager.createPrimaryWindow(); } finally { creatingId = null; }
              window = await creation;
              const created = provisional.get(message.viewId);
              if (!created || created.window !== window) {
                let reused = false;
                try { reused = !!window && !!ownedSenders.get(window.webContents); } catch {}
                createPhase = reused ? "native_create_reused" : "native_create_missing";
                throw Error("Private view ownership mismatch");
              }
              createPhase = "native_create_bootstrap";
              if (window.isDestroyed() || window.webContents.getURL() !== VIEW_URL || created.failed) throw Error("Private view did not load");
              created.bootstrap = await window.webContents.executeJavaScript(BOOTSTRAP_SCRIPT,false);
              if (created.failed || window.isDestroyed()) throw Error("Private view closed");
              window.once("closed",() => { appHostPorts.retire(created); projectPicker.retire(created.window.webContents); if (sharedThread) sharedThread.retire(created.window.webContents); bySender.delete(created.senderId); registry.forget(message.viewId,created); });
              return created;
            } catch (error) {
              writeFirstCause(createPhase, firstCauseEnabled);
              const created = provisional.get(message.viewId);
              if (created) { projectPicker.retire(created.window.webContents); if (sharedThread) sharedThread.retire(created.window.webContents); bySender.delete(created.senderId); }
              try {
                // Only the provisional record proves this creation owns a window.
                // A factory returning another window must never destroy its owner.
                if (created && !created.window.isDestroyed()) created.window.destroy();
              } catch { throw Object.assign(Error("Private view cleanup failed"),{code:"PRIVATE_CLEANUP_FAILED"}); }
              throw error;
            } finally { provisional.delete(message.viewId); }
          });
          if (record) {
            phase = "native_create_bootstrap";
            send({v:1,type:"bootstrap",scope:scope(message.viewId),bootstrap:record.bootstrap});
            delete record.bootstrap;
            record.bootstrapped = true;
            if (sharedHost) output(record,{type:"viewMessage",data:{type:"kanban-shared-host-state",state:sharedHostState}});
            for (const frame of record.queued) output(record,frame);
            record.queued.length = 0; record.queuedBytes = 0;
          }
        } else if (message.type === "destroyView") {
          if (Object.keys(message).sort().join(",") !== "type,v,viewId" || !UUID.test(message.viewId ?? "")) throw Error("Invalid destroy request");
          await registry.destroy(message.viewId);
          send({v:1,type:"viewClosed",scope:scope(message.viewId)});
        } else {
          const s = message.scope;
          if (!s || Object.keys(s).length !== 3 || s.profileId !== config.profileId || s.generation !== config.generation ||
              !UUID.test(s.viewId ?? "") || !Number.isSafeInteger(message.seq)) throw Error("Invalid frame scope");
          record = registry.get(s.viewId);
          if (!record || record.failed || !record.bootstrapped || message.seq !== record.inSeq + 1 ||
              !Number.isSafeInteger(message.id) || message.id <= record.lastId || record.pending.has(message.id) || record.pending.size >= 64) throw Error("Invalid frame sequence or request");
          let command;
          if (message.type === "call") {
            if (!CALLS.has(message.method) || !Array.isArray(message.args) || message.args.length > 8) throw Error("Unsupported operation");
            command = {type:"call",id:message.id,method:message.method,args:message.args};
          } else if (message.type === "openPort") {
            if (message.name !== "app-host" || typeof message.portId !== "string" || !/^app-host-[1-9][0-9]*$/.test(message.portId) || record.ports.size >= 16 || record.ports.has(message.portId)) throw Error("Invalid port");
            record.ports.add(message.portId);
            command = {type:"openPort",id:message.id,portId:message.portId,name:"app-host"};
          } else if (message.type === "portPost" || message.type === "closePort") {
            if (typeof message.portId !== "string" || !record.ports.has(message.portId)) throw Error("Unknown port");
            command = message.type === "portPost" ? {type:"portPost",id:message.id,portId:message.portId,data:message.data} : {type:"closePort",id:message.id,portId:message.portId};
          } else throw Error("Unsupported frame");
          record.pending.set(message.id,{type:message.type,portId:message.portId});
          record.inSeq = message.seq;
          record.lastId = message.id;
          if ((message.type === "portPost" || message.type === "closePort") && /^app-host-[1-9][0-9]*$/.test(message.portId)) appHostPorts.dispatch(record,command);
          else record.window.webContents.send("kanban-owned:command",command);
        }
      } catch (error) {
        writeFirstCause(phase, firstCauseEnabled);
        if (record?.viewId) void registry.destroy(record.viewId);
        try { send({v:1,type:"error",viewId:UUID.test(message?.viewId ?? "") ? message.viewId : UUID.test(message?.scope?.viewId ?? "") ? message.scope.viewId : null,code:"PRIVATE_CONTROL_ERROR"}); } catch {}
      }
    });
    process.on("disconnect", () => { ownerRetired = true; serverSsh?.close(); projectPicker.dispose(); if (sharedHost) sharedHost.close(); if (sharedThread) sharedThread.dispose(); if (threadReadIdentity) threadReadIdentity.close(); void registry.cancelAll(); });
    app.once("will-quit", () => { ownerRetired = true; serverSsh?.close(); projectPicker.dispose(); if (sharedHost) sharedHost.close(); if (sharedThread) sharedThread.dispose(); if (threadReadIdentity) threadReadIdentity.close(); });
    app.setAppPath(config.originalAsar);
    require(entry);
    wire = await wirePromise;
    maybeReady();
  } catch (error) {
    // Never leak artifact paths or local data over the control channel.
    if (process.connected && wire) process.send(wire.encodeWireValue({v:1,type:"fatal",code:"PRIVATE_LAUNCH_FAILED"}));
    console.error("Private desktop runtime could not start:", error?.message ?? "unknown error");
    app.exit(71);
  }
}
module.exports = { launch, installPrivateWindowBroadcast, createDefaultProjectDirectoryHandler, defaultProjectParent };
