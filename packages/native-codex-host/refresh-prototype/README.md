# Isolated refresh recovery components

Native editor opening receipts wait for command completion and use the exact registered URI's current tab group, not the temporary group reserved before `vscode.openWith`. A slow opening retains its own broker lock through command settlement; independent targets may still submit their own opening commands. VS Code may reuse a restored editor and remove that empty group. An existing inactive new chat is focused in its original group; duplicate exact native identities fail without choosing an arbitrary editor. These checks do not establish composer readiness or the two-second performance gate. The explicit new-chat browser harness captures bounded, read-only current tab-group metadata before closing its owned fixture, excluding tokens and tab labels.

This is an explicit, isolated compatibility prototype for [the reviewed refresh plan](../../../docs/designs/codex-mode-audit-20261014/refresh-recovery-plan.md). Default startup does not enable it. Explicit private-host attachment and server-registered client routes are available for isolated acceptance; automatic provisioning and production cutover are incomplete. The stage 0 performance gate failed; a working connection does not establish product recovery, multi-device operation, approval recovery or the two-second target.

The unmodified official VSIX `26.51007.21434` launches its CLI through the development-only `chatgpt.cliExecutable` setting. This prototype accepts only that captured launch, with or without `-c features.code_mode_host=true`, and `--version`. A fresh private host may select a generated executable that imports `runBridge` with a fixed absolute config path and exact domain/generation/PID/start-ticks identity. Every generated wrapper invocation rechecks the current service record, including version probes; transport admission checks it again after opening the socket and before forwarding initialize. Admission is bounded and cancellable; a late check cannot reopen input after failure. It must not replace the official executable or modify the VSIX. Each bridge establishes its own JSONL to Unix WebSocket connection to one independently owned app-server. Client IDs remain unchanged on the wire. EOF, cancellation and bridge exit affect the client connection only; the bridge never starts, stops, restarts or reconfigures the server.

Both the CLI and VSIX versions and SHA-256 hashes are checked against the investigated pair. CLI `0.162.1` is deliberately rejected. The config must be an owned `0600` regular file inside an owned `0700` runtime directory, and contain exactly:

```json
{
  "runtimeRoot": "/absolute/private/manager",
  "socketPath": "/absolute/private/manager/control.sock",
  "cliPath": "/absolute/matching-official-cli",
  "officialVsix": "/absolute/unmodified-official.vsix",
  "officialVersion": "26.51007.21434",
  "cliVersion": "0.162.0-alpha.17.2",
  "cliSha256": "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
  "officialVsixSha256": "75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56"
}
```

The configured socket must be directly inside the private runtime. This native version creates a rendezvous link to a protected physical socket named by SHA-256 of the requested path. Only that exact hash, an owned `0600` socket, and an owned `0700` canonical parent are accepted. An arbitrary/default CLI socket link is rejected. The native server owns creation and deletion of both paths; this adapter does not delete sockets or locks.

Input is bounded to 8 MiB per JSONL message, native output to 2 MiB per WebSocket message, and pending output/input to 8 MiB. Ingress and stdout backpressure pause their respective readers. Invalid UTF-8, malformed/incomplete JSONL, unexpected binary frames, lost connections and excess limits fail the connection. There is no automatic reconnect or submit replay. The existing gateway budgets are unchanged. An actual oversized native message has failed the real browser fixture; its source remains unidentified and compatibility is not established. `NATIVE_OUTPUT_LIMIT` diagnostics inspect at most 256 prefix bytes for a strict root method header and retain only method/declared length/limit. Missing receiver internals or an unrecognized header remain unknown; no body is logged and this metadata never changes admission.

Optional protocol measurements expose only a bounded method/id, error code and byte count, never params, result or output bodies. They are diagnostics, not receipts establishing task acceptance. Hash verification streams files instead of allocating both binary packages in each bridge. There is no completed response/history cache.

For reproduction, select the actual matching CLI explicitly:

```sh
node --test packages/native-codex-host/test/refresh-bridge.test.mjs
NATIVE_CODEX_REFRESH_CLI="$MATCHING_OFFICIAL_CLI" \
  node --test packages/native-codex-host/test/refresh-native.test.mjs
```

The second test starts and terminates only its own native listener in a fresh HOME, creates one ephemeral read-only thread, checks independent connection IDs, client exit and a real unsubscribe acknowledgement, and sends no model turn. Without the explicit CLI it skips; the recorded acceptance supplied the matching CLI and ran it.

`thread-pool.mjs` adds an isolated lifecycle policy with a configurable idle limit (default 10) and an explicitly supplied memory budget. Keys include authorization domain, generation, native thread UUID and canonical cwd. The caller must resolve real filesystem paths before observation. The policy stores lifecycle metadata only; repeated clients share an entry. Active turns, pending approvals/questions, unknown states and visible consumers cannot be evicted. A fresh native probe and observation revision fence precede unsubscribe; uncertainty stops further mutations and warm admission. RSS must be measured before admitting warm contexts. There is no time-based expiry.

