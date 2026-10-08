import { Plug } from "lucide-react";
import openai from "@session/assets/openai.svg";
import claude from "@session/assets/claudecode-color.svg";

/** Agent identity stays visible by shape; full ownership is accessible without color. */
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
      role="img"
      aria-label={`Agent: ${label}`}
      title={`Agent: ${label}`}
      className="session-agent-symbol"
    >
      {kind === "acp" ? (
        <Plug size={14} aria-hidden="true" />
      ) : (
        <img
          src={kind === "codex" ? openai : claude}
          alt=""
          aria-hidden="true"
        />
      )}
    </span>
  );
}
