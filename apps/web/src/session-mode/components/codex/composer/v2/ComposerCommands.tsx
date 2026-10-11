import { useState } from "react";
import { toast } from "sonner";
import { useCodexStore } from "../../stores";
import { codexService } from "@session/services/codexService";
import {
  SLASH_COMMANDS,
  slashCommandDescription,
  type SlashCommand,
  type SlashDialog,
} from "../slashCommands";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { ComposerSheet } from "./ComposerSheet";
export function ComposerCommands({
  onClose,
  onOpenDialog,
}: {
  onClose: () => void;
  onOpenDialog: (d: SlashDialog) => void;
}) {
  const [query, setQuery] = useState(""),
    [confirm, setConfirm] = useState<SlashCommand | null>(null),
    [busy, setBusy] = useState(false);
  const currentThreadId = useCodexStore((s) => s.currentThreadId);
  const { collaborationMode } = useThreadModelSettings(currentThreadId);
  const matches = SLASH_COMMANDS.filter((c) =>
    (c.id + " " + c.title + " " + slashCommandDescription(c, collaborationMode))
      .toLowerCase()
      .includes(query.replace(/^\//, "").toLowerCase()),
  );
  async function run(cmd: SlashCommand) {
    setBusy(true);
    try {
      await cmd.run({
        currentThreadId,
        openDialog: onOpenDialog,
        ensureThread: async () =>
          currentThreadId ?? (await codexService.threadStart()).id,
      });
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ComposerSheet
      title={confirm ? `运行 /${confirm.id}？` : "斜杠命令"}
      description="搜索并运行斜杠命令"
      onClose={onClose}
    >
      {confirm ? (
        <>
          <p>{confirm.confirmation}</p>
          <div className="session-context-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              返回命令列表
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(confirm)}
            >
              确认运行
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            className="session-command-search"
            autoFocus
            aria-label="搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索"
          />
          <p className="composer-suggestion-group">斜杠命令</p>
          {matches.map((c) => (
            <button
              type="button"
              className="session-command-row"
              key={c.id}
              disabled={busy}
              onClick={() => (c.confirmation ? setConfirm(c) : void run(c))}
            >
              <strong>/{c.id}</strong>
              <span>{c.title}</span>
              <span>{slashCommandDescription(c, collaborationMode)}</span>
            </button>
          ))}
          {!matches.length && <p>无命令</p>}
        </>
      )}
    </ComposerSheet>
  );
}
