import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@session/components/ui/alert-dialog";

type EditRollbackConfirmDialogProps = {
  open: boolean;
  submitting: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export const EditRollbackConfirmDialog = ({
  open,
  submitting,
  error,
  confirmDisabled = false,
  onOpenChange,
  onConfirm,
}: EditRollbackConfirmDialogProps) => {
  const { t } = useTranslation("thread");
  const outdatedRuntime =
    !!error &&
    /thread\/rollback/.test(error) &&
    /unknown variant|unknown method|method not found/i.test(error);
  const summary = outdatedRuntime
    ? t("editRollback.runtimeUpdateRequired")
    : error?.split(/\r?\n/)[0].slice(0, 240);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("editRollback.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("editRollback.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="min-w-0 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p role="alert" className="break-words text-destructive">
              {summary}
            </p>
            <details className="min-w-0 text-muted-foreground">
              <summary className="cursor-pointer py-1">
                {t("editRollback.errorDetails")}
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
                {error.slice(0, 12000)}
              </pre>
            </details>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={submitting || confirmDisabled}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {t("common.continue")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
