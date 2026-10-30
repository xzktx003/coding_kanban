import { invokeTauri, isDesktopTauri, getJson, postJson } from './shared';

// Desktop Tauri uses its native dictation commands. Web clients capture the
// microphone locally and send bounded PCM to the configured host transcriber.


export type DictationModelState = 'missing' | 'downloading' | 'ready' | 'error';

export type DictationDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
};

export type DictationModelStatus = {
  state: DictationModelState;
  modelId: string;
  progress: DictationDownloadProgress | null;
  error: string | null;
  path: string | null;
};

export type DictationSessionState = 'idle' | 'listening' | 'processing';

export type DictationEvent =
  | { type: 'state'; state: DictationSessionState }
  | { type: 'level'; value: number }
  | { type: 'transcript'; text: string }
  | { type: 'error'; message: string }
  | { type: 'canceled'; message: string };

export async function dictationModelStatus(modelId?: string): Promise<DictationModelStatus> {
  if (!isDesktopTauri()) {
    return getJson<DictationModelStatus>(`/api/dictation/models/status?modelId=${encodeURIComponent(modelId ?? "base")}`);
  }
  return await invokeTauri<DictationModelStatus>('dictation_model_status', { modelId });
}

export async function dictationDownloadModel(modelId?: string): Promise<DictationModelStatus> {
  if (!isDesktopTauri()) return postJson<DictationModelStatus>("/api/dictation/models/download", { modelId: modelId ?? "base" });
  return await invokeTauri<DictationModelStatus>('dictation_download_model', { modelId });
}

export async function dictationCancelDownload(modelId?: string): Promise<DictationModelStatus> {
  if (!isDesktopTauri()) return postJson<DictationModelStatus>("/api/dictation/models/cancel", { modelId: modelId ?? "base" });
  return await invokeTauri<DictationModelStatus>('dictation_cancel_download', { modelId });
}

export async function dictationRemoveModel(modelId?: string): Promise<DictationModelStatus> {
  if (!isDesktopTauri()) return postJson<DictationModelStatus>("/api/dictation/models/remove", { modelId: modelId ?? "base" });
  return await invokeTauri<DictationModelStatus>('dictation_remove_model', { modelId });
}

export async function dictationStart(
  preferredLanguage?: string,
  modelId?: string
): Promise<DictationSessionState> {
  if (!isDesktopTauri()) {
    throw new Error("Use the browser microphone control to start dictation.");
  }
  return await invokeTauri<DictationSessionState>('dictation_start', {
    preferredLanguage,
    modelId,
  });
}

export async function dictationRequestPermission(): Promise<boolean> {
  if (!isDesktopTauri()) {
    return false;
  }
  return await invokeTauri<boolean>('dictation_request_permission');
}

export async function dictationStop(): Promise<DictationSessionState> {
  return await invokeTauri<DictationSessionState>('dictation_stop');
}

export async function dictationCancel(): Promise<DictationSessionState> {
  return await invokeTauri<DictationSessionState>('dictation_cancel');
}
