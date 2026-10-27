import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(webRequire.resolve("vite")).href
);
const sources = {
  "conversationFormDrafts.ts":
    "apps/web/src/session-mode/components/codex/composer/conversationFormDrafts.ts",
  "conversationOwnerFormContext.tsx":
    "apps/web/src/session-mode/components/codex/composer/conversationOwnerFormContext.tsx",
};
for (const scenario of [
  "identity-references",
  "late-receipt-scope",
  "capacity-reload",
] as const) {
  test(`actual conversation form HMR preserves ${scenario} contracts`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    const root = await mkdtemp(join(tmpdir(), "conversation-form-hmr-"));
    const copied: Record<string, string> = Object.fromEntries(
      await Promise.all(
        Object.entries(sources).map(async ([name, path]) => [
          name,
          await readFile(path, "utf8"),
        ]),
      ),
    );
    for (const [name, source] of Object.entries(copied))
      await writeFile(join(root, name), source);
    await writeFile(
      join(root, "sonner.ts"),
      `const record=(...args)=>{(window.formToasts??=[]).push(args);return 'fixture-toast'};export const toast=new Proxy(record,{get:()=>record});export const Toaster=()=>null;`,
    );
    await writeFile(
      join(root, "main.tsx"),
      `
import React from 'react';
import {createRoot} from 'react-dom/client';
import * as drafts from './conversationFormDrafts';
import * as forms from './conversationOwnerFormContext';
import * as scope from '@session/services/codexOperationScope';
import {useCodexStore} from '@session/components/codex/stores/useCodexStore';
useCodexStore.setState({accountNamespace:'form-fixture-account',hasAccount:true,account:{type:'chatgpt'}});
const p=window.formProbe={drafts,forms,scope,updates:0,providerUpdates:0,token:Math.random(),originalStore:drafts.useConversationFormDrafts,contexts:{},accepted:[],writes:0};
let root;
p.mount=(id='a')=>{const module=p.forms;function ReadContext({id}){const owner=module.useConversationOwnerForm();p.contexts[id]=owner;return <pre data-owner={id}>{owner.target.key}</pre>}root?.unmount();root=createRoot(document.querySelector('#app'));const target=p.forms.captureConversationForm('notes',{threadId:id,cwd:'/fixture/'+id,title:id,draftOwner:id}).target;p.targets??={};p.targets[id]=target;const Provider=module.ConversationOwnerFormProvider;root.render(<Provider target={target}><ReadContext id={id}/></Provider>);return target;};
p.unmount=()=>{root?.unmount();root=undefined;};
if(import.meta.hot){
 import.meta.hot.accept('./conversationFormDrafts',next=>{p.drafts=next;p.updates++;});
 import.meta.hot.accept('./conversationOwnerFormContext',next=>{p.forms=next;p.providerUpdates++;});
}
`,
    );
    await writeFile(
      join(root, "index.html"),
      `<!doctype html><html><body><div class="session-mode"><div id="app"></div></div><script type="module" src="/main.tsx"></script></body></html>`,
    );
    const server = await createServer({
      configFile: false,
      envFile: false,
      root,
      cacheDir: join(root, ".vite"),
      esbuild: { jsx: "automatic" },
      resolve: {
        alias: [
          {
            find: "@session",
            replacement: resolve("apps/web/src/session-mode"),
          },
          { find: "@", replacement: resolve("apps/web/src") },
          { find: "sonner", replacement: join(root, "sonner.ts") },
          { find: /^react$/, replacement: webRequire.resolve("react") },
          {
            find: /^react\/jsx-runtime$/,
            replacement: webRequire.resolve("react/jsx-runtime"),
          },
          {
            find: /^react\/jsx-dev-runtime$/,
            replacement: webRequire.resolve("react/jsx-dev-runtime"),
          },
          {
            find: /^react-dom\/client$/,
            replacement: webRequire.resolve("react-dom/client"),
          },
          { find: /^zustand$/, replacement: webRequire.resolve("zustand") },
          {
            find: /^uuid$/,
            replacement: resolve(
              dirname(webRequire.resolve("uuid")),
              "../dist/index.js",
            ),
          },
        ],
      },
      server: {
        host: "0.0.0.0",
        port: 0,
        watch: {
          usePolling: true,
          interval: 50,
          awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
        },
        fs: { allow: [root, resolve(".")] },
      },
      logLevel: "error",
    });
    const errors: string[] = [],
      forbidden: string[] = [],
      captures: unknown[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/api/**", async (route) => {
      forbidden.push(route.request().url());
      await route.abort();
    });
    await page.addInitScript(() => {
      const active = new Set<EventListenerOrEventListenerObject>();
      const target = new Set<EventListenerOrEventListenerObject>();
      const add = window.addEventListener.bind(window),
        remove = window.removeEventListener.bind(window);
      (window as any).__formListeners = { active, target, adds: 0, removes: 0 };
      window.addEventListener = ((type: any, fn: any, opts: any) => {
        if (type === "beforeunload") {
          active.add(fn);
          if (new Error().stack?.includes("conversationFormDrafts.ts")) {
            target.add(fn);
            (window as any).__formListeners.adds++;
          }
        }
        add(type, fn, opts);
      }) as any;
      window.removeEventListener = ((type: any, fn: any, opts: any) => {
        if (type === "beforeunload") {
          active.delete(fn);
          if (target.delete(fn)) (window as any).__formListeners.removes++;
        }
        remove(type, fn, opts);
      }) as any;
    });
    const snapshot = async (label: string) => {
      const value = await page.evaluate(() => {
        const p = (window as any).formProbe,
          l = (window as any).__formListeners;
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return {
          updates: p.updates,
          providerUpdates: p.providerUpdates,
          token: p.token,
          sameStore: p.originalStore === p.drafts.useConversationFormDrafts,
          drafts: p.drafts.useConversationFormDrafts.getState().drafts,
          listeners: l.target.size,
          adds: l.adds,
          removes: l.removes,
          blocked: event.defaultPrevented,
          mountedOwner:
            document
              .querySelector("[data-owner]")
              ?.getAttribute("data-owner") ?? null,
          writes: p.writes,
          toasts: (window as any).formToasts ?? [],
        };
      });
      captures.push({ label, ...value });
      return value;
    };
    let token: number | undefined,
      url = "";
    const hmr = async (n: number) => {
      const pause = scenario === "identity-references" && n === 1;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (pause)
        await page.route("**/conversationFormDrafts.ts?t=*", async (route) => {
          await gate;
          await route.continue();
        });
      await writeFile(
        join(root, "conversationFormDrafts.ts"),
        copied["conversationFormDrafts.ts"] +
          `\n// owned form hot update ${n} ${".".repeat(n * 64)}\n`,
      );
      if (pause) {
        try {
          await page.waitForFunction(
            () => (window as any).__formListeners.target.size === 0,
          );
          const gap = await snapshot("disposed-before-successor");
          expect(gap.listeners).toBe(0);
          expect(gap.updates).toBe(0);
          expect(gap.drafts.a.fields.body).toBe("draft-a");
        } finally {
          release();
        }
      }
      await page.waitForFunction(
        (n) => (window as any).formProbe?.updates === n,
        n,
        { timeout: 15000 },
      );
      if (pause) await page.unroute("**/conversationFormDrafts.ts?t=*");
      const current = await snapshot("hmr-" + n);
      expect(current.token).toBe(token);
      expect(current.sameStore).toBe(true);
      expect(current.listeners).toBe(1);
    };
    try {
      await server.listen();
      const host = Object.values(networkInterfaces())
        .flat()
        .find((a) => a?.family === "IPv4" && !a.internal)?.address;
      expect(host).toBeTruthy();
      url = `http://${host}:${(server.httpServer!.address() as { port: number }).port}`;
      await page.goto(url);
      await page.waitForFunction(() => (window as any).formProbe, undefined, {
        timeout: 30000,
      });
      token = await page.evaluate(() => (window as any).formProbe.token);
      if (scenario === "identity-references") {
        await page.evaluate(() => {
          const p = (window as any).formProbe,
            d = p.drafts;
          p.release1 = d.retainConversationForm("clean");
          p.release2 = d.retainConversationForm("clean");
          d.changeConversationForm("a", "body", "draft-a");
          d.changeConversationForm("b", "body", "draft-b");
          d.updateConversationForm("b", (v: any) => ({
            ...v,
            receipt: "prior-accepted-receipt",
          }));
          d.updateConversationForm("a", (v: any) => ({
            ...v,
            pending: "captured-request",
            error: "retained-error",
          }));
        });
        const before = await snapshot("before");
        expect(before.blocked).toBe(true);
        expect(before.drafts.a.revision).toBe(1);
        await hmr(1);
        await hmr(2);
        const after = await snapshot("after");
        expect(after.drafts).toEqual(before.drafts);
        expect(after.removes).toBe(2);
        await page.evaluate(() => {
          const p = (window as any).formProbe;
          p.release3 = p.drafts.retainConversationForm("clean");
          p.release1();
          p.release2();
        });
        expect(
          (await snapshot("retained-by-new-module")).drafts.clean,
        ).toBeTruthy();
        await page.evaluate(() => {
          const p = (window as any).formProbe;
          p.release3();
          for (const key of ["a", "b"]) {
            p.drafts.updateConversationForm(key, (d: any) => ({
              ...d,
              fields: {},
              dirty: false,
              pending: null,
              error: null,
            }));
            p.drafts.releaseEmptyConversationForm(key);
          }
        });
        const clean = await snapshot("all-clean");
        expect(clean.drafts).toEqual({});
        expect(clean.blocked).toBe(false);
        expect(clean.listeners).toBe(1);
      } else if (scenario === "late-receipt-scope") {
        await page.evaluate(() => (window as any).formProbe.mount("a"));
        await page.waitForFunction(() => (window as any).formProbe.contexts.a);
        await page.evaluate(() => {
          const p = (window as any).formProbe;
          p.drafts.changeConversationForm(
            p.targets.a.key,
            "body",
            "submitted-a",
          );
          p.oldRun = p.contexts.a.run;
          p.result = p.oldRun(
            () =>
              new Promise((resolve) => {
                p.release = resolve;
                p.writes++;
              }),
            () => p.accepted.push("a"),
          );
        });
        await page.waitForFunction(() => !!(window as any).formProbe.release);
        const pending = await snapshot("pending");
        expect(Object.values(pending.drafts).some((d: any) => d.pending)).toBe(
          true,
        );
        await hmr(1);
        await page.evaluate(() => {
          const p = (window as any).formProbe;
          p.drafts.changeConversationForm(p.targets.a.key, "body", "newer-a");
          p.mount("b");
        });
        await page.waitForFunction(() => (window as any).formProbe.contexts.b);
        await page.evaluate(async () => {
          const p = (window as any).formProbe;
          p.drafts.changeConversationForm(p.targets.b.key, "body", "new-b");
          p.release("ok");
          await p.result;
        });
        const keys = await page.evaluate(() => {
          const p = (window as any).formProbe;
          return { a: p.targets.a.key, b: p.targets.b.key };
        });
        const settled = await snapshot("old-receipt");
        expect(settled.drafts[keys.a].fields.body).toBe("newer-a");
        expect(settled.drafts[keys.b].fields.body).toBe("new-b");
        expect(settled.drafts[keys.a].pending).toBeNull();
        await page.evaluate(() => {
          const p = (window as any).formProbe;
          p.oldB = p.contexts.b.run;
          p.resultB = p.oldB(
            () =>
              new Promise((resolve) => {
                p.releaseB = resolve;
                p.writes++;
              }),
            () => p.accepted.push("b"),
          );
        });
        await page.waitForFunction(() => !!(window as any).formProbe.releaseB);
        expect(
          (await snapshot("b-pending")).drafts[keys.b].pending,
        ).toBeTruthy();
        await hmr(2);
        const revokedReceipt = await page.evaluate(async () => {
          const p = (window as any).formProbe;
          p.scope.invalidateCodexOperationScope();
          p.releaseB("old-scope-accepted");
          return {
            result: await p.resultB,
            accepted: p.accepted,
            target: p.targets.b.id,
          };
        });
        expect(revokedReceipt.result).toBe(false);
        expect(revokedReceipt.accepted).toEqual(["a"]);
        const revoked = await snapshot("revoked-in-flight-receipt");
        expect(revoked.drafts[keys.b].receipt).toBe(revokedReceipt.target);
        expect(revoked.drafts[keys.b].error).toContain("运行环境已变化");
        expect(revoked.drafts[keys.b].pending).toBeNull();
        const denied = await page.evaluate(async () => {
          const p = (window as any).formProbe;
          let error = "";
          try {
            await p.oldB(async () => {
              p.writes++;
              return "must-not-run";
            });
          } catch (e) {
            error = String(e);
          }
          return { error, writes: p.writes };
        });
        expect(denied.error).toContain("运行环境");
        expect(denied.writes).toBe(2);
        expect(
          (await snapshot("scope-revoked")).drafts[keys.b].fields.body,
        ).toBe("new-b");
        await page.evaluate(() => (window as any).formProbe.unmount());
        const unmounted = await snapshot("both-components-unmounted");
        expect(unmounted.drafts[keys.a].fields.body).toBe("newer-a");
        expect(unmounted.drafts[keys.b].fields.body).toBe("new-b");
        await page.evaluate((keys) => {
          const d = (window as any).formProbe.drafts;
          for (const key of Object.values(keys)) {
            d.updateConversationForm(key, (v: any) => ({
              ...v,
              fields: {},
              dirty: false,
              pending: null,
              error: null,
              revision: v.revision + 1,
            }));
            d.releaseEmptyConversationForm(key);
          }
        }, keys);
        expect((await snapshot("cleared-after-release")).drafts).toEqual({});
        expect((await snapshot("clean-unblocked")).blocked).toBe(false);
      } else {
        await page.evaluate(() =>
          (window as any).formProbe.mount("capacity-a"),
        );
        await page.waitForFunction(
          () => (window as any).formProbe.contexts["capacity-a"],
        );
        await page.evaluate(() => {
          const p = (window as any).formProbe,
            d = p.drafts;
          p.capacityKey = p.targets["capacity-a"].key;
          for (let i = 0; i < 64; i++)
            d.changeConversationForm(
              i === 0 ? p.capacityKey : "owner-" + i,
              "body",
              "keep-" + i,
            );
        });
        const full = await snapshot("64-dirty");
        expect(Object.keys(full.drafts)).toHaveLength(64);
        expect(full.mountedOwner).toBe("capacity-a");
        const error = await page.evaluate(() => {
          try {
            (window as any).formProbe.drafts.changeConversationForm(
              "overflow",
              "body",
              "rejected",
            );
            return "";
          } catch (e) {
            return String(e);
          }
        });
        expect(error).toContain("草稿已满");
        expect((await snapshot("rejected-owner")).drafts).toEqual(full.drafts);
        await hmr(1);
        expect((await snapshot("full-after-hmr")).drafts).toEqual(full.drafts);
        await page.evaluate(() => {
          const p = (window as any).formProbe,
            d = p.drafts;
          d.changeConversationForm(
            p.capacityKey,
            "body",
            "x".repeat(1024 * 1024 + 1),
          );
        });
        const bytes = await snapshot("rejected-bytes");
        expect(bytes.drafts).toEqual(full.drafts);
        expect(JSON.stringify(bytes.toasts)).toContain("草稿容量");
        await page.reload();
        await page.waitForFunction(() => (window as any).formProbe);
        const reloaded = await snapshot("hard-reload");
        expect(reloaded.token).not.toBe(token);
        expect(reloaded.drafts).toEqual({});
        expect(reloaded.blocked).toBe(false);
        expect(reloaded.mountedOwner).toBeNull();
        expect(reloaded.writes).toBe(0);
      }
      expect(errors).toEqual([]);
      expect(forbidden).toEqual([]);
    } finally {
      await snapshot("final-observation").catch(() => {});
      await writeFile(
        info.outputPath("form-hmr.json"),
        JSON.stringify(
          {
            scenario,
            url,
            errors,
            forbidden,
            captures,
            sourceSha256: Object.fromEntries(
              Object.entries(copied).map(([name, source]) => [
                sources[name as keyof typeof sources],
                createHash("sha256").update(source).digest("hex"),
              ]),
            ),
          },
          null,
          2,
        ),
      );
      await page.goto("about:blank").catch(() => {});
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
