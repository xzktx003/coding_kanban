import { useTranslation } from "react-i18next";
import type { ItemGuardianApprovalReviewCompletedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewCompletedNotification";
import { useGuardianDenial } from "./useGuardianDenial";
import "./guardian-denial.css";
export function NativeGuardianDeniedAction({
  value,
}: {
  value: ItemGuardianApprovalReviewCompletedNotification;
}) {
  const { t } = useTranslation("thread");
  const action = useGuardianDenial(value);
  // Native gate false, incomplete event, read-only owner, and recorded reviews
  // do not display a synthetic approval button.
  if (
    action.state === "checking" ||
    action.state === "unavailable" ||
    action.state === "recorded"
  )
    return null;
  return (
    <div className="codex-guardian-denial-action" data-state={action.state}>
      <p className="codex-guardian-denial-heading">
        {t("guardianDenial.whatApprovalAllows")}
      </p>
      <div className="codex-guardian-denial-row">
        <p>{t("guardianDenial.approvalEffect")}</p>
        <button
          type="button"
          disabled={!action.canApprove}
          onClick={(event) => {
            event.stopPropagation();
            void action.approve();
          }}
        >
          {t(
            action.state === "approving"
              ? "guardianDenial.approving"
              : "guardianDenial.approve",
          )}
        </button>
      </div>
      {(action.state === "uncertain" || action.state === "rejected") && (
        <div className="codex-guardian-denial-receipt" role="status">
          <span>
            {t(
              action.state === "uncertain"
                ? "guardianDenial.uncertain"
                : "guardianDenial.rejected",
            )}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void action.recheck();
            }}
          >
            {t("guardianDenial.recheck")}
          </button>
        </div>
      )}
    </div>
  );
}
