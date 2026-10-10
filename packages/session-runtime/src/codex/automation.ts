import { projectRunEvent } from "../core/run-events.js";
import type { AgentRunner } from "../automation/service.js";
import { EventHub } from "../core/events.js";
import { object, type JsonObject } from "../core/json.js";
import type { Rpc } from "./ownership.js";
import { boundedText } from "./protocol.js";

/** Own only the newly created thread; completion is event-driven and cannot free the schedule lock early. */
export function codexRunner(codex: { call: Rpc }, hub: EventHub): AgentRunner {
  return async (spec) => {
    spec.signal.throwIfAborted();
    const stream = hub.subscribe({
      agents: "codex",
      snapshots: false,
      project: projectRunEvent,
      filter: (event) =>
        event.event === "codex:disconnected" ||
        (event.event === "codex:notification" &&
          ["turn/completed", "thread/closed", "error"].includes(
            String(event.payload.method),
          )),
    });
    stream.takeBacklog();
    let threadId: string | undefined, turnId: string | undefined;
    const abort = () => stream.close();
    spec.signal.addEventListener("abort", abort, { once: true });
    try {
      const start: JsonObject = {
        model: spec.model,
        modelProvider: spec.modelProvider,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        config: {
          model_reasoning_effort: "medium",
          model_reasoning_summary: "auto",
          web_search_request: false,
          view_image_tool: true,
          "features.multi_agents": true,
        },
        personality: "friendly",
        experimentalRawEvents: false,
      };
      if (spec.cwd) start.cwd = spec.cwd;
      threadId = boundedText(
        object(object(await codex.call("thread/start", start)).thread).id,
        512,
        "thread.id",
        true,
      );
      spec.onStarted(threadId);
      spec.signal.throwIfAborted();
      const turn: JsonObject = {
        threadId,
        model: spec.model,
        input: [{ type: "text", text: spec.prompt, text_elements: [] }],
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [],
          readOnlyAccess: { type: "fullAccess" },
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        effort: "medium",
        personality: "friendly",
        collaborationMode: {
          mode: "default",
          settings: { model: spec.model, reasoning_effort: "medium" },
        },
      };
      if (spec.cwd) turn.cwd = spec.cwd;
      turnId = boundedText(
        object(object(await codex.call("turn/start", turn)).turn).id,
        512,
        "turn.id",
        true,
      );
      spec.signal.throwIfAborted();
      for await (const event of stream) {
        if (event.event === "codex:disconnected")
          throw new Error(
            "DELIVERY_UNKNOWN: Codex disconnected during automation",
          );
        if (event.event !== "codex:notification") continue;
        const p = object(event.payload.params);
        if (p.threadId !== threadId) continue;
        if (
          event.payload.method === "turn/completed" &&
          object(p.turn).id === turnId
        ) {
          if (object(p.turn).status !== "completed")
            throw new Error(
              "Automation turn ended: " + String(object(p.turn).status),
            );
          return "finished";
        }
        if (
          event.payload.method === "thread/closed" ||
          (event.payload.method === "error" && p.willRetry === false)
        )
          throw new Error("Automation thread ended before completion");
      }
      spec.signal.throwIfAborted();
      throw new Error("Automation event stream closed before completion");
    } finally {
      spec.signal.removeEventListener("abort", abort);
      stream.close();
      if (spec.signal.aborted && threadId && turnId)
        await codex
          .call("turn/interrupt", { threadId, turnId })
          .catch(() => {});
    }
  };
}
