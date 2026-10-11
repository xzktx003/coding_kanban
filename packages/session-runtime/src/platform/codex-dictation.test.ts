import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import {
  readCodexAuth,
  resample16kTo24k,
  transcribeWithCodex,
} from "./codex-dictation.js";

class FakeSocket extends EventEmitter {
  static last: FakeSocket;
  sent: string[] = [];
  closed = false;
  constructor(
    readonly url: URL,
    readonly options: { headers: Record<string, string> },
  ) {
    super();
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

test("codex auth is available only for a ChatGPT access token", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-auth-"));
  const env = { CODEX_HOME: home };
  try {
    assert.equal(await readCodexAuth(env), null);
    await writeFile(join(home, "auth.json"), JSON.stringify({ tokens: {} }));
    assert.equal(await readCodexAuth(env), null);
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({
        tokens: { access_token: "fixture-token", account_id: "acct" },
      }),
    );
    assert.deepEqual(await readCodexAuth(env), {
      accessToken: "fixture-token",
      accountId: "acct",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("codex dictation sends 24 kHz transcription audio and keeps the final transcript", async () => {
  const pcm = Buffer.alloc(6400);
  pcm.writeInt16LE(1000, 0);
  pcm.writeInt16LE(-1000, 6398);
  const audio = resample16kTo24k(pcm);
  assert.equal(audio.length, 4800 * 2);
  assert.equal(audio.readInt16LE(0), 1000);

  const pending = transcribeWithCodex(
    pcm,
    { accessToken: "fixture-token", accountId: "acct" },
    {
      SESSION_CODEX_REALTIME_URL:
        "ws://127.0.0.1:9/v1/realtime?intent=transcription",
    },
    FakeSocket as unknown as typeof WebSocket,
  );
  const socket = FakeSocket.last;
  assert.equal(
    socket.url.href,
    "ws://127.0.0.1:9/v1/realtime?intent=transcription",
  );
  assert.equal(socket.options.headers.Authorization, "Bearer fixture-token");
  assert.equal(socket.options.headers["ChatGPT-Account-Id"], "acct");
  socket.emit("open");
  socket.emit("message", JSON.stringify({ type: "session.updated" }));
  const messages = socket.sent.map((line) => JSON.parse(line));
  assert.equal(messages[0].session.type, "transcription");
  assert.equal(
    messages[0].session.audio.input.transcription.model,
    "gpt-4o-mini-transcribe",
  );
  assert.equal(messages[0].session.audio.input.format.rate, 24000);
  assert.equal(messages.at(-1).type, "input_audio_buffer.commit");
  socket.emit(
    "message",
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "hel",
    }),
  );
  socket.emit(
    "message",
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: " hello ",
    }),
  );
  assert.deepEqual(await pending, { text: "hello" });
  assert.equal(socket.closed, true);
});
