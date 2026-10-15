// Deterministic loopback Responses provider for real native lifecycle tests.
// It never reads login data or calls an external model.
import { createServer } from "node:http";

export async function createRefreshModelFixture() {
  let count = 0;
  const held = new Set();
  const calls = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    let chunks = [],
      size = 0,
      body;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400).end();
      return;
    }
    chunks = null;
    const input = Array.isArray(body.input) ? body.input : [];
    const lastUser = input.findLastIndex((item) => item.role === "user");
    const marker = JSON.stringify(input[lastUser] ?? {});
    const afterTool = input
      .slice(lastUser + 1)
      .some((item) => item.type === "function_call_output");
    const mode = marker.includes("REFRESH_APPROVAL")
      ? "approval"
      : marker.includes("REFRESH_BACKGROUND")
        ? "background"
        : marker.includes("REFRESH_RUNNING")
          ? "running"
          : "idle";
    body = null;
    const sequence = ++count,
      id = `refresh-fixture-${sequence}`;
    calls.push({ sequence, mode, afterTool });
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    });
    const send = (event) => {
      if (!response.destroyed)
        response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: "response.created", response: { id } });
    if (mode === "running") {
      let release;
      await new Promise((resolve) => {
        release = resolve;
        held.add(release);
        response.once("close", release);
      });
      held.delete(release);
      response.off("close", release);
    }
    const item =
      mode === "approval" && !afterTool
        ? {
            type: "function_call",
            id: `${id}-approval`,
            call_id: `${id}-approval`,
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "printf 'APPROVED\\n' >> approval-count.txt",
              sandbox_permissions: "require_escalated",
              justification: "Private native refresh approval acceptance",
              max_output_tokens: 64,
            }),
          }
        : mode === "background" && !afterTool
          ? {
              type: "function_call",
              id: `${id}-background`,
              call_id: `${id}-background`,
              name: "exec_command",
              arguments: JSON.stringify({
                cmd: "sleep 4; printf BACKGROUND_DONE > background-proof.txt",
                yield_time_ms: 1,
                max_output_tokens: 64,
              }),
            }
          : {
              type: "message",
              id: `${id}-message`,
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: `REFRESH_${mode.toUpperCase()}_DONE`,
                },
              ],
            };
    send({ type: "response.output_item.done", item });
    send({
      type: "response.completed",
      response: {
        id,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    calls,
    release() {
      for (const resolve of held) resolve();
    },
    async close() {
      for (const resolve of held) resolve();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
