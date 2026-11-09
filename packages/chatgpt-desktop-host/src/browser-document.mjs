import { createHash } from "node:crypto";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ENTRY =
  /<script type="module" crossorigin src="(\.\/assets\/index-[a-f0-9]+\.js)"><\/script>/g;
const hash = (body) => createHash("sha256").update(body).digest("hex");

/**
 * Adapt the verified entry document, while leaving upstream JS/CSS untouched.
 * Unknown upstream HTML structure fails closed. This document is deliberately
 * different from the original; callers must use its adapted hash for caching.
 */
export function createBrowserDocument({
  body,
  profileId,
  generation,
  version = 1,
}) {
  if (
    !(body instanceof Uint8Array) ||
    body.byteLength > 256 * 1024 ||
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    ![1, 2, 3, 4, 5].includes(version)
  )
    throw new Error("Invalid desktop document binding");
  const html = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const entries = [...html.matchAll(ENTRY)];
  if (
    entries.length !== 1 ||
    (html.match(/<script\b/gi) ?? []).length !== 1 ||
    /<base\b/i.test(html) ||
    (html.match(/<div id="root">/g) ?? []).length !== 1
  )
    throw new Error("Unsupported original desktop entry document");
  const manifest = JSON.stringify({
    version,
    profileId,
    generation,
    entry: entries[0][1],
  });
  const replacement = `<script id="chatgpt-host-manifest" type="application/json">${manifest}</script><script type="module" src="./__host/browser-entry.mjs"></script>`;
  const adapted = Buffer.from(html.replace(ENTRY, replacement));
  return {
    body: adapted,
    originalSha256: hash(body),
    adaptedSha256: hash(adapted),
  };
}
