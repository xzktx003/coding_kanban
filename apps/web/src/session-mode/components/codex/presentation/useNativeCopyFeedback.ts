import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
} from "react";
import { notifyNativeClipboardError } from "@session/features/native-notifications/nativeClipboardError";
import { writeNativeMarkdownClipboard } from "./nativeMarkdownClipboard";

type CopyTarget = {
  revision: object;
  copied: boolean;
  feedbackMs: number;
  language: string;
  inlineError: boolean;
  setCopied: (value: boolean) => void;
  setPending: (value: boolean) => void;
  setError: (value: boolean) => void;
};
type CopyController = {
  target: CopyTarget | null;
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

// These callbacks live outside a component/render closure. A stalled browser
// clipboard promise may outlive the detail view, but must not keep its payload,
// React setters (and their fibers), or detached DOM alive after cleanup.
function observeCopy(
  write: Promise<void>,
  controller: CopyController,
  revision: object,
  feedback: boolean,
) {
  void write
    .then(
      () => {
        const target = controller.target;
        if (target?.revision !== revision || !feedback) return;
        target.setCopied(true);
        controller.timer = setTimeout(() => {
          if (controller.target?.revision === revision)
            controller.target.setCopied(false);
          controller.timer = undefined;
        }, target.feedbackMs);
      },
      () => {
        const target = controller.target;
        if (target?.revision !== revision) return;
        target.setCopied(false);
        if (target.inlineError) target.setError(true);
        else notifyNativeClipboardError(target.language);
      },
    )
    .finally(() => {
      controller.pending = false;
      controller.target?.setPending(false);
    });
}

function startCopy(
  text: string,
  controller: CopyController,
  revision: object,
  feedback: boolean,
  html?: string,
) {
  const target = controller.target;
  if (
    !target ||
    target.revision !== revision ||
    controller.pending ||
    (feedback && target.copied)
  )
    return;
  controller.pending = true;
  target.setPending(true);
  target.setError(false);
  // Keep the text-bearing synchronous call separate from pending callbacks.
  const write = writeNativeMarkdownClipboard(text, html);
  observeCopy(write, controller, revision, feedback);
}

export function useNativeCopyFeedback(
  dependencies: DependencyList,
  {
    feedbackMs,
    language = "zh",
    inlineError = false,
  }: {
    feedbackMs: number;
    language?: string;
    inlineError?: boolean;
  },
) {
  const [copied, setCopied] = useState(false);
  const [copyPending, setPending] = useState(false);
  const [copyError, setError] = useState(false);
  // The token deliberately contains no source text or owner data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const revision = useMemo(() => ({}), dependencies);
  const controller = useRef<CopyController>({
    target: null,
    pending: false,
    timer: undefined,
  }).current;
  const target: CopyTarget = {
    revision,
    copied,
    feedbackMs,
    language,
    inlineError,
    setCopied,
    setPending,
    setError,
  };
  controller.target = target;
  useLayoutEffect(() => {
    controller.target = target;
    setCopied(false);
    setError(false);
    return () => {
      controller.target = null;
      clearTimeout(controller.timer);
      controller.timer = undefined;
    };
  }, [revision]);
  return {
    copied,
    copyPending,
    copyError,
    copy: (text: string, feedback = true, html?: string) =>
      startCopy(text, controller, revision, feedback, html),
  };
}
