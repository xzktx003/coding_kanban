// Coalesce simultaneous completions, including while native close() is pending.
// AudioContext owns native resources outside the JS heap; stop() alone leaks them.
let releaseActiveBeep: (() => void) | undefined;
let audioContext: AudioContext | undefined;
let closing = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function releaseAudioContext() {
  clearTimeout(idleTimer);
  const context = audioContext;
  audioContext = undefined;
  if (!context) return;
  closing = true;
  const closed = () => {
    closing = false;
  };
  try {
    void context.close().then(closed, closed);
  } catch {
    closed();
  }
}

export function playBeep() {
  if (releaseActiveBeep || closing || typeof window.AudioContext !== "function")
    return;
  let audioCtx: AudioContext;
  try {
    // Repeated new/close also churns native audio resources outside the JS heap.
    audioCtx = audioContext ??= new window.AudioContext();
  } catch {
    return;
  }
  clearTimeout(idleTimer);
  let oscillator: OscillatorNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    if (oscillator) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        /* Already ended or failed to start. */
      }
      try {
        oscillator.disconnect();
      } catch {
        /* Audio device unavailable. */
      }
      oscillator = undefined;
    }
    if (releaseActiveBeep === release) releaseActiveBeep = undefined;
    if (audioCtx.state === "suspended") releaseAudioContext();
    else idleTimer = setTimeout(releaseAudioContext, 30_000);
  };
  releaseActiveBeep = release;
  // A suspended/autoplay-blocked context may never reach its scheduled stop.
  // Wall time guarantees cleanup even when audio time is frozen.
  timer = setTimeout(release, 1000);
  try {
    oscillator = audioCtx.createOscillator();
    oscillator.onended = release;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
    oscillator.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(release);
  } catch {
    release();
    releaseAudioContext();
  }
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseActiveBeep?.();
    releaseAudioContext();
  });
