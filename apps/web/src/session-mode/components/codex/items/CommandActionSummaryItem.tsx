import type { CommandActionSource } from "../thread/deriveRenderItems";
import { useTranscriptState } from "../thread/rowState";
import { useTranslation } from "react-i18next";
import type { CommandAction } from "@session/bindings/v2";
import { CommandActionItem } from "./CommandActionItem";
import {
  NativeCommandChevron,
  NativeCommandTerminal,
} from "../presentation/NativeCommandIcons";
import {
  NativeReadIcon,
  NativeSearchIcon,
  NativeListIcon,
} from "../presentation/NativeExplorationIcons";

type Props = {
  actions: CommandAction[];
  actionSources: CommandActionSource[];
  /** Closed slice, not proof that every command succeeded. */ completed: boolean;
};
function ActionIcon({ type }: { type: CommandAction["type"] }) {
  const Icon =
    type === "read"
      ? NativeReadIcon
      : type === "search"
        ? NativeSearchIcon
        : type === "listFiles"
          ? NativeListIcon
          : NativeCommandTerminal;
  return <Icon className="codex-activity-icon" />;
}
export function CommandActionSummaryItem(props: Props) {
  const first = props.actionSources[0];
  const identity = JSON.stringify([
    first?.threadId,
    first?.turnId,
    first?.commandItemId,
  ]);
  return <CommandActionSummary key={identity} {...props} identity={identity} />;
}
function CommandActionSummary({
  actions,
  actionSources,
  completed,
  identity,
}: Props & { identity: string }) {
  const { t } = useTranslation("thread");
  const [expanded, setExpanded] = useTranscriptState(
    `activity:${identity}`,
    false,
  );
  if (!actions.length) return null;
  const sourceFor = (index: number) =>
    actionSources[index] ?? { commandItemId: "", aggregatedOutput: null };
  let activeIndex = -1;
  for (let index = actions.length - 1; index >= 0; index--) {
    if (
      sourceFor(index).status === "inProgress" &&
      !sourceFor(index).termination
    ) {
      activeIndex = index;
      break;
    }
  }
  // Native single finished activity is a direct row, without aggregate disclosure.
  if (
    actions.length === 1 &&
    (activeIndex < 0 || actions[0].type === "unknown")
  )
    return <CommandActionItem action={actions[0]} {...sourceFor(0)} />;
  const active = activeIndex >= 0 ? actions[activeIndex] : null;
  let label: string;
  if (active) {
    const key =
      active.type === "read"
        ? "readingHeader"
        : active.type === "listFiles"
          ? active.path
            ? "listingPathHeader"
            : "listingHeader"
          : active.type === "search"
            ? active.query
              ? active.path
                ? "searchingQueryPathHeader"
                : "searchingQueryHeader"
              : "searchingHeader"
            : null;
    label = key
      ? t(`exploration.${key}`, {
          path:
            active.type === "read"
              ? active.name
              : active.type !== "unknown"
                ? active.path
                : "",
          query: active.type === "search" ? active.query : "",
          interpolation: { escapeValue: false },
        })
      : t("exploration.runningCommand", {
          command: active.command,
          interpolation: { escapeValue: false },
        });
  } else {
    const parts: string[] = [];
    if (
      actions.some(
        (action, i) =>
          action.type !== "unknown" && sourceFor(i).status === "completed",
      )
    )
      parts.push(t("exploration.readFiles"));
    const commandIds = new Set(
      actions.flatMap((action, i) =>
        action.type === "unknown" && sourceFor(i).status === "completed"
          ? [JSON.stringify([sourceFor(i).commandItemId, action.command])]
          : [],
      ),
    );
    if (commandIds.size)
      parts.push(t("exploration.commands", { count: commandIds.size }));
    label = parts.length ? parts.join(" ") : t("activity.ended");
  }
  const iconAction =
    active ??
    actions.find(
      (a, i) => a.type !== "unknown" && sourceFor(i).status === "completed",
    ) ??
    actions[0];
  return (
    <div className="codex-activity-group" data-slice-closed={completed}>
      <button
        className="codex-command-summary codex-activity-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="codex-command-summary-content">
          <ActionIcon type={iconAction.type} />
          <span className="codex-command-summary-label">{label}</span>
        </span>
        <NativeCommandChevron
          className="codex-command-chevron"
          data-expanded={expanded}
        />
      </button>
      {expanded && (
        <div className="codex-activity-body" tabIndex={0}>
          {actions.map((action, index) => {
            const source = sourceFor(index);
            return (
              <CommandActionItem
                key={JSON.stringify([
                  source.threadId,
                  source.turnId,
                  source.commandItemId,
                  action,
                  index,
                ])}
                action={action}
                {...source}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