`native-client.mjs` gives the manager one independent initialized connection with bounded pending requests/bytes, exact opaque turn/item/request IDs, uncertain timeouts without replay, and lifecycle metadata only. A `beforeSend` guard runs at the actual JSONL write boundary. Closing a backpressured bridge resumes its private reader to receive the close ACK and bounds its own close wait; no server shutdown is sent. `close()` is idempotent cleanup even after transport failure; `closed` and pending RPCs still reject with the original failure, so cleanup cannot be mistaken for delivery success.

`native-pool-adapter.mjs` uses real `thread/read` metadata, background-terminal and goal metadata, bounded loaded identities and native ancestry before unsubscribing only its own connection. Active or unknown descendants retain the parent. Revision changes at the native write boundary veto the request. A release is confirmed only after actual absence from `thread/loaded/list`; other subscribers are never disconnected. A context that unloads between reads is not accidentally cold-resumed by eviction. A fake adapter capability alone is not native compatibility proof.

`private-service.mjs` explicitly starts or attaches to a private service. It verifies the original CLI/VSIX bytes before execution, requires private canonical directories and a fresh record/endpoint, uses a detached native child with an environment allowlist, and records domain/generation/PID/Linux start ticks. Browser or manager exit does not stop it. Attaching validates the original process and endpoint; stale or foreign records fail without an implicit restart. `startPrivateService` requires metadata, domain UUID, processHome, codexHome and canonical cwd. These homes must be supplied within the same new private runtime parent; this module does not copy authentication or history. The native idle unload grace is explicitly configurable (1–60 seconds, isolated default 1), independently of the pool's count-based retention. There is no thread TTL.

`lifecycle-manager.mjs` composes the verified service, native adapter and bounded pool. It reconciles native state boundaries rather than stream bodies or idle full-history polls, adopts bounded loaded contexts after reconnection, tracks distinct visible consumers, and defers additional warm-only admission under resource pressure. Its API accepts only scope metadata. Before any thread RPC it binds two equal `account/read` snapshots with `refreshToken:false` across the pinned native's initial `account/updated` notice. ChatGPT admission requires actual user/workspace/backend/routing identity; a non-authenticating provider requires the explicit native `account:null, requiresOpenaiAuth:false` result. Unknown identity is rejected. Only a domain/generation-scoped digest is retained, never account payloads. The initial notice wait is bounded by `authorizationTimeoutMs` (default 15000, range 1–60000 ms). After binding, native `account/updated`, `account/login/completed` and `account/gatewayOAuth/changed` conservatively invalidate readiness even without a thread ID. Closing the manager closes only its connection, preserving the native process. Already queued writes and late warm-success returns are fenced. Rate-limit updates do not revoke the domain. This does not prevent a separate official client from changing authentication or establish service-wide bridge authorization; that integration remains pending. Manager close/reconnect, actual running turns, replayed approvals, background commands, real 11→10 LRU unloading and cold history restoration have isolated native tests. The test Responses provider is local and deterministic; it is not a replacement renderer or performance-model service.

```sh
NATIVE_CODEX_REFRESH_CLI="$MATCHING_OFFICIAL_CLI" \
  node --test packages/native-codex-host/test/refresh-lifecycle-native.test.mjs \
    packages/native-codex-host/test/refresh-service.test.mjs
```

Automatic browser bridge/control integration, visible-consumer disconnect/lease handling, profile provisioning and complete resource admission, official multi-device operations, long-history compatibility, final memory budget and production cutover remain incomplete. An explicit launcher can attach a new private host to an already verified service; this is not default enablement or a completed stage 1/two-second recovery. The explicit 2 GiB budget in tests is not a production default. Native family policy unit tests do not replace the remaining real descendant acceptance. WebSocket transport remains experimental. Earlier failed evidence are in [stage 0 acceptance](../../../docs/designs/codex-mode-audit-20261014/refresh-recovery-stage0.md).

Ongoing implementation and failed performance diagnostics: [2026-10-15 progress](../../../docs/designs/codex-mode-audit-20261014/refresh-recovery-progress-20261015.md).

## Explicit private host and client routing

The regular launcher accepts `--refresh-service-config /absolute/private/manager/bridge.json` together with `--refresh-domain <domain-UUID>` only as an explicit opt-in. `prepareRefreshHost` verifies the exact original CLI/VSIX pair, private service process/generation/domain and a read-only native initialize before importing the connection profile or installing extensions. It creates a fresh owned `0700` CLI wrapper and sets `chatgpt.cliExecutable` in that new host only. It never starts, restarts or takes over a native service. Missing/stale service metadata fails while preserving the service and source profile.

