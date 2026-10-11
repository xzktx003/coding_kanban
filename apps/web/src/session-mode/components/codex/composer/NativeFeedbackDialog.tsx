import { useEffect, useRef, useState } from "react";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import * as Primitive from "@radix-ui/react-dialog";
import * as Checkbox from "@radix-ui/react-checkbox";
import {
  Dialog,
  DialogPortal,
  DialogTitle,
} from "@session/components/ui/dialog";
import { isSessionInteractionVisible } from "@session/session-dom";
import type { submitSlashFeedback } from "./slashCommands";
import { startFeedbackUpload } from "@session/features/native-feedback/service";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { useComposerSheetHistory } from "./v2/useComposerSheetHistory";
import "./native-feedback.css";

// VSIX feedback-submission-dialog-12f6f595aa07 / feedback-form-dialog-2b9af5a9d324.
// Browser tabs, process diagnostics and document attachments require native host capabilities.
const categories = [
  "bug",
  "bad-result",
  "good-result",
  "safety_check",
  "research-failure",
  "other",
] as const;
const plus =
  "M6 1.59961C6.22091 1.59961 6.40039 1.77909 6.40039 2V5.59961H10C10.2209 5.59961 10.4004 5.77909 10.4004 6C10.4004 6.22091 10.2209 6.40039 10 6.40039H6.40039V10C6.40039 10.2209 6.22091 10.4004 6 10.4004C5.77909 10.4004 5.59961 10.2209 5.59961 10V6.40039H2C1.77909 6.40039 1.59961 6.22091 1.59961 6C1.59961 5.77909 1.77909 5.59961 2 5.59961H5.59961V2C5.59961 1.77909 5.77909 1.59961 6 1.59961Z";
