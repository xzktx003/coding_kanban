import { SubagentEvent } from "@session/features/subagents/SubagentEvent";
import { useMemo } from "react";
import {
  readQuestions,
  repliesFromContent,
} from "@session/features/async-questions/model";
import {
  QuestionMessage,
  AnswerMessage,
} from "@session/features/async-questions/QuestionMessage";
import { useTranscriptState } from "../thread/rowState";
import { useTranslation } from "react-i18next";
import type { ServerNotification } from "@session/bindings";
import type { FileUpdateChange } from "@session/bindings/v2";
import { Badge } from "@session/components/ui/badge";
import { AgentMessageItem } from "./AgentMessageItem";
import {
  aggregateFileChanges,
  aggregateTurnChangesFromContext,
  completedTurnChanges,
  getChangeCounts,
  getDiffViewerProps,
  type RenderEventContext,
} from "./fileChangeLogic";
import { IndividualFileChanges } from "./IndividualFileChanges";
import { McpToolCallItem } from "./McpToolCallItem";
import { ThreadFileChangesSummary } from "./ThreadFileChangesSummary";
import { TurnPlan } from "./TurnPlan";
import { TurnFailureNotice } from "./TurnFailureNotice";
import { EditableUserMessageItem } from "./UserMessageItem";
import { PlanContentItem } from "./PlanContentItem";
import { ReasoningSummaryItem } from "./ReasoningSummaryItem";
import { NativeActivityItem } from "./NativeActivityItem";
import { CodexContentOwner } from "../presentation/ownerContext";
import { nativeToolJson } from "../presentation/nativeToolSemantics";
import { isTranscriptMetadataOnly } from "../presentation/transcriptMetadata";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import { NativeHookPromptItem } from "./NativeHookStats";
import {
  NativeAutomaticReviewItem,
  NativeModelReroutedNotice,
} from "./NativeSystemNotice";

type CollapsedJsonItemProps = {
  label: string;
  value: unknown;
};

const CollapsedJsonItem = ({ label, value }: CollapsedJsonItemProps) => {
  const [expanded, setExpanded] = useTranscriptState("json", false);
  const text = useMemo(
    () => (expanded ? nativeToolJson(value) : ""),
    [expanded, value],
  );
  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="overflow-hidden rounded-md border bg-muted/20"
    >
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </summary>
      {expanded && (
        <pre className="max-h-64 overflow-auto border-t bg-background/80 p-2">
          <code>{text}</code>
        </pre>
      )}
    </details>
  );
};

const getRollbackTurnsForTurn = (
  context: RenderEventContext | undefined,
  turnId: string,
): number => {
  if (context?.rollbackTurns !== undefined) return context.rollbackTurns;
  const events = context?.events;
  const eventIndex = context?.eventIndex;
  if (!events || eventIndex === undefined || eventIndex < 0) return 1;

  const laterTurnIds = new Set<string>();
  for (let i = eventIndex + 1; i < events.length; i += 1) {
    const candidate = events[i];
    let candidateTurnId: string | undefined;

    if (
      (candidate.method === "item/started" ||
        candidate.method === "item/completed") &&
      candidate.params?.turnId
    ) {
      candidateTurnId = candidate.params.turnId;
    } else if (candidate.method === "turn/completed") {
      candidateTurnId = candidate.params?.turn?.id;
    }

    if (candidateTurnId && candidateTurnId !== turnId) {
      laterTurnIds.add(candidateTurnId);
    }
  }

  return laterTurnIds.size + 1;
};

type EventItemProps = {
  event: ServerNotification;
  context?: RenderEventContext;
  nativeEditUser?: boolean;
  hookRuns?: readonly HookRunSummary[];
};

export const EventItem = (props: EventItemProps) => {
  const params = props.event.params as { threadId?: unknown };
  return typeof params.threadId === "string" ? (
    <CodexContentOwner.Provider value={params.threadId}>
      <EventItemBody {...props} />
    </CodexContentOwner.Provider>
  ) : (
    <EventItemBody {...props} />
  );
};

