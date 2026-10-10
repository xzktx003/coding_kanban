import { useCallback, useContext, useId } from "react";
import { useTranslation } from "react-i18next";
import type {
  ActivityGroup,
  ActivityEntry,
  ActivitySummaryPart,
} from "../thread/activityRows";
import { useTranscriptState, RowStateContext } from "../thread/rowState";
import {
  NativeReadIcon,
  NativeSearchIcon,
  NativeListIcon,
} from "../presentation/NativeExplorationIcons";
import {
  NativePatchIcon,
  NativeMcpIcon,
  NativeWebIcon,
} from "../presentation/NativeActivityIcons";
import {
  NativeCommandTerminal,
  NativeCommandChevron,
} from "../presentation/NativeCommandIcons";
import { NativeCadencedShimmer } from "../presentation/NativeCadencedShimmer";
import { useNativeDeferredHeader } from "../presentation/useNativeDeferredHeader";
import { CommandActionItem } from "./CommandActionItem";
import { EventItem } from "./EventItem";
import { webSearchDetail } from "./NativeActivityItem";
import {
  nativeMcpSourcesSummaryLabel,
  nativeMcpToolLabel,
} from "../presentation/nativeToolSemantics";
import { NativeToolIcon } from "../presentation/NativeToolIcons";
import {
  nativeActiveExploration,
  nativeReadSkill,
} from "../presentation/nativeActiveExploration";
import { nativeDynamicToolLabel } from "../presentation/nativeDynamicToolSemantics";
import {
  NativeDynamicToolIcon,
  hasNativeDynamicToolIcon,
} from "../presentation/NativeDynamicToolIcon";

