import assert from "node:assert/strict";
import test from "node:test";

import { fetchPdfPreview, isPdfFile } from "./pdf-preview.js";

test("classifies PDF files by uppercase extension and MIME type", () => {
  assert.equal(isPdfFile("REPORT.PDF"), true);
  assert.equal(isPdfFile("report.txt", "application/pdf"), true);
  assert.equal(
    isPdfFile("report.txt", "application/pdf; charset=binary"),
    true,
  );
  assert.equal(isPdfFile("report.pdf.txt", "text/plain"), false);
});

test("fetchPdfPreview posts to the full binary download endpoint", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    },
  });

  const controller = new AbortController();
  const blob = await fetchPdfPreview(
    {
      path: "/workspace/docs/report.pdf",
      sshTarget: { host: "example.test", port: 22, username: "dev" },
    },
    controller.signal,
  );

  assert.equal(requestUrl, "/api/fs/download");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    path: "/workspace/docs/report.pdf",
    sshTarget: { host: "example.test", port: 22, username: "dev" },
  });
  assert.equal(
    new Headers(requestInit?.headers).get("Content-Type"),
    "application/json",
  );
  assert.equal(blob.type, "application/pdf");
  assert.equal(blob.size, 8);
});

test("fetchPdfPreview reports failed download responses", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => Response.json({ error: "文件不存在" }, { status: 404 }),
  });

  await assert.rejects(fetchPdfPreview({ path: "/missing.pdf" }), /文件不存在/);
});

test("fetchPdfPreview rejects non-PDF binary content", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(new Uint8Array([80, 75, 3, 4, 0])),
  });

  await assert.rejects(
    fetchPdfPreview({ path: "/workspace/archive.pdf" }),
    /非 PDF/,
  );
});
