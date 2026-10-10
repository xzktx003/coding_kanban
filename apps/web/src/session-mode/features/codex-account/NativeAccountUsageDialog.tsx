import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@session/components/ui/dialog";
import { NativeCodexUsage } from "./NativeCodexUsage";
export function NativeAccountUsageDialog({
  open,
  onOpenChange,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: () => void;
}) {
  const { t } = useTranslation("sidebar");
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="codex-presentation codex-native-config-preview">
        <DialogTitle>{t("usage")}</DialogTitle>
        <NativeCodexUsage
          onSignIn={() => {
            onOpenChange(false);
            onSignIn();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
