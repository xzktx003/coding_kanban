import { nativeNotifications } from "./service";

// composer.addContext.openFilePickerError from the unchanged current VSIX.
export function notifyNativeFilePickerError(locale: string) {
  const title = locale.startsWith("zh")
    ? "无法打开文件选择器"
    : locale.startsWith("ja")
      ? "ファイルピッカーを開けません"
      : locale.startsWith("fr")
        ? "Impossible d’ouvrir le sélecteur de fichiers"
        : "Unable to open file picker";
  return nativeNotifications.danger(title);
}
