import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openLifecycleFixture } from "./codex-refresh-ui-fixture.mjs";

const run = await openLifecycleFixture(
  "three clients resolve one original native approval after refresh",
);
const { fixture, result, observer, events, pages, frame, wait, save } = run;
const scene = fixture.scenes.approval;
try {
  assert.ok(
    scene.requestId === 0 || scene.requestId,
    "Exact pending native request required",
  );
  await observer.request("thread/resume", {
    threadId: scene.threadId,
    excludeTurns: true,
  });
  const request = await wait(
    () =>
      events.find(
        (event) =>
          event.method === "item/commandExecution/requestApproval" &&
          event.threadId === scene.threadId &&
          event.turnId === scene.turnId,
      ),
    "Original native approval replay missing",
  );
  assert.equal(request.requestId, scene.requestId);
  assert.equal(request.itemId, scene.itemId);
  result.approval = {
    threadId: request.threadId,
    turnId: request.turnId,
    itemId: request.itemId,
    requestId: request.requestId,
  };
  const controls = [];
  for (let index = 0; index < 3; index++) {
    const page = await run.createPage(index);
    const native = await frame(page, scene.threadId);
    const allow = native.getByRole("button", { name: /^Allow once/ });
    await allow.waitFor({ state: "visible" });
    assert.equal(await allow.isEnabled(), true);
    assert.equal(
      await page
        .getByText("请在原生界面中完成官方引导", { exact: true })
        .count(),
      0,
    );
    controls[index] = allow;
    result.steps.push({ step: "native-approval-visible", index, pass: true });
    await save();
  }
  await pages[0].reload({ waitUntil: "domcontentloaded" });
  controls[0] = (await frame(pages[0], scene.threadId)).getByRole("button", {
    name: /^Allow once/,
  });
  await controls[0].waitFor({ state: "visible" });
  assert.equal((await run.snapshot("approval")).status.type, "active");
  assert.equal(
    events.some(
      (event) =>
        event.method === "serverRequest/resolved" &&
        event.requestId === request.requestId,
    ),
    false,
  );
  result.steps.push({
    step: "original-approval-survives-one-client-refresh",
    pass: true,
  });
  await save();
  await pages[2].screenshot({ path: join(run.output, "mobile-pending.png") });
  const outcomes = await Promise.allSettled(
    controls.map((button, index) =>
      index === 2
        ? button.tap({ timeout: 2500 })
        : button.click({ timeout: 2500 }),
    ),
  );
  result.clickOutcomes = outcomes.map((outcome, index) => ({
    index,
    status: outcome.status,
  }));
  assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
  await wait(
    () =>
      events.find(
        (event) =>
          event.method === "serverRequest/resolved" &&
          event.requestId === request.requestId,
      ),
    "Exact native approval did not resolve",
  );
  await wait(
    async () => (await run.snapshot("approval")).status.type === "idle",
    "Native approval turn did not complete",
  );
  const history = await run.snapshot("approval", true);
  assert.equal(history.turns.length, 1);
  assert.equal(history.turns[0].id, scene.turnId);
  assert.equal(history.turns[0].status, "completed");
  const command = history.turns[0].items.find(
    (item) => item.id === request.itemId && item.type === "commandExecution",
  );
  assert.ok(command);
  assert.equal(command.status, "completed");
  assert.equal(command.exitCode, 0);
  assert.equal(
    await readFile(join(fixture.project, "approval-count.txt"), "utf8"),
    "APPROVED\n",
  );
  for (let index = 0; index < 3; index++) {
    const native = await frame(pages[index], scene.threadId);
    await native.getByText("REFRESH_APPROVAL_DONE", { exact: true }).waitFor();
    assert.equal(
      await native.getByRole("button", { name: /^Allow once/ }).count(),
      0,
    );
    result.steps.push({ step: "native-resolution-visible", index, pass: true });
  }
  result.executionCount = 1;
  result.completedTurnId = history.turns[0].id;
  result.steps.push({
    step: "one-native-command-execution-one-original-turn",
    pass: true,
  });
  result.passed = result.steps.length === 8 && result.errors.length === 0;
} catch (error) {
  result.errors.push({
    kind: "assertion",
    message: error.message.slice(0, 1000),
  });
  for (let index = 0; index < pages.length; index++)
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
    clickOutcomes: result.clickOutcomes,
  }),
);
if (!result.passed) process.exitCode = 1;
