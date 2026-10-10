import { useTranslation } from "react-i18next";

export function TranscriptDetailsNotice() {
  const { i18n } = useTranslation("thread");
  return (
    <span
      data-transcript-details-unloaded
      className="text-xs text-muted-foreground"
    >
      {(i18n?.language ?? "zh").startsWith("zh")
        ? "详情未加载"
        : "Details not loaded"}
    </span>
  );
}
