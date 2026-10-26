import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { openLifecycleFixture } from "./codex-refresh-ui-fixture.mjs";
import { focusInitialOriginalComposer } from "./codex-refresh-initial-prompt.mjs";
import { waitForOriginalComposerSettlement } from "./codex-refresh-ui-settlement.mjs";

const run = await openLifecycleFixture(
  "three independent official composer submissions to one idle native thread",
);
const { fixture, result, observer, events, pages, frame, wait, save } = run;
const scene = fixture.scenes.idle;
result.initializationActions = [];
result.uiSettlements = [];
result.controlObservations = [];
const caseId =
  process.env.NATIVE_CODEX_REFRESH_SEND_CASE ??
  randomUUID().replaceAll("-", "").toUpperCase();
assert.match(caseId, /^[A-Z0-9_]{1,32}$/);
const markers = ["A", "B", "C"].map(
  (client) => "REFRESH_IDLE_CONCURRENT_" + caseId + "_" + client,
);
try {
  await observer.request("thread/resume", {
    threadId: scene.threadId,
    excludeTurns: true,
  });
  const before = await run.snapshot("idle", true);
  assert.equal(before.status.type, "idle");
  const previous = new Set(before.turns.map((turn) => turn.id));
  for (let index = 0; index < 3; index++) {
    const page = await run.createPage(index, "idle");
    const native = await frame(page, scene.threadId);
    result.initializationActions.push({
      index,
      dismissedInitialPrompt: await focusInitialOriginalComposer({
        editor: native
          .locator('#root [contenteditable="true"]:visible')
          .first(),
        frame: native,
        mobile: index === 2,
      }),
    });
    await native
      .locator('#root [contenteditable="true"]:visible')
      .first()
      .fill(markers[index]);
  }
  const controls = [];
  for (let index = 0; index < 3; index++) {
    const native = await frame(pages[index], scene.threadId);
    await native.evaluate(() => {
      // Observe actual gestures without changing native handlers or routing.
      window.__refreshAcceptanceGestures = [];
      for (const type of [
        "pointerdown",
        "pointerup",
        "touchstart",
        "touchend",
        "click",
        "submit",
      ]) {
        document.addEventListener(
          type,
          (event) => {
            const button =
              event.target instanceof Element
                ? event.target.closest("button")
                : null;
            if (!button || window.__refreshAcceptanceGestures.length >= 32)
              return;
            window.__refreshAcceptanceGestures.push({
              type,
              at: Date.now(),
              trusted: event.isTrusted,
              label: button.getAttribute("aria-label"),
              title: button.getAttribute("title"),
              disabled: button.disabled,
            });
          },
          { capture: true, passive: true },
        );
      }
    });
    assert.equal(
      await native
        .locator('#root [contenteditable="true"]:visible')
        .first()
        .innerText(),
      markers[index],
    );
    controls.push(native.getByRole("button", { name: "Send", exact: true }));
    result.controlObservations.push({
      index,
      frameId: await (await native.frameElement()).getAttribute("id"),
      sendCount: await controls[index].count(),
      state: await native.evaluate(() => ({
        busy: !!document.querySelector('#root [aria-busy="true"]'),
        labels: [...document.querySelectorAll("#root button")]
          .slice(-24)
          .map((button) => ({
            label: button.getAttribute("aria-label"),
            title: button.getAttribute("title"),
            disabled: button.disabled,
          })),
      })),
    });
    await save();
    assert.equal(await controls[index].isEnabled(), true);
  }
  result.steps.push({
    step: "three-independent-drafts-and-idle-send-controls",
    pass: true,
  });
  await save();
  const offset = events.length;
  result.submitAttempts = 3;
  const outcomes = await Promise.allSettled(
    controls.map((button, index) =>
      index === 2
        ? button.tap({ timeout: 5000 })
        : button.click({ timeout: 5000 }),
    ),
  );
  result.clickOutcomes = outcomes.map((outcome, index) => ({
    index,
    status: outcome.status,
  }));
  await save();
  let observedCompletions = 0,
    history;
  await wait(
    async () => {
      const completed = new Set(
        events
          .slice(offset)
          .filter(
            (event) =>
              event.method === "turn/completed" &&
              event.threadId === scene.threadId,
          )
          .map((event) => event.turnId),
      );
      if (completed.size <= observedCompletions) return false;
      observedCompletions = completed.size;
      const current = await run.snapshot("idle", true);
      const userItems = current.turns
        .filter((turn) => !previous.has(turn.id))
        .flatMap((turn) =>
          turn.items
            .filter((item) => item.type === "userMessage")
            .map((item) => ({
              itemId: item.id,
              turnId: turn.id,
              text: item.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            })),
        );
      result.nativeInputEvidence = markers.map((marker) => ({
        marker,
        occurrences: userItems.reduce(
          (sum, item) => sum + item.text.split(marker).length - 1,
          0,
        ),
        items: userItems
          .filter((item) => item.text.includes(marker))
          .map(({ itemId, turnId }) => ({ itemId, turnId })),
      }));
      result.turnStatuses = current.turns
        .filter((turn) => !previous.has(turn.id))
        .map((turn) => ({ id: turn.id, status: turn.status }));
      await save();
      if (result.nativeInputEvidence.some((input) => input.occurrences !== 1))
        return false;
      history = current;
      return true;
    },
    "Not all independent submissions reached native history exactly once",
    30000,
  );
  const turns = history.turns.filter((turn) => !previous.has(turn.id));
  assert.ok(turns.length >= 1 && turns.length <= 3);
  assert.equal(
    turns.every((turn) => turn.status === "completed"),
    true,
    "Another submit must not interrupt an already accepted turn",
  );
  result.steps.push({
    step: "all-three-native-inputs-retained-exactly-once-without-interruption",
    pass: true,
  });
  for (let index = 0; index < 3; index++) {
    const native = await frame(pages[index], scene.threadId);
    result.uiSettlements.push({
      index,
      ...(await waitForOriginalComposerSettlement({
        frame: native,
        threadId: scene.threadId,
      })),
    });
    result.steps.push({
      step: "submitted-draft-cleared-on-own-client",
      index,
      pass: true,
    });
  }
  result.newNativeTurns = turns.length;
  await pages[2].screenshot({
    path: join(run.output, "mobile-concurrent-accepted.png"),
  });
  result.passed =
    result.steps.length === 5 &&
    result.uiSettlements.length === 3 &&
    result.errors.length === 0;
} catch (error) {
  result.errors.push({
    kind: "assertion",
    message: error.message.slice(0, 1000),
    ...(error.code === "ORIGINAL_COMPOSER_NOT_SETTLED"
      ? {
          code: error.code,
          observation: error.observation,
          samples: error.samples,
          elapsedMs: error.elapsedMs,
        }
      : {}),
  });
  result.remainingDrafts = [];
  for (let index = 0; index < pages.length; index++) {
    for (const candidate of pages[index].frames()) {
      try {
        const editor = candidate
          .locator('#root [contenteditable="true"]:visible')
          .first();
        if (await editor.count())
          result.remainingDrafts.push({
            index,
            preserved: (await editor.innerText()) === markers[index],
            empty: !(await editor.innerText()).trim(),
          });
      } catch {
        /* Detached native frame. */
      }
    }
    await pages[index]
      .screenshot({ path: join(run.output, "failure-" + index + ".png") })
      .catch(() => {});
  }
} finally {
  result.gestures = [];
  for (let index = 0; index < pages.length; index++) {
    for (const candidate of pages[index].frames()) {
      const gestures = await candidate
        .evaluate(() => window.__refreshAcceptanceGestures ?? null)
        .catch(() => null);
      if (gestures) result.gestures.push({ index, events: gestures });
    }
  }
  result.nativeLifecycle = events.filter(
    (event) => event.threadId === scene.threadId,
  );
  await run.close();
}
console.log(
  JSON.stringify({
    passed: result.passed,
    steps: result.steps.length,
    errors: result.errors.length,
    newNativeTurns: result.newNativeTurns,
  }),
);
if (!result.passed) process.exitCode = 1;
