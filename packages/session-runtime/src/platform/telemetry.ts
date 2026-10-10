import { join } from "node:path";
import { JsonStore } from "../core/json-store.js";
import { HttpError, object } from "../core/json.js";
export type TelemetryEvent =
  | "app_active"
  | "bot_created"
  | "bot_routine_created"
  | "bot_run_done"
  | "bot_run_blocked"
  | "bot_run_failed"
  | "bot_ask";
export class Telemetry {
  private store: JsonStore;
  constructor(
    dataHome: string,
    private env: NodeJS.ProcessEnv,
    private hasBots: () => boolean | Promise<boolean>,
    private version = "0.1.0",
    private fetcher: typeof fetch = fetch,
  ) {
    this.store = new JsonStore(
      join(dataHome, ".codexia/telemetry.json"),
      () => ({ consent: "unset", sent: {} }),
    );
  }
  private get available() {
    return (
      !!this.env.CODEXIA_TELEMETRY_URL?.trim() &&
      this.env.DO_NOT_TRACK?.trim() !== "1"
    );
  }
  async status() {
    const state = await this.store.read();
    return {
      available: this.available,
      consent: state.consent ?? "unset",
      eligible: this.available && (await this.hasBots()),
    };
  }
  async setConsent(consent: unknown) {
    if (!["unset", "granted", "denied"].includes(String(consent)))
      throw new HttpError(400, "Invalid telemetry consent");
    await this.store.update((s) => ({ ...s, consent: String(consent) }));
    return this.status();
  }
  async track(event: TelemetryEvent) {
    if (!this.available) return;
    const today = new Date().toISOString().slice(0, 10);
    let send = false;
    await this.store.update(async (s) => {
      const sent = object(s.sent);
      if (
        s.consent === "granted" &&
        sent[event] !== today &&
        (await this.hasBots())
      ) {
        send = true;
        return { ...s, sent: { ...sent, [event]: today } };
      }
      return s;
    });
    if (!send) return;
    const platform =
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux";
    const arch =
      process.arch === "x64"
        ? "x86_64"
        : process.arch === "arm64"
          ? "aarch64"
          : "unknown";
    await this.fetcher(this.env.CODEXIA_TELEMETRY_URL!.trim(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{ name: event, version: this.version, platform, arch }],
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
}
