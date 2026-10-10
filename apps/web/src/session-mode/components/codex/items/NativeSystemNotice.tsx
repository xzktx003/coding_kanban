import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import type { GuardianApprovalReview } from "@session/bindings/v2/GuardianApprovalReview";
import type { ModelReroutedNotification } from "@session/bindings/v2/ModelReroutedNotification";
import type { ItemGuardianApprovalReviewStartedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewStartedNotification";
import type { ItemGuardianApprovalReviewCompletedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewCompletedNotification";
import { NativeGuardianDeniedAction } from "@session/features/guardian-denial/NativeGuardianDeniedAction";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
import {
  nativeAutomaticReviewActionLabel,
  nativeAutomaticReviewTitle,
  nativeAutomaticReviewRationale,
} from "../presentation/nativeAutomaticReviewLabels";
import { NativeCommandChevron } from "../presentation/NativeCommandIcons";
import { NativeCadencedShimmer } from "../presentation/NativeCadencedShimmer";
import { NativeToolIcon } from "../presentation/NativeToolIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@session/components/ui/tooltip";
import "./tool-native.css";
export function NativeModelReroutedNotice({
  value,
}: {
  value: ModelReroutedNotification;
}) {
  const { i18n } = useTranslation("thread"),
    chinese = (i18n?.language ?? "zh").startsWith("zh");
  if (value.reason !== "highRiskCyberActivity") return null;
  const model = value.toModel.startsWith("gpt-")
    ? value.toModel.toUpperCase()
    : value.toModel;
  return (
    <div className="codex-native-notice codex-native-divider">
      <span className="codex-native-divider-message">
        <span>
          {chinese
            ? `你的请求已转发至 ${model}。`
            : `Your request was routed to ${model}.`}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={chinese ? "模型改派详情" : "Model routing details"}
              >
                <NativeToolIcon name="info" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="codex-file-preview codex-native-notice-tooltip max-w-64 text-center">
              <p>
                {chinese
                  ? "提醒：你的请求已被改派，以降低网络滥用风险。"
                  : "Heads up, your request was re-routed to reduce cyber-abuse risk."}
              </p>
              <p>
                {chinese
                  ? "认为这是误判？可申请复核："
                  : "Think this is a mistake? Request a review at "}
                <a
                  href="https://chatgpt.com/cyber"
                  target="_blank"
                  rel="noreferrer"
                >
                  chatgpt.com/cyber
                </a>
                {chinese
                  ? "，或通过 /feedback 反馈。"
                  : " or report via /feedback"}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    </div>
  );
}
export function NativeAutomaticReviewItem({
  value,
  termination,
}: {
  value: ItemGuardianApprovalReviewStartedNotification;
  termination?: string;
}) {
  const { i18n } = useTranslation("thread"),
    chinese = (i18n?.language ?? "zh").startsWith("zh"),
    { review, action } = value;
  if (review.status === "approved") return null;
  const label = nativeAutomaticReviewActionLabel(
    action,
    i18n?.language ?? "zh",
  );
  return (
    <NativeToolDisclosure
      className="codex-native-auto-review"
      icon={
        <NativeToolIcon
          name="review"
          style={
            review.status === "denied"
              ? { color: "var(--codex-tool-warning)" }
              : undefined
          }
        />
      }
      summary={label}
      running={review.status === "inProgress" && !termination}
    >
      {review.status === "denied" ? (
        <p className="codex-native-auto-review-explanation">
          {chinese
            ? review.riskLevel === "high"
              ? "此操作被视为高风险，需要明确授权"
              : "需要明确授权"
            : review.riskLevel === "high"
              ? "Requires explicit authorization because this action is considered high risk"
              : "Requires explicit authorization"}
        </p>
      ) : (
        <NativeAutomaticReviewDetails
          review={review}
          active={review.status === "inProgress" && !termination}
        />
      )}
      {termination && review.status === "inProgress" && (
        <p>
          {chinese
            ? "本轮已结束，审核未返回最终结果"
            : "Turn ended before the review returned a final result"}
        </p>
      )}
      {review.status === "denied" &&
        "completedAtMs" in value &&
        "decisionSource" in value && (
          <NativeGuardianDeniedAction
            value={value as ItemGuardianApprovalReviewCompletedNotification}
          />
        )}
    </NativeToolDisclosure>
  );
}

function NativeAutomaticReviewDetails({
  review,
  active,
}: {
  review: GuardianApprovalReview;
  active: boolean;
}) {
  const { i18n } = useTranslation("thread"),
    language = i18n?.language ?? "zh",
    [expanded, setExpanded] = useState(false),
    id = useId();
  const title = nativeAutomaticReviewTitle(review, language);
  return (
    <div className="codex-native-auto-review-details">
      <button
        type="button"
        className="codex-native-auto-review-details-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        {active ? (
          <NativeCadencedShimmer>{title}</NativeCadencedShimmer>
        ) : (
          <span>{title}</span>
        )}
        <NativeCommandChevron
          data-expanded={expanded}
          className={
            expanded
              ? "codex-command-chevron is-expanded"
              : "codex-command-chevron"
          }
        />
      </button>
      <div id={id} hidden={!expanded} inert={!expanded}>
        {expanded && (
          <p className="codex-native-auto-review-explanation">
            {nativeAutomaticReviewRationale(review, language)}
          </p>
        )}
      </div>
    </div>
  );
}
