import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const ts = requireWeb("typescript") as typeof import("typescript");

test("fetch JSON byte consumption preserves real response semantics without opaque body strings", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(45_000);
  const source = await readFile(
    "apps/web/src/session-mode/services/apiAdapt/readResponseJson.ts",
    "utf8",
  );
  const script = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sharedSource = await readFile(
    "apps/web/src/session-mode/services/apiAdapt/shared.ts",
    "utf8",
  );
  const sharedScript = ts
    .transpileModule(sharedSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replaceAll('"@tauri-apps/api/core"', '"/tauri.js"')
    .replaceAll('"@session/components/ui/use-toast"', '"/toast.js"')
    .replaceAll('"@session/hooks/runtime"', '"/runtime.js"')
    .replaceAll('"./readResponseJson"', '"/reader.js"');
  const body = JSON.stringify({
    text: "手机😀",
    data: "response-body ".repeat(74899),
  });
  let received = 0;
  let bytes = 0;
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    if (request.url?.startsWith("/data?")) {
      received++;
      bytes += Buffer.byteLength(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    } else if (request.url === "/split") {
      response.writeHead(200, { "content-type": "application/json" });
      for (const byte of Buffer.from('\uFEFF{"text":"手机😀"}'))
        response.write(Buffer.from([byte]));
      response.end();
    } else if (request.url === "/invalid") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"unfinished":');
    } else if (request.url === "/reader.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(script);
    } else if (request.url === "/shared.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(sharedScript);
    } else if (request.url === "/runtime.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(
        "export const buildUrl=path=>path;export const authHeaders=()=>({});export const isDesktopTauri=()=>false;export const isTauri=()=>false;",
      );
    } else if (request.url === "/tauri.js" || request.url === "/toast.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(
        "export const invoke=()=>{throw new Error('native bridge outside fixture')};export const toast=()=>{};",
      );
    } else if (request.url === "/unknown") {
      response.writeHead(409, { "content-type": "application/json" });
      response.end('{"deliveryStage":"outcome-unknown",');
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<!doctype html><title>Owned JSON byte consumer fixture</title>",
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const host =
    Object.values(networkInterfaces())
      .flat()
      .find((address) => address?.family === "IPv4" && !address.internal)
      ?.address ?? "127.0.0.1";
  const url = `http://${host}:${(server.address() as { port: number }).port}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  const samples: unknown[] = [];
  const sample = async (round: number) => {
    const heap = await cdp.send("Runtime.getHeapUsage");
    const processes = await browserCdp.send("SystemInfo.getProcessInfo");
    const rss =
      process.platform === "linux"
        ? sampleRendererRss(processes.processInfo)
        : {};
    samples.push({ round, ...heap, ...rss });
    if ("rendererRssBytes" in rss)
      expect(rss.rendererRssBytes).toBeLessThan(768 * 1024 * 1024);
  };
  try {
    await page.goto(url);
    await page.evaluate(async () => {
      const { readResponseJson } = await import("/reader.js");
      let nativeCalls = 0;
      Response.prototype.json = function () {
        nativeCalls++;
        throw new Error("opaque native JSON consumer must not be used");
      };
      const state = {
        decoded: 0,
        nativeCalls: () => nativeCalls,
        readResponseJson,
      };
      (window as any).__jsonByteFixture = state;
      const splitResponse = await fetch("/split");
      const split = await readResponseJson(splitResponse);
      if (split.text !== "手机😀")
        throw new Error("split UTF-8/BOM decoding changed");
      try {
        await readResponseJson(splitResponse);
        throw new Error("disturbed response was accepted");
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
      const response = await fetch("/invalid");
      try {
        await readResponseJson(response);
        throw new Error("invalid JSON was accepted");
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (response.body!.locked)
        throw new Error("failed JSON reader remains locked");
      const { postJsonWithOptions, isExplicitRequestRejection } =
        await import("/shared.js");
      const uncertain = await postJsonWithOptions(
        "/unknown",
        {},
        { suppressToast: true },
      ).catch((error: any) => error);
      if (
        uncertain.deliveryStage !== "outcome-unknown" ||
        isExplicitRequestRejection(uncertain)
      )
        throw new Error(
          "truncated error receipt was classified as a definite rejection",
        );
    });
    await sample(0);
    for (let round = 1; round <= 6; round++) {
      await page.evaluate(async (round) => {
        const state = (window as any).__jsonByteFixture;
        for (let offset = 0; offset < 40; offset++) {
          const response = await fetch(`/data?i=${(round - 1) * 40 + offset}`);
          const value = await state.readResponseJson(response);
          if (value.text !== "手机😀" || value.data.length !== 1048586)
            throw new Error("response JSON changed");
          if (!response.bodyUsed || response.body!.locked)
            throw new Error("JSON body ownership changed");
          state.decoded++;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }, round);
      await sample(round);
    }
    expect(
      await page.evaluate(() => ({
        decoded: (window as any).__jsonByteFixture.decoded,
        nativeCalls: (window as any).__jsonByteFixture.nativeCalls(),
      })),
    ).toEqual({ decoded: 240, nativeCalls: 0 });
    expect(received).toBe(240);
    expect(bytes).toBeGreaterThan(220 * 1024 * 1024);
    expect(errors).toEqual([]);
  } finally {
    const evidence = JSON.stringify(
      {
        url,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        sharedSourceSha256: createHash("sha256")
          .update(sharedSource)
          .digest("hex"),
        requests: received,
        responseBytes: bytes,
        samples,
        errors,
        scope:
          "Actual HTTP, production byte consumer and shared API error handling with local environment stubs; normal Playwright Network observation; natural samples, no GC/refresh. Short causal/semantic regression, not the standard 30-minute soak and no claim of closing its RSS threshold.",
      },
      null,
      2,
    );
    await writeFile(testInfo.outputPath("json-byte-consumer.json"), evidence);
    await testInfo.attach("json-byte-consumer.json", {
      body: evidence,
      contentType: "application/json",
    });
    await Promise.allSettled([cdp.detach(), browserCdp.detach()]);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
