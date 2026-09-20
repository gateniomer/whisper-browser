/**
 * Scribe — app shell.
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
import AboutDialog from "./components/AboutDialog.jsx";
import ModelInfoDialog from "./components/ModelInfoDialog.jsx";
import Splash from "./components/Splash.jsx";
import StatusStrip from "./components/StatusStrip.jsx";
import { useEngine } from "./hooks/useEngine.js";
import { useLiveCapture } from "./hooks/useLiveCapture.js";
import {
  DEFAULT_MODEL,
  MODELS,
  isEnglishOnly,
  isModelDownloaded,
  modelFamily,
  modelShortLabel,
  resolveDevice,
} from "./lib/models.js";
import { gpuMessage } from "./lib/webgpu.js";
import { progressPercent } from "./lib/format.js";

const SETTINGS_KEY = "scribe:settings";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export default function App() {
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = loadSettings();
  const saved = savedRef.current;

  const [model, setModel] = useState(() =>
    MODELS.some((m) => m.id === saved.model) ? saved.model : DEFAULT_MODEL,
  );
  const [language, setLanguage] = useState(saved.language || "en");
  const [device, setDevice] = useState(saved.device || "webgpu");
  const [segments, setSegments] = useState([]);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [booted, setBooted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [infoModel, setInfoModel] = useState(null);

  const deviceTouchedRef = useRef(!!saved.device);
  const endRef = useRef(null);

  // Persist user choices so the app doesn't fall back to the default model.
  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          model,
          language,
          ...(deviceTouchedRef.current ? { device } : {}),
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [model, language, device]);

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

  // Persistent GPU/CPU indicator, based on what the active model will use.
  const onGPU =
    device === "webgpu" &&
    engine.gpuStatus === "ready" &&
    resolveDevice(model, "webgpu") === "webgpu";
  const deviceLabel =
    engine.gpuStatus === "checking" ? null : onGPU ? "GPU" : "CPU";
  const deviceHint =
    engine.notice ||
    (engine.gpuStatus !== "ready" && engine.gpuStatus !== "checking"
      ? gpuMessage(engine.gpuStatus)
      : null);

  // What the stage's central card should say when there's no transcript yet.
  const downloadingLabel = engine.downloading
    ? (MODELS.find((m) => m.id === engine.downloading)?.label ??
      engine.downloading)
    : null;
  let stageState;
  if (engine.downloading) {
    stageState = { kind: "downloading", label: downloadingLabel, pct };
  } else if (
    !engine.error &&
    (engine.status === "loading" || (activeDownloaded && !modelReady))
  ) {
    stageState = { kind: "loading" };
  } else if (!activeDownloaded) {
    stageState = { kind: "no-model" };
  } else {
    stageState = { kind: "ready" };
  }

  // Transient status shown under the header, even mid-transcript.
  const stripState = engine.downloading
    ? { kind: "downloading", label: downloadingLabel, pct }
    : engine.status === "loading"
      ? { kind: "loading" }
      : pending > 0
        ? { kind: "transcribing" }
        : null;

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
        modelLabel={activeDownloaded ? modelShortLabel(model) : null}
        modelTitle={MODELS.find((m) => m.id === model)?.label}
        deviceLabel={deviceLabel}
        deviceTitle={deviceHint}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <StatusStrip state={stripState} />

      <Stage
        error={engine.error}
        showEmpty={showEmpty}
        state={stageState}
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
        notice={deviceHint}
        locked={locked}
        manager={{
          models: MODELS,
          device,
          activeModel: model,
          cacheUrls: engine.cacheUrls,
          parakeetCached: engine.parakeetCached,
          downloading: engine.downloading,
          pct,
          locked,
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
