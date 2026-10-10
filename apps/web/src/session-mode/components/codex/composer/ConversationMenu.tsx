import { useState } from "react";
import { Search, List, Download, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { threadAccess } from "@session/services/apiAdapt/codex";
import { createSideChat } from "@session/services/conversationActions";
import { Button } from "../../ui/button";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { threadWorkflowActions } from "@session/features/thread-workflows/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
export function ConversationMenu({
  threadId,
  title,
}: {
  threadId: string | null;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="当前会话的更多操作"
          title="当前会话的更多操作"
        >
          <NativeComposerIcon name="more" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="session-composer-menu"
        align="end"
        side="top"
        collisionPadding={12}
      >
        <p className="session-conversation-menu-title">{title}</p>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "search")
          }
        >
          <Search size={16} />
          搜索会话
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "users")
          }
        >
          <List size={16} />
          用户消息导航
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "export")
          }
        >
          <Download size={16} />
          导出 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId}
          onSelect={() =>
            threadId && threadWorkflowActions.request(threadId, "copyLink")
          }
        >
          <NativeComposerIcon name="link" />
          复制会话链接
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
          onSelect={() => {
            if (!threadId) return;
            setBusy(true);
            void createSideChat(threadId)
              .catch((e) => toast.error(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <MessagesSquare size={16} />
          侧边聊天
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!threadId || busy}
          onSelect={() => {
            if (!threadId) return;
            setBusy(true);
            void threadAccess(threadId, true)
              .then((access) => {
                toast.message(
                  access.state === "readonly"
                    ? "本项目已释放执行权"
                    : access.reason || "正在检查释放条件",
                );
                window.dispatchEvent(new Event("codex-access-changed"));
              })
              .catch((e) => toast.error(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          释放给其他客户端
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
