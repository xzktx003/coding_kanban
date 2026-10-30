import { createRequire } from "node:module";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveWebDevCacheDir } from "./vite-dev-cache.mjs";

/** Vite's development optimizer keeps every export of an icon barrel alive.
 * Resolve named icons against the installed package's real exports, preserving
 * aliases and component identity. Production already removes unused exports.
 */
export function createLucideImportOptimizer({ projectRoot }) {
  const require = createRequire(resolve(projectRoot, "apps/web/package.json"));
  const ts = require("typescript");
  const packageRoot = dirname(require.resolve("lucide-react/package.json"));
  const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  if (typeof metadata.module !== "string") throw new Error("Lucide ESM entry is unavailable");
  const barrel = readFileSync(resolve(packageRoot, metadata.module), "utf8");
  const icons = new Map();
  for (const match of barrel.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]\.\/(icons\/[-a-z0-9]+\.(?:mjs|js))['"]/g)) {
    for (const alias of match[1].matchAll(/default\s+as\s+([A-Za-z_$][\w$]*)/g))
      icons.set(alias[1], "lucide-react/" + dirname(metadata.module).replaceAll("\\", "/") + "/" + match[2]);
  }
  if (!icons.size) throw new Error("Lucide named icon export contract has changed; update the optimizer");
  const used = new Set();
  const usedNames = new Map();
  let configuredNames;
  function rewrite(code, id = "source.tsx", facadeId) {
    if (!/\bfrom\s*["']lucide-react["']/.test(code)) return code;
    const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const edits = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== "lucide-react" || statement.importClause?.isTypeOnly ||
          !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      const imports = [], facade = [], types = [], original = [];
      for (const binding of statement.importClause.namedBindings.elements) {
        const name = (binding.propertyName ?? binding.name).text;
        if (binding.isTypeOnly) types.push(binding.getText(source).replace(/^type\s+/, ""));
        else if (icons.has(name) && (!facadeId || configuredNames.has(name))) {
          const path = icons.get(name); used.add(path);
          usedNames.set(name, path);
          if (facadeId) facade.push(binding.getText(source));
          else imports.push(`import ${binding.name.text} from ${JSON.stringify(path)};`);
        } else original.push(binding.getText(source));
      }
      if (facade.length) imports.push(`import { ${facade.join(", ")} } from ${JSON.stringify(facadeId)};`);
      if (!imports.length) continue;
      if (types.length) imports.push(`import type { ${types.join(", ")} } from "lucide-react";`);
      if (statement.importClause.name || original.length) {
        const defaultName = statement.importClause.name?.text;
        imports.push(`import ${defaultName ?? ""}${defaultName && original.length ? ", " : ""}${original.length ? `{ ${original.join(", ")} }` : ""} from "lucide-react";`);
      }
      edits.push({ start: statement.getStart(source), end: statement.end, value: imports.join("\n") });
    }
    for (const edit of edits.reverse()) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
    return code;
  }
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) rewrite(readFileSync(path, "utf8"), path);
    }
  }
  scan(resolve(projectRoot, "apps/web/src"));
  configuredNames = new Set(usedNames.keys());
  return {
    rewrite,
    rewriteFacade(code, id) { return rewrite(code, id, "@kanban/lucide-icons"); },
    facadeSource() {
      // The owned optimizer cache can be outside apps/web's node_modules tree.
      // Resolve the installed files here rather than asking esbuild to resolve
      // a bare dependency relative to that cache directory.
      return [...configuredNames].sort().map(name => {
        const path = resolve(packageRoot, usedNames.get(name).slice("lucide-react/".length));
        return `export { default as ${name} } from ${JSON.stringify(path)};`;
      }).join("\n") + "\n";
    },
    get dependencies() { return [...used].sort(); },
  };
}

export function lucideImportOptimizer({ projectRoot }) {
  const optimizer = createLucideImportOptimizer({ projectRoot });
  // One dependency entry avoids hundreds of HTTP/2 icon-module requests. The
  // facade belongs to this Vite process's existing private optimizer directory.
  const facadePath = resolve(resolveWebDevCacheDir({ projectRoot }), "lucide-facade.mjs");
  mkdirSync(dirname(facadePath), { recursive: true });
  const facadeSource = optimizer.facadeSource();
  let previous;
  try { previous = readFileSync(facadePath, "utf8"); } catch { /* First owned cache. */ }
  if (previous !== facadeSource) writeFileSync(facadePath, facadeSource);
  return {
    name: "kanban-named-icon-imports", enforce: "pre", apply: "serve",
    config() { return { resolve: { alias: { "@kanban/lucide-icons": facadePath } }, optimizeDeps: { include: ["@kanban/lucide-icons", "lucide-react"] } }; },
    transform(code, id) {
      if (id.includes("/node_modules/") || id.includes("/.dev-runtime/vite-cache/") || !/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return null;
      const rewritten = optimizer.rewriteFacade(code, id);
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}
