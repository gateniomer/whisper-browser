/**
 * Whisper in the Browser — app shell.
 *
 * This file only wires things together. The heavier logic lives in:
 *   - hooks/useEngine       engine selection + messaging + model/cache state
 *   - hooks/useLiveCapture  live capture + VAD segmentation
 *   - lib/*                 framework-free helpers (models, webgpu, format, …)
 *   - components/*          presentational UI
 */
import { useEffect, useRef, useState } from "react";
import TopBar from "./components/TopBar.jsx";
import Stage from "./components/Stage.jsx";
import Dock from "./components/Dock.jsx";
import SettingsSheet from "./components/SettingsSheet.jsx";
import Splash from "./components/Splash.jsx";
import { useEngine } from "./hooks/useEngine.js";
import { useLiveCapture } from "./hooks/useLiveCapture.js";
import {
  DEFAULT_MODEL,
  MODELS,
  isEnglishOnly,
  isModelDownloaded,
  modelFamily,
} from "./lib/models.js";
import { progressPercent, statusLabel } from "./lib/format.js";

export default function App() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("webgpu");
  const [segments, setSegments] = useState([]);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [booted, setBooted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const deviceTouchedRef = useRef(false);
  const endRef = useRef(null);

  const engine = useEngine({
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

  // English-only models ignore the language picker; Whisper-family English
  // models are pinned to "en", Moonshine takes no language option at all.
  const englishOnly = isEnglishOnly(model);
  const transcribeLanguage = englishOnly
    ? modelFamily(model) === "whisper"
      ? "en"
      : null
    : language === "auto"
      ? null
      : language;

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

  // Boot screen: shown until the engine is chosen (GPU probe done) and the
  // initially-selected model — if already downloaded — is loaded. Runs once.
  useEffect(() => {
    if (booted || !engine.ready) return;
    if (activeDownloaded && !modelReady) return;
    setBooted(true);
  }, [booted, engine.ready, activeDownloaded, modelReady]);

  // Safety net: never leave the user on the splash if the engine never reports.
  useEffect(() => {
    if (booted) return;
    const t = setTimeout(() => setBooted(true), 10000);
    return () => clearTimeout(t);
  }, [booted]);

  const live = useLiveCapture({
    onSegment: ({ id, offset, audio, speechSec }) => {
      setPending((p) => p + 1);
      engine.transcribe(
        {
          audio,
          model,
          device,
          language: transcribeLanguage,
          live: true,
          id,
          offset,
          speechSec,
        },
        [audio.buffer],
      );
    },
    onError: engine.setError,
    onLevel: setLevel,
  });

  // Running clock while live.
  useEffect(() => {
    if (!live.liveActive) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live.liveActive]);

  // Keep the newest line in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [segments, live.liveActive]);

  const busy =
    engine.status === "loading" ||
    engine.status === "transcribing" ||
    pending > 0;
  const pct = progressPercent(engine.progress);
  const locked = busy || live.liveActive || starting;
  const showEmpty = !live.liveActive && !starting && segments.length === 0;

  const statusText = engine.downloading
    ? `Downloading… ${pct ?? 0}%`
    : starting
      ? "Starting…"
      : live.liveActive
        ? pending > 0
          ? `Listening · ${pending} queued`
          : "Listening…"
        : !activeDownloaded
          ? "Model not downloaded"
          : !modelReady
            ? "Loading model…"
            : statusLabel(engine.status);

  async function toggleLive() {
    if (live.liveActive) {
      await live.stop();
      return;
    }
    engine.setError(null);
    setStarting(true);
    setSegments([]);
    setPending(0);
    try {
      await engine.loadModel({ model, device });
      await live.start();
    } catch (err) {
      engine.setError(String(err?.message || err));
    } finally {
      setStarting(false);
    }
  }

  function handleDeviceChange(value) {
    deviceTouchedRef.current = true;
    setDevice(value);
  }

  if (!booted) {
    return (
      <Splash
        label={
          engine.ready
            ? "Loading model…"
            : "Setting up on-device transcription…"
        }
      />
    );
  }

  return (
    <div className="app">
      <TopBar
        mode={live.liveActive ? "live" : "idle"}
        statusText={statusText}
        notice={engine.notice}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {(engine.downloading || engine.status === "loading") && (
        <div className="loadbar">
          <div style={{ width: `${pct ?? 0}%` }} />
        </div>
      )}

      <Stage
        error={engine.error}
        showEmpty={showEmpty}
        activeDownloaded={activeDownloaded}
        onChooseModel={() => setSettingsOpen(true)}
        liveActive={live.liveActive}
        segments={segments}
        endRef={endRef}
      />

      <Dock
        liveActive={live.liveActive}
        starting={starting}
        elapsed={elapsed}
        level={level}
        disabled={!live.liveActive && (busy || !modelReady || starting)}
        onToggle={toggleLive}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        language={language}
        onLanguageChange={setLanguage}
        englishOnly={englishOnly}
        device={device}
        onDeviceChange={handleDeviceChange}
        gpuStatus={engine.gpuStatus}
        notice={engine.notice}
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