`--reconnection-grace-seconds` is valid only with that opt-in, accepts 1–300 seconds and defaults to 60. It controls code-server's disconnected-client grace, independently of native thread retention and pool capacity. Default hosts retain their original code-server behavior. The matching environment variables are `NATIVE_CODEX_REFRESH_SERVICE_CONFIG`, `NATIVE_CODEX_REFRESH_DOMAIN` and `NATIVE_CODEX_RECONNECTION_GRACE_SECONDS`. There is no automatic production activation.

An explicitly constructed gateway may register `registerNativeCodexRoutes(app, { gateway, profileId })` for each owned profile UUID. The server validates the fixed upstream; the browser cannot supply a port, path or upstream. HTTP/WebSocket paths, redirects, cookie paths and status iframe addresses are scoped to `/native-codex/clients/<UUID>/` and `/api/native-codex/clients/<UUID>/`. Existing transport budgets and the default route remain intact.

The corresponding browser entry is `/?mode=codex&nativeClient=<UUID>`. Host operations, including explicit public-composer sends, use that registered client. Followed tabs stay on the shared `/api/native-codex/tabs` journal. Layout templates, per-tab startup mappings, cached iframe URLs and previous-host identities are scoped to the selected profile. Invalid/duplicate selectors and another profile's iframe URL fail without falling back to the default host. This selector does not create a host or establish draft isolation by itself. The original code-server default profile shares its global browser IndexedDB across paths on one origin; separate server-side directories alone failed real draft isolation.

## Explicit browser-origin experiment

`createOriginListener` in `origin-listener.mjs` creates an additional HTTPS listener from an already listening, caller-owned frontend, reusing its actual request/upgrade handlers and TLS configuration. It preserves HTTP/2 where present, Host/Origin, cookies, CSP and the existing WebSocket budgets. There is no proxy hop, response cache, official bundle change or replacement MessagePort. Bind IP/port and bounded connection/close limits are explicit; closing it affects only that listener, and owner shutdown cannot leave a newly started listener behind. This is an internal isolated helper, not an option automatically enabled by `pnpm dev`.

Distinct browser origins partition the original browser storage. A real three-page test against one code-server and one shared native thread preserved three distinct existing-thread drafts across refresh, with each page submitting once through its original Send button. One page used a 390 px viewport, not a physical phone. Refresh-to-native-acceptance remained 14.627–16.147 seconds, and request failures were retained. That earlier run did not accept new-chat drafts. The later explicit iPhone 16 size simulation replaced the physical-device requirement. Two desktop tabs plus a 393×852/DPR 3 page now pass all nine independent-draft/concurrent/reload checks for one empty new chat per client after the original-workbench restoration barrier. All operations and the two-second gate remain incomplete.

The helper does not assign durable client identities or reserve origins. A production allocator must persist exact client-to-origin ownership and prevent a reused origin from inheriting another client's browser state, and enforce total host/listener resources. Ephemeral port allocation in the fixture is not that allocator. Default startup remains unchanged.

## Explicit browser acceptance

The user replaced physical-phone acceptance with iPhone 16 size simulation. `tests/e2e/codex-refresh-mobile.mjs` declares 393×852 CSS screen, DPR 3, mobile/touch mode and separate full/toolbar/keyboard-occlusion viewports. Browser engine/version, actual screen/viewport, coarse-pointer behavior and received touch events are recorded. This does not emulate an iOS system keyboard or hardware performance. Playwright viewport resize also changes screen; fixed-screen probes use separate contexts, while live resize tests record that limitation.

`tests/e2e/codex-refresh-browser-acceptance.mjs` requires explicit `NATIVE_CODEX_REFRESH_BROWSER_MANIFEST` and a fresh `NATIVE_CODEX_REFRESH_BROWSER_OUTPUT` directory. The owned `0600` manifest supplies a private fixture root, native service domain, exact thread/project, one registered host profile and three distinct LAN HTTPS origins. It does not start a host, copy login data or select a default service. Choose `NATIVE_CODEX_REFRESH_MOBILE_ENGINE=chromium` for dimension/touch simulation; WebKit additionally requires `NATIVE_CODEX_REFRESH_WEBKIT_ENDPOINT_FILE`, an owned `0600` file containing a private loopback BrowserServer endpoint. No API responses are intercepted. The script verifies three independent drafts, live mobile reflow, original Send/tap and actual native acceptance IDs. Any two-second failure remains failed. Its three diagnostic samples do not replace the full three-state 180-sample matrix.

