// Controlled private-fixture evidence, not an application history loader.
export function expectedRefreshHistory(thread, { threadId, cwd, turnId } = {}) {
  if (
    !thread ||
    thread.id !== threadId ||
    thread.cwd !== cwd ||
    !Array.isArray(thread.turns) ||
    thread.turns.length < 1 ||
    thread.turns.length > 32
  )
    throw new Error("Exact bounded fixture history required");
  const latest = thread.turns.at(-1);
  if (
    latest.status !== "completed" ||
    typeof latest.id !== "string" ||
    latest.id.length < 1 ||
    latest.id.length > 128 ||
    /[\x00-\x1f\x7f]/.test(latest.id) ||
    (turnId !== undefined && latest.id !== turnId) ||
    !Array.isArray(latest.items) ||
    latest.items.length > 64
  )
    throw new Error("Exact completed fixture turn required");
  const reply = latest.items
    .filter((item) => item.type === "agentMessage")
    .at(-1)?.text;
  if (
    typeof reply !== "string" ||
    !/^REFRESH_(?:PROFILE_SEED|IPHONE_ACCEPTED_[0-2])$/.test(reply)
  )
    throw new Error("Controlled native reply token required");
  return Object.freeze({
    token: reply,
    turnId: latest.id,
    turnCount: thread.turns.length,
  });
}
