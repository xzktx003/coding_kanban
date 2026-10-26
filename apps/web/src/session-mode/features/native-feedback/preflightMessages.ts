import type { FeedbackPreflightReason } from "./preflight";

// Official 26.51007 feedback.disabledByPolicy/Configuration/permissionsUnavailable.
const messages = {
  zh: {
    policy: "你的组织已关闭反馈功能",
    configuration: "反馈功能已在你的配置中关闭",
    unavailable: "未能验证反馈权限。请重试",
  },
  en: {
    policy: "Your organization has turned off feedback",
    configuration: "Feedback is turned off in your configuration",
    unavailable: "Couldn't verify feedback permissions. Please try again",
  },
  ja: {
    policy: "所属する組織によってフィードバックがオフにされています",
    configuration: "設定でフィードバックの送信がオフになっています",
    unavailable:
      "フィードバックの送信権限を確認できませんでした。もう一度お試しください",
  },
  fr: {
    policy: "Votre organisation a désactivé l’envoi de commentaires",
    configuration:
      "L’envoi de commentaires est désactivé dans votre configuration",
    unavailable:
      "Impossible de vérifier les autorisations d’envoi de commentaires. Veuillez réessayer",
  },
};

export function feedbackPreflightMessage(
  language: string,
  reason: FeedbackPreflightReason,
) {
  const locale = language.startsWith("zh")
    ? "zh"
    : language.startsWith("ja")
      ? "ja"
      : language.startsWith("fr")
        ? "fr"
        : "en";
  return messages[locale][reason];
}
