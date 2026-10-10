import type { FastifyInstance } from "fastify";

/** Serialized browser origins, not URL prefixes; CORS never grants API ownership. */
export function originIsAllowed(
  origin: string,
  extra: readonly string[] = [],
): boolean {
  if (origin === "tauri://localhost") return true;
  if (origin === "null") return extra.includes(origin);
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (!["http:", "https:"].includes(url.protocol))
    return extra.includes(origin) && url.pathname === "";
  if (url.origin !== origin) return false;
  if (extra.includes(origin)) return true;
  return (
    ["localhost", "127.0.0.1", "[::1]", "tauri.localhost"].includes(
      url.hostname,
    ) || url.hostname.endsWith(".ts.net")
  );
}

/** Register before the device-token hook so browser preflight can describe auth. */
export function registerRuntimeCors(
  app: FastifyInstance,
  options: { allowedOrigins?: readonly string[] } = {},
) {
  const extra = [...(options.allowedOrigins ?? [])];
  app.addHook("onRequest", async (request, reply) => {
    reply.header(
      "Vary",
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    );
    const origin = request.headers.origin;
    if (!origin) return;
    if (!originIsAllowed(origin, extra))
      return reply.code(403).send({ error: "Origin is not allowed" });
    reply.header("Access-Control-Allow-Origin", origin);
    if (request.method !== "OPTIONS") return;
    const method = request.headers["access-control-request-method"];
    const rawHeaders = request.headers["access-control-request-headers"];
    const headers =
      typeof rawHeaders === "string"
        ? rawHeaders
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean)
        : [];
    if (
      typeof method !== "string" ||
      !["GET", "POST"].includes(method) ||
      headers.some((h) => !["content-type", "authorization"].includes(h))
    )
      return reply
        .code(403)
        .send({ error: "CORS method or headers are not allowed" });
    reply.header("Access-Control-Allow-Methods", "GET, POST");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return reply.code(204).send();
  });
}
