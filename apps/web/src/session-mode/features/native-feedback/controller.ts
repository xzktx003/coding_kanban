/** VSIX feedback-upload-cb5de3dd6947: se/ce. Closing UI never cancels a submitted upload. */
export type FeedbackUploadStatus =
  | "uploading"
  | "uploaded"
  | "incomplete"
  | "disabled"
  | "failed"
  | "unconfirmed";
export interface FeedbackReport {
  id: string;
  owner: string;
  correlationId: string | null;
  status: FeedbackUploadStatus;
  open: boolean;
  notification: boolean;
}
export function feedbackErrorStatus(error: unknown): FeedbackUploadStatus {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(
    "feedback report was accepted, but some attachments failed to upload",
  )
    ? "incomplete"
    : message.includes("sending feedback is disabled by configuration")
      ? "disabled"
      : message.includes("feedback uploads are already in progress")
        ? "failed"
        : "unconfirmed";
}
export class FeedbackUploads {
  private reports: FeedbackReport[] = [];
  private tasks = new Map<
    string,
    { submit?: () => Promise<string>; running: boolean }
  >();
  private listeners = new Set<() => void>();
  private sequence = 0;
  getSnapshot = () => this.reports;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(reports: FeedbackReport[]) {
    this.reports = reports;
    for (const listener of this.listeners) listener();
  }
  start(
    correlationId: string | null,
    owner: string,
    submit: () => Promise<string>,
  ) {
    const id = `feedback-${++this.sequence}`;
    this.tasks.set(id, { submit, running: false });
    this.publish([
      ...this.reports,
      {
        id,
        owner,
        correlationId,
        status: "uploading",
        open: true,
        notification: false,
      },
    ]);
    void this.run(id);
    return id;
  }
  private async run(id: string) {
    const task = this.tasks.get(id);
    if (!task || task.running || !task.submit) return;
    task.running = true;
    const report = this.reports.find((r) => r.id === id);
    if (report?.status !== "uploading" || !report.open || report.notification)
      this.publish(
        this.reports.map((r) =>
          r.id === id
            ? { ...r, status: "uploading", open: true, notification: false }
            : r,
        ),
      );
    let correlationId: string | undefined, status: FeedbackUploadStatus;
    try {
      correlationId = await task.submit();
      status = "uploaded";
    } catch (error) {
      status = feedbackErrorStatus(error);
    }
    if (this.tasks.get(id) !== task) return;
    task.running = false;
    if (status !== "failed") task.submit = undefined;
    this.publish(
      this.reports.map((r) =>
        r.id === id
          ? {
              ...r,
              status,
              correlationId: correlationId ?? r.correlationId,
              notification: !r.open,
            }
          : r,
      ),
    );
  }
  retry(id: string) {
    const r = this.reports.find((r) => r.id === id);
    if (r?.status !== "failed" || this.tasks.get(id)?.running) return false;
    void this.run(id);
    return true;
  }
  dismiss(id: string) {
    const r = this.reports.find((r) => r.id === id);
    if (!r || (!r.open && r.notification)) return;
    if (["uploaded", "incomplete", "disabled"].includes(r.status)) {
      this.remove(id);
      return;
    }
    this.publish(
      this.reports.map((r) =>
        r.id === id ? { ...r, open: false, notification: true } : r,
      ),
    );
  }
  reopen(id: string) {
    if (
      !this.tasks.has(id) ||
      this.reports.some((r) => r.id === id && r.open && !r.notification)
    )
      return;
    this.publish([
      ...this.reports.filter((r) => r.id !== id),
      ...this.reports
        .filter((r) => r.id === id)
        .map((r) => ({ ...r, open: true, notification: false })),
    ]);
  }
  remove(id: string) {
    this.tasks.delete(id);
    if (this.reports.some((r) => r.id === id))
      this.publish(this.reports.filter((r) => r.id !== id));
  }
  clear() {
    this.tasks.clear();
    if (this.reports.length) this.publish([]);
  }
}
