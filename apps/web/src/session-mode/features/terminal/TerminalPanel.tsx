import { Plus, Terminal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@session/components/ui/button";
import { cn } from "@session/lib/utils";
import { useLayoutStore } from "@session/stores";
import { TerminalPane } from "./TerminalPane";

interface TerminalPanelProps {
  isActive: boolean;
}

export function TerminalPanel({ isActive }: TerminalPanelProps) {
  const {
    terminals,
    activeTerminalId,
    addTerminal,
    removeTerminal,
    setActiveTerminalId,
    isRightPanelOpen,
  } = useLayoutStore();

  const tabsRef = useRef<HTMLDivElement>(null);
  const newTerminalRef = useRef<HTMLButtonElement>(null);

  // The right panel collapses to width 0 instead of unmounting, so `isActive`
  // alone stays true while it is closed. Panes must know the panel is really
  // visible, otherwise they fit to a 0x0 container (which wipes the rendered
  // buffer) and never refit/refocus when it reopens.
  const panelVisible = isActive && isRightPanelOpen;

  // Auto-open a first session the first time this tab is used. Mount-only on
  // purpose: re-running when terminals.length drops back to 0 would silently
  // reopen a fresh terminal the moment the user closes the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design, see above
  useEffect(() => {
    // StrictMode replays this effect with the original render snapshot.
    if (useLayoutStore.getState().terminals.length === 0) addTerminal();
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col bg-black text-zinc-100">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-sidebar px-1">
        <div
          ref={tabsRef}
          aria-label="终端列表"
          className="flex min-w-0 flex-1 items-center overflow-x-auto"
        >
          {terminals.map((tab) => (
            <div
              key={tab.id}
              className="group flex shrink-0 items-center border-r border-border"
            >
              <button
                type="button"
                onClick={() => setActiveTerminalId(tab.id)}
                aria-label={`切换到终端 ${tab.label}`}
                aria-pressed={activeTerminalId === tab.id}
                title={tab.label}
                className={cn(
                  "flex h-9 min-w-0 items-center gap-1.5 pl-2 pr-1 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  activeTerminalId === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <Terminal className="size-3.5 shrink-0" />
                <span className="max-w-40 truncate">
                  {tab.label.replace(/^Terminal (\d+)$/, "终端 $1")}
                </span>
              </button>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover:opacity-100 group-focus-within:opacity-100 hover:text-foreground hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`关闭终端 ${tab.label}（结束该终端进程）`}
                title={`关闭终端 ${tab.label}（结束该终端进程）`}
                onClick={(event) => {
                  const restoreFocus =
                    event.currentTarget === document.activeElement;
                  removeTerminal(tab.id);
                  if (restoreFocus)
                    requestAnimationFrame(() => {
                      const next =
                        tabsRef.current?.querySelector<HTMLButtonElement>(
                          'button[aria-pressed="true"]',
                        );
                      (next ?? newTerminalRef.current)?.focus();
                    });
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button
          ref={newTerminalRef}
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => addTerminal()}
          title="新建终端"
          aria-label="新建终端"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="relative flex-1 min-h-0">
        {terminals.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-zinc-400">
            <Terminal className="size-6" aria-hidden="true" />
            <p>暂无终端</p>
            <p className="text-xs">点击上方加号，新建一个终端。</p>
          </div>
        )}
        {terminals.map((tab) => (
          <TerminalPane
            key={tab.id}
            active={panelVisible && tab.id === activeTerminalId}
            panelOpen={panelVisible}
            command={tab.command}
          />
        ))}
      </div>
    </div>
  );
}