`tests/e2e/codex-refresh-newchat-acceptance.mjs` uses the same explicit manifest/output variables for original empty-new-chat drafts and refresh. Native onboarding is completed through its own visible buttons, with time for scene transitions. Chromium composition is exercised through the browser input protocol; trusted start/update and the actual committed text are checked. The observed end-event trust and lack of an OS keyboard are reported rather than fabricated. It sends no model message.

For focused diagnosis only, `NATIVE_CODEX_REFRESH_SINGLE_CLIENT_DIAGNOSTIC=1` runs one desktop page and labels the result `diagnosticOnly`; it can report `scenarioPassed`, but cannot set the three-client `passed` result. The default remains two desktop tabs plus the iPhone 16 size simulation. Bounded startup marks and current native tab-group metadata are observed without modifying official state.

The browser surface observes the original `code/didStartWorkbench` mark before publishing its companion instance identity. Companion activation alone precedes editor-layout restoration and cannot authorize opening a new editor. A mark PerformanceObserver handles completion without polling, preserving the original performance timeline; pause/dispose disconnects it. Missing completion evidence leaves host operations unavailable. This wait counts toward ordinary refresh latency.


## Bounded startup diagnostics

The explicit browser acceptance script now records sanitized per-document resource/navigation timing and long-task observations. It keeps at most 512 resources, 128 tasks and 16 frames per snapshot; a full browser resource buffer is reported instead of cleared or enlarged. Related same-origin frames can report the same main-thread task, so their task durations must not be added as exclusive CPU time. A zero transfer size alone does not prove a network-cache hit. Full URLs, query values, headers and bodies are excluded.

For a single-desktop CPU diagnosis against an already running owned fixture:

```sh
NATIVE_CODEX_REFRESH_BROWSER_MANIFEST=/absolute/private/ready.json \
NATIVE_CODEX_REFRESH_BROWSER_OUTPUT=/absolute/fresh/profile-output \
node tests/e2e/codex-refresh-startup-profile.mjs
```

This script sends no model message and stops timing at the exact interactive native composer, **not** a native acceptance receipt. It is not a two-second acceptance run. CDP sampling overhead is uncalibrated. Raw CPU profiles stay in memory only; output contains bounded static asset basenames, source positions and counts. Non-monotonic native sample deltas produce an explicit counts-only histogram with all duration fields unknown; strict duration aggregation continues to reject them. Original performance marks and official files are preserved.

The diagnostic history oracle accepts only the bounded, controlled private fixture (32 turns maximum). It checks exact native thread/cwd, a completed turn and a controlled reply token; after each actual completion the browser test advances its expected tail. It does not require the original seed reply to remain in a virtualized DOM, copy history into the browser or substitute for the long-history matrix. General long-history acceptance needs its own evidence and remains incomplete.


## Owned process resource admission

`createRefreshManager` now requires an explicit `resourceMonitor`; native RSS alone is not a fallback. Construct `createRefreshResourceMonitor({service, roots})` with roots held by the process owner. Each extra root has an opaque UUID `id`, `kind` (`host`, `manager` or `gateway`), and the exact `pid`/`startTicks` captured immediately from the owner's child. `captureProcessIdentity(pid)` reads identity; it **does not establish ownership** and must never authorize an HTTP-supplied PID. Include every owned launcher/code-server, manager and gateway that belongs to this service. The native root is included automatically. Do not add the shared application's or a foreign host's process merely because its UID matches.

The monitor walks direct children of **every Linux task**, including worker-thread forks, deduplicates overlapping trees, and keeps previously observed descendants after reparenting until their exact process exits. Reused PIDs are not inherited. Roots disappearing/restarting, missing RSS, foreign UID, changing or cyclic ancestry, process/task budget overflow, and generation changes make the measurement unavailable. It rechecks identities and tree edges before returning a sample; it never truncates a successful total. Limits are 32 extra roots, 256 processes and 4096 tasks. There is no timer, process signal, command-line/environment capture or full `/proc` scan.

The manager checks the exact domain/generation, complete accounting and a sample age of at most five seconds before using the RSS for admission; it samples again after native state probes. Missing or failed measurements block additional idle warming. Expired samples also withdraw the status admission claim without polling history. Status exposes only counts, bytes and measurement time. Eviction continues through the original fresh native state/write fences and only this manager's unsubscribe. The monitor is invalidated by its owner, independently of closing one manager connection.

This is a conservative **sum of process RSS**, not PSS or a promise to cap operating-system memory: shared pages may count multiple times, running tasks may grow, and a process tree cannot be sampled atomically. Browser renderer memory still requires separate acceptance measurements. The caller's explicit root inventory is not an automatic host registry. Automatic host/profile registration, budget calibration, admission of new hosts/listeners and the 30-minute browser/native memory gate remain incomplete. The prototype stays opt-in.
