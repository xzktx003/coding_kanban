import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import { run } from "./common.js";
export class DeviceToken {
  private constructor(private token: string) {}
  static async load(dataHome: string): Promise<DeviceToken> {
    const dir = join(dataHome, ".codexia");
    const path = join(dir, "device-token");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const t = (await readFile(path, "utf8")).trim();
      if (!t) throw new Error("Empty device token");
      await chmod(path, 0o600);
      return new DeviceToken(t);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    try {
      const file = await open(path, "wx", 0o600);
      const token = randomBytes(32).toString("hex");
      try {
        await file.writeFile(token);
        await file.sync();
      } finally {
        await file.close();
      }
      return new DeviceToken(token);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        return DeviceToken.load(dataHome);
      throw e;
    }
  }
  value() {
    return this.token;
  }
  matches(candidate: string) {
    const actual = Buffer.from(this.token);
    const other = Buffer.from(candidate);
    return actual.length === other.length && timingSafeEqual(actual, other);
  }
  permits(request: FastifyRequest) {
    const address = request.ip.replace(/^::ffff:/, "");
    const local = address === "::1" || /^127\./.test(address);
    let hostname = "";
    try {
      hostname = new URL(`http://${request.headers.host ?? ""}`).hostname;
    } catch {}
    if (local && ["localhost", "127.0.0.1", "[::1]"].includes(hostname))
      return true;
    const header = request.headers.authorization;
    const candidate = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : new URL(request.url, "http://localhost").searchParams.get("token");
    return (
      candidate !== null && candidate !== undefined && this.matches(candidate)
    );
  }
}
export async function detectTailscale(env: NodeJS.ProcessEnv) {
  for (const cmd of [
    "tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ]) {
    try {
      const status = JSON.parse(
        await run(cmd, ["status", "--json"], { env, timeout: 5000 }),
      );
      const dns_name =
        typeof status.Self?.DNSName === "string"
          ? status.Self.DNSName.replace(/\.+$/, "")
          : "";
      const ipv4 = Array.isArray(status.Self?.TailscaleIPs)
        ? status.Self.TailscaleIPs.find(
            (v: unknown) => typeof v === "string" && isIP(v) === 4,
          )
        : undefined;
      if (dns_name && ipv4) return { dns_name, ipv4 };
    } catch {}
  }
  return null;
}
