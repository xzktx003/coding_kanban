import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionDatabase } from "../storage/database.js";
import { KekeMcpService } from "../keke/mcp.js";
import { EventHub } from "../core/events.js";
import { DelegationTokens } from "./routes.js";
import { createBotResolver } from "./policy.js";
test("bot policies isolate memory, selected native connectors and per-session capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "bot-policy-"));
  const db = new SessionDatabase(root);
  const tokens = new DelegationTokens();
  const hub = new EventHub();
  const keke = new KekeMcpService({ home: join(root, "keke") });
  try {
    db.createBot({
      id: "bot",
      name: "B",
      avatar: "",
      color: "",
      cwd: root,
      trustLevel: "read_only",
    });
    db.updateBot("bot", {
      mcpServers: [
        "legacy",
        "keke:native",
        "keke:disabled",
        "keke:codexia-bots",
      ],
      systemPrompt: "Persona",
    });
    await keke.add("native", { command: "fixture" });
    await keke.add("disabled", { command: "no", disabled: true });
    const resolve = createBotResolver({
      db,
      dataDir: root,
      keke,
      tokens,
      hub,
      findAgent: async () => ({
        id: "keke",
        name: "Keke",
        command: "fixture",
        args: ["agent", "stdio"],
      }),
      apiBaseUrl: () => "http://127.0.0.1:12345",
    });
    const resolved = await resolve("bot", {
      unattended: true,
      allowCollaboration: true,
    });
    assert.equal(resolved.policy.readOnly, true);
    assert.equal(resolved.policy.unattended?.allowAll, false);
    assert.equal(
      resolved.agent.env?.KEKE_MEMORY_DIR,
      join(root, "bots", "bot", "memory"),
    );
    assert.equal(resolved.agent.env?.KEKE_INSTRUCTIONS, "Persona");
    const first = resolved.policy.sessionMcpServers!() as any[];
    const second = resolved.policy.sessionMcpServers!() as any[];
    assert.equal(first.length, 2);
    const a = first[0].headers[0].value,
      b = second[0].headers[0].value;
    assert.notEqual(a, b);
    assert.equal(tokens.verify(a, "bot"), true);
    resolved.policy.onClose!();
    assert.equal(tokens.verify(a, "bot"), false);
    assert.equal(tokens.verify(b, "bot"), false);
    const delegated = await resolve("bot", {
      unattended: true,
      allowCollaboration: false,
    });
    assert.equal(delegated.policy.sessionMcpServers!().length, 1);
  } finally {
    hub.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
