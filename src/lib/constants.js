export const APP_NAME = "Scribe";
export const REPO_URL = "https://github.com/gateniomer/whisper-browser";

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
  silenceMs: 500, // pause long enough to end a segment
  trailingSilenceMs: 200, // keep only this much silence after speech ends
  preRollMs: 150, // keep this much audio before speech starts
  minSpeechSec: 0.4, // ignore segments with less actual speech than this
  maxSegmentSec: 8, // force a cut so segments stay short
  partialMs: 800, // how often to refresh the provisional (interim) text
  partialWindowSec: 5, // only re-decode the last N seconds for interim text
};
