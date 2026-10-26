import { expect, it } from "vitest";
import { parseFeedbackPreflight } from "./preflight";
import { feedbackPreflightMessage } from "./preflightMessages";

const allowed = {
  reason: null,
  runtimeInstance: "fixture-runtime",
  provenance: {
    config: "default",
    requirements: "unavailable",
    account: "native",
    workspace: "not-required",
  },
};

it("accepts an authoritative complete DTO without inferring policy from provenance or absent private fields", () => {
  expect(parseFeedbackPreflight(allowed)).toEqual(allowed);
});

it.each([
  null,
  [],
  {},
  { ...allowed, token: "fixture-unexpected-private-field" },
  { ...allowed, runtimeInstance: "" },
  { ...allowed, runtimeInstance: "fixture\nother" },
  { ...allowed, reason: true },
  { ...allowed, provenance: { ...allowed.provenance, nativeRaw: {} } },
  {
    ...allowed,
    provenance: {
      config: "default",
      account: "native",
      workspace: "not-required",
    },
  },
  { ...allowed, provenance: { ...allowed.provenance, workspace: "owned" } },
])(
  "rejects incomplete, unsafe or unsupported preflight response %#",
  (value) => {
    expect(() => parseFeedbackPreflight(value)).toThrow(
      "Feedback permissions are unavailable",
    );
  },
);

it.each([
  [
    "zh-CN",
    "你的组织已关闭反馈功能",
    "反馈功能已在你的配置中关闭",
    "未能验证反馈权限。请重试",
  ],
  [
    "en-US",
    "Your organization has turned off feedback",
    "Feedback is turned off in your configuration",
    "Couldn't verify feedback permissions. Please try again",
  ],
  [
    "ja-JP",
    "所属する組織によってフィードバックがオフにされています",
    "設定でフィードバックの送信がオフになっています",
    "フィードバックの送信権限を確認できませんでした。もう一度お試しください",
  ],
  [
    "fr-FR",
    "Votre organisation a désactivé l’envoi de commentaires",
    "L’envoi de commentaires est désactivé dans votre configuration",
    "Impossible de vérifier les autorisations d’envoi de commentaires. Veuillez réessayer",
  ],
])(
  "uses the original %s info messages",
  (language, policy, configuration, unavailable) => {
    expect(feedbackPreflightMessage(language, "policy")).toBe(policy);
    expect(feedbackPreflightMessage(language, "configuration")).toBe(
      configuration,
    );
    expect(feedbackPreflightMessage(language, "unavailable")).toBe(unavailable);
  },
);

it.each(["x".repeat(256), "é".repeat(128)])(
  "accepts the shared 256 UTF-8-byte runtime identity boundary %#",
  (runtimeInstance) => {
    expect(
      parseFeedbackPreflight({ ...allowed, runtimeInstance }).runtimeInstance,
    ).toBe(runtimeInstance);
  },
);
it.each(["x".repeat(257), "é".repeat(129)])(
  "rejects runtime identities above the shared UTF-8-byte boundary %#",
  (runtimeInstance) => {
    expect(() =>
      parseFeedbackPreflight({ ...allowed, runtimeInstance }),
    ).toThrow("Feedback permissions are unavailable");
  },
);
