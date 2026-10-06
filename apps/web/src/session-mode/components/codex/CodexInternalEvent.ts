/** codex:stderr — raw stderr line from the codex process */
export type CodexStderrEvent = { message: string };

/** codex:parseError — stdout line that failed JSON parsing */
export type CodexParseErrorEvent = { error: string; raw: string };
