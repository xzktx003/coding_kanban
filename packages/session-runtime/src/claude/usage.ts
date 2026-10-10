import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { object, type JsonObject } from "../core/json.js";
import type { ClaudeConfig } from "./config.js";
const exec = promisify(execFile);
export class ClaudeUsage {
  private cached?: { time: number; value: JsonObject };
  private inflight?: Promise<JsonObject>;
  constructor(
    private readonly config: ClaudeConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async read(refresh = false): Promise<JsonObject> {
    if (!refresh && this.cached && Date.now() - this.cached.time < 180_000)
      return this.cached.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetch()
      .then((value) => {
        this.cached = { time: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }
  private async fetch() {
    let content: string;
    try {
      content =
        process.platform === "darwin"
          ? (
              await exec(
                "/usr/bin/security",
                [
                  "find-generic-password",
                  "-s",
                  "Claude Code-credentials",
                  "-w",
                ],
                { timeout: 20_000, maxBuffer: 1024 * 1024 },
              )
            ).stdout
          : await readFile(
              join(this.config.claudeHome, ".credentials.json"),
              "utf8",
            );
    } catch {
      throw new Error("Claude Code credentials are unavailable");
    }
    let token: unknown;
    try {
      token = object(JSON.parse(content).claudeAiOauth).accessToken;
    } catch {
      throw new Error("Claude Code credentials are invalid");
    }
    if (typeof token !== "string" || !token)
      throw new Error("Claude Code OAuth token is unavailable");
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.anthropic.com/api/oauth/usage",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new Error("Could not reach Claude usage service");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Claude Code login expired; sign in again with Claude Code"
          : response.status === 429
            ? "Claude usage service is rate limiting requests"
            : `Claude usage service returned HTTP ${response.status}`,
      );
    let data: JsonObject;
    try {
      data = object(await response.json());
    } catch {
      throw new Error("Claude usage response is invalid");
    }
    const parse = (value: unknown) => {
      const input = object(value);
      const percent = input.utilization;
      return typeof percent === "number" &&
        Number.isFinite(percent) &&
        percent >= 0 &&
        percent <= 100
        ? {
            usedPercent: percent,
            resetsAt:
              typeof input.resets_at === "string" ? input.resets_at : null,
          }
        : null;
    };
    return {
      fiveHour: parse(data.five_hour),
      sevenDay: parse(data.seven_day),
      fetchedAt: new Date().toISOString(),
    };
  }
}
