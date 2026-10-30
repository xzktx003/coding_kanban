import { expect, it } from "vitest";
import { threadPermissionParameters } from "./threadPermissionProjection";
import { nativeThreadSettings } from "./nativeThreadSettings";
import type { ThreadModelSettings } from "../stores/useThreadModelStore";
it("projects an explicit named profile without combining a stale sandbox policy or reviewer", () => {
  const settings = {
    permissions: "restricted-team",
    permissionSources: {
      permissions: "local",
      sandboxPolicy: "native",
      approvalPolicy: "native",
      approvalsReviewer: "native",
    },
    sandboxPolicy: { type: "dangerFullAccess" },
    approvalPolicy: "never",
    approvalsReviewer: "user",
  } as unknown as ThreadModelSettings;
  expect(threadPermissionParameters(settings)).toEqual({
    permissions: "restricted-team",
  });
});
it("retains an actual native permissions field but does not turn volatile profile metadata into a persisted permission intent", () => {
  expect(
    nativeThreadSettings({ model: "native", permissions: "team" }),
  ).toMatchObject({ permissions: "team" });
  expect(
    nativeThreadSettings({
      model: "native",
      activePermissionProfile: { id: "team", extends: null },
    }),
  ).not.toHaveProperty("permissions");
});
