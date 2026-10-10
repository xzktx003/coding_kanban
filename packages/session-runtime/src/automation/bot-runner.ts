import type { AcpService } from "../acp/index.js";
import type { AgentRunner } from "./service.js";
/** A refused unattended permission means the routine did not finish its work. */
export function botAutomationRunner(
  acp: Pick<AcpService, "runBotUnattended">,
): AgentRunner {
  return async (spec) => {
    if (!spec.botId) throw new Error("a bot routine needs a bot");
    const report = await acp.runBotUnattended(
      spec.botId,
      spec.prompt,
      spec.cwd,
      true,
      spec.onStarted,
      spec.signal,
    );
    if (report.blocked)
      throw new Error("blocked: a step needed approval the bot does not have");
    return "finished";
  };
}
