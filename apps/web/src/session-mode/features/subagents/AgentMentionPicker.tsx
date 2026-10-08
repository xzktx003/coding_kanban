import { useEffect, useState } from "react";
import { appendDraft } from "@session/stores/useSessionDraftStore";
import { validAgentMention } from "@agent-orchestrator/shared";
import { useSubagentFamily } from "./hooks";
import { subagentService } from "./service";
import { mentionDrafts, useAgentMentionDrafts } from "./mentions";
const EMPTY: never[] = [];
export function AgentMentionPicker({
  root,
  owner,
}: {
  root: string | null;
  owner: string;
}) {
  const [open, setOpen] = useState(false),
    [roles, setRoles] = useState<{ name: string; description: string }[]>([]),
    [error, setError] = useState("");
  const { rows } = useSubagentFamily(root);
  const selected = useAgentMentionDrafts((s) => s.drafts[owner] ?? EMPTY);
  useEffect(() => {
    setOpen(false);
    setRoles([]);
    setError("");
  }, [root, owner]);
  useEffect(() => {
    if (!open || !root) return;
    let current = true;
    subagentService
      .roles(root)
      .then((r) => {
        if (current) {
          setRoles(r.roles);
          setError("");
        }
      })
      .catch((e) => {
        if (current) setError(String(e));
      });
    return () => {
      current = false;
    };
  }, [open, root]);
  const insert = (name: string, path: string) => {
    if (!validAgentMention({ name, path })) return;
    mentionDrafts.add(owner, { name, path });
    appendDraft(owner, `@${name} `);
    setOpen(false);
  };
  return (
    <div className="session-agent-mentions">
      <button
        type="button"
        aria-expanded={open}
        aria-label="引用子 Agent 或配置角色"
        onClick={() => setOpen(!open)}
      >
        {" "}
        @{selected.length || ""}
      </button>
      {open &&
        selected.map((m) => (
          <span className="session-mention-chip" key={m.path}>
            @{m.name}
            <button
              type="button"
              aria-label={`移除引用 ${m.name}`}
              onClick={() => mentionDrafts.clear(owner, [m])}
            >
              ×
            </button>
          </span>
        ))}
      {open && (
        <div
          className="session-agent-mention-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <strong>已有子 Agent</strong>
          {rows
            .filter((r) => r.node.thread.canAcceptDirectInput === true)
            .map((r) => (
              <button
                type="button"
                key={r.node.thread.id}
                onClick={() =>
                  insert(
                    r.node.thread.agentNickname ??
                      r.node.thread.name ??
                      r.node.thread.id.slice(0, 8),
                    `agent://${r.node.thread.id}`,
                  )
                }
              >
                {r.node.thread.agentNickname ??
                  r.node.thread.name ??
                  r.node.thread.id.slice(0, 8)}{" "}
                · {r.node.objective ?? r.node.thread.preview}
              </button>
            ))}
          {!rows.some((r) => r.node.thread.canAcceptDirectInput === true) && (
            <small>
              当前没有可直接引用的子 Agent；可在子任务详情中让主 Agent 跟进。
            </small>
          )}
          <strong>已配置角色</strong>
          {roles.map((r) => (
            <button
              type="button"
              key={r.name}
              onClick={() => insert(r.name, `subagent://${r.name}`)}
            >
              {r.name}
              <small>{r.description}</small>
            </button>
          ))}
          {!roles.length && (
            <small>
              {error ||
                (root
                  ? "没有已配置角色；也可以在主会话中用自然语言提出分工。"
                  : "先建立主会话，再读取其项目角色配置。")}
            </small>
          )}
        </div>
      )}
    </div>
  );
}