const labels = {
  zh: {
    submitted: "反馈已提交",
    title: "提交反馈",
    options: "反馈选项",
    categories: [
      "错误",
      "结果异常",
      "结果正常",
      "安全检查",
      "研究失败",
      "其他",
    ],
    details: "填写详情（必填）",
    logs: "包含 ChatGPT 诊断日志",
    notice: "你的反馈可用于改进 ChatGPT。",
    more: "了解更多",
    submit: "提交",
    close: "关闭对话框",
    error: "无法提交反馈。请稍后重试。",
  },
  en: {
    submitted: "Feedback submitted",
    title: "Share feedback",
    options: "Feedback options",
    categories: [
      "Bug",
      "Bad result",
      "Good result",
      "Safety check",
      "Research failure",
      "Other",
    ],
    details: "Share details (required)",
    logs: "Include ChatGPT diagnostic logs",
    notice: "Your feedback can be used to improve ChatGPT.",
    more: "Learn more",
    submit: "Submit",
    close: "Close dialog",
    error: "We couldn't submit your feedback. Please try again in a moment",
  },
  ja: {
    submitted: "フィードバックが送信されました",
    title: "フィードバックを共有する",
    options: "フィードバックオプション",
    categories: [
      "バグ",
      "悪い結果",
      "良い結果",
      "安全性チェック",
      "調査の失敗",
      "その他",
    ],
    details: "詳細を入力（必須）",
    logs: "ChatGPT の診断ログを含める",
    notice: "ご意見は ChatGPT の改善に利用されることがあります。",
    more: "詳細を見る",
    submit: "送信",
    close: "ダイアログを閉じる",
    error:
      "フィードバックを送信できませんでした。しばらくしてからもう一度お試しください。",
  },
  fr: {
    submitted: "Commentaires envoyés",
    title: "Donner un feedback",
    options: "Options de feedback",
    categories: [
      "Bug",
      "Mauvais résultat",
      "Bon résultat",
      "Vérification de sécurité",
      "Échec de la recherche",
      "Autre",
    ],
    details: "Fournir des détails (obligatoire)",
    logs: "Inclure les journaux de diagnostic de ChatGPT",
    notice: "Votre avis peut être utilisé pour améliorer ChatGPT.",
    more: "En savoir plus",
    submit: "Envoyer",
    close: "Fermer la boîte de dialogue",
    error:
      "Votre feedback n’a pas pu être envoyé. Veuillez réessayer dans un instant.",
  },
};
export function NativeFeedbackDialog({
  threadId,
  onClose,
  returnFocus,
  owner,
  submitFeedback,
}: {
  threadId: string | null;
  onClose: () => void;
  returnFocus?: () => void;
  owner?: string;
  submitFeedback?: typeof submitSlashFeedback;
}) {
  const { i18n } = useTranslation(),
    text = (i18n.language ?? "zh").startsWith("zh")
      ? labels.zh
      : (i18n.language ?? "").startsWith("ja")
        ? labels.ja
        : (i18n.language ?? "").startsWith("fr")
          ? labels.fr
          : labels.en;
  const [classification, setClassification] = useState<
      (typeof categories)[number] | null
    >(null),
    [details, setDetails] = useState(""),
    [includeLogs, setIncludeLogs] = useState(true),
    [pending, setPending] = useState(false);
  const active = useRef(true),
    lock = useRef(false);
  const restoreFocus = useRef(false);
  const close = () => {
    restoreFocus.current = true;
    onClose();
  };
  const visible = useComposerSheetHistory(close);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const invalid = classification === null || !details.trim();
  if (!visible) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPortal>
        <Primitive.Content
          className="codex-native-feedback"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (restoreFocus.current && isSessionInteractionVisible())
              returnFocus?.();
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (invalid || lock.current || classification === null) return;
              lock.current = true;
              setPending(true);
              try {
                const selection = { classification, includeLogs };
                const result = submitFeedback
                  ? await submitFeedback(threadId, details, selection)
                  : startFeedbackUpload(
                      threadId,
                      details,
                      selection,
                      owner ?? sessionDraftKey("codex", threadId),
                    );
                if (active.current && result !== false) close();
              } catch {
                if (active.current) toast.error(text.error);
              } finally {
                lock.current = false;
                if (active.current) setPending(false);
              }
            }}
          >
            <div className="feedback-section">
              <DialogTitle>{text.title}</DialogTitle>
            </div>
            <div className="feedback-section">
              <div className="feedback-fields">
                <div role="radiogroup" aria-label={text.options}>
                  {categories.map((category, index) => (
                    <button
                      key={category}
                      type="button"
                      role="radio"
                      aria-checked={classification === category}
                      onClick={() => setClassification(category)}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12">
                        <path
                          d={
                            classification === category
                              ? "M9.53532 2.22277C9.66082 2.04108 9.91018 1.99578 10.092 2.12121C10.2737 2.2467 10.319 2.49606 10.1935 2.67785L5.40544 9.61535C5.2377 9.86166 4.88746 9.89564 4.67692 9.68469L1.84098 6.87023C1.68424 6.71471 1.68269 6.46066 1.83805 6.30383C1.99355 6.14723 2.24668 6.14665 2.40348 6.30187L4.96598 8.84386L9.53532 2.22277Z"
                              : plus
                          }
                          fill="currentColor"
                        />
                      </svg>
                      {text.categories[index]}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={5}
                  autoFocus
                  placeholder={text.details}
                  aria-label={text.details}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="feedback-consent">
                  <Checkbox.Root
                    id="codex-feedback-include-logs"
                    checked={includeLogs}
                    onCheckedChange={(v) => setIncludeLogs(v === true)}
                  >
                    <Checkbox.Indicator>
                      <svg width="17" height="17" viewBox="0 0 17 17">
                        <path
                          d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z"
                          fill="currentColor"
                        />
                      </svg>
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <label htmlFor="codex-feedback-include-logs">
                    {text.logs}
                  </label>
                </div>
                <div className="feedback-legal">
                  {text.notice}
                  {text === labels.en || text === labels.fr ? " " : ""}
                  <a
                    href="https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {text.more}
                  </a>
                  {text === labels.zh || text === labels.ja ? "。" : "."}
                </div>
              </div>
            </div>
            <div className="feedback-section">
              <button
                className="feedback-submit"
                type="submit"
                disabled={invalid || pending}
                aria-busy={pending || undefined}
                aria-disabled={pending || invalid}
              >
                {pending && (
                  <span
                    className="feedback-spinner"
                    onAnimationStart={(e) => {
                      for (const animation of e.currentTarget.getAnimations())
                        animation.startTime = 0;
                    }}
                  >
                    <NativeComposerIcon name="spinner" width="12" height="12" />
                  </span>
                )}
                <span>{text.submit}</span>
              </button>
            </div>
          </form>
          <Primitive.Close className="feedback-close" aria-label={text.close}>
            <svg width="21" height="21" viewBox="0 0 21 21">
              <path
                d="M14.6549 5.57307C14.9283 5.2997 15.3718 5.2997 15.6451 5.57307C15.9185 5.84643 15.9185 6.28993 15.6451 6.5633L11.3903 10.8182L15.6451 15.0731L15.735 15.1834C15.9141 15.4551 15.8842 15.8242 15.6451 16.0633C15.4061 16.3024 15.0369 16.3322 14.7653 16.1531L14.6549 16.0633L10.4 11.8084L6.14515 16.0633C5.87178 16.3367 5.42828 16.3367 5.15492 16.0633C4.88155 15.7899 4.88155 15.3464 5.15492 15.0731L9.4098 10.8182L5.15492 6.5633L5.06507 6.45295C4.88597 6.18128 4.91584 5.81214 5.15492 5.57307C5.39399 5.33399 5.76313 5.30413 6.0348 5.48322L6.14515 5.57307L10.4 9.82795L14.6549 5.57307Z"
                fill="currentColor"
              />
            </svg>
          </Primitive.Close>
        </Primitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
