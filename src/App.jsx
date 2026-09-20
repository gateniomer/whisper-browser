import { useEffect, useRef, useState } from "react";
import workletUrl from "./pcm-worklet.js?url";
import { createEngine } from "./engine.js";

const MODELS = [
  { id: "onnx-community/whisper-base", label: "Whisper Base", size: "~140 MB" },
  { id: "onnx-community/whisper-tiny", label: "Whisper Tiny", size: "~40 MB" },
  { id: "onnx-community/whisper-small", label: "Whisper Small", size: "~500 MB" },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    size: "~1.5 GB",
  },
];

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "auto", label: "Auto-detect" },
  { id: "zh", label: "Chinese" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
];

// Live segmentation tuning.
const VAD_MIN = 0.01; // absolute RMS floor for speech
const VAD_NOISE_MULT = 3; // speech must exceed the noise floor by this factor
const VAD_RELEASE = 0.6; // hysteresis: speech ends below this fraction of the start threshold
const SILENCE_MS = 700; // pause long enough to end a segment
const TRAILING_SILENCE_MS = 200; // keep only this much silence after speech ends
const PRE_ROLL_MS = 150; // keep this much audio before speech starts
const MIN_SPEECH_SEC = 0.5; // ignore segments with less actual speech than this
const MAX_SEGMENT_SEC = 12; // force a cut so segments stay short

// The .onnx files transformers.js loads depend on the backend.
function requiredFiles(device) {
  return device === "webgpu"
    ? ["encoder_model.onnx", "decoder_model_merged.onnx"]
    : ["encoder_model_quantized.onnx", "decoder_model_merged_quantized.onnx"];
}

