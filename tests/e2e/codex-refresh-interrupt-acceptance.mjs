import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { openLifecycleFixture } from "./codex-refresh-ui-fixture.mjs";
import { focusInitialOriginalComposer } from "./codex-refresh-initial-prompt.mjs";
import { waitForOriginalComposerSettlement } from "./codex-refresh-ui-settlement.mjs";

const run = await openLifecycleFixture(
  "official mobile Stop interrupts the exact turn and desktop continues once",
);
const { fixture, result, observer, events, pages, frame, wait, save } = run;
const scene = fixture.scenes.idle;
const caseId = randomUUID().replaceAll("-", "").toUpperCase();
const runningMarker = "REFRESH_RUNNING_INTERRUPT_" + caseId;
const continueMarker = "REFRESH_IDLE_CONTINUE_" + caseId;
result.initializationActions = [];
result.uiSettlements = [];

const inputs = (thread, marker) =>
  thread.turns.flatMap((turn) =>
    turn.items
      .filter((item) => item.type === "userMessage")
      .flatMap((item) =>
        item.content
          .filter((part) => part.type === "text" && part.text.includes(marker))
          .map((part) => ({
            turnId: turn.id,
            count: part.text.split(marker).length - 1,
          })),
      ),
  );

async function settleAll(phase) {
  for (let index = 0; index < 3; index++) {
    result.uiSettlements.push({
      index,
      phase,
      ...(await waitForOriginalComposerSettlement({
        frame: await frame(pages[index], scene.threadId),
        threadId: scene.threadId,
        expectedTurnStatus: phase === "interrupt" ? "interrupted" : "completed",
      })),
    });
    result.steps.push({
      step: phase + "-original-composer-settled",
      index,
      pass: true,
    });
    await save();
  }
}

try {
  await observer.request("thread/resume", {
    threadId: scene.threadId,
    excludeTurns: true,
  });
  assert.equal((await run.snapshot("idle")).status.type, "idle");
  for (let index = 0; index < 3; index++) {
    result.phase = "cold-original-composer-" + index;
    const page = await run.createPage(index, "idle");
    const native = await frame(page, scene.threadId);
    const editor = native.locator('#root [contenteditable="true"]:visible');
    await editor.waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await editor.count(), 1);
    result.initializationActions.push({
      index,
      dismissedInitialPrompt: await focusInitialOriginalComposer({
        editor,
        frame: native,
        mobile: index === 2,
      }),
    });
    assert.equal((await editor.innerText()).trim(), "");
    result.steps.push({
      step: "correct-empty-official-composer",
      index,
      pass: true,
    });
    await save();
  }
  const mobileNative = await frame(pages[2], scene.threadId);
  result.phase = "mobile-submit-running";
  await mobileNative
    .locator('#root [contenteditable="true"]:visible')
    .fill(runningMarker);
  const send = mobileNative.getByRole("button", { name: "Send", exact: true });
  assert.equal(await send.count(), 1);
  assert.equal(await send.isEnabled(), true);
  const offset = events.length;
  result.runningSubmitAttempts = 1;
  await save();
  await send.tap();
  const started = await wait(
    () =>
      events
        .slice(offset)
        .find(
          (event) =>
            event.method === "turn/started" &&
            event.threadId === scene.threadId,
        ),
    "Native acceptance of the mobile running submission missing",
  );
  const running = await run.snapshot("idle", true);
  const submitted = inputs(running, runningMarker);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].count, 1);
  assert.equal(submitted[0].turnId, started.turnId);
  assert.equal(running.status.type, "active");
  result.runningTurnId = started.turnId;
  result.steps.push({
    step: "mobile-running-submission-accepted-once",
    pass: true,
  });
  await save();
  for (const page of pages) {
    const stop = (await frame(page, scene.threadId)).getByRole("button", {
      name: /^Stop(?:\s|$)/,
    });
    await stop.waitFor();
    assert.equal(await stop.isEnabled(), true);
  }
  await pages[2].screenshot({
    path: join(run.output, "mobile-before-stop.png"),
  });
  result.phase = "mobile-stop";
  result.stopAttempts = 1;
  await save();
  await mobileNative.getByRole("button", { name: /^Stop(?:\s|$)/ }).tap();
  await wait(
    () =>
      events
        .slice(offset)
        .find(
          (event) =>
            event.method === "turn/completed" &&
            event.threadId === scene.threadId &&
            event.turnId === started.turnId,
        ),
    "Exact original turn did not finish after official Stop",
  );
  const stopped = await run.snapshot("idle", true);
  const stoppedTurn = stopped.turns.find((turn) => turn.id === started.turnId);
  assert.equal(stoppedTurn.status, "interrupted");
  assert.equal(stopped.status.type, "idle");
  assert.deepEqual(inputs(stopped, runningMarker), submitted);
  result.steps.push({
    step: "official-mobile-stop-interrupted-exact-turn",
    pass: true,
  });
  await save();
  await settleAll("interrupt");

  result.phase = "desktop-continue";
  const desktopNative = await frame(pages[0], scene.threadId);
  await desktopNative
    .locator('#root [contenteditable="true"]:visible')
    .fill(continueMarker);
  const nextSend = desktopNative.getByRole("button", {
    name: "Send",
    exact: true,
  });
  assert.equal(await nextSend.isEnabled(), true);
  const continueOffset = events.length;
  result.continueSubmitAttempts = 1;
  await save();
  await nextSend.click();
  const accepted = await wait(
    () =>
      events
        .slice(continueOffset)
        .find(
          (event) =>
            event.method === "turn/started" &&
            event.threadId === scene.threadId,
        ),
    "Native acceptance of desktop continuation missing",
  );
  await wait(
    () =>
      events
        .slice(continueOffset)
        .find(
          (event) =>
            event.method === "turn/completed" &&
            event.threadId === scene.threadId &&
            event.turnId === accepted.turnId,
        ),
    "Desktop continuation did not complete",
  );
  const completed = await run.snapshot("idle", true);
  const continued = inputs(completed, continueMarker);
  assert.equal(continued.length, 1);
  assert.equal(continued[0].count, 1);
  assert.equal(continued[0].turnId, accepted.turnId);
  assert.notEqual(accepted.turnId, started.turnId);
  assert.equal(
    completed.turns.find((turn) => turn.id === accepted.turnId).status,
    "completed",
  );
  assert.deepEqual(inputs(completed, runningMarker), submitted);
  result.continueTurnId = accepted.turnId;
  result.steps.push({ step: "desktop-continued-in-new-turn-once", pass: true });
  await save();
  await settleAll("continue");
  result.phase = "complete";
  await pages[2].screenshot({
    path: join(run.output, "mobile-after-continue.png"),
  });
  result.passed = result.steps.length === 12 && result.errors.length === 0;
} catch (error) {
  result.errors.push({
    kind: "assertion",
    message: error.message.slice(0, 1000),
  });
  if (error.code === "ORIGINAL_COMPOSER_NOT_SETTLED")
    result.lastSettlement = error.observation;
  for (let index = 0; index < pages.length; index++)
    if (!pages[index].isClosed())
      await pages[index]
        .screenshot({ path: join(run.output, "failure-" + index + ".png") })
        .catch(() => {});
} finally {
  await run.close();
}
console.log(
  JSON.stringify({
    passed: result.passed,
    steps: result.steps.length,
    errors: result.errors.length,
  }),
);
if (!result.passed) process.exitCode = 1;
