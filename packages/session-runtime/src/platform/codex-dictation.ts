import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

export type CodexSocket = new (
  url: URL,
  options: { headers: Record<string, string>; handshakeTimeout: number },
) => WebSocket;
import { absolutePath } from "../claude/config.js";
import { HttpError, object, type JsonObject } from "../core/json.js";

const MODEL = "gpt-4o-mini-transcribe";
const TARGET_RATE = 24_000;
const SOURCE_RATE = 16_000;
const CHUNK_BYTES = 4800;

export interface CodexAuth {
  accessToken: string;
  accountId: string | null;
}

export function codexHome(env: NodeJS.ProcessEnv) {
  return absolutePath(
    env.CODEX_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), ".codex"),
  );
}

/** Reads the local Codex login. Missing or API-key-only auth is unavailable. */
export async function readCodexAuth(
  env: NodeJS.ProcessEnv,
): Promise<CodexAuth | null> {
  let text: string;
  try {
    text = await readFile(join(codexHome(env), "auth.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: JsonObject;
  try {
    parsed = object(JSON.parse(text));
  } catch {
    return null;
  }
  const tokens = object(parsed.tokens);
  if (typeof tokens.access_token !== "string" || !tokens.access_token)
    return null;
  return {
    accessToken: tokens.access_token,
    accountId:
      typeof tokens.account_id === "string" ? tokens.account_id : null,
  };
}

export function resample16kTo24k(pcm: Buffer) {
  const input = pcm.length / 2;
  const output = Math.round((input * TARGET_RATE) / SOURCE_RATE);
  const samples = Buffer.alloc(output * 2);
  for (let index = 0; index < output; index += 1) {
    const position = (index * SOURCE_RATE) / TARGET_RATE;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input - 1);
    const mix = position - left;
    const value = Math.round(
      pcm.readInt16LE(left * 2) * (1 - mix) +
        pcm.readInt16LE(right * 2) * mix,
    );
    samples.writeInt16LE(Math.max(-32768, Math.min(32767, value)), index * 2);
  }
  return samples;
}

function sessionUpdate() {
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: TARGET_RATE },
          transcription: { model: MODEL },
        },
      },
    },
  };
}

function transcriptText(message: JsonObject) {
  const type = message.type;
  if (
    type !== "conversation.item.input_audio_transcription.completed" &&
    type !== "conversation.item.input_audio_transcription.delta"
  )
    return null;
  const text = message.transcript ?? message.delta;
  return typeof text === "string" ? text : "";
}

/** Codex transcription session from the plugin's realtime v2 protocol. */
export function transcribeWithCodex(
  pcm16k: Buffer,
  auth: CodexAuth,
  env: NodeJS.ProcessEnv,
  socketFactory: CodexSocket = WebSocket,
) {
  const base =
    env.SESSION_CODEX_REALTIME_URL ??
    "wss://api.openai.com/v1/realtime?intent=transcription";
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new HttpError(400, "Invalid Codex realtime URL");
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:")
    throw new HttpError(400, "Invalid Codex realtime URL");
  const audio = resample16kTo24k(pcm16k);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
  return new Promise<{ text: string }>((resolve, reject) => {
    const socket = new socketFactory(url, { headers, handshakeTimeout: 15_000 });
    const timer = setTimeout(() => finish(new Error("Codex dictation timed out")), 60_000);
    let text = "";
    let audioSent = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve({ text: text.trim() });
    };
    const sendAudio = () => {
      for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: audio.subarray(offset, offset + CHUNK_BYTES).toString("base64"),
          }),
        );
      }
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    };
    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      if (!settled) finish(new Error("Codex dictation closed before a transcript"));
    });
    socket.on("message", (data) => {
      let message: JsonObject;
      try {
        message = object(JSON.parse(String(data)));
      } catch {
        return;
      }
      if (message.type === "session.updated" && !audioSent) {
        audioSent = true;
        sendAudio();
        return;
      }
      if (message.type === "error") {
        const detail = object(message.error);
        finish(new Error(typeof detail.message === "string" ? detail.message : "Codex dictation failed"));
        return;
      }
      const next = transcriptText(message);
      if (next == null) return;
      if (message.type === "conversation.item.input_audio_transcription.completed") {
        text = next || text;
        finish();
      } else text += next;
    });
    socket.on("open", () => {
      socket.send(JSON.stringify(sessionUpdate()));
    });
  });
}
