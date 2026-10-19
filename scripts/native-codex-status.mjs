import {
  constants,
  lstatSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStartupEnv } from "./startup-env.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Keep aligned with the four source entries packed by buildCompanionVsix().
const companionFiles = [
  "package.json",
  "extension.cjs",
  "control.cjs",
  "appserver-send.cjs",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function regularFile(path, privateFile = false, maxBytes = 1024 * 1024) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    throw new Error("invalid file");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error("symlink rejected");
  }
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(descriptor);
    if (
      !info.isFile() ||
      info.size > maxBytes ||
      (privateFile &&
        (info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o600))
    )
      throw new Error("unsafe file");
    const data = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < data.length) {
      const count = readSync(descriptor, data, length, data.length - length);
      if (!count) break;
      length += count;
    }
    if (length > maxBytes) throw new Error("oversized file");
    return data.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}
function privateJson(path) {
  return JSON.parse(regularFile(path, true, 64 * 1024));
}
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])]),
    );
  return value;
}
function digest(bytes, manifest = false) {
  if (manifest) {
    const value = JSON.parse(bytes);
    delete value.__metadata;
    bytes = JSON.stringify(normalized(value));
  }
  return createHash("sha256").update(bytes).digest("hex");
}
function companionComparison(root, extensionsDir) {
  const source = join(root, "packages/native-codex-host/companion");
  const manifest = JSON.parse(regularFile(join(source, "package.json")));
  for (const key of ["publisher", "name", "version"])
    if (typeof manifest[key] !== "string" || !/^[\w.-]+$/.test(manifest[key]))
      throw new Error("invalid manifest");
  if (typeof extensionsDir !== "string" || !isAbsolute(extensionsDir))
    throw new Error("invalid extension directory");
  const installed = join(
    extensionsDir,
    `${manifest.publisher}.${manifest.name}-${manifest.version}`,
  );
  const changedFiles = companionFiles.filter((name) => {
    const expected = digest(
      regularFile(join(source, name)),
      name === "package.json",
    );
    try {
      return (
        digest(regularFile(join(installed, name)), name === "package.json") !==
        expected
      );
    } catch {
      return true;
    }
  });
  return { companion: changedFiles.length ? "stale" : "current", changedFiles };
}
function gatewayMatchesRecord(gateway, record) {
  if (
    typeof gateway?.iframeUrl !== "string" ||
    !gateway.iframeUrl.startsWith("/native-codex/?")
  )
    return false;
  const url = new URL(gateway.iframeUrl, "http://127.0.0.1");
  if (
    url.searchParams.getAll("folder").length !== 1 ||
    url.searchParams.get("folder") !== record.projectDir
  )
    return false;
  if (record.newChatWindowIds !== undefined) {
    if (
      !Array.isArray(record.newChatWindowIds) ||
      !Array.isArray(gateway.newChatWindowIds)
    )
      return false;
    const windows = record.newChatWindowIds;
    if (
      !windows.length ||
      !windows.every((value) => typeof value === "string" && UUID.test(value))
    )
      return false;
    if (
      gateway.newChatWindowIds.length !== windows.length ||
      !windows.every(
        (value, index) => gateway.newChatWindowIds[index] === value,
      )
    )
      return false;
  }
  return true;
}
async function probe(fetcher, url, headers, json = true) {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
      ...(headers ? { headers } : {}),
    });
    if (!response.ok || !json) {
      await response.body?.cancel();
      return response.ok ? true : null;
    }
    // Broker status includes editor metadata. Consume only a bounded response and never print it.
    const reader = response.body.getReader();
    let length = 0;
    const chunks = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 64 * 1024) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(chunk.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      reader.releaseLock();
    }
  } catch {
    return null;
  }
}

