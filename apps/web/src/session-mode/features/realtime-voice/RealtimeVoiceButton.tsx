import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { AudioLines, MicOff, PhoneOff } from "lucide-react";
import { Button } from "@session/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";
import { realtimeTransport } from "./transport";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import { useAgentInteractionVisible } from "@session/session-dom";
import { openEventStream } from "@session/lib/eventStream";
import { claimMicrophone } from "@session/features/audio/microphoneLease";
import { newSessionEditId } from "@session/services/sessionEditIdentity";
import type { RealtimeVoiceController, VoicePhase } from "./controller";
export type RealtimeVoiceControl = {
  stop: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
};
type Preflight = { contextToken: string; threadId: string };
export function RealtimeVoiceButton({
  threadId,
  owner,
  disabled = false,
  onStarting,
  onPhaseChange,
  controlRef,
}: {
  threadId: string | null;
  owner: string;
  disabled?: boolean;
  onStarting?: () => void;
  onPhaseChange?: (phase: VoicePhase) => void;
  controlRef?: MutableRefObject<RealtimeVoiceControl | null>;
}) {
  const [open, setOpen] = useState(false),
    [phase, setPhase] = useState<VoicePhase>("idle"),
    [context, setContext] = useState<Preflight | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [muted, setMuted] = useState(false),
    [speakerMuted, setSpeakerMuted] = useState(false),
    [playBlocked, setPlayBlocked] = useState(false),
    [receiptUnknown, setReceiptUnknown] = useState(false),
    [receiptReviewed, setReceiptReviewed] = useState(false);
  const visible = useAgentInteractionVisible(),
    audio = useRef<HTMLAudioElement>(null),
    audioOwner = useRef<number | null>(null),
    voice = useRef<RealtimeVoiceController | null>(null),
    read = useRef<AbortController | null>(null),
    launch = useRef(0),
    live = useRef({ threadId, owner, visible });
  live.current = { threadId, owner, visible };
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  useEffect(() => {
    if (!controlRef) return;
    const control = {
      stop: close,
      sendText: async (text: string) => {
        if (!voice.current) throw new Error("语音连接不可用");
        await voice.current.sendText(text);
      },
    };
    controlRef.current = control;
    return () => {
      if (controlRef.current === control) controlRef.current = null;
    };
  });
  useEffect(() => {
    setOpen(false);
    setContext(null);
    setPhase("idle");
    setError(null);
    setMuted(false);
    setSpeakerMuted(false);
    setPlayBlocked(false);
    if (audio.current) audio.current.muted = false;
    return () => {
      launch.current++;
      read.current?.abort();
      const captured = voice.current;
      voice.current = null;
      void captured?.stop();
    };
  }, [threadId, owner]);
  useEffect(() => {
    if (!visible) {
      void close();
    }
  }, [visible]);
  useEffect(() => {
    if (!open && !["starting", "active", "stopping"].includes(phase)) return;
    const revoke = () => {
      launch.current++;
      read.current?.abort();
      voice.current?.revoke();
      voice.current = null;
      setPhase("idle");
      setContext(null);
      setError("连接或账号已变化，请重新打开语音对话。");
    };
    const stop = openEventStream({
      agents: ["codex"],
      label: "realtime-voice",
      onResync: revoke,
      onEvent: (event) => {
        const method = (event.payload as { method?: string }).method;
        if (
          event.event === "codex:disconnected" ||
          ["account/updated", "account/login/completed"].includes(method ?? "")
        )
          revoke();
      },
    });
    return stop;
  }, [open, phase]);
  async function prepare() {
    if (!threadId) return;
    setOpen(true);
    setError(null);
    setContext(null);
    setLoading(true);
    setReceiptReviewed(false);
    try {
      setReceiptUnknown(
        JSON.parse(
          localStorage.getItem("kanban.session.realtime-text.v1." + owner) ??
            "null",
        )?.status === "unknown",
      );
    } catch {
      setReceiptUnknown(true);
    }
    const transport = realtimeTransport(),
      target = { threadId, owner },
      scope = captureCodexOperationScope(),
      controller = new AbortController();
    read.current?.abort();
    read.current = controller;
    try {
      const value = await transport.request<Preflight>(
        "preflight",
        { threadId },
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        transport.current() &&
        isCodexOperationScopeCurrent(scope) &&
        live.current.threadId === target.threadId &&
        live.current.owner === target.owner
      ) {
        if (
          !/^[a-f0-9]{64}$/.test(value.contextToken) ||
          value.threadId !== target.threadId
        )
          throw new Error("语音服务返回了不匹配的目标");
        setContext(value);
        setPhase("idle");
        setMuted(false);
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (read.current === controller) setLoading(false);
    }
  }
  async function start() {
    if (!context || phase !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError("此浏览器需要可用的麦克风和安全连接才能使用语音对话。");
      return;
    }
    onStarting?.();
    setError(null);
    setPhase("starting");
    const generation = ++launch.current;
    const transport = realtimeTransport(),
      target = { threadId: context.threadId, owner },
      scope = captureCodexOperationScope(),
      current = () =>
        transport.current() &&
        isCodexOperationScopeCurrent(scope) &&
        live.current.threadId === target.threadId &&
        live.current.owner === target.owner &&
        live.current.visible;
    let Controller: typeof import("./controller").RealtimeVoiceController;
    try {
      Controller = (await import("./controller")).RealtimeVoiceController;
    } catch (reason) {
      if (launch.current === generation) {
        setPhase("failed");
        setError(String(reason));
      }
      return;
    }
    if (launch.current !== generation || !current()) return;
    const value = new Controller({
      claim: claimMicrophone,
      microphone: () =>
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        }),
      peer: () => new RTCPeerConnection(),
      current,
      canStop: () => transport.current() && isCodexOperationScopeCurrent(scope),
      phase: (next) => {
        if (launch.current === generation && current()) setPhase(next);
      },
      error: (message) => {
        if (launch.current === generation && current()) setError(message);
      },
      audio: (stream) => {
        if (!stream) {
          if (audioOwner.current === generation && audio.current) {
            audio.current.srcObject = null;
            audioOwner.current = null;
          }
          return;
        }
        if (launch.current === generation && current() && audio.current) {
          audioOwner.current = generation;
          audio.current.srcObject = stream;
          void audio.current.play().catch(() => {
            if (launch.current === generation && current())
              setPlayBlocked(true);
          });
        }
      },
      start: (sdp, signal) =>
        transport.request(
          "start",
          {
            contextToken: context.contextToken,
            threadId: context.threadId,
            sdp,
            replaceExisting: true,
          },
          signal,
        ),
      sendText: async (text) => {
        const key = "kanban.session.realtime-text.v1." + owner,
          old = localStorage.getItem(key),
          hash = [
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(text),
              ),
            ),
          ]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
        if (launch.current !== generation || !current())
          throw new Error("语音目标或连接已变化，草稿已保留。");
        if (
          old &&
          (JSON.parse(old).status === "unknown" ||
            (JSON.parse(old).status === "abandoned" &&
              JSON.parse(old).hash === hash))
        )
          throw new Error(
            "上一条语音文字回执未知，请核对原会话；草稿保留，不能重复发送。",
          );
        const intentId = newSessionEditId();
        localStorage.setItem(
          key,
          JSON.stringify({
            intentId,
            threadId: context.threadId,
            createdAt: Date.now(),
            hash,
            status: "unknown",
          }),
        );
        try {
          await transport.request("append-text", {
            contextToken: context.contextToken,
            threadId: context.threadId,
            text,
            intentId,
          });
        } catch (reason) {
          if (launch.current === generation && current())
            setReceiptUnknown(true);
          throw reason;
        }
        localStorage.setItem(
          key,
          JSON.stringify({
            intentId,
            threadId: context.threadId,
            createdAt: Date.now(),
            hash,
            status: "accepted",
          }),
        );
      },
      stop: () =>
        transport.request("stop", {
          contextToken: context.contextToken,
          threadId: context.threadId,
        }),
    });
    voice.current = value;
    void value.start();
  }
  async function close() {
    const generation = ++launch.current,
      target = { threadId, owner };
    read.current?.abort();
    const captured = voice.current;
    voice.current = null;
    setContext(null);
    setOpen(false);
    setPhase("stopping");
    const stopped = await captured?.stop();
    if (
      launch.current === generation &&
      live.current.threadId === target.threadId &&
      live.current.owner === target.owner
    ) {
      setPhase(stopped === false ? "failed" : "idle");
      if (stopped === false)
        setError("语音结束回执未知；麦克风已释放，请核对原会话，不会重发。");
    }
  }
  return (
    <>
      <audio ref={audio} autoPlay className="hidden" aria-hidden="true" />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || !threadId}
        aria-label="语音对话"
        title={threadId ? "语音对话" : "先创建会话，再开始语音对话"}
        onClick={() => {
          if (["starting", "active", "stopping"].includes(phase)) setOpen(true);
          else void prepare();
        }}
      >
        <AudioLines className="h-4 w-4" />
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) {
              if (phase === "active") setOpen(false);
              else void close();
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>语音对话</DialogTitle>
              <DialogDescription>
                浏览器通过当前官方会话服务连接语音。开始会替换该会话中已有的语音连接。
              </DialogDescription>
            </DialogHeader>
            {loading && <p role="status">正在核对会话和语音协议…</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {receiptUnknown && (
              <div className="space-y-2 rounded-md border border-amber-500/40 p-3 text-sm">
                <p>
                  上一条语音文字回执未知。请核对原会话中的回答；相同内容不会重复发送。
                </p>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={receiptReviewed}
                    onChange={(event) =>
                      setReceiptReviewed(event.target.checked)
                    }
                  />
                  我已核对，放弃这条文字的后续重试
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!receiptReviewed}
                  onClick={() => {
                    const key = "kanban.session.realtime-text.v1." + owner,
                      old = JSON.parse(localStorage.getItem(key) ?? "null");
                    if (old)
                      localStorage.setItem(
                        key,
                        JSON.stringify({ ...old, status: "abandoned" }),
                      );
                    setReceiptUnknown(false);
                  }}
                >
                  保留记录并允许不同的新消息
                </Button>
              </div>
            )}
            {phase === "idle" && (
              <Button
                type="button"
                disabled={!context || loading}
                onClick={() => void start()}
              >
                确认开始语音对话
              </Button>
            )}
            {phase === "starting" && <p role="status">正在连接语音…</p>}
            {phase === "active" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (audio.current) audio.current.muted = !speakerMuted;
                  setSpeakerMuted((value) => !value);
                }}
              >
                {speakerMuted ? "取消扬声器静音" : "静音扬声器"}
              </Button>
            )}
            {phase === "active" && playBlocked && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void audio.current
                    ?.play()
                    .then(() => setPlayBlocked(false))
                    .catch(() =>
                      setError("浏览器仍无法播放语音，请核对声音权限。"),
                    );
                }}
              >
                播放语音回复
              </Button>
            )}
            {phase === "active" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  voice.current?.mute(!muted);
                  setMuted((value) => !value);
                }}
              >
                <MicOff className="mr-1 h-4 w-4" />
                {muted ? "取消静音" : "静音麦克风"}
              </Button>
            )}
            {phase === "active" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                返回聊天（保持语音）
              </Button>
            )}
            {phase !== "idle" && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void close()}
              >
                <PhoneOff className="mr-1 h-4 w-4" />
                结束语音
              </Button>
            )}
            {phase === "idle" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void close()}
              >
                取消
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
