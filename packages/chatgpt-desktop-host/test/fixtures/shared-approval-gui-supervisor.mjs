import { spawn } from "node:child_process";

// Fixture-only supervisor: retain the private container on every test failure.
// Only the test itself may retire its exact owned daemon after proving task
// completion. This supervisor never signals or replays a native operation.
if (process.env.CHATGPT_APPROVAL_GUI_ISOLATED !== "1")
  throw new Error("isolated fixture required");
const child = spawn(
  process.execPath,
  [
    "--test-isolation=none",
    "--test",
    "/work/packages/chatgpt-desktop-host/test/shared-thread-approval-native.test.mjs",
  ],
  {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const [stream, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
])
  stream.on("data", (chunk) => output.write(chunk));
child.on("error", () => {
  process.stderr.write("PRIVATE_GUI_FIXTURE_RETAINED: test process failed\n");
  setInterval(() => {}, 60000);
});
child.on("exit", (code, signal) => {
  if (code === 0 && signal === null) return;
  process.stderr.write(
    "PRIVATE_GUI_FIXTURE_RETAINED: verify owned task before cleanup\n",
  );
  setInterval(() => {}, 60000);
});
