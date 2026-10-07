/** Always visible: distinguish agent ownership without relying on hover or color. */
export function SessionAgentBadge({
  kind,
  agentName,
}: {
  kind: "codex" | "cc" | "acp";
  agentName?: string | null;
}) {
  const label =
    kind === "codex"
      ? "Codex"
      : kind === "cc"
        ? "Claude Code"
        : agentName
          ? `ACP · ${agentName}`
          : "ACP";
  return (
    <span
      data-session-agent={kind}
      aria-label={`Agent: ${label}`}
      title={`Agent: ${label}`}
      className="inline-flex max-w-32 shrink-0 truncate rounded border border-border bg-muted/40 px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
    >
      {label}
    </span>
  );
}
