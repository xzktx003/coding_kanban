#!/usr/bin/env node
// Read-only component fixture. This server never starts Codex or opens its IPC.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    extension: { type: "string" },
    host: { type: "string", default: "0.0.0.0" },
    port: { type: "string", default: "0" },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("--port must be an integer from 0 through 65535");
if (values.host !== "0.0.0.0")
  throw new Error(
    "This frontend fixture requires --host 0.0.0.0 for LAN access",
  );
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(repository, "tests/fixtures/codex-goal-reference");
const extension = await realpath(
  resolve(
    repository,
    values.extension ??
      "third_party/openai.chatgpt-26.51007.21434-linux-x64/extension",
  ),
);
const assetRoot = await realpath(resolve(extension, "webview/assets"));
const manifest = JSON.parse(
  await readFile(resolve(extension, "package.json"), "utf8"),
);
const files = new Set([
  "native-goal.html",
  "native-goal-reference.js",
  "native-goal-completion-reference.js",
  "native-goal-draft-reference.js",
  "native-transcript.html",
  "native-transcript-reference.js",
]);
const expected = JSON.parse(
  await readFile(resolve(fixture, "reference-assets.json"), "utf8"),
);
if (manifest.version !== expected.version)
  throw new Error(
    "Official reference package version changed; audit the fixture before upgrading",
  );
const hashes = {};
for (const [name, sha256] of Object.entries(expected.hashes)) {
  hashes[name] = createHash("sha256")
    .update(await readFile(resolve(assetRoot, name)))
    .digest("hex");
  if (hashes[name] !== sha256)
    throw new Error(`Official reference asset changed: ${name}`);
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://fixture.invalid")
      .pathname;
    let path;
    if (pathname === "/reference.json") {
      response.writeHead(200, {
        "content-type": mime[".json"],
        "cache-control": "no-store",
      });
      response.end(
        request.method === "HEAD"
          ? undefined
          : JSON.stringify({ version: manifest.version, hashes }),
      );
      return;
    }
    if (files.has(pathname.slice(1)))
      path = resolve(fixture, pathname.slice(1));
    else if (/^\/assets\/[a-zA-Z0-9_.\/-]+$/.test(pathname)) {
      path = await realpath(
        resolve(assetRoot, pathname.slice("/assets/".length)),
      );
      const child = relative(assetRoot, path);
      if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`))
        throw new Error("Outside asset directory");
    } else {
      response.writeHead(404).end();
      return;
    }
    const details = await stat(path);
    if (!details.isFile() || !mime[extname(path)]) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": mime[extname(path)],
      "content-length": details.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else await pipeline(createReadStream(path), response);
  } catch {
    if (!response.headersSent) response.writeHead(404).end();
    else response.destroy();
  }
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(port, values.host, done);
});
const address = server.address();
const hosts = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry.address);
console.log(
  JSON.stringify({
    fixture: "codex-goal-reference",
    pid: process.pid,
    version: manifest.version,
    urls: hosts.map(
      (host) => `http://${host}:${address.port}/native-goal.html`,
    ),
    identity: `/reference.json`,
  }),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
