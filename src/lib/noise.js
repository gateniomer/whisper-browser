// Whisper likes to emit short phrases like "you" or "thank you" on near-silent
// or noise-only audio. Drop those when the segment had little real speech.
const NOISE_OUTPUTS = new Set([
  "",
  "you",
  "thank you",
  "thanks",
  "thank you.",
  "bye",
  "bye bye",
  "okay",
  "yeah",
  "hmm",
  "um",
  "uh",
  "oh",
  "music",
  "you.",
  "thank you for watching",
  "please subscribe",
  "subscribe",
]);

export function isNoiseOutput(text, speechSec) {
  if (typeof speechSec !== "number" || speechSec >= 1) return false;
  const norm = (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return NOISE_OUTPUTS.has(norm);
}
