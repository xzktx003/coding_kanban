import { readCodexAuth } from "./codex-dictation.ts";
import { WebSocket } from "ws";

const auth = await readCodexAuth(process.env);
if (!auth) process.exit(1);
const samples = Buffer.alloc(24000 * 2);
for (let i = 0; i < samples.length / 2; i += 1)
  samples.writeInt16LE(Math.round(Math.sin(i / 18) * 8000), i * 2);
const audio = samples.toString("base64");
console.log("pcm", samples.length, "b64", audio.length, "roundtrip", Buffer.from(audio, "base64").length);
const headers: Record<string, string> = {
  Authorization: `Bearer ${auth.accessToken}`,
};
if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

await new Promise<void>((resolve) => {
  const socket = new WebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    { headers, handshakeTimeout: 15000 },
  );
  const timer = setTimeout(() => {
    console.log("TIMEOUT");
    socket.close();
    resolve();
  }, 20000);
  let sent = false;
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    console.log(
      message.type,
      String(message.error?.message ?? message.transcript ?? message.delta ?? "").slice(0, 200),
    );
    if (message.type === "session.updated" && !sent) {
      sent = true;
      const chunk = 4800;
      const raw = Buffer.from(audio, "base64");
      for (let offset = 0; offset < raw.length; offset += chunk) {
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: raw.subarray(offset, offset + chunk).toString("base64"),
          }),
        );
      }
      setTimeout(() => {
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }, 300);
    }
    if (
      message.type === "error" ||
      message.type === "conversation.item.input_audio_transcription.completed"
    ) {
      clearTimeout(timer);
      socket.close();
      resolve();
    }
  });
  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: null,
            },
          },
        },
      }),
    );
  });
  socket.on("close", () => {
    clearTimeout(timer);
    resolve();
  });
});
