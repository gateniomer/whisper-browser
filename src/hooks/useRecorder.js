import { useEffect, useRef, useState } from "react";
import { blobToMono16k } from "../lib/audio.js";

/**
 * One-shot microphone recording. Calls `onAudio` with 16 kHz mono Float32 PCM
 * once the user stops.
 */
export function useRecorder({ onAudio, onError } = {}) {
  const recorderRef = useRef(null);
  const cbRef = useRef({ onAudio, onError });
  cbRef.current = { onAudio, onError };

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(chunks, {
            type: recorder.mimeType || "audio/webm",
          });
          const audio = await blobToMono16k(blob);
          cbRef.current.onAudio?.(audio);
        } catch (err) {
          cbRef.current.onError?.(String(err?.message || err));
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      cbRef.current.onError?.(String(err?.message || err));
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return { recording, elapsed, start, stop };
}
