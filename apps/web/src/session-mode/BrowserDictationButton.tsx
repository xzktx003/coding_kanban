import { useEffect, useRef, useState } from "react";
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
import { postJson } from "./services/apiAdapt/shared";
import { encodePcm16k } from "./pcm-audio";

export function BrowserDictationButton({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const { selectedModelId, setSelectedModelId } = useDictationStore();
  const [status, setStatus] = useState<DictationModelStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const transcript = useRef(onTranscript); transcript.current = onTranscript;
  const capture = useRef<{
    model: string;
    stream: MediaStream;
    context: AudioContext;
    node: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const mounted = useRef(true);
  async function refresh() {
    const current = await dictationModelStatus(selectedModelId);
    if (mounted.current) setStatus(current);
  }
  useEffect(() => {
    mounted.current = true;
    const changeMode = (event: Event) => { if ((event as CustomEvent).detail !== "session" && capture.current) void stop(); };
    window.addEventListener("workbench-mode-changed", changeMode);
    return () => {
      window.removeEventListener("workbench-mode-changed", changeMode);
      mounted.current = false;
      cleanup();
    };
  }, []);
  useEffect(() => {
    if (!picker) return;
    void refresh().catch((error) => toast.error(String(error)));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [picker, selectedModelId]);
  function cleanup() {
    const current = capture.current;
    capture.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.node.disconnect();
    current.source.disconnect();
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context.close();
  }
  async function stop() {
    const current = capture.current;
    if (!current) return;
    setRecording(false);
    setProcessing(true);
    cleanup();
    try {
      const bytes = encodePcm16k(chunks.current, current.context.sampleRate);
      const pieces: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32768)
        pieces.push(
          String.fromCharCode(...bytes.subarray(offset, offset + 32768)),
        );
      const result = await postJson<{ text: string }>(
        "/api/dictation/transcribe",
        { modelId: current.model, data: btoa(pieces.join("")) },
      );
      if (mounted.current && result.text.trim()) transcript.current(result.text);
    } catch (error) {
      if (mounted.current)
        setFailure(
          error instanceof Error ? error.message : "无法转录音频",
        );
    } finally {
      chunks.current = [];
      if (mounted.current) setProcessing(false);
    }
  }
  async function start() {
    if (recording) {
      await stop();
      return;
    }
    if (starting) return;
    setStarting(true);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      });
      context = new AudioContext();
      await context.resume();
      if (!mounted.current || document.querySelector<HTMLElement>(".session-mode")?.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const node = context.createScriptProcessor(4096, 1, 1);
      chunks.current = [];
      node.onaudioprocess = (event) => {
        if (capture.current)
          chunks.current.push(
            new Float32Array(event.inputBuffer.getChannelData(0)),
          );
      };
      source.connect(node);
      node.connect(context.destination);
      capture.current = {
        model: selectedModelId,
        stream,
        context,
        source,
        node,
        timer: setTimeout(() => {
          void stop();
        }, 119_000),
      };
      setRecording(true);
      setPicker(false);
    } catch (error) {
      cleanup();
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close();
      if (mounted.current) {
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
      }
    } finally {
      if (mounted.current) setStarting(false);
    }
  }
  const available = Boolean(navigator.mediaDevices?.getUserMedia);
  return (
    <Popover open={picker} onOpenChange={setPicker}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={!available || processing || starting}
          onClick={(event) => {
            event.preventDefault();
            void start();
          }}
          aria-label={
            processing
              ? "正在转写"
              : recording
                ? "停止听写"
                : starting
                  ? "正在启动听写；点击可取消"
                  : "听写"
          }
          title={
            processing
              ? "正在转写"
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
          <button type="button" onClick={() => setFailure(null)}>
            关闭
          </button>
          <button
            type="button"
            onClick={() => {
              setFailure(null);
              void start();
            }}
          >
            重试听写
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
