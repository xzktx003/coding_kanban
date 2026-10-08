import { useState } from "react";
import { MoreHorizontal, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { threadAccess } from "@session/services/apiAdapt/codex";
import { createSideChat } from "@session/services/conversationActions";
import { Button } from "../../ui/button";
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
          <MoreHorizontal size={17} />
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
