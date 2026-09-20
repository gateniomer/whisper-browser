// Pure derivation of the app's view state from engine/model state. Kept free of
// React so it can be read and tested in isolation.
import { MODELS, resolveDevice } from "./models.js";
import { gpuMessage } from "./webgpu.js";
import { progressPercent } from "./format.js";

export function deriveViewState({
  engine,
  model,
  device,
  pending,
  modelReady,
  liveActive,
  starting,
  segmentCount,
  activeDownloaded,
}) {
  const busy =
    engine.status === "loading" ||
    engine.status === "transcribing" ||
    pending > 0;
  const pct = progressPercent(engine.progress);
  const locked = busy || liveActive || starting;
  const showEmpty = !liveActive && !starting && segmentCount === 0;

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

  const downloadingLabel = engine.downloading
    ? (MODELS.find((m) => m.id === engine.downloading)?.label ??
      engine.downloading)
    : null;

  // What the stage's central card should say when there's no transcript yet.
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

  return {
    busy,
    pct,
    locked,
    showEmpty,
    deviceLabel,
    deviceHint,
    downloadingLabel,
    stageState,
    stripState,
  };
}
