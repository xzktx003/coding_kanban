import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Check adapters against actual TS Fastify registrations, never a route inventory. */
const ADAPTER_DIR = __dirname;
const ROOT = resolve(__dirname, "../../../../../..");
const require = createRequire(import.meta.url);
interface AdapterRoute {
  file: string;
  method: "GET" | "POST";
  path: string;
  target?: "gateway";
}
function adapterSources(): { file: string; content: string }[] {
  return readdirSync(ADAPTER_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      file: name,
      content: readFileSync(join(ADAPTER_DIR, name), "utf8"),
    }));
}

function adapterRoutes(file: string, content: string): AdapterRoute[] {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const routes: AdapterRoute[] = [];
  const checkedEndpoints = new Set<ts.Node>();
  const declarations = new Map<string, ts.Expression>();
  function declarationsIn(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    )
      declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, declarationsIn);
  }
  declarationsIn(source);
  function queryOnly(value: ts.Expression, seen = new Set<string>()): boolean {
    if (ts.isStringLiteralLike(value))
      return value.text === "" || value.text.startsWith("?");
    if (ts.isTemplateExpression(value)) return value.head.text.startsWith("?");
    if (ts.isConditionalExpression(value))
      return (
        queryOnly(value.whenTrue, seen) && queryOnly(value.whenFalse, seen)
      );
    if (ts.isIdentifier(value) && !seen.has(value.text)) {
      const initializer = declarations.get(value.text);
      if (initializer)
        return queryOnly(initializer, new Set([...seen, value.text]));
    }
    return false;
  }
  function pathOf(
    value: ts.Expression | undefined,
  ): Pick<AdapterRoute, "path" | "target"> {
    let literal: string | undefined;
    if (value && ts.isStringLiteralLike(value)) literal = value.text;
    else if (value && ts.isTemplateExpression(value)) {
      if (value.head.text.includes("?")) literal = value.head.text;
      else if (
        value.templateSpans.length === 1 &&
        value.templateSpans[0].literal.text === "" &&
        queryOnly(value.templateSpans[0].expression)
      )
        literal = value.head.text;
    }
    if (!literal?.startsWith("/"))
      throw new Error(
        `${file}: unresolved adapter endpoint ${value?.getText(source) ?? "<missing>"}`,
      );
    const pathname = literal.split("?", 1)[0];
    // buildUrl prefixes relative gateway endpoints with /api/session. Legacy
    // /api/* adapters are still forwarded to the independent runtime below.
    if (!pathname.startsWith("/api/"))
      return { path: `/api/session${pathname}`, target: "gateway" };
    return {
      path: pathname.startsWith("/api/session/")
        ? pathname.slice("/api/session".length)
        : pathname,
    };
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const get = ["getJson", "getJsonWithOptions", "dualGet"].includes(name);
      const post = [
        "postJson",
        "postJsonWithOptions",
        "postNoContent",
        "postNoContentWithOptions",
        "dual",
        "dualVoid",
      ].includes(name);
      if (get || post || name === "fetch") {
        let method: AdapterRoute["method"] =
          get || name === "fetch" ? "GET" : "POST";
        if (name === "fetch" && node.arguments[1]) {
          const init = node.arguments[1];
          if (!ts.isObjectLiteralExpression(init))
            throw new Error(`${file}: unresolved fetch method`);
          if (init.properties.some(ts.isSpreadAssignment))
            throw new Error(`${file}: unresolved fetch method spread`);
          const option = init.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) ||
                ts.isStringLiteralLike(property.name)) &&
              property.name.text === "method",
          );
          if (option && ts.isPropertyAssignment(option)) {
            if (
              !ts.isStringLiteralLike(option.initializer) ||
              !["GET", "POST"].includes(option.initializer.text)
            )
              throw new Error(`${file}: unsupported fetch method`);
            method = option.initializer.text as AdapterRoute["method"];
          }
        }
        const endpoint = node.arguments[name.startsWith("dual") ? 2 : 0];
        routes.push({ file, method, ...pathOf(endpoint) });
        if (endpoint) checkedEndpoints.add(endpoint);
      }
    }
    const literal = ts.isStringLiteralLike(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? node.head.text
        : undefined;
    if (
      (literal?.startsWith("/api/") || literal?.startsWith("/lifecycle/")) &&
      !checkedEndpoints.has(node)
    )
      throw new Error(`${file}: HTTP method unknown for ${literal}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return routes;
}

// Run outside jsdom/Vite so Fastify and native dependencies use their real Node
// environment. Import source through tsx: stale dist cannot make the test pass.
// No listen, API handlers, CLI process, network request or scheduler is started.
const REGISTERED_ROUTES = String.raw`
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync} from 'node:fs';
const {createRuntime} = await import(process.argv[1]);
const {registerSessionLifecycleRoutes} = await import(process.argv[2]);
const {default: Fastify} = await import(process.argv[3]);
const routes=JSON.parse(readFileSync(0,'utf8'));
const deny=()=>{throw new Error('Route registration unexpectedly started a process or network request')};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])childProcess[key]=deny;
syncBuiltinESMExports();
globalThis.fetch=deny;
const runtime=await createRuntime({dataHome:process.env.SESSION_DATA_HOME,instance:'adapter-route-contract',env:process.env});
const gateway=Fastify({logger:false});
registerSessionLifecycleRoutes(gateway,{origin:deny,fetch:deny,context:deny,followups:{inspect:deny,pause:deny}});
try{
 await Promise.all([runtime.app.ready(),gateway.ready()]);
 if(runtime.app.server.listening||gateway.server.listening)throw new Error('Route check must not bind a listener');
 process.stdout.write(JSON.stringify(routes.map(route=>({...route,registered:(route.target==='gateway'?gateway:runtime.app).hasRoute({method:route.method,url:route.path})}))));
}finally{await Promise.all([runtime.app.close(),gateway.close()])}
`;
function registeredRoutes(
  routes: AdapterRoute[],
): Array<AdapterRoute & { registered: boolean }> {
  const home = mkdtempSync(join(tmpdir(), "kanban-adapter-routes-"));
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(require.resolve("tsx")).href,
          "--input-type=module",
          "-e",
          REGISTERED_ROUTES,
          pathToFileURL(join(ROOT, "packages/session-runtime/src/server.ts"))
            .href,
          pathToFileURL(
            join(ROOT, "apps/server/src/routes/session-lifecycle.ts"),
          ).href,
          pathToFileURL(
            require.resolve("fastify", { paths: [join(ROOT, "apps/server")] }),
          ).href,
        ],
        {
          cwd: ROOT,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            USERPROFILE: home,
            TMPDIR: tmpdir(),
            SESSION_DATA_HOME: home,
            CODEX_HOME: join(home, "codex"),
            CLAUDE_CONFIG_DIR: join(home, "claude"),
            CODEX_PATH: join(home, "no-native-codex"),
            SESSION_CLAUDE_BIN: join(home, "no-native-claude"),
            DO_NOT_TRACK: "1",
            NODE_ENV: "test",
          },
          input: JSON.stringify(routes),
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
      ),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("api adapter routes", () => {
  it("registers every adapter's actual HTTP method and path in its isolated TS runtime or gateway", () => {
    const routes = adapterSources()
      .filter(({ file }) => file !== "shared.ts")
      .flatMap(({ file, content }) => adapterRoutes(file, content));
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).toContainEqual({
      file: "codex.ts",
      method: "POST",
      path: "/api/codex/thread/read",
    });
    expect(routes).toContainEqual({
      file: "acp.ts",
      method: "GET",
      path: "/health",
    });
    expect(routes).toContainEqual({
      file: "codex.ts",
      method: "GET",
      path: "/api/session/lifecycle/context",
      target: "gateway",
    });
    expect(routes).toContainEqual({
      file: "codex.ts",
      method: "POST",
      path: "/api/session/lifecycle/restore",
      target: "gateway",
    });
    const probes: AdapterRoute[] = [
      { file: "negative-method-probe", method: "GET", path: "/api/acp/prompt" },
      {
        file: "negative-route-probe",
        method: "POST",
        path: "/api/__missing_adapter_route",
      },
      {
        file: "negative-gateway-method-probe",
        method: "GET",
        path: "/api/session/lifecycle/restore",
        target: "gateway",
      },
      {
        file: "negative-gateway-route-probe",
        method: "POST",
        path: "/api/session/lifecycle/__missing",
        target: "gateway",
      },
    ];
    const checked = registeredRoutes([...routes, ...probes]);
    expect(
      checked.slice(0, routes.length).filter((route) => !route.registered),
    ).toEqual([]);
    expect(
      checked.slice(routes.length).map((route) => route.registered),
    ).toEqual([false, false, false, false]);
  }, 35_000);

  it("extracts both quote styles, generic helpers and query templates, and rejects dynamic paths", () => {
    expect(
      adapterRoutes(
        "fixture.ts",
        `
      getJson('/api/settings');
      postJson<Result>("/api/settings", {});
      getJson(\x60/api/status?model=\x24{model}\x60);
      const qs = cwd ? \x60?cwd=\x24{cwd}\x60 : '';
      getJson(\x60/api/projects\x24{qs}\x60);
      fetch('/api/session/health');
      fetch('/api/settings', { "method": "POST" });
    `,
      ).map(({ method, path }) => [method, path]),
    ).toEqual([
      ["GET", "/api/settings"],
      ["POST", "/api/settings"],
      ["GET", "/api/status"],
      ["GET", "/api/projects"],
      ["GET", "/health"],
      ["POST", "/api/settings"],
    ]);
    expect(
      adapterRoutes(
        "fixture.ts",
        "getJson('/lifecycle/context'); postJson('/lifecycle/restore', {});",
      ),
    ).toEqual([
      {
        file: "fixture.ts",
        method: "GET",
        path: "/api/session/lifecycle/context",
        target: "gateway",
      },
      {
        file: "fixture.ts",
        method: "POST",
        path: "/api/session/lifecycle/restore",
        target: "gateway",
      },
    ]);
    expect(() =>
      adapterRoutes("fixture.ts", "postJson(endpoint, {});"),
    ).toThrow(/unresolved adapter endpoint/);
    expect(() =>
      adapterRoutes("fixture.ts", "unknownHttp('/api/missing');"),
    ).toThrow(/HTTP method unknown/);
    expect(() =>
      adapterRoutes("fixture.ts", "unknownHttp('/lifecycle/missing');"),
    ).toThrow(/HTTP method unknown/);
    expect(() =>
      adapterRoutes("fixture.ts", "postJson(`/lifecycle/${action}`, {});"),
    ).toThrow(/unresolved adapter endpoint/);
    expect(() =>
      adapterRoutes("fixture.ts", "fetch('/api/missing', {...options});"),
    ).toThrow(/unresolved fetch method/);
  });

  it("no longer routes calls through tauri invoke outside native-only modules", () => {
    const nativeOnly = new Set([
      "dictation.ts",
      "lifecycle.ts",
      "remote.ts",
      "shared.ts",
      "tunnel.ts",
    ]);
    const offenders = adapterSources()
      .filter(({ file }) => !nativeOnly.has(file))
      .filter(({ content }) =>
        /\binvokeTauri\b|\bdual(Get|Void)?[<(]/.test(content),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