/** Read-only diagnostics: no process signals, native inputs, or configuration writes. */
export async function nativeCodexStatus({
  root = repositoryRoot,
  env = process.env,
  fetcher = fetch,
} = {}) {
  const upstream = env.NATIVE_CODEX_UPSTREAM_URL;
  const match = upstream?.match(
    /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})\/?$/,
  );
  if (!match || Number(match[2]) > 65535)
    return {
      state: "unconfigured",
      reason: "需要显式 HTTP loopback 上游和私有宿主记录。",
    };
  let record, auth, comparison;
  try {
    record = privateJson(env.NATIVE_CODEX_RUNTIME_RECORD);
    const gatewayPort = Number(env.SERVER_PORT || env.PORT || 4000);
    if (
      record.protocol !== "http" ||
      record.port !== Number(match[2]) ||
      typeof record.projectDir !== "string" ||
      !isAbsolute(record.projectDir) ||
      resolve(record.projectDir) !== record.projectDir ||
      !Number.isInteger(record.brokerPort) ||
      record.brokerPort < 1024 ||
      record.brokerPort > 65535 ||
      record.brokerPort === record.port ||
      !Number.isInteger(gatewayPort) ||
      gatewayPort < 1 ||
      gatewayPort > 65535
    )
      throw new Error("invalid ports");
    auth = privateJson(record.brokerAuthFile);
    if (
      auth.port !== record.brokerPort ||
      typeof auth.token !== "string" ||
      !/^[0-9a-f]{64}$/.test(auth.token)
    )
      throw new Error("invalid broker identity");
    comparison = companionComparison(root, record.extensionsDir);
  } catch {
    return {
      state: "unconfigured",
      reason: "宿主记录、端口或 companion 私有配置无效；未请求未知宿主。",
    };
  }
  const hostUrl = new URL("/healthz", upstream).href;
  const gatewayUrl = `http://127.0.0.1:${Number(env.SERVER_PORT || env.PORT || 4000)}/api/native-codex/status`;
  const [host, gateway, broker] = await Promise.all([
    probe(fetcher, hostUrl, undefined, false),
    probe(fetcher, gatewayUrl),
    probe(fetcher, `http://127.0.0.1:${record.brokerPort}/status`, {
      authorization: `Bearer ${auth.token}`,
    }),
  ]);
  const result = {
    ...comparison,
    hostUrl,
    gatewayUrl,
    host: host ? "available" : "unavailable",
    gateway: gateway?.available === true ? "available" : "unavailable",
    sendAvailable:
      broker?.sendAvailable === true && gateway?.sendAvailable === true,
  };
  if (comparison.companion === "stale") return { ...result, state: "stale" };
  if (!host || gateway?.available !== true)
    return { ...result, state: "unreachable" };
  if (!gatewayMatchesRecord(gateway, record))
    return { ...result, state: "gateway-mismatch" };
  const brokerReady =
    broker?.companionActive === true &&
    broker.officialActive === true &&
    broker.broker?.enabled === true &&
    broker.instanceBroker?.enabled === true &&
    UUID.test(broker.instanceBroker.instanceId ?? "");
  return {
    ...result,
    state: brokerReady ? "broker-ready" : "host-ready-awaiting-browser",
  };
}

export function printNativeCodexStatus(result, log = console.log) {
  const explanation = {
    unconfigured: result.reason,
    stale: `已安装的自有 companion 与当前仓库不一致：${result.changedFiles?.join("、")}。旧版可能缺少浏览器实例标识或私有 broker；需在安全窗口部署新宿主。`,
    unreachable: "宿主或 Kanban 网关不可达，或网关未确认当前宿主。",
    "gateway-mismatch":
      "网关仍指向其他项目或宿主窗口，当前 .env 宿主配置尚未在网关生效。",
    "host-ready-awaiting-browser":
      "宿主 HTTP 已就绪，官方插件或当前私有实例 broker 尚未就绪；可能未激活或激活失败，请在 Codex 模式检查。",
    "broker-ready":
      "官方插件与私有实例 broker 已激活；不代表已登录或模型对话已验证。",
  };
  log(`[codex-status] ${result.state}：${explanation[result.state]}`);
  if (result.host)
    log(
      `[codex-status] 宿主 ${result.host}；网关 ${result.gateway}；公共发送桥 ${result.sendAvailable ? "可用" : "不可用（独立模式不依赖，使用原生输入框）"}。`,
    );
  log("[codex-status] 仅执行本地文件核对和 GET 检查；未启动、停止或发送任务。");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await nativeCodexStatus({
      env: loadStartupEnv(repositoryRoot, { ...process.env }),
    });
    printNativeCodexStatus(result);
    if (
      ["unconfigured", "stale", "unreachable", "gateway-mismatch"].includes(
        result.state,
      )
    )
      process.exitCode = 1;
  } catch {
    console.error("[codex-status] 无法读取启动配置；未执行宿主操作。");
    process.exitCode = 1;
  }
}