function ActivityIcon({ entry }: { entry?: ActivityEntry }) {
  if (!entry) return null;
  if (entry.kind === "review")
    return <NativeToolIcon name="review" className="codex-activity-icon" />;
  if (
    entry.kind === "event" &&
    entry.item.type === "dynamicToolCall" &&
    entry.item.namespace === "codex_app" &&
    hasNativeDynamicToolIcon(entry.item.tool)
  )
    return (
      <NativeDynamicToolIcon
        tool={entry.item.tool}
        className="codex-activity-icon"
      />
    );
  const skill = entry.kind === "command" ? nativeReadSkill(entry.action) : null;
  if (skill)
    return (
      <NativeToolIcon
        name={skill.internalKnowledge ? "knowledge" : "skill"}
        className="codex-activity-icon"
      />
    );
  const type = entry.kind === "command" ? entry.action.type : entry.item.type;
  const Icon =
    type === "read"
      ? NativeReadIcon
      : type === "search"
        ? NativeSearchIcon
        : type === "listFiles"
          ? NativeListIcon
          : type === "unknown"
            ? NativeCommandTerminal
            : type === "fileChange"
              ? NativePatchIcon
              : type === "mcpToolCall"
                ? NativeMcpIcon
                : type === "webSearch"
                  ? NativeWebIcon
                  : null;
  return Icon ? <Icon className="codex-activity-icon" /> : null;
}
export function ActivityEntryView({ entry }: { entry: ActivityEntry }) {
  const parent = useContext(RowStateContext);
  const key = `native-entry:${entry.key}`;
  let state = parent?.get(key) as Map<string, unknown> | undefined;
  if (!state) {
    state = new Map();
    parent?.set(key, state);
  }
  return (
    <RowStateContext.Provider value={state}>
      {entry.kind === "command" ? (
        <CommandActionItem action={entry.action} {...entry.source} />
      ) : entry.row.item.kind === "event" ? (
        <EventItem event={entry.row.item.event} context={entry.row.context} />
      ) : null}
    </RowStateContext.Provider>
  );
}
export function NativeActivityGroup({ group }: { group: ActivityGroup }) {
  const { t, i18n } = useTranslation("thread");
  const id = useId();
  const identity = group.entries[0]?.key ?? "";
  const cache = useContext(RowStateContext);
  const scrollKey = `native-activity-scroll:${identity}`;
  const restoreScroll = useCallback(
    (element: HTMLDivElement | null) => {
      if (element)
        element.scrollTop = (cache?.get(scrollKey) as number | undefined) ?? 0;
    },
    [cache, scrollKey],
  );
  const [expanded, setExpanded] = useTranscriptState(
    `native-activity:${identity}`,
    false,
  );
  const active = group.state.kind === "active" ? group.state.entry : undefined;
  let label: string;
  if (group.state.kind === "thinking") label = t("activityGroup.thinking");
  else if (active?.kind === "command") {
    const description = nativeActiveExploration(active.action);
    label = t(`exploration.${description.key}`, {
      ...description.values,
      interpolation: { escapeValue: false },
    });
  } else if (active?.kind === "event") {
    const item = active.item;
    label =
      item.type === "fileChange"
        ? t("activityGroup.editing")
        : item.type === "webSearch"
          ? t("activityGroup.searchingQuery", {
              query: webSearchDetail(item),
              interpolation: { escapeValue: false },
            })
          : item.type === "mcpToolCall"
            ? nativeMcpToolLabel(item, i18n.language, false)
            : item.type === "dynamicToolCall"
              ? nativeDynamicToolLabel(item, i18n.language)
              : t("activityGroup.thinking");
  } else if (active?.kind === "review") label = t("activityGroup.thinking");
  else {
    const segments = group.parts.map((part: ActivitySummaryPart, index) =>
      part.kind === "dynamic"
        ? nativeDynamicToolLabel(
            {
              ...part.item,
              completed: true,
              status:
                part.item.status === "inProgress"
                  ? "completed"
                  : part.item.status,
            },
            i18n.language,
            index === 0,
          )
        : part.kind === "mcpSources"
          ? nativeMcpSourcesSummaryLabel(
              part.sources,
              i18n.language,
              index === 0,
            )
          : part.kind === "mcpNative"
            ? nativeMcpToolLabel(part.item, i18n.language, true, index === 0)
            : t(
                `activityGroup.${part.kind}${index === 0 ? "Leading" : "Following"}`,
                { count: part.count },
              ),
    );
    label = segments.length
      ? new Intl.ListFormat(i18n.language || "en", { type: "unit" }).format(
          segments,
        )
      : t("activityGroup.activity");
  }
  const firstPart = group.parts[0];
  const iconEntry =
    group.state.kind === "thinking"
      ? undefined
      : (active ??
        group.entries.find((entry) =>
          firstPart?.kind === "tools" ||
          firstPart?.kind === "mcpSources" ||
          firstPart?.kind === "mcpNative"
            ? entry.kind === "event" && entry.item.type === "mcpToolCall"
            : firstPart?.kind === "files"
              ? entry.kind === "event" && entry.item.type === "fileChange"
              : firstPart?.kind === "exploration"
                ? entry.kind === "command" && entry.action.type !== "unknown"
                : firstPart?.kind === "commands"
                  ? entry.kind === "command" && entry.action.type === "unknown"
                  : firstPart?.kind === "web"
                    ? entry.kind === "event" && entry.item.type === "webSearch"
                    : firstPart?.kind === "dynamic"
                      ? entry.kind === "event" &&
                        entry.item.type === "dynamicToolCall"
                      : false,
        ));
  const header = useNativeDeferredHeader(
    active ? `active:${active.key}` : group.state.kind,
    <>
      <ActivityIcon entry={iconEntry} />
      <span className="codex-command-summary-label">
        {group.state.kind === "summary" ? (
          label
        ) : (
          <NativeCadencedShimmer>{label}</NativeCadencedShimmer>
        )}
      </span>
    </>,
    group.state.kind === "summary",
  );
  return (
    <div
      className="codex-activity-group codex-native-activity-group"
      data-activity-state={group.state.kind}
      data-thread-id={group.threadId}
      data-turn-id={group.turnId}
    >
      <div className="codex-native-activity-header">
        {group.canExpand && (
          <button
            type="button"
            className="codex-native-activity-disclosure"
            aria-labelledby={id}
            aria-expanded={expanded}
            onClick={() => {
              cache?.delete(scrollKey);
              setExpanded((value) => !value);
            }}
          />
        )}
        <span className="codex-command-summary-content" id={id}>
          {header}
        </span>
        {group.canExpand && (
          <NativeCommandChevron
            className="codex-command-chevron"
            data-expanded={expanded}
          />
        )}
      </div>
      {expanded && group.canExpand && (
        <div
          className="codex-activity-body"
          tabIndex={0}
          ref={restoreScroll}
          onScroll={(event) =>
            cache?.set(scrollKey, event.currentTarget.scrollTop)
          }
        >
          {group.entries
            .filter((entry) => entry.bodyVisible)
            .map((entry) => (
              <ActivityEntryView entry={entry} key={entry.key} />
            ))}
        </div>
      )}
    </div>
  );
}
