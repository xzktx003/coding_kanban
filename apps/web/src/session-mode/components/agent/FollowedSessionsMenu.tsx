import { lazy, Suspense, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { OptionalSessionPanel } from "../layout/OptionalSessionPanel";
import {
  useFollowedSessionStates,
  type SessionConnectionState,
} from "../../hooks/useFollowedSessionStates";
const MenuBody = lazy(() =>
  import("./FollowedSessionsMenuBody").then((module) => ({
    default: module.FollowedSessionsMenuBody,
  })),
);

export function FollowedSessionsMenu({
  status = "ready",
  summary = false,
}: {
  status?: SessionConnectionState;
  summary?: boolean;
}) {
  const { rows, counts, complete, questionCount } =
    useFollowedSessionStates(status);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null),
    keyboardOpening = useRef(false);
  const label =
    status === "checking"
      ? "正在检查连接"
      : status !== "ready"
        ? "正在重连"
        : counts.pending
          ? `待确认 ${counts.pending}`
          : questionCount
            ? `待答 ${questionCount}`
            : !complete
              ? "状态待同步"
              : `关注 ${rows.length}`;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onKeyDown={(event) => {
            if (["Enter", " ", "ArrowDown"].includes(event.key))
              keyboardOpening.current = true;
          }}
          onPointerDown={() => {
            keyboardOpening.current = false;
          }}
          className={
            summary ? "session-attention-trigger" : "session-followed-trigger"
          }
          data-pending={counts.pending > 0}
          aria-label={summary ? label : "全部关注会话与窗口组"}
          title={summary ? "查看关注会话状态" : "全部关注会话与窗口组"}
        >
          {summary ? (
            <>
              <span className="session-attention-full">{label}</span>
              <span className="session-attention-compact" aria-hidden="true">
                {status !== "ready"
                  ? "重连"
                  : counts.pending
                    ? `待${counts.pending}`
                    : questionCount
                      ? `答${questionCount}`
                      : !complete
                        ? "同步"
                        : `关注${rows.length}`}
              </span>
            </>
          ) : (
            <ChevronDown size={16} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menuRef}
        align="end"
        sideOffset={6}
        className="session-followed-menu"
      >
        {open && (
          <OptionalSessionPanel
            label="关注会话菜单"
            onClose={() => setOpen(false)}
          >
            <Suspense
              fallback={
                <div role="status" className="session-menu-note">
                  正在加载关注会话…
                </div>
              }
            >
              <MenuBody
                status={status}
                summary={summary}
                menuRef={menuRef}
                focusFirst={keyboardOpening.current}
              />
            </Suspense>
          </OptionalSessionPanel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RunningSessionsSummary({
  status,
}: {
  status: SessionConnectionState;
}) {
  const { counts } = useFollowedSessionStates(status);
  return status === "ready" && counts.running > 0 ? (
    <span className="session-running-summary">
      <Loader2 size={13} />
      运行中 {counts.running}
    </span>
  ) : null;
}
