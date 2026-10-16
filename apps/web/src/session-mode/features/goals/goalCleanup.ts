import { toast } from "sonner";
import type { GoalMaterialization } from "./goalMaterialization";

let cleanupNotice = 0;

/** Only for a confirmed rejection, before any accepted turn references the files. */
export async function cleanupRejectedGoal(
  materialized: GoalMaterialization,
  labels: { cleanupError: string; cleanupRetry: string },
): Promise<void> {
  const cleanup = materialized.cleanup;
  if (!cleanup) return;
  const id = `session-goal-cleanup-${++cleanupNotice}`;
  const attempt = async () => {
    try {
      await cleanup();
    } catch (error) {
      toast.error(labels.cleanupError, {
        id,
        duration: 60_000,
        description: error instanceof Error ? error.message : undefined,
        // The capability closes over the original endpoint and owned directory.
        // Retrying cleanup cannot resend a goal or delete another draft's files.
        action: {
          label: labels.cleanupRetry,
          onClick: () => {
            void attempt();
          },
        },
      });
    }
  };
  await attempt();
}
