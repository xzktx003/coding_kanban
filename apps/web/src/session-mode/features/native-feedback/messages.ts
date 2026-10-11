import { nativeClipboardErrorLabels } from "../native-notifications/nativeClipboardError";
// Exact VSIX feedback-upload-cb5de3dd6947 messages and bundled locale dictionaries.
const messages = {
  en: {
    ...nativeClipboardErrorLabels("en"),
    copy: "Copy",
    copied: "Copied",
    close: "Close dialog",
    dismiss: "Dismiss",
    retry: "Retry",
    id: "Feedback ID",
    openIssue: "open a GitHub issue",
    existingIssue: "existing open issue",
    view: "View upload",
    uploadingNoId:
      "Your diagnostics are uploading. Your Feedback ID will appear when the upload finishes",
    failedNoId: "Feedback upload failed. Retry to upload your diagnostics",
    titles: {
      uploading: "Uploading feedback",
      uploaded: "Feedback submitted",
      incomplete: "Feedback submitted",
      disabled: "Feedback is disabled",
      unconfirmed: "Feedback upload not confirmed",
      failed: "Feedback upload failed",
    },
    messages: {
      uploading:
        "Your Feedback ID is ready while diagnostics finish uploading:",
      uploaded:
        "Feedback submitted. If the problem persists, please {openIssueLink} or mention this id in an {existingIssueLink}:",
      incomplete:
        "Your feedback was received, but some diagnostic files could not be uploaded",
      disabled: "Sending feedback is disabled in your configuration",
      unconfirmed:
        "We couldn't confirm whether your feedback was received. It may already have arrived, so sending it again could create a duplicate",
      failed: "The upload failed, but your Feedback ID is unchanged:",
    },
    toasts: {
      uploading: "Uploading feedback",
      uploaded: "Feedback submitted",
      incomplete: "Feedback sent without all diagnostics",
      disabled: "Feedback is disabled",
      unconfirmed: "Feedback upload not confirmed",
      failed: "Feedback upload failed",
    },
  },
  zh: {
    ...nativeClipboardErrorLabels("zh"),
    copy: "复制",
    copied: "已复制",
    close: "关闭对话框",
    dismiss: "关闭",
    retry: "重试",
    id: "反馈 ID",
    openIssue: "提交 GitHub 问题",
    existingIssue: "现有未解决问题",
    view: "查看上传内容",
    uploadingNoId: "正在上传诊断数据。上传完成后将显示你的反馈 ID",
    failedNoId: "反馈上传未成功。请重试上传诊断信息",
    titles: {
      uploading: "正在上传反馈",
      uploaded: "反馈已提交",
      incomplete: "反馈已提交",
      disabled: "反馈已禁用",
      unconfirmed: "反馈上传未确认",
      failed: "反馈上传未成功",
    },
    messages: {
      uploading: "您的反馈 ID 已就绪，诊断信息正在完成上传：",
      uploaded:
        "反馈已提交。如果问题仍然存在，请{openIssueLink}，或在{existingIssueLink}中提及此 ID：",
      incomplete: "已收到你的反馈，但部分诊断文件无法上传",
      disabled: "你的配置已禁用发送反馈",
      unconfirmed:
        "我们无法确认是否已收到你的反馈。反馈可能已送达，重新发送可能会导致重复提交",
      failed: "上传未成功，但你的反馈 ID 保持不变：",
    },
    toasts: {
      uploading: "正在上传反馈",
      uploaded: "反馈已提交",
      incomplete: "反馈已发送，但未包含所有诊断信息",
      disabled: "反馈功能已禁用",
      unconfirmed: "尚未确认反馈是否上传成功",
      failed: "反馈上传失败",
    },
  },
  ja: {
    ...nativeClipboardErrorLabels("ja"),
    copy: "コピーする",
    copied: "コピーしました",
    close: "ダイアログを閉じる",
    dismiss: "閉じる",
    retry: "再試行",
    id: "フィードバック ID",
    openIssue: "GitHub issue を開く",
    existingIssue: "未解決の既存の問題",
    view: "アップロードを表示",
    uploadingNoId:
      "診断情報をアップロードしています。アップロードが完了すると、フィードバック ID が表示されます。",
    failedNoId:
      "フィードバックのアップロードに失敗しました。診断情報のアップロードを再試行してください",
    titles: {
      uploading: "フィードバックをアップロード中",
      uploaded: "フィードバックが送信されました",
      incomplete: "フィードバックが送信されました",
      disabled: "フィードバックは無効になっています",
      unconfirmed: "フィードバックのアップロードを確認できませんでした",
      failed: "フィードバックのアップロードに失敗しました",
    },
    messages: {
      uploading:
        "診断データのアップロードが完了するまでの間、フィードバック ID を確認できます:",
      uploaded:
        "フィードバックを送信しました。問題が解決しない場合は、{openIssueLink}するか、{existingIssueLink}でこの ID に言及してください：",
      incomplete:
        "フィードバックは受け付けましたが、一部の診断ファイルはアップロードできませんでした",
      disabled: "お使いの設定では、フィードバックの送信が無効になっています",
      unconfirmed:
        "フィードバックが受信されたか確認できませんでした。すでに届いている可能性があるため、再送すると重複するおそれがあります",
      failed:
        "アップロードに失敗しましたが、フィードバック ID に変更はありません:",
    },
    toasts: {
      uploading: "フィードバックをアップロードしています",
      uploaded: "フィードバックを送信しました",
      incomplete:
        "フィードバックを送信しましたが、一部の診断情報は送信されませんでした",
      disabled: "フィードバックは無効です",
      unconfirmed: "フィードバックのアップロード完了を確認できませんでした",
      failed: "フィードバックのアップロードに失敗しました",
    },
  },
  fr: {
    ...nativeClipboardErrorLabels("fr"),
    copy: "Copier",
    copied: "Copié",
    close: "Fermer la boîte de dialogue",
    dismiss: "Ignorer",
    retry: "Réessayer",
    id: "ID du feedback",
    openIssue: "créer un problème GitHub",
    existingIssue: "problème ouvert existant",
    view: "Afficher l’envoi",
    uploadingNoId:
      "Votre diagnostic est en cours de chargement. Votre ID de feedback apparaîtra une fois l’envoi terminé.",
    failedNoId:
      "Échec du chargement des commentaires. Réessayez pour charger vos diagnostics",
    titles: {
      uploading: "Envoi des commentaires",
      uploaded: "Commentaires envoyés",
      incomplete: "Commentaires envoyés",
      disabled: "L’envoi de commentaires est désactivé",
      unconfirmed: "Envoi du rapport non confirmé",
      failed: "Échec du chargement des commentaires",
    },
    messages: {
      uploading:
        "Votre ID de feedback est prêt pendant la finalisation de l’envoi des diagnostics :",
      uploaded:
        "Commentaires envoyés. Si le problème persiste, veuillez {openIssueLink} ou mentionner cet identifiant dans un {existingIssueLink}\u00a0:",
      incomplete:
        "Vos commentaires ont bien été reçus, mais certains fichiers de diagnostic n’ont pas pu être téléversés.",
      disabled:
        "L’envoi de commentaires est désactivé dans votre configuration",
      unconfirmed:
        "Nous n’avons pas pu confirmer la réception de votre signalement. Il a peut-être déjà été reçu, donc un nouvel envoi pourrait créer un doublon.",
      failed:
        "Le chargement a échoué, mais votre ID de feedback reste inchangé :",
    },
    toasts: {
      uploading: "Importation des commentaires en cours",
      uploaded: "Commentaires envoyés",
      incomplete: "Commentaires envoyés sans certains fichiers de diagnostic",
      disabled: "L’envoi de commentaires est désactivé",
      unconfirmed: "Importation des commentaires non confirmée",
      failed: "Échec de l'importation des commentaires",
    },
  },
} as const;
export function feedbackUploadLabels(locale: string) {
  return messages[
    locale.startsWith("zh")
      ? "zh"
      : locale.startsWith("ja")
        ? "ja"
        : locale.startsWith("fr")
          ? "fr"
          : "en"
  ];
}
