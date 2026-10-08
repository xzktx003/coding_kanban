import { useLayoutEffect } from "react";
import { startSessionPageHistory } from "../../services/sessionPageHistory";
import { useSessionNavigationGuard, cancelSessionNavigation, confirmSessionNavigation } from "../../services/sessionNavigationGuard";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "../ui/alert-dialog";
import { Button } from "../ui/button";

export function SessionPageNavigation() {
  useLayoutEffect(startSessionPageHistory, []);
  const { pending, saving, dirty } = useSessionNavigationGuard();
  if (!pending) return null;
  return <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) cancelSessionNavigation(); }}>
    <AlertDialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
      <AlertDialogHeader>
        <AlertDialogTitle>{saving ? "正在保存" : dirty ? "离开此页面？" : "更改已保存"}</AlertDialogTitle>
        <AlertDialogDescription>{saving ? "请等待保存完成，再离开此页面。" : dirty ? "此页面有尚未保存的更改。离开将放弃这些更改，会话草稿不受影响。" : "现在可以安全离开此页面。"}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button variant="outline" onClick={cancelSessionNavigation}>继续编辑</Button>
        <Button disabled={saving} onClick={confirmSessionNavigation}>{dirty ? "放弃更改并离开" : "离开页面"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
