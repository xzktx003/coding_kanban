import test from "node:test";
import assert from "node:assert/strict";
import {
  WebsitePreviewService,
  websitePreviewUrl,
  isPublicPreviewAddress,
} from "./codex-website-preview.js";
const url = "https://example.com/page#fragment";
const response = (html: string) =>
  new Response(html, { headers: { "content-type": "text/html" } });
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
test("native public HTTPS policy excludes private, mapped-private, credentials, ports and internal names", () => {
  assert.equal(websitePreviewUrl(url)?.href, "https://example.com/page");
  for (const value of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://localhost",
    "https://a.local",
    "https://a.internal",
    "https://a.test",
    "https://127.0.0.1",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://169.254.169.254",
  ])
    assert.equal(websitePreviewUrl(value), null, value);
  for (const ip of [
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.2",
    "100.64.0.1",
    "127.1.1.1",
    "169.254.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(isPublicPreviewAddress(ip), false, ip);
  assert.equal(isPublicPreviewAddress("93.184.216.34"), true);
});
test("native metadata precedence, entities, whitespace and copied field budgets", async (t) => {
  const calls: string[] = [];
  const service = new WebsitePreviewService({
    lookup,
    fetch: async (target) => {
      calls.push(target.href);
      return response(
        `<head><title>Fallback</title><meta property="og:title" content=" First &amp;  title "><meta property="og:title" content="Wrong"><meta name="twitter:title" content="Wrong"><meta property="og:description" content="${"x".repeat(3000)}"></head>`,
      );
    },
  });
  t.after(() => service.dispose());
  assert.deepEqual(await service.get({ url }), {
    status: "ready",
    title: "First & title",
    description: "x".repeat(1000),
    image: null,
  });
  await service.get({ url: "https://example.com/page#different" });
  assert.equal(calls.length, 1);
});
test("every DNS address and redirect/image destination is checked before fetching", async (t) => {
  let count = 0;
  const service = new WebsitePreviewService({
    lookup: async (host) =>
      host === "example.com"
        ? await lookup()
        : [{ address: "127.0.0.1", family: 4 }],
    fetch: async () => {
      count++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://private.example/secret" },
      });
    },
  });
  t.after(() => service.dispose());
  assert.deepEqual(await service.get({ url }), { status: "unavailable" });
  assert.equal(count, 1);
  const mixed = new WebsitePreviewService({
    lookup: async () => [
      ...(await lookup()),
      { address: "10.0.0.1", family: 4 },
    ],
    fetch: async () => {
      count++;
      return response("<title>Wrong</title>");
    },
  });
  t.after(() => mixed.dispose());
  assert.deepEqual(await mixed.get({ url }), { status: "unavailable" });
  assert.equal(count, 1);
});
test("direct image URLs stay unavailable; valid metadata images preserve dimensions and failures keep text", async (t) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const service = new WebsitePreviewService({
    lookup,
    fetch: async (target) =>
      target.pathname === "/image"
        ? new Response(png, { headers: { "content-type": "image/png" } })
        : response(
            '<title>Image</title><meta property="og:image" content="/image">',
          ),
  });
  t.after(() => service.dispose());
  assert.deepEqual(await service.get({ url: "https://example.com/image" }), {
    status: "unavailable",
  });
  const result = await service.get({ url });
  assert.equal(result.status, "ready");
  if (result.status === "ready")
    assert.deepEqual(result.image, {
      dataUrl: "data:image/png;base64," + png.toString("base64"),
      width: 1,
      height: 1,
    });
});
test("native head cutoff cancels a long body; size limits and incompatible MIME return unavailable", async (t) => {
  let canceled = false;
  const service = new WebsitePreviewService({
    lookup,
    fetch: async (target) =>
      target.pathname === "/large"
        ? response("x".repeat(1048577))
        : new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(
                  new TextEncoder().encode("<title>Safe</title></head>"),
                );
              },
              cancel() {
                canceled = true;
              },
            }),
            { headers: { "content-type": "text/html" } },
          ),
  });
  t.after(() => service.dispose());
  assert.equal((await service.get({ url })).status, "ready");
  assert.equal(canceled, true);
  assert.deepEqual(await service.get({ url: "https://example.com/large" }), {
    status: "unavailable",
  });
});
test("native maximum four active and eight queued reads; coalescing, cache and disposal release waiting work", async () => {
  const release: (() => void)[] = [];
  let active = 0,
    max = 0,
    count = 0;
  const service = new WebsitePreviewService({
    lookup,
    fetch: async (_url, { signal }) => {
      count++;
      active++;
      max = Math.max(max, active);
      await new Promise<void>((resolve, reject) => {
        release.push(resolve);
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
      active--;
      return response("<title>Ready</title>");
    },
  });
  const first = service.get({ url });
  const same = service.get({ url });
  const rest = Array.from({ length: 11 }, (_, i) =>
    service.get({ url: `https://example.com/${i}` }),
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(max, 4);
  assert.equal(count, 4);
  assert.deepEqual(await service.get({ url: "https://example.com/overflow" }), {
    status: "unavailable",
  });
  service.dispose();
  await Promise.all([first, same, ...rest]);
  assert.deepEqual(await service.get({ url }), { status: "unavailable" });
});

test("native 32-entry LRU and 30-second text/failure expiry do not retain an unbounded directory", async (t) => {
  let clock = 0,
    calls = 0;
  const service = new WebsitePreviewService({
    now: () => clock,
    lookup,
    fetch: async () => {
      calls++;
      return response("<title>Cached</title>");
    },
  });
  t.after(() => service.dispose());
  for (let i = 0; i < 33; i++)
    await service.get({ url: `https://example.com/${i}` });
  assert.equal(calls, 33);
  await service.get({ url: "https://example.com/1" });
  assert.equal(calls, 33);
  await service.get({ url: "https://example.com/0" });
  assert.equal(calls, 34);
  clock = 30_001;
  await service.get({ url: "https://example.com/1" });
  assert.equal(calls, 35);
});
test("native redirect budget stops after four responses and MIME mismatch does not remove safe text", async (t) => {
  let calls = 0;
  const redirect = new WebsitePreviewService({
    lookup,
    fetch: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "/again" },
      });
    },
  });
  t.after(() => redirect.dispose());
  assert.deepEqual(await redirect.get({ url }), { status: "unavailable" });
  assert.equal(calls, 4);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const wrong = new WebsitePreviewService({
    lookup,
    fetch: async (target) =>
      target.pathname === "/wrong.jpg"
        ? new Response(png, { headers: { "content-type": "image/jpeg" } })
        : response(
            '<title>Safe</title><meta property="og:image" content="/wrong.jpg">',
          ),
  });
  t.after(() => wrong.dispose());
  assert.deepEqual(await wrong.get({ url }), {
    status: "ready",
    title: "Safe",
    description: null,
    image: null,
  });
});
