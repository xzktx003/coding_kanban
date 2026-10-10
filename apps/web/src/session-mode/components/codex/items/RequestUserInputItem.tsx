import { rpcKey, useRpcDeliveryStore } from "../stores/rpcLifecycle";
import { RpcDeliveryNotice } from "./RpcDeliveryNotice";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";
import { Textarea } from "@session/components/ui/textarea";
import {
  requestUserInputKey,
  useRequestUserInputStore,
  type RequestUserInputRequest,
} from "../stores/useRequestUserInputStore";
import "./request-native.css";

export function RequestUserInputItem({
  currentThreadId,
}: {
  currentThreadId: string | null;
}) {
  const request = useRequestUserInputStore((state) =>
    state.pendingRequests.find((r) => r.threadId === currentThreadId),
  );
  return request ? (
    <QuestionForm key={requestUserInputKey(request)} request={request} />
  ) : null;
}

function QuestionForm({ request }: { request: RequestUserInputRequest }) {
  const { t } = useTranslation("thread");
  const key = requestUserInputKey(request);
  const delivery = useRpcDeliveryStore((s) => s.states[rpcKey(request)]);
  const draft = useRequestUserInputStore((state) => state.drafts[key]);
  const updateDraft = useRequestUserInputStore((state) => state.updateDraft);
  const respond = useRequestUserInputStore((state) => state.respondToRequest);
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState(false);
  const disabled =
    submitting ||
    delivery?.phase === "submitting" ||
    delivery?.phase === "uncertain";
  useEffect(
    () => () => {
      if (advance.current) clearTimeout(advance.current);
    },
    [key, draft?.index, draft?.collapsed, disabled],
  );
  if (!draft || !request.questions.length) return null;
  const index = Math.min(draft.index, request.questions.length - 1);
  const question = request.questions[index];
  const options = question.options ?? [];
  const custom = !options.length || draft.custom[question.id];
  const answer = draft.answers[question.id];
  const text = answer?.[0] ?? "";
  const answered =
    answer !== undefined && (answer.length === 0 || !!text.trim());
  const allAnswered = request.questions.every((q) => {
    const value = draft.answers[q.id];
    return value !== undefined && (value.length === 0 || !!value[0]?.trim());
  });
  const last = index === request.questions.length - 1;
  const select = (value: string, isCustom = false, restore = false) => {
    if (disabled) return;
    if (advance.current) clearTimeout(advance.current);
    setError(false);
    const selected = restore ? (draft.customText?.[question.id] ?? "") : value;
    updateDraft(request, {
      answers: { ...draft.answers, [question.id]: [selected] },
      custom: { ...draft.custom, [question.id]: isCustom },
      ...(isCustom
        ? { customText: { ...draft.customText, [question.id]: selected } }
        : {}),
    });
    // Native request-panel Jn/we advances one selected choice after 180ms.
    // The last choice waits for explicit submit; stale instances never advance.
    if (!isCustom && !last)
      advance.current = setTimeout(() => {
        const state = useRequestUserInputStore.getState();
        const current = state.drafts[key];
        if (
          state.pendingRequests.includes(request) &&
          current?.index === index &&
          !current.collapsed
        )
          state.updateDraft(request, { index: index + 1 });
      }, 180);
  };
  const submit = async () => {
    if (!allAnswered || lock.current || disabled) return;
    lock.current = true;
    setSubmitting(true);
    setError(false);
    try {
      await respond(
        request.requestId,
        {
          answers: Object.fromEntries(
            request.questions.map((q) => [
              q.id,
              {
                answers: (draft.answers[q.id] ?? []).map((value) =>
                  draft.custom[q.id] || !q.options?.length
                    ? value.trim()
                    : value,
                ),
              },
            ]),
          ),
        },
        request.threadId,
        request,
      );
      // The original running turn resumes through its JSON-RPC response.
      // Never start another turn or change collaboration/approval settings.
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  };
  if (draft.collapsed)
    return (
      <div
        className="session-user-question session-user-question-collapsed"
        data-session-user-question
      >
        <span className="flex items-center gap-2 text-sm">
          <CircleHelp className="size-4" />
          {t("userInput.waiting")}
        </span>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => updateDraft(request, { collapsed: false })}
        >
          {t("userInput.expand")}
        </Button>
      </div>
    );
  return (
    <section
      className="session-user-question codex-request-card"
      data-session-user-question
      aria-label={t("userInput.title")}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.repeat ||
          event.defaultPrevented
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!submitting) updateDraft(request, { collapsed: true });
          return;
        }
        if (disabled) return;
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (last) void submit();
          else if (answered) updateDraft(request, { index: index + 1 });
          return;
        }
        const editing = (event.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        );
        if (
          editing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        if (/^[1-9]$/.test(event.key)) {
          const number = Number(event.key) - 1;
          if (number < options.length) {
            event.preventDefault();
            select(options[number].label);
          } else if (number === options.length && question.isOther) {
            event.preventDefault();
            select("", true, true);
          }
        } else if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          updateDraft(request, { index: index - 1 });
        } else if (event.key === "ArrowRight" && !last) {
          event.preventDefault();
          updateDraft(request, { index: index + 1 });
        }
      }}
    >
      <div className="session-user-question-header">
        <span className="codex-request-question-title">
          {question.question}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={index === 0 || disabled}
          aria-label={t("userInput.previous")}
          onClick={() => updateDraft(request, { index: index - 1 })}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span
          className="ml-auto text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {t("userInput.progress", {
            current: index + 1,
            total: request.questions.length,
          })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          disabled={submitting}
          aria-label={t("userInput.collapse")}
          onClick={() => updateDraft(request, { collapsed: true })}
        >
          <X className="size-4" />
        </Button>
      </div>
      <fieldset
        disabled={disabled}
        aria-label={question.question}
        className="min-w-0 space-y-3"
      >
        {options.length > 0 && (
          <div
            role="radiogroup"
            aria-label={question.header || question.question}
            className="space-y-2"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                !event.repeat &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !disabled
              ) {
                const radio = event.target as HTMLButtonElement;
                if (
                  radio.getAttribute("role") === "radio" &&
                  radio.getAttribute("aria-checked") === "true"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (last) void submit();
                  else updateDraft(request, { index: index + 1 });
                  return;
                }
              }
              if (
                ![
                  "ArrowDown",
                  "ArrowUp",
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                ].includes(event.key)
              )
                return;
              const radios = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="radio"]',
                ),
              ];
              const current = radios.indexOf(event.target as HTMLButtonElement);
              if (
                current < 0 ||
                disabled ||
                event.nativeEvent.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return;
              const target =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? radios.length - 1
                    : (current +
                        (["ArrowDown", "ArrowRight"].includes(event.key)
                          ? 1
                          : -1) +
                        radios.length) %
                      radios.length;
              event.preventDefault();
              radios[target].focus({ preventScroll: true });
              radios[target].click();
            }}
          >
            {options.map((option, number) => {
              const selected = !custom && text === option.label;
              return (
                <button
                  key={`${number}:${option.label}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  tabIndex={
                    selected || (!custom && !text && number === 0) ? 0 : -1
                  }
                  onClick={() => select(option.label)}
                  className="session-user-question-option"
                >
                  <span
                    className="session-user-question-number"
                    aria-hidden="true"
                  >
                    {selected ? <Check className="size-4" /> : number + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground break-words">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {question.isOther && (
              <button
                type="button"
                role="radio"
                aria-checked={!!custom}
                disabled={disabled}
                tabIndex={custom ? 0 : -1}
                className="session-user-question-option"
                onClick={() => select("", true, true)}
              >
                <span
                  className="session-user-question-number"
                  aria-hidden="true"
                >
                  {custom ? <Check className="size-4" /> : options.length + 1}
                </span>
                <span className="text-sm">{t("userInput.custom")}</span>
              </button>
            )}
          </div>
        )}
        {custom &&
          (question.isSecret ? (
            <Input
              type="password"
              disabled={disabled}
              autoComplete="off"
              aria-label={question.question}
              placeholder={t("userInput.enterAnswer")}
              value={text}
              onChange={(e) => select(e.target.value, true)}
              className="min-h-11 text-base"
            />
          ) : (
            <Textarea
              disabled={disabled}
              aria-label={question.question}
              placeholder={t("userInput.enterAnswer")}
              value={text}
              onChange={(e) => select(e.target.value, true)}
              className="min-h-20 text-base"
            />
          ))}
        {answer?.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("userInput.skipped")}
          </p>
        )}
      </fieldset>
      <RpcDeliveryNotice request={request} />
      {error && !delivery && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t("userInput.failed")}
        </p>
      )}
      <div className="session-user-question-footer">
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={disabled}
            onClick={() => {
              updateDraft(request, {
                answers: { ...draft.answers, [question.id]: [] },
                custom: { ...draft.custom, [question.id]: false },
                index: last ? index : index + 1,
              });
            }}
          >
            {t("userInput.skip")}
          </Button>
          {(!options.length || text.trim()) &&
            (last ? (
              <Button
                className="min-h-11"
                disabled={!allAnswered || disabled}
                onClick={() => void submit()}
              >
                {submitting && <LoaderCircle className="size-4 animate-spin" />}
                {t(submitting ? "userInput.submitting" : "userInput.submit")}
              </Button>
            ) : (
              <Button
                className="min-h-11"
                disabled={!answered || disabled}
                onClick={() => updateDraft(request, { index: index + 1 })}
              >
                {t("userInput.next")}
                <ChevronRight className="size-4" />
              </Button>
            ))}
        </div>
      </div>
    </section>
  );
}
