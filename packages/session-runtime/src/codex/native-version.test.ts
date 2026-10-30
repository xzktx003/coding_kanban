import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeVersionFromUserAgent,
  nativeRealtimeWebRtcSupported,
} from "./native-version.js";

test("native initialize version is independent of the official client's display name", () => {
  assert.equal(
    nativeVersionFromUserAgent(
      "codexia/0.165.0 (Linux) unknown (codexia; 0.1.0)",
    ),
    "0.165.0",
  );
  assert.equal(
    nativeVersionFromUserAgent(
      "Codex Desktop/0.163.0 (Linux) unknown (codexia; 0.1.0)",
    ),
    "0.163.0",
  );
});
test("unknown or misleading version text never grants native capabilities", () => {
  for (const value of [
    undefined,
    null,
    163,
    "codexia",
    "codexia/0.163.0junk",
    "platform (codexia/0.165.0)",
    "/0.163.0",
    "\nCodex Desktop/0.163.0",
  ])
    assert.equal(nativeVersionFromUserAgent(value), undefined);
  for (const value of [
    undefined,
    "0.164.0",
    "0.166.0",
    "0.163.0-alpha.1",
    "0.165.0-extra",
  ])
    assert.equal(nativeRealtimeWebRtcSupported(value), false);
});
test("only separately verified exact native releases enable realtime WebRTC", () => {
  assert.equal(nativeRealtimeWebRtcSupported("0.163.0"), true);
  assert.equal(nativeRealtimeWebRtcSupported("0.165.0"), true);
});
