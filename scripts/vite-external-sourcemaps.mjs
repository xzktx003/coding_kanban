import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), "../apps/web/package.json"),
);
const supportedVersion = "7.3.1";
const inlineMap =
  /\n\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;,\s]+)?;base64,[A-Za-z0-9+/=]+\s*$/;

export function assertExternalSourceMapContract(version) {
  if (version !== supportedVersion)
    throw new Error(
      `Vite external source map contract requires ${supportedVersion}; found ${version}. Revalidate JS, map, query, conditional response and HMR tests before updating.`,
    );
}
export function externalSourceMapUrl(requestUrl) {
  if (
    typeof requestUrl !== "string" ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//")
  )
    return null;
  const parsed = new URL(requestUrl, "http://vite.invalid");
  return `${parsed.pathname}.map${parsed.search}`;
}

/** Vite already retains each transform's real source map and exposes its .map
 * route. Only move that map out of the initial JavaScript response; do not
 * retain a second map cache, change transforms or change native HMR handling. */
export function viteExternalSourceMaps() {
  return {
    name: "workbench-external-source-maps",
    apply: "serve",
    configureServer(server) {
      assertExternalSourceMapContract(require("vite/package.json").version);
      const graph = server.environments?.client?.moduleGraph;
      if (!(graph?.urlToModuleMap instanceof Map))
        throw new Error(
          "Vite external source map module graph contract changed",
        );
      server.middlewares.use((request, response, next) => {
        const mapUrl = externalSourceMapUrl(request.url);
        if (
          request.method !== "GET" ||
          !mapUrl ||
          new URL(request.url, "http://vite.invalid").pathname.endsWith(".map")
        )
          return next();
        const end = response.end;
        response.end = function (chunk, encoding, callback) {
          if (
            response.statusCode !== 200 ||
            !String(response.getHeader("content-type") ?? "").includes(
              "javascript",
            )
          )
            return end.call(this, chunk, encoding, callback);
          const code =
            typeof chunk === "string"
              ? chunk
              : Buffer.isBuffer(chunk)
                ? chunk.toString("utf8")
                : null;
          if (!code || !inlineMap.test(code))
            return end.call(this, chunk, encoding, callback);
          // First transforms have completed by the time Vite ends the response.
          // Its fallback maps (e.g. untransformed assets) are kept inline because
          // they do not have a corresponding map in the module graph.
          // Match Vite 7.3.1's transform URL normalization without adding an
          // asynchronous module resolution to every critical script response.
          const moduleUrl = decodeURI(
            request.url.replace(/\bt=\d{13}&?\b/, "").replace(/[?&]$/, ""),
          )
            .replace(/(\?|&)import=?(?:&|$)/, "$1")
            .replace(/[?&]$/, "")
            .replaceAll("__x00__", "\0");
          const map = graph.urlToModuleMap.get(moduleUrl)?.transformResult?.map;
          if (!map || !map.mappings)
            return end.call(response, chunk, encoding, callback);
          if (response.hasHeader("content-length"))
            response.removeHeader("content-length");
          return end.call(
            response,
            code.replace(inlineMap, `\n//# sourceMappingURL=${mapUrl}\n`),
            encoding,
            callback,
          );
        };
        next();
      });
    },
  };
}
