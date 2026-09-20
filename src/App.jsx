/**
 * Scribe — app shell.
 *
 * This file wires things together. The heavier logic lives in:
 *   - hooks/usePersistentSettings  remembered model/language/device
 *   - hooks/useEngine              engine selection + messaging + model/cache state
 *   - hooks/useLiveCapture         live capture + VAD segmentation
 *   - lib/viewState                pure derivation of the view state
 *   - lib/*                        framework-free helpers
 *   - components/*                 presentational UI
 */
import { useEffect, useRef, useState } from "react";
import TopBar from "./components/TopBar.jsx";
import Stage from "./components/Stage.jsx";
import Dock from "./components/Dock.jsx";
import SettingsSheet from "./components/SettingsSheet.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
import ModelInfoDialog from "./components/ModelInfoDialog.jsx";
import Splash from "./components/Splash.jsx";
import StatusStrip from "./components/StatusStrip.jsx";
import { useEngine } from "./hooks/useEngine.js";
import { useLiveCapture } from "./hooks/useLiveCapture.js";
import { usePersistentSettings } from "./hooks/usePersistentSettings.js";
import {
  MODELS,
  isEnglishOnly,
  isModelDownloaded,
  modelFamily,
  modelShortLabel,
} from "./lib/models.js";
import { deriveViewState } from "./lib/viewState.js";

const MAX_TRANSCRIBE_BOOT_MS = 10000;

export default function App() {
  const {
    model,
    setModel,
    language,
    setLanguage,
    device,
    setDevice,
    deviceTouchedRef,
  } = usePersistentSettings();

  const [segments, setSegments] = useState([]);
  const [partial, setPartial] = useState(null);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [booted, setBooted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [infoModel, setInfoModel] = useState(null);

  const pendingRef = useRef(0);
  const endRef = useRef(null);

  const engine = useEngine({
    onSegment: ({ id, offset, data }) => {
      setPending((p) => Math.max(0, p - 1));
      setPartial(null);
      const text = (data.text || "").trim();
      if (text) {
        setSegments((prev) =>
          [...prev, { id, offset, text }].sort((a, b) => a.id - b.id),
        );
      }
    },
    onPartial: ({ data, offset }) => {
      const text = (data?.text || "").trim();
      setPartial(text ? { text, offset } : null);
    },
    onLiveError: () => setPending((p) => Math.max(0, p - 1)),
  });

  // Adopt the engine's device recommendation unless the user picked one.
  useEffect(() => {
    if (!engine.suggestDevice || deviceTouchedRef.current) return;
    setDevice(engine.suggestDevice);
  }, [engine.suggestDevice]);

  const activeDownloaded = isModelDownloaded(
    model,
    device,
    engine.cacheUrls,
    engine.parakeetCached,
  );

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

  // Boot splash: until the engine is chosen and the initial model (if already
  // downloaded) is loaded.
  useEffect(() => {
    if (booted || !engine.ready) return;
    if (activeDownloaded && !modelReady) return;
    setBooted(true);
  }, [booted, engine.ready, activeDownloaded, modelReady]);

  // Safety net: never leave the user on the splash if the engine never reports.
  useEffect(() => {
    if (booted) return;
    const t = setTimeout(() => setBooted(true), MAX_TRANSCRIBE_BOOT_MS);
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
    onPartial: ({ audio, offset }) => {
      // Don't queue interim work behind committed segments.
      if (pendingRef.current > 0) return;
      engine.transcribe(
        {
          audio,
          model,
          device,
          language: transcribeLanguage,
          live: true,
          partial: true,
          offset,
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
  }, [segments, partial, live.liveActive]);

  // Track pending in a ref for the interim-text guard.
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const view = deriveViewState({
    engine,
    model,
    device,
    pending,
    modelReady,
    liveActive: live.liveActive,
    starting,
    segmentCount: segments.length,
    activeDownloaded,
  });

  async function toggleLive() {
    if (live.liveActive) {
      await live.stop();
      setPartial(null);
      return;
    }
    engine.setError(null);
    setStarting(true);
    setSegments([]);
    setPartial(null);
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
        modelLabel={activeDownloaded ? modelShortLabel(model) : null}
        modelTitle={MODELS.find((m) => m.id === model)?.label}
        deviceLabel={view.deviceLabel}
        deviceTitle={view.deviceHint}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <StatusStrip state={view.stripState} />

      <Stage
        error={engine.error}
        showEmpty={view.showEmpty}
        state={view.stageState}
        onChooseModel={() => setSettingsOpen(true)}
        liveActive={live.liveActive}
        segments={segments}
        partial={partial}
        endRef={endRef}
      />

      <Dock
        liveActive={live.liveActive}
        starting={starting}
        elapsed={elapsed}
        level={level}
        disabled={!live.liveActive && (view.busy || !modelReady || starting)}
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
        notice={view.deviceHint}
        locked={view.locked}
        manager={{
          models: MODELS,
          device,
          activeModel: model,
          cacheUrls: engine.cacheUrls,
          parakeetCached: engine.parakeetCached,
          downloading: engine.downloading,
          pct: view.pct,
          locked: view.locked,
          liveActive: live.liveActive,
          gpuReady: engine.gpuStatus === "ready",
          onDownload: (id) => engine.downloadModel({ model: id, device }),
          onDelete: engine.deleteModel,
          onUse: setModel,
          onInfo: setInfoModel,
        }}
      />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <ModelInfoDialog
        model={infoModel}
        device={device}
        gpuReady={engine.gpuStatus === "ready"}
        onClose={() => setInfoModel(null)}
      />
    </div>
  );
}
