// Explicit launcher integration only; the regular startup never enables it.
import { lstat, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyBridgeConfig } from "./cli-bridge.mjs";
import { attachPrivateService } from "./private-service.mjs";

export async function prepareRefreshHost(
  options,
  { assertRunning = () => {} } = {},
) {
  assertRunning();
  if (!options.refreshServiceConfig) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      options.refreshDomain ?? "",
    )
  )
    throw Error("exact refresh domain required");
  const metadata = await verifyBridgeConfig(options.refreshServiceConfig);
  if (
    (await realpath(options.codexCli)) !== metadata.cliPath ||
    (await realpath(options.officialVsix)) !== metadata.officialVsix
  )
    throw Error(
      "refresh service and host must use the same original CLI/VSIX pair",
    );
  assertRunning();
  const service = await attachPrivateService({
    metadata,
    domain: options.refreshDomain,
  });
  assertRunning();
  const probe = await service.connect({ name: "kanban_refresh_host_probe" });
  await probe.close();
  const info = await lstat(options.runtimeRoot);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await realpath(options.runtimeRoot)) !== options.runtimeRoot
  )
    throw Error("refresh host runtime must be canonical private 0700");
  if (/[\s\x00-\x1f\x7f]/.test(process.execPath))
    throw Error("refresh bridge requires a direct Node interpreter path");
  const executable = join(options.runtimeRoot, "refresh-cli.mjs");
  const module = new URL("./cli-bridge.mjs", import.meta.url).href;
  const scope = {
    domain: service.record.domain,
    generation: service.record.generation,
    pid: service.record.pid,
    startTicks: service.record.startTicks,
  };
  const code = `#!${process.execPath}\nimport {runBridge} from ${JSON.stringify(module)};\nconst controller=new AbortController();\nprocess.on('SIGTERM',()=>controller.abort());process.on('SIGINT',()=>controller.abort());\nrunBridge({configPath:${JSON.stringify(options.refreshServiceConfig)},scope:${JSON.stringify(scope)},argv:process.argv.slice(2),signal:controller.signal}).catch(error=>{process.stderr.write(error.message+'\\n');process.exitCode=1;});\n`;
  assertRunning();
  await writeFile(executable, code, { mode: 0o700, flag: "wx" });
  return {
    executable,
    domain: service.record.domain,
    generation: service.record.generation,
    pid: service.record.pid,
    reconnectionGraceSeconds: options.reconnectionGraceSeconds,
  };
}
