import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { createServer as reserveServer } from "node:net";
import { resolveWebDevCacheDir, webDevReactOptions } from "../../scripts/vite-dev-cache.mjs";
import { lucideImportOptimizer } from "../../scripts/vite-icon-imports.mjs";

test("optimized dependency bytes stay compiled while application Fast Refresh preserves state", async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const { createServer } = await import(pathToFileURL(requireWeb.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(requireWeb.resolve("@vitejs/plugin-react")).href);
  const root = await mkdtemp(join(tmpdir(), "kanban-optimizer-browser-"));
  const cacheDir = resolveWebDevCacheDir({ projectRoot: root });
  const component = (label: string) => `import {useState} from 'react'; export default function Counter(){const [n,setN]=useState(0);return <button onClick={()=>setN(n+1)}>${label} {n}</button>;}`;
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await symlink(resolve("apps/web/node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(root, "index.html"), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
    await writeFile(join(root, "main.tsx"), "import {createRoot} from 'react-dom/client';import Counter from './Counter';createRoot(document.getElementById('root')!).render(<Counter/>);");
    await writeFile(join(root, "Counter.tsx"), component("Before"));
    // Vite normalizes port 0 to its default. Choose an owned ephemeral port
    // first, then let strictPort reject any intervening collision.
    const reservation = reserveServer();
    await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "0.0.0.0", resolve); });
    const reserved = reservation.address();
    if (!reserved || typeof reserved === "string") throw new Error("Missing reserved listener");
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    server = await createServer({
      configFile: false, root, cacheDir,
      plugins: [react(webDevReactOptions())],
      server: { host: "0.0.0.0", port: reserved.port, strictPort: true,
        watch: { usePolling: true, interval: 50 }, fs: { allow: [root, process.cwd()] } },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Missing owned listener");
    const host = baseURL ? new URL(baseURL).hostname : Object.values(networkInterfaces()).flat().find((v) => v?.family === "IPv4" && !v.internal)?.address;
    if (!host || ["localhost", "127.0.0.1"].includes(host)) throw new Error("Provide a LAN hostname for optimizer acceptance");
    const url = `http://${host}:${address.port}`;
    let navigations = 0;
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const dependency = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/deps/react-dom_client.js"));
    await page.goto(url);
    const response = await dependency;
    const served = await response.text();
    const diskBytes = (await readFile(join(cacheDir, "deps/react-dom_client.js"))).byteLength;
    const servedBytes = Buffer.byteLength(served);
    expect(servedBytes).toBeLessThan(diskBytes * 1.2 + 2000);
    await page.getByRole("button", { name: "Before 0", exact: true }).click();
    await page.getByRole("button", { name: "Before 1", exact: true }).click();
    await writeFile(join(root, "Counter.tsx"), component("After"));
    await expect(page.getByRole("button", { name: "After 2", exact: true })).toBeVisible();
    expect(navigations).toBe(1);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath("optimizer.json"), JSON.stringify({ url, servedBytes, diskBytes, navigations, statePreserved: true, errors }, null, 2));
  } finally {
    await page.goto("about:blank").catch(() => {});
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("named icon optimization and a later alias preserve the live component during Fast Refresh", async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const { createServer } = await import(pathToFileURL(requireWeb.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(requireWeb.resolve("@vitejs/plugin-react")).href);
  const root = await mkdtemp(join(tmpdir(), "kanban-icon-hmr-browser-"));
  const web = join(root, "apps/web"), src = join(web, "src");
  const component = (label: string, icon: string) => `import {useState} from 'react'; import {${icon} as Glyph} from 'lucide-react'; export default function Counter(){const [n,setN]=useState(0);return <button onClick={()=>setN(n+1)}><Glyph data-testid="counter-icon"/>${label} {n}</button>;}`;
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await mkdir(src, { recursive: true });
    await symlink(resolve("apps/web/node_modules"), join(web, "node_modules"), "dir");
    await writeFile(join(web, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(web, "index.html"), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
    await writeFile(join(src, "main.tsx"), "import {createRoot} from 'react-dom/client';import Counter from './Counter';createRoot(document.getElementById('root')!).render(<Counter/>);");
    await writeFile(join(src, "Counter.tsx"), component("Before", "Plus"));
    const reservation = reserveServer();
    await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "0.0.0.0", resolve); });
    const reserved = reservation.address();
    if (!reserved || typeof reserved === "string") throw new Error("Missing reserved listener");
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    server = await createServer({
      configFile: false, root: web, cacheDir: resolveWebDevCacheDir({ projectRoot: root }),
      plugins: [lucideImportOptimizer({ projectRoot: root }), react(webDevReactOptions())],
      server: { host: "0.0.0.0", port: reserved.port, strictPort: true,
        watch: { usePolling: true, interval: 50 }, fs: { allow: [root, process.cwd()] } },
    });
    await server.listen();
    const host = baseURL ? new URL(baseURL).hostname : Object.values(networkInterfaces()).flat().find((v) => v?.family === "IPv4" && !v.internal)?.address;
    if (!host || ["localhost", "127.0.0.1"].includes(host)) throw new Error("Provide a LAN hostname for optimizer acceptance");
    const url = `http://${host}:${reserved.port}`;
    let navigations = 0;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = page.waitForResponse(value => new URL(value.url()).pathname === "/src/Counter.tsx");
    await page.goto(url);
    const transformed = await (await response).text();
    expect(transformed).toMatch(/lucide-icons/);
    await page.getByRole("button", { name: "Before 0", exact: true }).click();
    await page.getByRole("button", { name: "Before 1", exact: true }).click();
    await writeFile(join(src, "Counter.tsx"), component("After", "Plus"));
    await expect(page.getByRole("button", { name: "After 2", exact: true })).toBeVisible();
    // A new alias was absent from the initial scan. It must fall back to the
    // already prepared package without replacing React or losing input state.
    const aliasResponse = page.waitForResponse(value => new URL(value.url()).pathname === "/src/Counter.tsx");
    await writeFile(join(src, "Counter.tsx"), component("Alias", "PlusIcon"));
    const aliasTransformed = await (await aliasResponse).text();
    expect(aliasTransformed).toMatch(/import\s*\{\s*PlusIcon\s+as\s+Glyph\s*\}\s*from\s*["'][^"']*\/deps\/lucide-react\.js(?:\?[^"']*)?["']/);
    await expect(page.getByRole("button", { name: "Alias 2", exact: true })).toBeVisible();
    await expect(page.getByTestId("counter-icon")).toBeVisible();
    await expect(page.locator('svg[data-testid="counter-icon"]')).toBeVisible();
    expect(navigations).toBe(1);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath("icon-optimizer-hmr.json"), JSON.stringify({ url, navigations, initialFacadeUsed: true, initialIconImport: transformed.split("\n").find(line => line.includes("lucide-icons")), aliasFallbackPreservedState: true, aliasIconImport: aliasTransformed.split("\n").find(line => line.includes("lucide-react.js")), errors }, null, 2));
  } finally {
    await page.goto("about:blank").catch(() => {});
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
