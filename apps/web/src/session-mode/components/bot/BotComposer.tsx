import { ArrowUp, Square } from "lucide-react";
import { useAcpAgents } from "@session/components/acp/useAcpAgents";
import { Button } from "@session/components/ui/button";
import { acpCancel, acpPrompt } from "@session/services/apiAdapt/acp";
import type { Bot } from "@session/services/apiAdapt/bots";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useBotUiStore } from "@session/stores/useBotUiStore";
import { BotKekeInstall } from "./BotKekeInstall";
import { BotToolsMenu } from "./BotToolsMenu";
import { useBotSession } from "./useBotSession";

export function BotComposer({ bot }: { bot: Bot }) {
  const { connectionId, connecting, setRunning, addEntry } = useAcpStore();
  const connectionByBot = useBotUiStore((s) => s.connectionByBot);
  const sessionByBot = useBotUiStore((s) => s.sessionByBot);
  const kekeSpawnFailed = useBotUiStore((s) => s.kekeSpawnFailed);
  const running = useBotUiStore((s) => Boolean(s.runningByBot[bot.id]));
  const savingSettings = useBotUiStore((s) =>
    Boolean(s.savingSettingsByBot[bot.id]),
  );
  const toolsChanged = useBotUiStore((s) => Boolean(s.mcpChangedByBot[bot.id]));
  const setBotRunning = useBotUiStore((s) => s.setBotRunning);
  const { open } = useBotSession();
  const text = useBotUiStore((state) => state.draftByBot[bot.id] ?? "");
  const error = useBotUiStore((state) => state.composerErrorByBot[bot.id]);
  const sending = useBotUiStore((state) => Boolean(state.sendingByBot[bot.id]));
  const stopping = useBotUiStore((state) =>
    Boolean(state.stoppingByBot[bot.id]),
  );
  const setText = (value: string) =>
    useBotUiStore.getState().setDraft(bot.id, value);

  // Scoped to this bot: the ACP store can still hold another agent's live
  // connection from the chat pane, which must not read as this bot's.
  const botConnection = connectionByBot[bot.id];
  const botSession = sessionByBot[bot.id];
  const hasSession = Boolean(botConnection && botSession);

  // `null` while the agent list is still resolving — only an actually resolved
  // list saying keke is missing should replace the composer.
  //
  // `local`, not `available`: with Node installed keke always "resolves", via
  // the `npx -y @milisp/keke@latest` fallback, which re-downloads the package
  // on every spawn and is why a bot could sit there doing nothing instead of
  // offering to install.
  const agents = useAcpAgents();
  const keke = agents?.find((a) => a.id === "keke");
  const kekeMissing =
    !hasSession && ((keke !== undefined && !keke.local) || kekeSpawnFailed);

  if (kekeMissing) return <BotKekeInstall botName={bot.name} />;

  const send = async () => {
    const draft = text;
    const trimmed = draft.trim();
    const ui = useBotUiStore.getState();
    if (
      !trimmed ||
      running ||
      connecting ||
      ui.savingSettingsByBot[bot.id] ||
      ui.sendingByBot[bot.id] ||
      ui.stoppingByBot[bot.id]
    )
      return;
    ui.setSending(bot.id, true);
    ui.setComposerError(bot.id, null);
    let live: { connectionId: string; sessionId: string } | null = null;
    const matchesVisible = () => {
      const current = useAcpStore.getState();
      return Boolean(
        live &&
        useBotUiStore.getState().selectedBotId === bot.id &&
        current.connectionId === live.connectionId &&
        current.sessionId === live.sessionId,
      );
    };
    try {
      live =
        botConnection &&
        botSession &&
        connectionId === botConnection &&
        !toolsChanged
          ? { connectionId: botConnection, sessionId: botSession }
          : await open(bot);
      if (!live) {
        ui.setComposerError(bot.id, "助手连接未就绪，请重试。");
        return;
      }
      if (matchesVisible())
        addEntry({ id: `u-${Date.now()}`, role: "user", text: trimmed });
      setBotRunning(bot.id, true);
      if (matchesVisible()) setRunning(true);
      await acpPrompt(live.connectionId, live.sessionId, trimmed);
      // Clear only the captured draft: typing while the request runs is safe.
      if (useBotUiStore.getState().draftByBot[bot.id] === draft)
        ui.setDraft(bot.id, "");
    } catch (cause) {
      ui.setComposerError(
        bot.id,
        `发送失败：${cause instanceof Error ? cause.message : String(cause)}。草稿已保留，可重试。`,
      );
    } finally {
      ui.setSending(bot.id, false);
      if (
        live &&
        useBotUiStore.getState().connectionByBot[bot.id] ===
          live.connectionId &&
        useBotUiStore.getState().sessionByBot[bot.id] === live.sessionId
      ) {
        setBotRunning(bot.id, false);
        if (matchesVisible()) setRunning(false);
      }
    }
  };

  const stop = async () => {
    const ui = useBotUiStore.getState();
    if (!botConnection || ui.stoppingByBot[bot.id]) return;
    const capturedConnection = botConnection;
    const capturedSession = botSession ?? null;
    ui.setStopping(bot.id, true);
    ui.setComposerError(bot.id, null);
    try {
      await acpCancel(capturedConnection, capturedSession);
      const latest = useBotUiStore.getState();
      const current = useAcpStore.getState();
      if (
        latest.connectionByBot[bot.id] === capturedConnection &&
        (latest.sessionByBot[bot.id] ?? null) === capturedSession
      ) {
        setBotRunning(bot.id, false);
        if (
          latest.selectedBotId === bot.id &&
          current.connectionId === capturedConnection &&
          current.sessionId === capturedSession
        )
          setRunning(false);
      }
    } catch (cause) {
      ui.setComposerError(
        bot.id,
        `停止失败：${cause instanceof Error ? cause.message : String(cause)}。任务状态保留，请重试。`,
      );
    } finally {
      ui.setStopping(bot.id, false);
    }
  };

  return (
    <div className="min-w-0 max-w-full shrink-0 border-t bg-background p-3">
      <div className="flex min-w-0 max-w-full items-end gap-2 rounded-2xl border px-3 py-2">
        <BotToolsMenu key={bot.id} bot={bot} />
        <textarea
          aria-label={`给${bot.name}的消息`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // `isComposing` is what keeps Enter from sending mid-word while an
            // IME is still choosing characters.
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`给${bot.name}发送消息…`}
          rows={1}
          className="min-h-[24px] max-h-40 min-w-0 flex-1 resize-none bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
        />
        {running ? (
          <Button
            aria-label={stopping ? "正在停止" : "停止生成"}
            title={stopping ? "正在停止" : "停止生成"}
            disabled={stopping || !botConnection}
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => void stop()}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            aria-label={sending ? "正在发送" : "发送消息"}
            title={sending ? "正在发送" : "发送消息"}
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            disabled={
              !text.trim() ||
              connecting ||
              savingSettings ||
              sending ||
              stopping
            }
            onClick={() => void send()}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      {stopping && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          正在停止当前助手任务…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 text-xs text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
