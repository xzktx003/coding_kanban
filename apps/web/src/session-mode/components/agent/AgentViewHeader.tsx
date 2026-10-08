import { isPhone } from "../../hooks/runtime";
import { useAcpStore } from "../../stores/useAcpStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useSessionName } from "../../stores/useSessionNameStore";
import { SessionStatus } from "../common/SessionStatus";
import { RenameSessionButton } from "../common/RenameSessionButton";
import { SessionIdentityTitle, SessionProjectLabel } from "./SessionIdentity";
/** Standard sessions carry identity in their own tabs/cards. ACP has one conversation. */
export function AgentViewHeader() {
  const acp = useAcpStore();
  const cwd = useWorkspaceStore((s) => s.cwd);
  const id = acp.sessionId ? `${acp.agentId}:${acp.sessionId}` : null;
  const title = useSessionName(
    "acp",
    id,
    acp.agentTitle || acp.agentId || "新聊天",
  );
  if (!acp.active || isPhone()) return null;
  return (
    <div className="session-acp-identity session-card-header">
      <div className="session-card-identity">
        <div className="session-identity-main">
          <SessionIdentityTitle kind="acp" title={title} />
        </div>
        <SessionProjectLabel card={{ cwd }} />
      </div>
      {id && (
        <>
          <SessionStatus kind="acp" id={id} />
          <RenameSessionButton kind="acp" id={id} title={title} />
        </>
      )}
    </div>
  );
}
