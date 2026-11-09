import {
  openSync,
  fstatSync,
  lstatSync,
  readFileSync,
  closeSync,
  constants,
} from "node:fs";
import { fileURLToPath } from "node:url";
const PREFIX = "/chatgpt-remote-desktop",
  HEADER = "X-CG-GUI-Broker-Token";
const bad = () => Error("Invalid remote desktop configuration");
export function readOwnedVncToken(file) {
  let fd;
  try {
    fd = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (error?.code === "ELOOP" || error?.code === "ENOENT") throw bad();
    throw error;
  }
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.nlink !== 1 ||
      (st.mode & 0o777) !== 0o600 ||
      st.uid !== process.getuid() ||
      st.size < 32 ||
      st.size > 257
    )
      throw bad();
    const value = readFileSync(fd, "utf8").trim();
    if (!/^[A-Za-z0-9_+/=-]{32,256}$/.test(value)) throw bad();
    return value;
  } finally {
    closeSync(fd);
  }
}

export function configureVncCandidate(base, { origin, port, target, token }) {
  let publicUrl, upstream;
  try {
    publicUrl = new URL(origin);
    upstream = new URL(target);
  } catch {
    throw bad();
  }
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.origin !== origin ||
    publicUrl.username ||
    publicUrl.password ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    Number(publicUrl.port || 443) !== port ||
    upstream.protocol !== "http:" ||
    upstream.hostname !== "127.0.0.1" ||
    !upstream.port ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== "/" ||
    upstream.search ||
    upstream.hash ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_+/=-]{32,256}$/.test(token) ||
    !Array.isArray(base?.plugins)
  )
    throw bad();
  const matches = (req) =>
    typeof req.url === "string" && req.url.startsWith(PREFIX);
  const requestTarget = (req) => {
    const authority = req.headers[":authority"],
      host = req.headers.host;
    if (authority && host && authority !== host) return "";
    return authority || host || "";
  };
  const originOk = (req) =>
    requestTarget(req) === publicUrl.host &&
    (!req.headers.origin || req.headers.origin === origin);
  const staticOk = (req) => {
    try {
      const raw = req.url.split("?")[0],
        u = new URL(req.url, origin);
      if (
        u.origin !== origin ||
        !new RegExp("^" + PREFIX + "/[A-Za-z0-9_./-]+$").test(raw) ||
        raw.split("/").includes("..") ||
        u.pathname === PREFIX + "/websockify"
      )
        return false;
      if (u.search) {
        if (u.pathname !== PREFIX + "/vnc.html") return false;
        const expected = {
          autoconnect: "true",
          resize: "off",
          path: PREFIX.slice(1) + "/websockify",
        };
        for (const [k, v] of u.searchParams)
          if (!Object.hasOwn(expected, k) || expected[k] !== v) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  const guard = {
    name: "fixed-authenticated-native-desktop",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!matches(req)) return next();
        if (
          !["GET", "HEAD"].includes(req.method) ||
          !originOk(req) ||
          !staticOk(req)
        ) {
          res.statusCode = 403;
          res.end("Desktop access denied");
          return;
        }
        delete req.headers[HEADER.toLowerCase()];
        next();
      });
      server.httpServer?.prependListener("upgrade", (req, socket) => {
        if (!matches(req)) return;
        if (
          req.method !== "GET" ||
          req.url !== PREFIX + "/websockify" ||
          !originOk(req) ||
          req.headers.origin !== origin
        ) {
          socket.write(
            "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
          );
          socket.destroy();
          return;
        }
        delete req.headers[HEADER.toLowerCase()];
      });
    },
  };
  const proxy = {
    target: upstream.origin,
    ws: true,
    changeOrigin: false,
    headers: { [HEADER]: token },
    rewrite: (path) => path.replace(PREFIX, "/vnc"),
    configure(proxy) {
      proxy.on("proxyRes", (res) => {
        res.headers["cache-control"] = "private, no-store";
        res.headers["x-frame-options"] = "SAMEORIGIN";
        res.headers["content-security-policy"] =
          "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";
        res.headers["x-content-type-options"] = "nosniff";
      });
    },
  };
  return {
    ...base,
    plugins: [
      ...base.plugins.filter((p) => p?.name !== "http-fallback"),
      guard,
    ],
    server: {
      ...base.server,
      host: "0.0.0.0",
      port,
      strictPort: true,
      hmr: {
        ...(base.server?.hmr || {}),
        protocol: "wss",
        host: publicUrl.hostname,
        clientPort: port,
      },
      proxy: { ...base.server?.proxy, [PREFIX]: proxy },
    },
  };
}

// This resolver is installed only by the explicit native-desktop Vite config.
// The existing workbench and all direct imports retain their default modules.
export function nativeDesktopEntryPlugin() {
  const owner = fileURLToPath(
    new URL("./src/components/WorkbenchShell.tsx", import.meta.url),
  );
  const replacement = fileURLToPath(
    new URL("./src/chatgpt-mode/ChatgptNativeDesktopApp.tsx", import.meta.url),
  );
  return {
    name: "chatgpt-native-desktop-entry",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        source !== "../chatgpt-mode/ChatgptModeApp" ||
        typeof importer !== "string" ||
        importer.split("?")[0] !== owner
      )
        return null;
      return replacement;
    },
  };
}
