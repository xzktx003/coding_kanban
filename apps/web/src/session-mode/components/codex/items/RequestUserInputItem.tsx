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
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";
import { Textarea } from "@session/components/ui/textarea";
import {
  requestUserInputKey,
  useRequestUserInputStore,
  type RequestUserInputRequest,
} from "../stores/useRequestUserInputStore";

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
  const [error, setError] = useState(false);
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
  const select = (value: string, isCustom = false) => {
    setError(false);
    updateDraft(request, {
      answers: { ...draft.answers, [question.id]: [value] },
      custom: { ...draft.custom, [question.id]: isCustom },
    });
  };
  const submit = async () => {
    if (!allAnswered || lock.current) return;
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
      className="session-user-question"
      data-session-user-question
      aria-label={t("userInput.title")}
    >
      <div className="session-user-question-header">
        <span className="flex items-center gap-2 text-sm font-medium">
          <CircleHelp className="size-4 text-muted-foreground" />
          {t("userInput.title")}
        </span>
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
      <fieldset disabled={submitting} className="min-w-0 space-y-3">
        <legend className="mb-3 text-base font-semibold leading-relaxed whitespace-pre-wrap break-words">
          {question.question}
        </legend>
        {options.length > 0 && (
          <div
            role="radiogroup"
            aria-label={question.header || question.question}
            className="space-y-2"
            onKeyDown={(event) => {
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
              if (current < 0 || submitting) return;
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
                tabIndex={custom ? 0 : -1}
                className="session-user-question-option"
                onClick={() => select("", true)}
              >
                <span
                  className="session-user-question-number"
                  aria-hidden="true"
                >
                  {custom ? <Check className="size-4" /> : "+"}
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
              autoComplete="off"
              aria-label={question.question}
              placeholder={t("userInput.enterAnswer")}
              value={text}
              onChange={(e) => select(e.target.value, true)}
              className="min-h-11 text-base"
            />
          ) : (
            <Textarea
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
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={index === 0 || submitting}
          onClick={() => updateDraft(request, { index: index - 1 })}
        >
          <ChevronLeft className="size-4" />
          {t("userInput.previous")}
        </Button>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={submitting}
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
          {last ? (
            <Button
              className="min-h-11"
              disabled={!allAnswered || submitting}
              onClick={() => void submit()}
            >
              {submitting && <LoaderCircle className="size-4 animate-spin" />}
              {t(submitting ? "userInput.submitting" : "userInput.submit")}
            </Button>
          ) : (
            <Button
              className="min-h-11"
              disabled={!answered || submitting}
              onClick={() => updateDraft(request, { index: index + 1 })}
            >
              {t("userInput.next")}
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
