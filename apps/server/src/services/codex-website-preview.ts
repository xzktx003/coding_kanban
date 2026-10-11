import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request } from "node:https";
import { Readable } from "node:stream";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import ipaddr from "ipaddr.js";
import { parse } from "node-html-parser";
import { imageSize } from "image-size";
import type { NativeWebsitePreviewData } from "@agent-orchestrator/shared";

export function isPublicPreviewAddress(value: string): boolean {
  return ipaddr.isValid(value) && ipaddr.process(value).range() === "unicast";
}
/** Native C3/owe: strip hash and reject private IPs and internal DNS names. */
export function websitePreviewUrl(value: string, base?: URL): URL | null {
  try {
    const u = new URL(value, base),
      host = u.hostname.replace(/^\[|\]$/gu, "");
    if (
      value.length > 8192 ||
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      (ipaddr.isValid(host)
        ? !isPublicPreviewAddress(host)
        : !host.includes(".") ||
          /\.(?:localhost|local|internal|test)\.?$/iu.test(host))
    )
      return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}
type Fetch = (
  url: URL,
  options: { addresses: LookupAddress[]; signal: AbortSignal },
) => Promise<Response>;
/** Connect only to the checked addresses, preserving TLS SNI and certificate verification. */
export const pinnedWebsiteFetch: Fetch = (url, { addresses, signal }) =>
  new Promise((resolve, reject) => {
    const pinned = addresses.map((a) => ({
      address: a.address,
      family: a.family,
    }));
    const req = request(
      url,
      {
        method: "GET",
        signal,
        agent: false,
        headers: {
          accept: "*/*",
          "accept-encoding": "gzip, deflate, br",
          "user-agent": "node",
        },
        lookup: (_host, options, callback) => {
          if (options.all)
            (
              callback as unknown as (
                error: null,
                addresses: LookupAddress[],
              ) => void
            )(null, pinned);
          else callback(null, pinned[0].address, pinned[0].family);
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        let stream: Readable = incoming;
        const encoding = headers.get("content-encoding")?.toLowerCase();
        const decompressor =
          encoding === "gzip"
            ? createGunzip()
            : encoding === "deflate"
              ? createInflate()
              : encoding === "br"
                ? createBrotliDecompress()
                : null;
        if (decompressor) {
          incoming.once("error", (error) => decompressor.destroy(error));
          stream = incoming.pipe(decompressor);
          stream.once("close", () => incoming.destroy());
        }
        const status = incoming.statusCode ?? 502;
        const noBody = [204, 205, 304].includes(status);
        if (noBody) incoming.destroy();
        try {
          resolve(
            new Response(
              noBody
                ? null
                : (Readable.toWeb(stream) as ReadableStream<Uint8Array>),
              { status, headers },
            ),
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    req.once("error", reject);
    req.end();
  });
const unavailable: NativeWebsitePreviewData = { status: "unavailable" };
const text = (value: string | undefined, limit: number) => {
  const result = value?.replace(/\s+/gu, " ").trim().slice(0, limit);
  return result ? Array.from(result).join("") : null;
};
async function readBytes(
  response: Response,
  limit: number,
  head: boolean,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0,
    prefix = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Preview response exceeds budget");
      chunks.push(value);
      if (head) {
        prefix += decoder.decode(value, { stream: true });
        if (/<\/head\s*>/iu.test(prefix)) break;
      }
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class WebsitePreviewService {
  private closed = false;
  private active = 0;
  private queue: ((ready: boolean) => void)[] = [];
  private aborts = new Set<AbortController>();
  private pending = new Map<string, Promise<NativeWebsitePreviewData>>();
  private cache = new Map<
    string,
    { value: NativeWebsitePreviewData; bytes: number; expires: number }
  >();
  private bytes = 0;
  constructor(
    private readonly options: {
      fetch?: Fetch;
      lookup?: (host: string) => Promise<LookupAddress[]>;
      now?: () => number;
    } = {},
  ) {}
  private now() {
    return (this.options.now ?? Date.now)();
  }
  async get(value: unknown): Promise<NativeWebsitePreviewData> {
    const input =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
    const url =
      typeof input?.url === "string" ? websitePreviewUrl(input.url) : null;
    if (this.closed || !url) return unavailable;
    const key = url.href,
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.bytes -= cached.bytes;
      if (cached.expires > this.now()) {
        this.cache.set(key, cached);
        this.bytes += cached.bytes;
        return cached.value;
      }
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.active >= 4 && this.queue.length >= 8) return unavailable;
    const work = this.load(url)
      .catch(() => unavailable)
      .then((result) => {
        if (!this.closed) {
          const bytes = JSON.stringify(result).length * 2;
          this.cache.set(key, {
            value: result,
            bytes,
            expires:
              this.now() +
              (result.status === "ready" && result.image ? 600_000 : 30_000),
          });
          this.bytes += bytes;
          while (this.cache.size > 32 || this.bytes > 24 * 1024 * 1024) {
            const oldest = this.cache.entries().next().value;
            if (!oldest) break;
            this.cache.delete(oldest[0]);
            this.bytes -= oldest[1].bytes;
          }
        }
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  dispose() {
    this.closed = true;
    for (const abort of this.aborts) abort.abort();
    for (const resume of this.queue.splice(0)) resume(false);
    this.cache.clear();
    this.bytes = 0;
  }
  private release() {
    const next = this.closed ? null : this.queue.shift();
    if (next) next(true);
    else this.active--;
  }
  private async load(url: URL): Promise<NativeWebsitePreviewData> {
    if (this.active >= 4) {
      if (
        !(await new Promise<boolean>((resume) => this.queue.push(resume))) ||
        this.closed
      )
        return unavailable;
    } else this.active++;
    const abort = new AbortController();
    this.aborts.add(abort);
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      return await this.extract(url, abort.signal);
    } finally {
      clearTimeout(timer);
      abort.abort();
      this.aborts.delete(abort);
      this.release();
    }
  }
  private async addresses(
    hostname: string,
    signal: AbortSignal,
  ): Promise<LookupAddress[]> {
    const host = hostname.replace(/^\[|\]$/gu, "");
    if (ipaddr.isValid(host))
      return [
        { address: host, family: ipaddr.parse(host).kind() === "ipv6" ? 6 : 4 },
      ];
    let cancel!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error("Preview canceled"));
      signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      signal.throwIfAborted();
      return await Promise.race([
        (this.options.lookup ?? ((host) => dnsLookup(host, { all: true })))(
          host,
        ),
        aborted,
      ]);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  private async fetch(
    url: URL,
    signal: AbortSignal,
  ): Promise<{ url: URL; response: Response }> {
    let current = url;
    for (let redirect = 0; redirect <= 3; redirect++) {
      signal.throwIfAborted();
      const addresses = await this.addresses(current.hostname, signal);
      if (
        !addresses.length ||
        addresses.some((a) => !isPublicPreviewAddress(a.address))
      )
        throw new Error("Preview destination unavailable");
      signal.throwIfAborted();
      const response = await (this.options.fetch ?? pinnedWebsiteFetch)(
        current,
        { addresses, signal },
      );
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        const url = next ? websitePreviewUrl(next, current) : null;
        if (!url) break;
        current = url;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        break;
      }
      return { url: current, response };
    }
    throw new Error("Preview response unavailable");
  }
  private async image(url: URL, signal: AbortSignal) {
    const { response } = await this.fetch(url, signal),
      mime = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
    const kind = (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
      } as Record<string, string>
    )[mime ?? ""];
    if (!kind) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readBytes(response, 2 * 1024 * 1024, false),
      size = imageSize(bytes);
    if (
      size.type !== kind ||
      size.width <= 0 ||
      size.height <= 0 ||
      size.width > 8192 ||
      size.height > 8192 ||
      size.width * size.height > 16_000_000
    )
      return null;
    return {
      dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      width: size.width,
      height: size.height,
    };
  }
  private async extract(
    url: URL,
    signal: AbortSignal,
  ): Promise<NativeWebsitePreviewData> {
    const fetched = await this.fetch(url, signal),
      contentType = fetched.response.headers.get("content-type"),
      mime = contentType?.split(";")[0].trim().toLowerCase();
    if (mime !== "text/html" && mime !== "application/xhtml+xml") {
      await fetched.response.body?.cancel();
      return unavailable;
    }
    const charset = contentType?.match(
      /\bcharset\s*=\s*["']?([^\s;"']+)/iu,
    )?.[1];
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(charset);
    } catch {
      decoder = new TextDecoder();
    }
    const html = parse(
        decoder.decode(await readBytes(fetched.response, 1024 * 1024, true)),
      ),
      meta = new Map<string, string>();
    for (const element of html.querySelectorAll("meta")) {
      const name = (
          element.getAttribute("property") ?? element.getAttribute("name")
        )?.toLowerCase(),
        value = element.getAttribute("content")?.trim();
      if (name && value && !meta.has(name)) meta.set(name, value);
    }
    const title = text(
        meta.get("og:title") ??
          meta.get("twitter:title") ??
          html.querySelector("title")?.text,
        300,
      ),
      description = text(
        meta.get("og:description") ??
          meta.get("twitter:description") ??
          meta.get("description"),
        1000,
      );
    const source =
        meta.get("og:image:secure_url") ??
        meta.get("og:image") ??
        meta.get("og:image:url") ??
        meta.get("twitter:image") ??
        meta.get("twitter:image:src"),
      imageUrl = source ? websitePreviewUrl(source, fetched.url) : null;
    const image = imageUrl
      ? await this.image(imageUrl, signal).catch(() => null)
      : null;
    return title === null && description === null && image === null
      ? unavailable
      : { status: "ready", title, description, image };
  }
}
