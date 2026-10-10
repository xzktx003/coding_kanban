import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { JsonStore } from "../core/json-store.js";
import {
  bodyObject,
  HttpError,
  object,
  type JsonObject,
} from "../core/json.js";
import { absolutePath } from "../claude/config.js";
import type { CodexService } from "./client.js";
export function codexHome(env: NodeJS.ProcessEnv) {
  return absolutePath(
    env.CODEX_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), ".codex"),
  );
}
function labelName(label: string) {
  if (!label || label.length > 256 || /[\x00-\x1f]/.test(label))
    throw new HttpError(400, "Invalid account label");
  return label.replace(/[^A-Za-z0-9._@-]/g, "_") + ".json";
}
export class AccountSnapshots {
  readonly home: string;
  constructor(
    private readonly codex: Pick<CodexService, "raw" | "accountOperations">,
    env: NodeJS.ProcessEnv,
  ) {
    this.home = codexHome(env);
  }
  private path(label: string) {
    return join(this.home, "codexia-accounts", labelName(label));
  }
  private async auth() {
    const text = await readFile(join(this.home, "auth.json"), "utf8");
    try {
      return bodyObject(JSON.parse(text));
    } catch {
      throw new Error("Codex auth file is invalid");
    }
  }
  private async stored(label: string) {
    const text = await readFile(this.path(label), "utf8");
    let value: JsonObject;
    try {
      value = bodyObject(JSON.parse(text));
    } catch {
      throw new Error("Saved account snapshot is invalid");
    }
    if (value.label !== label)
      throw new HttpError(
        409,
        "Account label collides with an existing snapshot",
      );
    return value;
  }
  save(label: string, email: string | null, planType: string | null) {
    const path = this.path(label);
    return this.codex.accountOperations.run("account", async () => {
      const auth = await this.auth();
      const tokens = object(auth.tokens);
      // Never replace a restorable ChatGPT snapshot with an API-key-only login.
      if (typeof tokens.access_token !== "string" || !tokens.access_token)
        return;
      try {
        await this.stored(label);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new JsonStore(path, () => ({})).write({
        label,
        email,
        plan_type: planType,
        account_id:
          typeof tokens.account_id === "string" ? tokens.account_id : null,
        auth,
      });
    });
  }
  async list() {
    let current: unknown;
    try {
      current = object((await this.auth()).tokens).account_id;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        !(error instanceof SyntaxError)
      )
        throw error;
    }
    let entries: string[];
    try {
      entries = await readdir(join(this.home, "codexia-accounts"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const rows: JsonObject[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      let value: JsonObject;
      try {
        value = bodyObject(
          JSON.parse(
            await readFile(join(this.home, "codexia-accounts", entry), "utf8"),
          ),
        );
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof HttpError)
          continue;
        throw error;
      }
      if (
        typeof value.label !== "string" ||
        typeof object(object(value.auth).tokens).access_token !== "string"
      )
        continue;
      rows.push({
        label: value.label,
        email: typeof value.email === "string" ? value.email : null,
        planType: typeof value.plan_type === "string" ? value.plan_type : null,
        isCurrent: typeof current === "string" && value.account_id === current,
      });
    }
    return rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }
  remove(label: string) {
    return this.codex.accountOperations.run("account", async () => {
      try {
        await this.stored(label);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      await rm(this.path(label));
    });
  }
  switch(label: string) {
    return this.codex.accountOperations.run("account", async () => {
      let value: JsonObject;
      try {
        value = await this.stored(label);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new HttpError(404, `Account '${label}' not found`);
        throw error;
      }
      const tokens = object(object(value.auth).tokens);
      if (typeof tokens.access_token !== "string" || !tokens.access_token)
        throw new Error("Saved account is missing an access token");
      if (typeof tokens.account_id !== "string" || !tokens.account_id)
        throw new Error("Saved account is missing an account id");
      return this.codex.raw("account/login/start", {
        type: "chatgptAuthTokens",
        accessToken: tokens.access_token,
        chatgptAccountId: tokens.account_id,
        chatgptPlanType: value.plan_type ?? null,
      });
    });
  }
}
