import { Check, Circle, LoaderCircle } from "lucide-react";
import type { TurnPlanStep } from "@session/bindings/v2";
import { cn } from "@session/lib/utils";

interface TurnPlanProps {
  plan: TurnPlanStep[];
  explanation: string | null;
}

/**
 * Codex 26.51007.21434 (`sites-end-resource-733bd1c6da06.js`) builds a plan step
 * as `flex items-start gap-2` over two columns: a `flex flex-shrink-0
 * items-start gap-0.5` pair of status glyph plus an `{index}.` text prefix, then
 * `text-size-chat flex-1 leading-4` for the step itself. Each glyph sits in the
 * same `flex size-4 shrink-0 items-center justify-center overflow-hidden` box,
 * and status is carried by the glyph alone: the only text change is
 * `line-through` on a completed step, with no recolouring or weight shift.
 */
function PlanStepGlyph({ status }: { status: TurnPlanStep["status"] }) {
  return (
    <div className="flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted-foreground">
      {status === "completed" ? (
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
      ) : status === "inProgress" ? (
        <LoaderCircle
          className="size-3.5 shrink-0 animate-spin"
          aria-hidden="true"
        />
      ) : (
        <Circle className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      )}
    </div>
  );
}

export function TurnPlan({ plan, explanation }: TurnPlanProps) {
  return (
    <div className="bg-card/50 border-border flex flex-col rounded-lg border p-3">
      {explanation && (
        <div className="text-foreground/80 mb-4 px-1 text-sm font-medium">
          {explanation}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {plan.map((p, index) => (
          // `TurnPlanStep` has no identity field and two steps may share text,
          // so the index is the only stable key available here.
          <div key={index} data-plan-step="" className="flex items-start gap-2">
            <div className="flex flex-shrink-0 items-start gap-0.5">
              <PlanStepGlyph status={p.status} />
              <span
                data-plan-step-index=""
                className="text-[13px] leading-4 tabular-nums"
              >
                {index + 1}.
              </span>
            </div>
            <span
              data-plan-step-label=""
              className={cn(
                "flex-1 text-[13px] leading-4",
                p.status === "completed" && "line-through",
              )}
            >
              {p.step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
