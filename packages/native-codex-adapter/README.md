# Native Codex readonly IPC adapter

Experimental, dependency-free Node adapter for the unmodified Codex extension host.
It only initializes a client, discovers a thread owner, and reads that owner's model
settings. There is no HTTP endpoint, generic request method, turn submission,
approval, interruption, router creation, socket fallback or automatic reconnect.

```js
import { NativeCodexReadonlyClient, verifyExtensionHost } from './src/index.mjs';

// All paths/version come from the isolated host launcher's verified configuration.
const compatibility = await verifyExtensionHost({
  extensionHostPath: config.extensionHostPath,
  extensionVersion: config.extensionVersion,
});
const client = await NativeCodexReadonlyClient.connect({
  isolatedCodexHome: config.isolatedCodexHome,
  socketPath: config.socketPath,
  compatibility,
});
try {
  const owner = await client.findOwner({ hostId: 'local', conversationId: config.threadId });
  if (owner) {
    const settings = await client.readModelSettings(owner);
    // Consume the readonly result; do not log private data by default.
  }
} finally {
  client.close();
}
```

`connect()` requires an explicit absolute, canonical isolated CLI home and its
`ipc/ipc.sock`. The home, IPC directory and socket must belong to the current UID
and have no group/other access. Symlink paths, the current user's default `.codex`
home, and the adapter process's configured `CODEX_HOME` (including realpath aliases
and descendants) are rejected before connection. `CODEX_HOME` is only examined to
exclude the native default; it is never used as an implicit connection path. Keep
the adapter in the controller's original environment and set the isolated
`CODEX_HOME` only on the native host child process. There is no override that lets
an arbitrary caller relabel the adapter's current default home as isolated.
The launcher must also isolate
the extension's temporary directory because the original host has a legacy IPC
fallback; this adapter never follows that fallback.

Compatibility accepts only versions `26.51002.51308` and `26.1002.51308` with host
SHA-256 `bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c`.
`verifyExtensionHost()` computes that digest from the actual configured host file.
Passing compatibility metadata directly is intended for a trusted launcher or
test fixture which already verified the bytes. The IPC protocol itself does not
authenticate the host digest or advertise an extension version.

The wire format is exactly four little-endian length bytes followed by UTF-8 JSON.
Initialization uses `sourceClientId: "initializing-client"`, method version `0`
and `{ clientType: "vscode" }`; the router assigns the client ID. Owner discovery
uses method version `1` and `{ hostId, conversationId }`. Local settings reads omit
the request-level host ID and use version `1`; remote reads retain their explicit
host ID and use version `2`. Native responses have no required version field;
success validates the method and owner ID, and any supplied mismatching version
is rejected. Inbound discovery always returns `canHandle: false`; inbound requests
receive native-compatible version/unsupported-handler errors.

`findOwner()` returns `null` for `no-client-found`, otherwise an immutable owner
token containing host, conversation, target client and method versions. Only the
client which issued that exact token can consume it. Each read first repeats
discovery with the captured `targetClientId`, so changed ownership fails before
the read. Tokens are weakly held and no thread/history map is retained. Native
settings are returned as an opaque object; a stable product schema has not yet
been established by real-host testing.

Default bounds are 1 MiB per frame, 16 pending requests, 2 MiB of queued outgoing
socket bytes and 5-second connection/request/partial-frame deadlines. Optional
`maxFrameBytes`, `maxPendingRequests`, `maxQueuedBytes`, `timeoutMs` and
`frameTimeoutMs` have hard upper limits of 4 MiB, 64, 8 MiB, 60 seconds and 60 seconds.
Invalid framing closes the client; request timeout releases its pending entry;
close/disconnect releases all timers and partial frame memory. Initialization must
receive a validated success identity and remain open before `connect()` returns;
native initialization errors reject and close the socket. Broadcast bodies
are discarded immediately. `diagnostics` exposes counts only.

Run `node --test packages/native-codex-adapter/test/ipc.test.mjs` from the repository
root, or `pnpm --dir packages/native-codex-adapter test`. Tests bind independent
temporary Unix sockets and never connect the user's default/live IPC. These tests
prove the adapter contract against fixtures, not a real extension host, model
availability, version upgrades, browser rendering or whole-process RSS limits.
