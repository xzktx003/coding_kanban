import { expect, it } from "vitest";
import { mcpAppPolicy, mcpAppSandboxUrl, normalizeMcpAppCsp } from "./sandbox";
it("creates an opaque-origin proxy and enforces restrictive defaults before app HTML", () => {
  const csp = normalizeMcpAppCsp({}), policy = mcpAppPolicy(csp), url = mcpAppSandboxUrl(csp);
  expect(url).toMatch(/^data:text\/html/);
  expect(policy).toContain("connect-src 'none'"); expect(policy).toContain("frame-src 'none'"); expect(policy).toContain("object-src 'none'");
  const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  expect(html).toContain("event.source===parent"); expect(html).toContain("event.source===view.contentWindow"); expect(html).toContain("ui/notifications/sandbox-resource-ready");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeTruthy(); expect(() => new Function(script!)).not.toThrow();
});
it("uses only declared secure origins and rejects CSP delimiter or credential injection", () => {
  expect(normalizeMcpAppCsp({ resource_domains: ["https://cdn.example.invalid"], connectDomains: ["wss://socket.example.invalid"] })).toMatchObject({ resourceDomains: ["https://cdn.example.invalid"], connectDomains: ["wss://socket.example.invalid"] });
  for (const origin of ["https://site.invalid; script-src *", "https://user:secret@site.invalid", "javascript:alert(1)", "http://localhost:9000", "https://site.invalid/path", "https://site.invalid/'"]) expect(() => normalizeMcpAppCsp({ resourceDomains: [origin] })).toThrow();
});
