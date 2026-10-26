import assert from "node:assert/strict";
import { join } from "node:path";
import { captureProcessIdentity } from "../../packages/native-codex-host/refresh-prototype/resources.mjs";
import { openLifecycleFixture } from "./codex-refresh-ui-fixture.mjs";
import { verifyRefreshSetupProcess } from "./codex-refresh-fixture.mjs";
import { waitForOriginalComposerSettlement } from "./codex-refresh-ui-settlement.mjs";

const run = await openLifecycleFixture(
  "running native turn survives mobile refresh and one browser closing",
);
const { fixture, result, observer, pages, frame, wait, save } = run;
const scene = fixture.scenes.running;
result.createdViaFixture = true;
result.uiSettlements = [];
try {
  await observer.request("thread/resume", {
    threadId: scene.threadId,
    excludeTurns: true,
  });
  const before = await run.snapshot("running", true);
  assert.equal(before.status.type, "active");
  assert.equal(before.turns.length, 1);
  assert.equal(before.turns[0].id, scene.turnId);
  assert.equal(before.turns[0].status, "inProgress");
  result.turnId = scene.turnId;
  for (let index = 0; index < 3; index++) {
    const page = await run.createPage(index, "running"),
      native = await frame(page, scene.threadId);
    const stop = native.getByRole("button", { name: /^Stop(?:\s|$)/ });
    await stop.waitFor({ state: "visible" });
    assert.equal(await stop.isEnabled(), true);
    result.steps.push({
      step: "official-running-operation-visible",
      index,
      pass: true,
    });
    await save();
  }
  await pages[2].reload({ waitUntil: "domcontentloaded" });
  await (await frame(pages[2], scene.threadId))
    .getByRole("button", { name: /^Stop(?:\s|$)/ })
    .waitFor({ state: "visible" });
  assert.equal((await run.snapshot("running")).status.type, "active");
  result.steps.push({
    step: "original-turn-survives-mobile-refresh",
    pass: true,
  });
  await save();
  await pages[2].screenshot({ path: join(run.output, "mobile-running.png") });
  await run.closePage(0);
  await new Promise((resolve) => setTimeout(resolve, 11000));
  assert.equal((await run.snapshot("running")).status.type, "active");
  assert.equal(
    (await captureProcessIdentity(fixture.service.pid)).startTicks,
    fixture.service.startTicks,
  );
  result.steps.push({
    step: "original-turn-survives-one-browser-close-beyond-host-grace",
    pass: true,
  });
  await save();
  await verifyRefreshSetupProcess(
    fixture,
    process.env.NATIVE_CODEX_REFRESH_BROWSER_MANIFEST,
  );
  process.kill(fixture.setupPid, "SIGUSR2");
  result.modelReleasedByFixture = true;
  await wait(
    () =>
      run.events.find(
        (event) =>
          event.method === "turn/completed" &&
          event.threadId === scene.threadId &&
          event.turnId === scene.turnId,
      ),
    "Original native turn completion missing",
  );
  const after = await run.snapshot("running", true);
  assert.equal(after.turns.length, 1);
  assert.equal(after.turns[0].id, scene.turnId);
  assert.equal(after.turns[0].status, "completed");
  result.steps.push({
    step: "original-native-turn-completes-once",
    pass: true,
  });
  for (const index of [1, 2]) {
    const native = await frame(pages[index], scene.threadId);
    await native.getByText("REFRESH_RUNNING_DONE", { exact: true }).waitFor();
    result.steps.push({ step: "completion-visible", index, pass: true });
    result.uiSettlements.push({
      index,
      ...(await waitForOriginalComposerSettlement({
        frame: native,
        threadId: scene.threadId,
      })),
    });
    result.steps.push({ step: "original-composer-settled", index, pass: true });
  }
  await pages[2].screenshot({ path: join(run.output, "mobile-completed.png") });
  result.passed = result.steps.length === 10 && result.errors.length === 0;
} catch (error) {
  result.errors.push({
    kind: "assertion",
    message: error.message.slice(0, 1000),
  });
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
