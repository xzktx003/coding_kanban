import test from "node:test";
import assert from "node:assert/strict";
import { runOriginalApprovalBrowser } from "./fixtures/shared-approval-browser-native.mjs";

test("the original approval browser fixture refuses to launch outside its isolated container", async () => {
  await assert.rejects(runOriginalApprovalBrowser({}), {
    code: "APPROVAL_GUI_ISOLATION_REQUIRED",
  });
});
