import { readFile } from "node:fs/promises";
import { readCodexAuth, transcribeWithCodex } from "./codex-dictation.ts";
const auth = await readCodexAuth(process.env);
if (!auth) { console.log("NO_AUTH"); process.exit(1); }
const pcm = await readFile(process.argv[2] ?? "/tmp/speech.pcm");
const result = await transcribeWithCodex(pcm, auth, process.env);
console.log("TEXT", JSON.stringify(result.text));
