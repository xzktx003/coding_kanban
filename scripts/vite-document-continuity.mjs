import { randomUUID } from "node:crypto";

const clientSuffix = "/vite/dist/client/client.mjs";
const statePath = "/__workbench_hmr_state";

function replaceOnce(source, pattern, replacement, description) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1)
    throw new Error(`Vite reconnect contract changed at ${description}`);
  return source.replace(pattern, replacement);
}

/** Keep hot updates; ask the user before replacing an active document. */
export function preserveViteDocument(
  source,
  state = { instanceId: "test", revision: 0 },
) {
  if (
    typeof state.instanceId !== "string" ||
    !Number.isSafeInteger(state.revision)
  )
    throw new TypeError("Invalid Vite document continuity state");

  const prefix = source.replace(
    "let willUnload = false;",
    `let willUnload = false;
let workbenchUpdatePending = false;
let workbenchReconnecting = false;
function requestWorkbenchReload() {
  workbenchUpdatePending = true;
  document.documentElement.dataset.workbenchUpdatePending = "true";
  window.dispatchEvent(new Event("workbench-update-available"));
}
let workbenchHmrInstance = ${JSON.stringify(state.instanceId)};
let workbenchHmrRevision = ${state.revision};
async function readWorkbenchHmrState() {
  const response = await fetch(base + "__workbench_hmr_state", { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Vite document state unavailable");
  return response.json();
}
function createWorkbenchHmrHandler(onConnected) {
  return createHMRHandler(async (payload) => {
    await handleMessage(payload);
    if (payload.type === "connected") onConnected?.();
    if (["connected", "update", "full-reload", "prune"].includes(payload.type)) {
      try {
        const state = await readWorkbenchHmrState();
        workbenchHmrInstance = state.instanceId;
        workbenchHmrRevision = state.revision;
      } catch { /* A later reconnect checks the state again. */ }
    }
  });
}`,
  );
  if (prefix === source)
    throw new Error("Vite reconnect contract changed at document lifecycle");

  let patched = replaceOnce(
    prefix,
    /onDisconnection\(\);/g,
    "clearInterval(pingIntervalId);\nonDisconnection();",
    "socket cleanup",
  );
  patched = replaceOnce(
    patched,
    /transport\.connect\(createHMRHandler\(handleMessage\)\);/g,
    "transport.connect(createWorkbenchHmrHandler());",
    "HMR handler setup",
  );
  patched = replaceOnce(
    patched,
    /await waitForSuccessfulPing\(url\.href\);\s*location\.reload\(\);/g,
    `if (workbenchReconnecting || workbenchUpdatePending) return;
                    workbenchReconnecting = true;
                    try { for (;;) {
                      if (willUnload) return;
                      if (document.visibilityState === "hidden") {
                        await new Promise(resolve => document.addEventListener("visibilitychange", resolve, { once: true }));
                        continue;
                      }
                      try {
                        const state = await readWorkbenchHmrState();
                        if (state.instanceId !== workbenchHmrInstance || state.revision !== workbenchHmrRevision) {
                          requestWorkbenchReload();
                          return;
                        }
                        let connected, handshakeTimer;
                        const handshake = new Promise((resolve, reject) => {
                          connected = resolve;
                          handshakeTimer = setTimeout(() => reject(new Error("Vite HMR reconnect timed out")), 10000);
                        });
                        try {
                          await transport.connect(createWorkbenchHmrHandler(() => connected()));
                          await handshake;
                        } finally { clearTimeout(handshakeTimer); }
                        return;
                      } catch {
                        await transport.disconnect();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                      }
                    } } finally { workbenchReconnecting = false; }`,
    "lost socket recovery",
  );
  patched = replaceOnce(
    patched,
    /await connectingPromise;\n\t\t\t\tconnectingPromise = void 0;/g,
    "try { await connectingPromise; } finally { connectingPromise = void 0; }",
    "connection cleanup",
  );
  if ((patched.match(/location\.reload\(\);/g) ?? []).length !== 2)
    throw new Error("Vite reconnect contract changed at full reload");
  return replaceOnce(
    patched.replaceAll("location.reload();", "requestWorkbenchReload();"),
    /case "update":/g,
    'case "update":\n            if (workbenchUpdatePending) return;',
    "hot update admission",
  );
}

export function viteDocumentContinuity() {
  const instanceId = randomUUID();
  let revision = 0;

  return {
    name: "workbench-document-continuity",
    apply: "serve",
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(
          request.url ?? "/",
          "http://coding-kanban.local",
        ).pathname;
        if (pathname !== statePath) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ instanceId, revision }));
      });
    },
    handleHotUpdate() {
      revision += 1;
    },
    transform(source, id) {
      if (!id.replaceAll("\\", "/").split("?")[0].endsWith(clientSuffix))
        return;
      return {
        code: preserveViteDocument(source, { instanceId, revision }),
        map: null,
      };
    },
  };
}
