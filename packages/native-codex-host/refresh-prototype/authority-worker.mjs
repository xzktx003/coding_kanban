// Internal observer: no turn, history, task interruption or shutdown RPC.
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { controlDirectory } from "./control-channel.mjs";
import { createNativeClient } from "./native-client.mjs";
import { verifyNativeArtifacts } from "./cli-bridge.mjs";
import { verifyPrivateNativeEndpoint } from "./private-service.mjs";
import { createNativeAuthorizationTracker } from "./authorization-boundary.mjs";
import { listenNativeAuthority } from "./native-authority.mjs";
import { exact } from "./control-peer.mjs";
process.umask(0o077);
let listener,
  client,
  stopping = false;
const stop = () => {
  stopping = true;
  void listener?.close().catch(() => {});
  void client?.close().catch(() => {});
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  if (process.argv.length !== 4 || process.argv[2] !== "--config")
    throw Error();
  const path = process.argv[3],
    runtimeRoot = dirname(path);
  await controlDirectory(runtimeRoot);
  const info = await lstat(path);
  if (
    basename(path) !== "authority-config.json" ||
    (await realpath(path)) !== path ||
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o600 ||
    info.size > 8192
  )
    throw Error();
  const config = JSON.parse(await readFile(path, "utf8"));
  if (
    !exact(config, "metadata,scope,version") ||
    config.version !== 1 ||
    config.metadata?.runtimeRoot !== runtimeRoot
  )
    throw Error();
  const { metadata, scope } = config;
  await verifyNativeArtifacts(metadata);
  await verifyPrivateNativeEndpoint({ metadata, scope });
  const tracker = createNativeAuthorizationTracker({
    ...scope,
    onInvalidated() {
      stopping = true;
      listener?.revoke("authorization-changed");
      void client?.close().catch(() => {});
    },
  });
  client = createNativeClient({
    socketPath: metadata.socketPath,
    name: "kanban_refresh_authority",
    beforeReady: () => verifyPrivateNativeEndpoint({ metadata, scope }),
    onLifecycle: (event) => tracker.observe(event),
  });
  client.closed.then(
    () => {
      listener?.revoke("native-closed");
      stop();
    },
    () => {
      listener?.revoke("native-closed");
      stop();
    },
  );
  await client.ready;
  const binding = await tracker.bind(client);
  tracker.assertValid();
  if (stopping) throw Error();
  listener = await listenNativeAuthority({ runtimeRoot, scope, binding });
  listener.closed.then(stop);
  tracker.assertValid();
  await verifyPrivateNativeEndpoint({ metadata, scope });
  if (stopping) throw Error();
} catch {
  stop();
  process.stderr.write("Private native authority initialization failed.\n");
  process.exitCode = 1;
}
