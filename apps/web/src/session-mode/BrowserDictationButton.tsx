import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover";
import { DictationPopoverContent } from "./components/codex/composer/DictationPopoverContent";
import { useDictationStore } from "./stores/settings/useDictationStore";
import {
  dictationModelStatus,
  dictationDownloadModel,
  dictationCancelDownload,
  type DictationModelStatus,
} from "./services/apiAdapt/dictation";
import { postJsonWithOptions } from "./services/apiAdapt/shared";
import { encodePcm16k } from "./pcm-audio";
import { claimMicrophone } from "./features/audio/microphoneLease";

export type BrowserDictationPhase =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "retry";
export interface BrowserDictationControl {
  finishAndSend: () => Promise<void>;
  cancel: () => void;
}
export interface BrowserDictationProps {
  onTranscript: (text: string, intent?: { send: boolean }) => void;
  controlRef?: MutableRefObject<BrowserDictationControl | null>;
  onPhaseChange?: (phase: BrowserDictationPhase) => void;
  disabled?: boolean;
}

export function BrowserDictationButton({
  onTranscript,
  controlRef,
  onPhaseChange,
  disabled = false,
}: BrowserDictationProps) {
  const { selectedModelId, setSelectedModelId } = useDictationStore();
  const [status, setStatus] = useState<DictationModelStatus | null>(null);
  const [phase, setPhase] = useState<BrowserDictationPhase>("idle");
  const [picker, setPicker] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const recording = phase === "recording",
    starting = phase === "starting",
    processing = phase === "transcribing";
  const generation = useRef(0);
  const transcription = useRef<AbortController | null>(null);
  const startingResources = useRef<{
    stream: MediaStream;
    context: AudioContext | null;
  } | null>(null);
  const capture = useRef<{
    model: string;
    generation: number;
    transcript: BrowserDictationProps["onTranscript"];
    stream: MediaStream;
    context: AudioContext;
    node: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const retry = useRef<{
    generation: number;
    payload: { modelId: string; data: string };
    transcript: BrowserDictationProps["onTranscript"];
    send: boolean;
  } | null>(null);
  const retryExpiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const mounted = useRef(true);
  const microphoneAbort = useRef<AbortController | null>(null);
  const microphoneRelease = useRef<(() => void) | null>(null);
  function releaseRetry() {
    retry.current = null;
    if (retryExpiry.current) clearTimeout(retryExpiry.current);
    retryExpiry.current = null;
  }
  function cleanup() {
    microphoneAbort.current?.abort();
    microphoneAbort.current = null;
    microphoneRelease.current?.();
    microphoneRelease.current = null;
    const pending = startingResources.current;
    startingResources.current = null;
    if (pending) {
      pending.stream.getTracks().forEach((track) => track.stop());
      if (pending.context) void pending.context.close().catch(() => {});
    }
    const current = capture.current;
    capture.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.node.onaudioprocess = null;
    current.node.disconnect();
    current.source.disconnect();
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context.close().catch(() => {});
  }
  function cancel() {
    generation.current++;
    transcription.current?.abort();
    transcription.current = null;
    cleanup();
    chunks.current = [];
    releaseRetry();
    if (mounted.current) {
      setPhase("idle");
      setFailure(null);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const changeMode = (event: Event) => {
      if ((event as CustomEvent).detail !== "session") cancel();
    };
    window.addEventListener("workbench-mode-changed", changeMode);
    return () => {
      window.removeEventListener("workbench-mode-changed", changeMode);
      mounted.current = false;
      generation.current++;
      transcription.current?.abort();
      transcription.current = null;
      cleanup();
      chunks.current = [];
      releaseRetry();
    };
  }, []);
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  useEffect(() => {
    if (!controlRef) return;
    const control = { finishAndSend: () => stop(true), cancel };
    controlRef.current = control;
    return () => {
      if (controlRef.current === control) controlRef.current = null;
    };
  });
  useEffect(() => {
    if (!picker) return;
    let live = true;
    const refresh = async () => {
      const current = await dictationModelStatus(selectedModelId);
      if (live) setStatus(current);
    };
    void refresh().catch((error) => toast.error(String(error)));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [picker, selectedModelId]);
  async function transcribe(pending: NonNullable<typeof retry.current>) {
    if (
      transcription.current ||
      !mounted.current ||
      pending.generation !== generation.current
    )
      return;
    const controller = new AbortController();
    transcription.current = controller;
    if (retryExpiry.current) clearTimeout(retryExpiry.current);
    retryExpiry.current = null;
    setPhase("transcribing");
    setFailure(null);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        postJsonWithOptions<{ text: string }>(
          "/api/dictation/transcribe",
          pending.payload,
          { signal: controller.signal, suppressToast: true },
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("转写超时，可重试本次录音"));
          }, 60_000);
        }),
      ]);
      if (!mounted.current || pending.generation !== generation.current) return;
      releaseRetry();
      if (result.text.trim())
        pending.transcript(result.text, { send: pending.send });
      setPhase("idle");
    } catch (error) {
      if (!mounted.current || pending.generation !== generation.current) return;
      retry.current = pending;
      setFailure(error instanceof Error ? error.message : "无法转录音频");
      setPhase("retry");
      // Keep only this one bounded recording for a short explicit retry window.
      if (retryExpiry.current) clearTimeout(retryExpiry.current);
      retryExpiry.current = setTimeout(() => {
        if (retry.current !== pending) return;
        releaseRetry();
        if (mounted.current) {
          setPhase("idle");
          setFailure("录音已过期，请重新听写");
        }
      }, 60_000);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (transcription.current === controller) transcription.current = null;
    }
  }
  async function stop(send = false) {
    const current = capture.current;
    if (!current) return;
    const samples = chunks.current;
    chunks.current = [];
    const rate = current.context.sampleRate;
    cleanup();
    const bytes = encodePcm16k(samples, rate);
    const pieces: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 32768)
      pieces.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 32768)),
      );
    const pending = {
      generation: current.generation,
      payload: { modelId: current.model, data: btoa(pieces.join("")) },
      transcript: current.transcript,
      send,
    };
    retry.current = pending;
    await transcribe(pending);
  }
  async function start() {
    if (disabled && phase === "idle") return;
    if (starting) {
      cancel();
      return;
    }
    if (recording) {
      await stop();
      return;
    }
    if (processing) {
      cancel();
      return;
    }
    releaseRetry();
    setFailure(null);
    const attempt = ++generation.current;
    const transcript = onTranscript;
    setPhase("starting");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    const microphone = new AbortController();
    microphoneAbort.current = microphone;
    try {
      const release = await claimMicrophone(microphone.signal);
      if (!mounted.current || generation.current !== attempt) { release(); return; }
      microphoneRelease.current = release;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      });
      if (!mounted.current || generation.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      startingResources.current = { stream, context: null };
      context = new AudioContext();
      startingResources.current.context = context;
      await context.resume();
      if (
        !mounted.current ||
        generation.current !== attempt ||
        document.querySelector<HTMLElement>(".session-mode")?.hidden
      ) {
        if (startingResources.current?.stream === stream) cleanup();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const node = context.createScriptProcessor(4096, 1, 1);
      chunks.current = [];
      node.onaudioprocess = (event) => {
        if (capture.current?.generation === attempt)
          chunks.current.push(
            new Float32Array(event.inputBuffer.getChannelData(0)),
          );
      };
      source.connect(node);
      node.connect(context.destination);
      startingResources.current = null;
      capture.current = {
        model: selectedModelId,
        generation: attempt,
        transcript,
        stream,
        context,
        source,
        node,
        timer: setTimeout(() => {
          void stop();
        }, 119_000),
      };
      setPhase("recording");
      setPicker(false);
    } catch (error) {
      if (microphoneAbort.current === microphone) cleanup();
      if (mounted.current && generation.current === attempt) {
        const name = error instanceof Error ? error.name : "";
        setFailure(
          name === "NotAllowedError"
            ? "请启用麦克风访问权限以使用听写功能"
            : name === "NotFoundError"
              ? "连接麦克风以使用听写功能"
              : name === "NotReadableError"
                ? "关闭其他正在使用麦克风的应用"
                : "无法开始听写",
        );
        setPhase("idle");
      }
    }
  }
  const available = Boolean(navigator.mediaDevices?.getUserMedia);
  return (
    <Popover open={picker} onOpenChange={setPicker}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={!available || (disabled && phase === "idle")}
          onClick={(event) => {
            event.preventDefault();
            void start();
          }}
          aria-label={
            processing
              ? "正在转写；点击可取消"
              : recording
                ? "停止听写"
                : starting
                  ? "正在启动听写；点击可取消"
                  : "听写"
          }
          title={
            processing
              ? "正在转写；点击可取消"
              : recording
                ? "停止听写"
                : starting
                  ? "正在启动听写…"
                  : "听写"
          }
          className={recording ? "text-red-400" : ""}
        >
          {processing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : recording ? (
            <Square size={15} />
          ) : (
            <Mic size={16} />
          )}
        </Button>
      </PopoverTrigger>
      {failure && (
        <span className="session-dictation-failure" role="alert">
          <span>{failure}</span>
          <button type="button" onClick={cancel}>
            丢弃录音
          </button>
          <button
            type="button"
            onClick={() => {
              const pending = retry.current;
              if (pending) void transcribe(pending);
              else void start();
            }}
          >
            {phase === "retry" ? "重试转写" : "重试听写"}
          </button>
        </span>
      )}
      <PopoverContent className="w-72">
        <DictationPopoverContent
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
          onConfirmModel={async (id) => {
            setSelectedModelId(id);
            try {
              setStatus(await dictationDownloadModel(id));
            } catch (error) {
              toast.error(String(error));
            }
          }}
          onCancelDownload={
            status?.state === "downloading"
              ? async () => {
                  setStatus(await dictationCancelDownload(selectedModelId));
                }
              : undefined
          }
          modelStatus={status}
          downloadProgress={status?.progress}
        />
      </PopoverContent>
    </Popover>
  );
}