const EventItemBody = ({
  event,
  context,
  nativeEditUser = false,
  hookRuns,
}: EventItemProps) => {
  const { t } = useTranslation("thread");
  const fileChangeMap = {
    add: t("fileChanges.created"),
    delete: t("fileChanges.deleted"),
    update: t("fileChanges.edited"),
  };

  const renderFileChanges = (
    changes: FileUpdateChange[],
    metadataOnly = false,
  ) => (
    <IndividualFileChanges
      changes={
        metadataOnly
          ? changes.map((change) => ({
              ...change,
              transcriptMetadataOnly: true,
            }))
          : changes
      }
      fileChangeMap={fileChangeMap}
      getChangeCounts={getChangeCounts}
      getDiffViewerProps={getDiffViewerProps}
    />
  );
  switch (event.method) {
    case "model/rerouted":
      return <NativeModelReroutedNotice value={event.params} />;
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
      return (
        <NativeAutomaticReviewItem
          value={event.params}
          termination={context?.renderTermination}
        />
      );
    case "guardianWarning":
      return (
        <p className="codex-native-notice" role="status">
          {event.params.message}
        </p>
      );
    case "error":
      return (
        <TurnFailureNotice
          message={event.params.error.message}
          willRetry={event.params.willRetry}
        />
      );
    case "warning":
      return (
        <p className="text-yellow-600 dark:text-yellow-400 font-medium">
          {event.params.message}
        </p>
      );
    case "item/started": {
      const { item: startedItem } = event.params;
      switch (startedItem.type) {
        case "userMessage": {
          const replies = repliesFromContent(startedItem.content);
          if (replies) return <AnswerMessage replies={replies} />;
          const threadId = event.params.threadId;
          const turnId = event.params.turnId;
          const rollbackTurns = getRollbackTurnsForTurn(context, turnId);

          return (
            <EditableUserMessageItem
              content={startedItem.content}
              itemId={startedItem.id}
              nativeEdit={nativeEditUser}
              hookRuns={hookRuns}
              threadId={threadId}
              turnId={turnId}
              rollbackTurns={rollbackTurns}
            />
          );
        }
        case "collabAgentToolCall":
        case "subAgentActivity":
          return (
            <SubagentEvent root={event.params.threadId} item={startedItem} />
          );
        case "commandExecution":
          return null;
        case "hookPrompt":
          return (
            <NativeHookPromptItem
              fragments={startedItem.fragments}
              runs={hookRuns}
            />
          );
        case "reasoning":
          return (
            <ReasoningSummaryItem
              summary={startedItem.summary}
              running={!context?.renderTermination}
            />
          );
        case "plan":
          return (
            <PlanContentItem
              text={startedItem.text}
              threadId={event.params.threadId}
              turnId={event.params.turnId}
              running={!context?.renderTermination}
            />
          );
        case "mcpToolCall":
          return (
            <McpToolCallItem
              item={startedItem}
              termination={context?.renderTermination}
            />
          );
        case "webSearch":
        case "imageView":
        case "imageGeneration":
        case "contextCompaction":
        case "dynamicToolCall":
          return (
            <NativeActivityItem
              item={startedItem}
              running
              startedAtMs={event.params.startedAtMs}
              termination={context?.renderTermination}
            />
          );
        case "agentMessage":
        case "enteredReviewMode":
        case "exitedReviewMode":
        case "sleep":
          return null;
        case "fileChange":
          return renderFileChanges(
            startedItem.changes,
            isTranscriptMetadataOnly(startedItem),
          );
        default:
          return (
            <CollapsedJsonItem
              label={(startedItem as { type: string }).type}
              value={startedItem}
            />
          );
      }
    }
    case "item/completed": {
      const { item } = event.params;
      switch (item.type) {
        case "agentMessage":
          if (readQuestions(item).length)
            return (
              <QuestionMessage
                threadId={event.params.threadId}
                sourceId={item.id}
              />
            );
          return item.text.trim() ? (
            <AgentMessageItem
              text={item.text}
              itemId={item.id}
              threadId={event.params.threadId}
              turnId={event.params.turnId}
              phase={item.phase}
              memoryCitation={item.memoryCitation}
              hookRuns={hookRuns}
            />
          ) : null;
        case "userMessage":
        case "commandExecution":
          return null;
        case "hookPrompt":
          return (
            <NativeHookPromptItem fragments={item.fragments} runs={hookRuns} />
          );
        case "fileChange":
          return renderFileChanges(
            item.changes,
            isTranscriptMetadataOnly(item),
          );
        case "enteredReviewMode":
        case "exitedReviewMode":
        case "reasoning":
          return item.type === "reasoning" ? (
            <ReasoningSummaryItem summary={item.summary} />
          ) : null;
        case "plan":
          return (
            <PlanContentItem
              text={item.text}
              threadId={event.params.threadId}
              turnId={event.params.turnId}
            />
          );
        case "collabAgentToolCall":
        case "subAgentActivity":
          return <SubagentEvent root={event.params.threadId} item={item} />;
        case "mcpToolCall":
          return <McpToolCallItem item={item} />;
        case "webSearch":
        case "imageView":
        case "imageGeneration":
        case "contextCompaction":
        case "dynamicToolCall":
        case "sleep":
          return <NativeActivityItem item={item} />;
        default:
          return (
            <CollapsedJsonItem
              label={(item as { type: string }).type}
              value={item}
            />
          );
      }
    }
    case "turn/completed": {
      const { changes: aggregatedChanges, batches } = completedTurnChanges(
        event.params.threadId,
        event.params.turn.id,
        event.params.turn.items,
        context,
      );

      const alreadyShown = context?.events
        ?.slice(0, context.eventIndex)
        .some(
          (candidate) =>
            candidate.method === "error" &&
            candidate.params.threadId === event.params.threadId &&
            candidate.params.turnId === event.params.turn.id &&
            !candidate.params.willRetry,
        );
      const failed = event.params.turn.status === "failed" && !alreadyShown;
      const interrupted = event.params.turn.status === "interrupted";
      if (aggregatedChanges.length === 0 && !failed && !interrupted)
        return null;

      return (
        <div className="space-y-2">
          {interrupted && <Badge variant="destructive">已中断</Badge>}
          {failed && (
            <TurnFailureNotice message={event.params.turn.error?.message} />
          )}
          {aggregatedChanges.length > 0 && (
            <ThreadFileChangesSummary
              changes={aggregatedChanges}
              threadId={event.params.threadId}
              turnId={event.params.turn.id}
              batches={batches}
            />
          )}
        </div>
      );
    }
    case "turn/plan/updated":
      return (
        <TurnPlan
          plan={event.params.plan}
          explanation={event.params.explanation}
        />
      );
    case "item/agentMessage/delta":
      return event.params.delta.trim() ? (
        <AgentMessageItem
          text={event.params.delta}
          threadId={event.params.threadId}
          turnId={event.params.turnId}
          itemId={event.params.itemId}
          streaming={!context?.renderTermination}
          hookRuns={hookRuns}
        />
      ) : null;
    case "item/plan/delta":
      return (
        <PlanContentItem
          text={event.params.delta}
          threadId={event.params.threadId}
          turnId={event.params.turnId}
          running={!context?.renderTermination}
        />
      );
    case "item/reasoning/textDelta":
      return null;
    case "item/fileChange/outputDelta":
      return null;
    case "item/commandExecution/terminalInteraction":
      return (
        <div className="rounded-md border border-slate-300/80 bg-slate-100/40 px-2 py-1 text-xs text-slate-700">
          <span className="mr-2 font-medium">terminal input</span>
          <code className="whitespace-pre-wrap break-all">
            {event.params.stdin}
          </code>
        </div>
      );
    case "thread/name/updated":
    case "thread/started":
    case "thread/tokenUsage/updated":
    case "thread/status/changed":
    case "thread/goal/updated":
    case "thread/goal/cleared":
    case "turn/diff/updated":
    case "rawResponseItem/completed":
    case "item/commandExecution/outputDelta":
    case "turn/started":
    case "mcpServer/startupStatus/updated":
    case "hook/started":
    case "hook/completed":
      return null;

    default:
      return <CollapsedJsonItem label={event.method} value={event.params} />;
  }
};
