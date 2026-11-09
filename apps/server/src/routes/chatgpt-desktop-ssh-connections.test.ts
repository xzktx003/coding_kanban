import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { registerChatGptDesktopSshConnectionRoutes } from "./chatgpt-desktop-ssh-connections.js";
const profile = {
  version: 1 as const,
  id: randomUUID(),
  generation: randomUUID(),
  pid: 12345,
  uid: 1000,
  startTicks: "123",
  macAsarPath: "/private/mac.asar",
  macAsarSha256:
    "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  linuxAsarPath: "/private/linux.asar",
  linuxAsarSha256:
    "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e",
  controlSocketPath: "/private/control.sock",
};
const base = `/api/chatgpt-desktop/${profile.id}/${profile.generation}/ssh`;
test("HTTP accepts only selected aliases and returns bounded metadata, never private native paths", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const calls: string[] = [];
  const current = () => ({
    status: {
      state: "ready" as const,
      reasonCode: "identity_ready" as const,
      profileId: profile.id,
      generation: profile.generation,
    },
    profile,
  });
  const list = {
    connections: [{ alias: "fixture", state: "disconnected" as const }],
  };
  await app.register(registerChatGptDesktopSshConnectionRoutes, {
    profileService: { readValidated: async () => current() },
    connections: {
      probeVersion: async () => ({
        code: 0,
        stdout: "codex-cli 0.166.0\n",
        stderr: "",
      }),
      save: async () => {
        calls.push("save");
        return list;
      },
      refresh: async () => list,
      connect: async () => {
        calls.push("connect");
        return {
          alias: "fixture",
          state: "connecting",
          connectionId: randomUUID(),
        };
      },
      disconnect: async () => ({ alias: "fixture", state: "disconnected" }),
      discover: async () => ({ sshAliases: ["fixture"] }),
      attach: async () => {
        throw Error("HTTP must not attach");
      },
      close() {},
    },
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/aliases",
        payload: { aliases: ["fixture"] },
      })
    ).statusCode,
    200,
  );
  const connect = await app.inject({
    method: "POST",
    url: base + "/connect",
    payload: { alias: "fixture" },
  });
  assert.equal(connect.statusCode, 404);
  assert.doesNotMatch(connect.body, /socketPath|codexHome|private|params/);
  for (const payload of [
    { alias: "fixture", command: "id" },
    { host: "anything" },
    { alias: "fixture", path: "/elsewhere" },
    { alias: "fixture", socketPath: "/sock" },
  ])
    assert.equal(
      (await app.inject({ method: "POST", url: base + "/aliases", payload }))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/aliases?alias=fixture",
        payload: { aliases: ["fixture"] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base.replace(profile.generation, randomUUID()) + "/aliases",
        payload: { aliases: ["fixture"] },
      })
    ).statusCode,
    409,
  );
  assert.deepEqual(calls, ["save"]);
});
