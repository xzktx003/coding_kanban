// Call only after the exact native turn completed. Read the original DOM; never
// clear a draft, retry a submit, or substitute a native completion for UI state.
export async function waitForOriginalComposerSettlement({
  frame,
  threadId,
  timeoutMs = 15000,
  pollMs = 50,
  expectedTurnStatus = "completed",
}) {
  if (!["completed", "interrupted"].includes(expectedTurnStatus))
    throw Error("Confirmed terminal turn status required");
  if (
    typeof threadId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      threadId,
    )
  )
    throw Error("Exact native thread UUID required");
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 1 ||
    pollMs > 1000
  )
    throw Error("Bounded UI settlement timeout and polling required");
  const start = Date.now(),
    deadline = start + timeoutMs;
  let samples = 0,
    observation = null;
  const expired = () =>
    Object.assign(
      Error("Original composer did not settle before its deadline"),
      {
        code: "ORIGINAL_COMPOSER_NOT_SETTLED",
        observation,
        samples,
        elapsedMs: Date.now() - start,
      },
    );
  while (true) {
    let timer;
    const state = await Promise.race([
      frame.evaluate(() => {
        const root = document.querySelector("#root");
        const targets = [
          ...document.querySelectorAll("[data-above-composer-conversation-id]"),
        ];
        const editors = [
          ...(root?.querySelectorAll('[contenteditable="true"]') ?? []),
        ];
        const visible = (element) =>
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden" &&
          getComputedStyle(element).visibility !== "collapse";
        const shown = editors.filter(visible);
        const editor = shown[0];
        const buttons = [...(root?.querySelectorAll("button") ?? [])].filter(
          visible,
        );
        const count = (label) =>
          buttons.filter(
            (button) => button.getAttribute("aria-label") === label,
          ).length;
        return {
          threadId:
            targets[0]?.getAttribute("data-above-composer-conversation-id") ??
            null,
          targetCount: targets.length,
          editorCount: shown.length,
          editorVisible: !!editor,
          editorEmpty:
            !!editor && (editor.textContent ?? "").trim().length === 0,
          busy: !!root?.querySelector('[aria-busy="true"]'),
          sendCount: count("Send"),
          stopCount: count("Stop"),
          queueCount: count("Queue"),
          resumeCount: count("Resume"),
        };
      }, threadId),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(expired()),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]).finally(() => clearTimeout(timer));
    samples++;
    if (
      !state ||
      typeof state !== "object" ||
      !["editorVisible", "editorEmpty", "busy"].every(
        (key) => typeof state[key] === "boolean",
      ) ||
      ![
        "targetCount",
        "editorCount",
        "sendCount",
        "stopCount",
        "queueCount",
        "resumeCount",
      ].every((key) => Number.isSafeInteger(state[key]) && state[key] >= 0)
    )
      throw Error("Incomplete original composer state observation");
    if (
      state.threadId !== threadId ||
      state.targetCount !== 1 ||
      state.editorCount > 1
    )
      throw Error("Original composer target or editor changed");
    // Keep one fixed-size metadata sample; never retain arbitrary frame output.
    observation = Object.fromEntries(
      [
        "threadId",
        "targetCount",
        "editorCount",
        "editorVisible",
        "editorEmpty",
        "busy",
        "sendCount",
        "stopCount",
        "queueCount",
        "resumeCount",
      ].map((key) => [key, state[key]]),
    );
    if (
      state.editorCount === 1 &&
      state.editorVisible &&
      state.editorEmpty &&
      !state.busy &&
      (expectedTurnStatus === "interrupted"
        ? state.sendCount + state.resumeCount === 1
        : state.sendCount === 1 && state.resumeCount === 0) &&
      state.stopCount === 0 &&
      state.queueCount === 0
    ) {
      const settledAt = Date.now();
      return {
        settledAt,
        elapsedMs: settledAt - start,
        samples,
        submitAction: state.resumeCount === 1 ? "resume" : "send",
      };
    }
    if (Date.now() >= deadline) throw expired();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollMs, deadline - Date.now())),
    );
  }
}