export default function App() {
  const engineRef = useRef(null);
  const recorderRef = useRef(null);
  const liveRef = useRef(null);
  const liveActiveRef = useRef(false);
  const liveConfigRef = useRef({ model: null, device: null, language: null });
  const speechChunksRef = useRef([]);
  const preRollRef = useRef([]);
  const speechMsRef = useRef(0);
  const silenceMsRef = useRef(0);
  const speakingRef = useRef(false);
  const liveOffsetRef = useRef(0);
  const segmentIdRef = useRef(0);
  const noiseFloorRef = useRef(0.005);
  const vadActiveRef = useRef(false);
  const loadWaitersRef = useRef([]);
  const loadedKeyRef = useRef(null);

  const [status, setStatus] = useState("idle"); // idle | loading | transcribing
  const [progress, setProgress] = useState(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [model, setModel] = useState(MODELS[0].id);
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("webgpu");
  const [result, setResult] = useState(null);
  const [segments, setSegments] = useState([]);
  const [pending, setPending] = useState(0);
  const [liveActive, setLiveActive] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // "checking" | "ready" | "no-adapter" | "unsupported" | "insecure"
  const [gpuStatus, setGpuStatus] = useState("checking");
  const [modelReady, setModelReady] = useState(false);
  const [cacheUrls, setCacheUrls] = useState([]);
  const [downloading, setDownloading] = useState(null);
  const [engineReady, setEngineReady] = useState(false);

  const deviceTouchedRef = useRef(false);

  // Choose where inference runs, then keep one engine:
  //  - WebGPU in a worker, when the browser exposes WorkerNavigator.gpu (Chrome);
  //  - otherwise WebGPU on the main thread, which every WebGPU browser exposes;
  //  - otherwise WASM in a worker (keeps the UI responsive).
  // The worker reports its own capability via a "caps" message first.
  useEffect(() => {
    let disposed = false;
    let worker = null;
    let localEngine = null;

    function handleMessage(msg) {
      const { type, data, live, id, offset } = msg;
      if (type === "progress") {
        setProgress(data);
        if (data.status === "progress" || data.status === "initiate") {
          setStatus("loading");
        }
      } else if (type === "status") {
        setStatus(data);
      } else if (type === "result") {
        setResult(data);
        setStatus("idle");
      } else if (type === "segment") {
        setPending((p) => Math.max(0, p - 1));
        const text = (data.text || "").trim();
        if (text) {
          setSegments((prev) =>
            [...prev, { id, offset, text }].sort((a, b) => a.id - b.id),
          );
        }
      } else if (type === "loaded") {
        loadedKeyRef.current = msg.key ?? null;
        const waiters = loadWaitersRef.current;
        loadWaitersRef.current = [];
        waiters.forEach((w) => w.resolve());
      } else if (type === "cache-list") {
        setCacheUrls(Array.isArray(data) ? data : []);
      } else if (type === "downloaded") {
        setDownloading(null);
      } else if (type === "download-error") {
        setDownloading(null);
        setError(data);
      } else if (type === "notice") {
        setNotice(data);
        setGpuStatus("no-adapter");
        setDevice("wasm");
      } else if (type === "error") {
        setError(data);
        setStatus("idle");
        if (live) setPending((p) => Math.max(0, p - 1));
        if (msg.fatal) {
          const waiters = loadWaitersRef.current;
          loadWaitersRef.current = [];
          waiters.forEach((w) => w.reject(new Error(data)));
        }
      }
    }

    const workerAdapter = {
      postMessage: (msg, transfer) => worker?.postMessage(msg, transfer),
    };

    function useLocalEngine() {
      localEngine = createEngine(handleMessage);
      engineRef.current = {
        postMessage: (msg) => {
          localEngine.handle(msg);
        },
      };
      worker?.terminate();
      worker = null;
    }

    async function decide(caps) {
      const windowStatus = await probeWebGPU();
      if (disposed) return;

      if (caps.webgpu) {
        engineRef.current = workerAdapter;
        setGpuStatus("ready");
        if (!deviceTouchedRef.current) setDevice("webgpu");
      } else if (windowStatus === "ready") {
        // The worker can't use WebGPU, but the window can.
        useLocalEngine();
        setGpuStatus("ready");
        setNotice(null);
        if (!deviceTouchedRef.current) setDevice("webgpu");
      } else {
        engineRef.current = workerAdapter;
        setGpuStatus(windowStatus);
        setNotice(gpuMessage(windowStatus));
        if (!deviceTouchedRef.current) setDevice("wasm");
      }

      setEngineReady(true);
      engineRef.current.postMessage({ type: "list" });
    }

    worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      if (e.data?.type === "caps") {
        decide(e.data);
        return;
      }
      handleMessage(e.data);
    };
    worker.onerror = (e) => setError(e.message);
    worker.postMessage({ type: "caps" });

    return () => {
      disposed = true;
      worker?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preload the selected model only if it is already downloaded.
  useEffect(() => {
    if (!engineReady || !engineRef.current) return;
    if (!isModelDownloaded(model)) {
      setModelReady(false);
      return;
    }
    let cancelled = false;
    setModelReady(false);
    ensureLoaded()
      .then(() => {
        if (!cancelled) setModelReady(true);
      })
      .catch(() => {
        if (!cancelled) setModelReady(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, model, device, cacheUrls]);

  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Tear down the live capture graph on unmount.
  useEffect(() => {
    return () => {
      liveActiveRef.current = false;
      const live = liveRef.current;
      if (live) {
        try {
          live.node.port.onmessage = null;
          live.source.disconnect();
          live.highpass?.disconnect();
          live.node.disconnect();
          live.gain.disconnect();
          live.stream.getTracks().forEach((t) => t.stop());
          live.ctx.close();
        } catch {
          /* already closed */
        }
      }
    };
  }, []);

  function isModelDownloaded(id) {
    const needs = requiredFiles(device);
    const urls = cacheUrls || [];
    return needs.every((n) =>
      urls.some((u) => u.includes(`/${id}/`) && u.endsWith(n)),
    );
  }

  function ensureLoaded() {
    const key = `${model}|${device}`;
    if (loadedKeyRef.current === key) return Promise.resolve();
    return new Promise((resolve, reject) => {
      loadWaitersRef.current.push({ resolve, reject });
      engineRef.current.postMessage({ type: "load", model, device });
    });
  }

  function downloadModel(id) {
    setError(null);
    setDownloading(id);
    engineRef.current.postMessage({ type: "download", model: id, device });
  }

  function deleteModel(id) {
    engineRef.current.postMessage({ type: "delete", model: id });
  }

  async function startRecording() {
    setError(null);
    setResult(null);
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
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const audio = await blobToMono16k(blob);
          setStatus("transcribing");
          engineRef.current.postMessage(
            {
              type: "transcribe",
              audio,
              model,
              device,
              language: language === "auto" ? null : language,
            },
            [audio.buffer],
          );
        } catch (err) {
          setError(String(err?.message || err));
          setStatus("idle");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function flushSegment(sampleRate) {
    const chunks = speechChunksRef.current;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const speechSec = speechMsRef.current / 1000;

    speechChunksRef.current = [];
    preRollRef.current = [];
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    speakingRef.current = false;

    // Drop blips and noise bursts: require a real amount of speech energy.
    if (speechSec < MIN_SPEECH_SEC || total === 0) return;

    const audio = new Float32Array(total);
    let at = 0;
    for (const c of chunks) {
      audio.set(c, at);
      at += c.length;
    }

    const offset = liveOffsetRef.current;
    liveOffsetRef.current += total / sampleRate;

    const id = ++segmentIdRef.current;
    const { model: m, device: d, language: l } = liveConfigRef.current;
    setPending((p) => p + 1);
    engineRef.current.postMessage(
      {
        type: "transcribe",
        audio,
        model: m,
        device: d,
        language: l,
        live: true,
        id,
        offset,
        speechSec,
      },
      [audio.buffer],
    );
  }

  function onFrame(samples, sampleRate) {
    const frameMs = (samples.length / sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);

    // Adaptive noise floor: track the ambient level while not in speech, then
    // require speech to rise clearly above it. Hysteresis stops rapid toggling.
    if (!vadActiveRef.current) {
      noiseFloorRef.current =
        0.95 * noiseFloorRef.current + 0.05 * Math.min(rms, 0.2);
    }
    const startTh = Math.max(VAD_MIN, noiseFloorRef.current * VAD_NOISE_MULT);
    const isSpeech = vadActiveRef.current
      ? rms > startTh * VAD_RELEASE
      : rms > startTh;
    if (isSpeech && !vadActiveRef.current) vadActiveRef.current = true;
    if (!isSpeech && vadActiveRef.current) vadActiveRef.current = false;

    if (!speakingRef.current) {
      if (!isSpeech) {
        // Remember a little audio so we don't clip the start of a word.
        const pre = preRollRef.current;
        pre.push(samples);
        const maxPre = Math.ceil((PRE_ROLL_MS / 1000) * sampleRate);
        let preTotal = pre.reduce((n, c) => n + c.length, 0);
        while (preTotal > maxPre && pre.length) {
          preTotal -= pre.shift().length;
        }
        return;
      }
      // Speech onset.
      speakingRef.current = true;
      speechChunksRef.current = [...preRollRef.current, samples];
      preRollRef.current = [];
      speechMsRef.current = frameMs;
      silenceMsRef.current = 0;
    } else if (isSpeech) {
      speechChunksRef.current.push(samples);
      speechMsRef.current += frameMs;
      silenceMsRef.current = 0;
    } else {
      silenceMsRef.current += frameMs;
      // Keep only a short bit of trailing silence (long silence makes Whisper
      // hallucinate things like "you").
      if (silenceMsRef.current <= TRAILING_SILENCE_MS) {
        speechChunksRef.current.push(samples);
      }
      if (silenceMsRef.current > SILENCE_MS) {
        flushSegment(sampleRate);
        return;
      }
    }

    const bufferedSec =
      speechChunksRef.current.reduce((n, c) => n + c.length, 0) / sampleRate;
    if (bufferedSec > MAX_SEGMENT_SEC) flushSegment(sampleRate);
  }

  async function startLive() {
    setError(null);
    setSegments([]);
    setPending(0);
    try {
      // Make sure the selected (downloaded) model is loaded before capturing.
      await ensureLoaded();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });

      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule(workletUrl);

      const source = ctx.createMediaStreamSource(stream);
      // Cut low rumble/hum so it doesn't pump the VAD.
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;
      highpass.Q.value = 0.7;

      const node = new AudioWorkletNode(ctx, "pcm-processor");
      const gain = ctx.createGain();
      gain.gain.value = 0; // keeps the graph pulled without echoing mic to speakers
      source.connect(highpass);
      highpass.connect(node);
      node.connect(gain);
      gain.connect(ctx.destination);

      liveConfigRef.current = {
        model,
        device,
        language: language === "auto" ? null : language,
      };
      speechChunksRef.current = [];
      preRollRef.current = [];
      speechMsRef.current = 0;
      silenceMsRef.current = 0;
      speakingRef.current = false;
      liveOffsetRef.current = 0;
      segmentIdRef.current = 0;
      noiseFloorRef.current = 0.005;
      vadActiveRef.current = false;

      node.port.onmessage = (e) => {
        if (liveActiveRef.current) onFrame(e.data, ctx.sampleRate);
      };

      liveRef.current = { ctx, stream, source, highpass, node, gain };
      liveActiveRef.current = true;
      setLiveActive(true);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function stopLive() {
    liveActiveRef.current = false;
    setLiveActive(false);

    const live = liveRef.current;
    if (live && speechChunksRef.current.length) {
      flushSegment(live.ctx.sampleRate);
    }
    if (live) {
      try {
        live.node.port.onmessage = null;
        live.source.disconnect();
        live.highpass?.disconnect();
        live.node.disconnect();
        live.gain.disconnect();
        live.stream.getTracks().forEach((t) => t.stop());
        await live.ctx.close();
      } catch {
        /* already closed */
      }
      liveRef.current = null;
    }
  }

  const busy = status === "loading" || status === "transcribing";
  const pct =
    progress && typeof progress.progress === "number"
      ? Math.round(progress.progress)
      : null;
  const locked = busy || recording || liveActive;
  const activeDownloaded = isModelDownloaded(model);

  const statusText = downloading
    ? `Downloading… ${pct ?? 0}%`
    : liveActive
      ? "Listening…"
      : !activeDownloaded
        ? "Model not downloaded"
        : !modelReady
          ? "Loading model…"
          : statusLabel(status);

  return (
    <div className="app">
      <h1>Whisper in the Browser</h1>
      <p className="sub">
        Download, manage, and run speech recognition locally. Audio never leaves
        your machine.
      </p>

      <div className="manager">
        <div className="managerHead">
          <h2>Models</h2>
          <span className="status">Stored in your browser</span>
        </div>
        <ul className="modelList">
          {MODELS.map((m) => {
            const downloaded = isModelDownloaded(m.id);
            const isActive = m.id === model;
            const isDling = downloading === m.id;
            return (
              <li key={m.id} className={isActive ? "model active" : "model"}>
                <div className="modelInfo">
                  <span className="modelName">{m.label}</span>
                  <span className="modelMeta">{m.size}</span>
                </div>
                <div className="modelActions">
                  <span className={downloaded ? "badge ok" : "badge"}>
                    {isDling
                      ? `Downloading ${pct ?? 0}%`
                      : downloaded
                        ? "Downloaded"
                        : "Not downloaded"}
                  </span>
                  {!downloaded && (
                    <button
                      className="ghost"
                      onClick={() => downloadModel(m.id)}
                      disabled={!!downloading}
                    >
                      Download
                    </button>
                  )}
                  {downloaded && (
                    <button
                      className="ghost"
                      onClick={() => deleteModel(m.id)}
                      disabled={!!downloading || (isActive && liveActive)}
                    >
                      Delete
                    </button>
                  )}
                  <button
                    className="ghost"
                    onClick={() => setModel(m.id)}
                    disabled={isActive || !downloaded || locked}
                  >
                    {isActive ? "Active" : "Use"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="controls">
        <label>
          Language
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={locked}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Device
          <select
            value={device}
            onChange={(e) => {
              deviceTouchedRef.current = true;
              setDevice(e.target.value);
            }}
            disabled={locked}
          >
            <option value="webgpu">
              WebGPU (GPU){gpuStatus === "ready" ? "" : " — may be unavailable"}
            </option>
            <option value="wasm">WASM (CPU)</option>
          </select>
        </label>
      </div>

      <div className="recordRow">
        <button
          className={recording ? "rec stop" : "rec"}
          onClick={recording ? stopRecording : startRecording}
          disabled={busy || liveActive || !modelReady}
        >
          {recording ? `Stop (${elapsed}s)` : "Record"}
        </button>

        <button
          className={liveActive ? "rec stop" : "rec live"}
          onClick={liveActive ? stopLive : startLive}
          disabled={!liveActive && (busy || recording || !modelReady)}
        >
          {liveActive ? "Stop live" : "Start live"}
        </button>

        <span className="status">{statusText}</span>
      </div>

      {(downloading || status === "loading") && (
        <div className="progress">
          <div className="bar">
            <div style={{ width: `${pct ?? 0}%` }} />
          </div>
          <span>
            {progress?.file || progress?.name || "Loading"}
            {pct != null ? ` — ${pct}%` : ""}
          </span>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result">
          <div className="resultHead">
            <h2>Transcript</h2>
            <button
              className="ghost"
              onClick={() => navigator.clipboard.writeText(result.text || "")}
            >
              Copy
            </button>
          </div>
          <p className="text">{result.text?.trim() || "(no speech detected)"}</p>

          {result.chunks?.length > 1 && (
            <ul className="chunks">
              {result.chunks.map((c, i) => (
                <li key={i}>
                  <time>{fmt(c.timestamp?.[0])}</time>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(liveActive || segments.length > 0) && (
        <div className="result">
          <div className="resultHead">
            <h2>Live transcript</h2>
            <div className="headActions">
              {pending > 0 && <span className="status">{pending} queued…</span>}
              <button
                className="ghost"
                onClick={() =>
                  navigator.clipboard.writeText(
                    segments.map((s) => `[${fmt(s.offset)}] ${s.text}`).join("\n"),
                  )
                }
              >
                Copy
              </button>
            </div>
          </div>

          {segments.length === 0 ? (
            <p className="text dim">
              {liveActive ? "Listening… start speaking." : "No speech captured."}
            </p>
          ) : (
            <ul className="chunks live">
              {segments.map((s) => (
                <li key={s.id}>
                  <time>{fmt(s.offset)}</time>
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function statusLabel(status) {
  if (status === "loading") return "Loading model…";
  if (status === "transcribing") return "Transcribing…";
  return "Ready";
}

function gpuMessage(status) {
  switch (status) {
    case "insecure":
      return "WebGPU requires an HTTPS (secure) origin, and this page is on HTTP — using CPU (WASM). It works, just slower.";
    case "unsupported":
      return "This browser doesn't support WebGPU — using CPU (WASM). It works, just slower.";
    case "no-adapter":
      return "No WebGPU adapter is available on this device — using CPU (WASM). It works, just slower.";
    default:
      return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

// Returns one of: "ready" | "no-adapter" | "unsupported" | "insecure".
// requestAdapter() can resolve null (or, in some Firefox builds, reject) if it
// is called before the GPU stack is ready, so retry with backoff before giving
// up. navigator.gpu is absent entirely in insecure contexts.
async function probeWebGPU() {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return typeof window !== "undefined" && !window.isSecureContext
      ? "insecure"
      : "unsupported";
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const adapter = await withTimeout(
        navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
        3000,
      );
      if (adapter) {
        // Some browsers/drivers hand out an adapter but fail when a device is
        // actually created, which is the step ONNX Runtime needs.
        try {
          const device = await withTimeout(adapter.requestDevice(), 3000);
          device.destroy?.();
          return "ready";
        } catch {
          /* fall through and retry */
        }
      }
    } catch {
      // Some builds reject instead of resolving null; treat as "not yet".
    }
    await sleep(400 * 2 ** attempt);
  }
  return "no-adapter";
}

function fmt(seconds) {
  if (seconds == null) return "--:--";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function blobToMono16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  const targetRate = 16000;
  const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, length, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
