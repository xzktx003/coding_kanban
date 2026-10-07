import { Bot as BotIcon, Plus } from "lucide-react";
import { Button } from "@session/components/ui/button";
import type { Bot } from "@session/services/apiAdapt/bots";
import { BotAvatar } from "./BotAvatar";

interface BotWelcomeProps {
  bots: Bot[];
  creating: boolean;
  onCreate: () => void;
  onSelect: (bot: Bot) => void;
}

export function BotWelcome({
  bots,
  creating,
  onCreate,
  onSelect,
}: BotWelcomeProps) {
  return (
    <div className="flex min-w-0 max-w-full flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
      <div className="m-auto min-w-0 w-full max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <BotIcon className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {bots.length === 0 ? "创建你的第一个助手" : "选择一个助手开始工作"}
          </h1>
          {bots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              为助手设置职责，然后开始对话。
            </p>
          )}
        </div>
        {bots.length > 0 && (
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {bots.map((item) => (
              <Button
                key={item.id}
                aria-label={`打开助手 ${item.name}`}
                variant="outline"
                className="h-auto min-w-0 w-full max-w-full justify-start gap-3 px-3 py-3 text-left"
                onClick={() => onSelect(item)}
              >
                <BotAvatar bot={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {item.name}
                  </span>
                  {item.title && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.title}
                    </span>
                  )}
                </span>
              </Button>
            ))}
          </div>
        )}
        <div className="flex justify-center">
          <Button
            variant={bots.length === 0 ? "default" : "outline"}
            disabled={creating}
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" />
            {creating
              ? "正在创建…"
              : bots.length === 0
                ? "创建助手"
                : "新建助手"}
          </Button>
        </div>
      </div>
    </div>
  );
}
