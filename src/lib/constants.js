export const DEFAULT_MODEL = "onnx-community/whisper-base";

export const MODELS = [
  { id: "onnx-community/whisper-tiny", label: "Whisper Tiny — 39M" },
  { id: "onnx-community/whisper-base", label: "Whisper Base — 74M" },
  { id: "onnx-community/whisper-small", label: "Whisper Small — 244M" },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo — 809M",
  },
];

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "auto", label: "Auto-detect" },
  { id: "zh", label: "Chinese" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
];

// Live segmentation tuning.
export const LIVE_TUNING = {
  vadMin: 0.01, // absolute RMS floor for speech
  noiseMult: 3, // speech must exceed the noise floor by this factor
  release: 0.6, // hysteresis: speech ends below this fraction of the start threshold
  silenceMs: 700, // pause long enough to end a segment
  trailingSilenceMs: 200, // keep only this much silence after speech ends
  preRollMs: 150, // keep this much audio before speech starts
  minSpeechSec: 0.5, // ignore segments with less actual speech than this
  maxSegmentSec: 12, // force a cut so segments stay short
};
