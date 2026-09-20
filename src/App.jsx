/**
 * Whisper in the Browser — app shell.
 *
 * This file only wires things together. The heavier logic lives in:
 *   - hooks/useEngine       engine selection + messaging + model/cache state
 *   - hooks/useRecorder     one-shot recording
 *   - hooks/useLiveCapture  live capture + VAD segmentation
 *   - lib/*                 framework-free helpers (models, webgpu, audio, …)
 *   - components/*          presentational UI
 */
import { useEffect, useRef, useState } from "react";
import TopBar from "./components/TopBar.jsx";
import Stage from "./components/Stage.jsx";
import Dock from "./components/Dock.jsx";
import SettingsSheet from "./components/SettingsSheet.jsx";
import { useEngine } from "./hooks/useEngine.js";
import { useRecorder } from "./hooks/useRecorder.js";
import { useLiveCapture } from "./hooks/useLiveCapture.js";
import { DEFAULT_MODEL, MODELS } from "./lib/constants.js";
import { isModelDownloaded } from "./lib/models.js";
import { progressPercent, statusLabel } from "./lib/format.js";

export default function App() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("webgpu");
  const [segments, setSegments] = useState([]);
  const [pending, setPending] = useState(0);
  const [result, setResult] = useState(null);
  const [modelReady, setModelReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const deviceTouchedRef = useRef(false);
  const endRef = useRef(null);

  const engine = useEngine({
    onResult: (data) => setResult(data),
    onSegment: ({ id, offset, data }) => {
      setPending((p) => Math.max(0, p - 1));
      const text = (data.text || "").trim();
      if (text) {
        setSegments((prev) =>
          [...prev, { id, offset, text }].sort((a, b) => a.id - b.id),
        );
      }
    },
    onLiveError: () => setPending((p) => Math.max(0, p - 1)),
  });

  // Adopt the engine's device recommendation unless the user picked one.
  useEffect(() => {
    if (!engine.suggestDevice || deviceTouchedRef.current) return;
    setDevice(engine.suggestDevice);
  }, [engine.suggestDevice]);

  const activeDownloaded = isModelDownloaded(model, device, engine.cacheUrls);

  // Preload the active model only when it is already downloaded.
  useEffect(() => {
    if (!engine.ready) return;
    if (!activeDownloaded) {
      setModelReady(false);
      return;
    }
    let cancelled = false;
    setModelReady(false);
    engine
      .loadModel({ model, device })
      .then(() => !cancelled && setModelReady(true))
      .catch(() => !cancelled && setModelReady(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.ready, model, device, engine.cacheUrls]);

  const recorder = useRecorder({
    onAudio: (audio) => {
      engine.setStatus("transcribing");
      engine.transcribe(
        { audio, model, device, language: language === "auto" ? null : language },
        [audio.buffer],
      );
    },
    onError: engine.setError,
  });

  const live = useLiveCapture({
    onSegment: ({ id, offset, audio, speechSec }) => {
      setPending((p) => p + 1);
      engine.transcribe(
        {
          audio,
          model,
          device,
          language: language === "auto" ? null : language,
          live: true,
          id,
          offset,
          speechSec,
        },
        [audio.buffer],
      );
    },
    onError: engine.setError,
  });

  // Keep the newest live line in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [segments, live.liveActive]);

  const busy = engine.status === "loading" || engine.status === "transcribing";
  const pct = progressPercent(engine.progress);
  const locked = busy || recorder.recording || live.liveActive;

  const statusText = engine.downloading
    ? `Downloading… ${pct ?? 0}%`
    : live.liveActive
      ? pending > 0
        ? `Listening · ${pending} queued`
        : "Listening…"
      : !activeDownloaded
        ? "Model not downloaded"
        : !modelReady
          ? "Loading model…"
          : statusLabel(engine.status);

  const showLive = live.liveActive || segments.length > 0;
  const showFinal = !showLive && result;
  const showEmpty = !showLive && !showFinal;

  async function startLive() {
    engine.setError(null);
    setSegments([]);
    setPending(0);
    try {
      await engine.loadModel({ model, device });
      await live.start();
    } catch (err) {
      engine.setError(String(err?.message || err));
    }
  }

  function startRecording() {
    engine.setError(null);
    setResult(null);
    recorder.start();
  }

  function handleDeviceChange(value) {
    deviceTouchedRef.current = true;
    setDevice(value);
  }

  return (
    <div className="app">
      <TopBar
        mode={live.liveActive ? "live" : recorder.recording ? "rec" : "idle"}
        statusText={statusText}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {(engine.downloading || engine.status === "loading") && (
        <div className="loadbar">
          <div style={{ width: `${pct ?? 0}%` }} />
        </div>
      )}

      <Stage
        error={engine.error}
        notice={engine.notice}
        showEmpty={showEmpty}
        activeDownloaded={activeDownloaded}
        onChooseModel={() => setSettingsOpen(true)}
        showLive={showLive}
        segments={segments}
        endRef={endRef}
        showFinal={showFinal}
        result={result}
      />

      <Dock
        recording={recorder.recording}
        liveActive={live.liveActive}
        elapsed={recorder.elapsed}
        disabledRecord={busy || live.liveActive || !modelReady}
        disabledLive={
          !live.liveActive && (busy || recorder.recording || !modelReady)
        }
        onRecord={recorder.recording ? recorder.stop : startRecording}
        onLive={live.liveActive ? live.stop : startLive}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        language={language}
        onLanguageChange={setLanguage}
        device={device}
        onDeviceChange={handleDeviceChange}
        gpuStatus={engine.gpuStatus}
        locked={locked}
        manager={{
          models: MODELS,
          device,
          activeModel: model,
          cacheUrls: engine.cacheUrls,
          downloading: engine.downloading,
          pct,
          locked,
          liveActive: live.liveActive,
          onDownload: (id) => engine.downloadModel({ model: id, device }),
          onDelete: engine.deleteModel,
          onUse: setModel,
        }}
      />
    </div>
  );
}
