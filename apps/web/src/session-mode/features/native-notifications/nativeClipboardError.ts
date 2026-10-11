import { nativeNotifications } from "./service";
// clipboard.copyError from the unchanged VSIX locale dictionaries.
const labels = {
  en: {
    copyError: "Couldn’t copy to clipboard",
    copyErrorDescription:
      "The content wasn’t copied. Try again while ChatGPT is focused",
  },
  zh: {
    copyError: "无法复制到剪贴板",
    copyErrorDescription: "内容未复制。请在 ChatGPT 处于焦点时重试",
  },
  ja: {
    copyError: "クリップボードにコピーできませんでした",
    copyErrorDescription:
      "コンテンツをコピーできませんでした。ChatGPT にフォーカスした状態でもう一度お試しください",
  },
  fr: {
    copyError: "Impossible de copier dans le presse-papiers",
    copyErrorDescription:
      "Le contenu n’a pas été copié. Réessayez lorsque ChatGPT est au premier plan.",
  },
} as const;
export function nativeClipboardErrorLabels(locale: string) {
  return labels[
    locale.startsWith("zh")
      ? "zh"
      : locale.startsWith("ja")
        ? "ja"
        : locale.startsWith("fr")
          ? "fr"
          : "en"
  ];
}
export function notifyNativeClipboardError(locale: string) {
  const labels = nativeClipboardErrorLabels(locale);
  return nativeNotifications.danger(labels.copyError, {
    id: "copy-to-clipboard-error",
    description: labels.copyErrorDescription,
  });
}
