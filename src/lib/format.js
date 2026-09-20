export function fmt(seconds) {
  if (seconds == null) return "--:--";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Overall progress as a whole percent, preferring the engine's aggregated value.
export function progressPercent(progress) {
  if (!progress) return null;
  if (typeof progress.overall === "number") return Math.round(progress.overall);
  if (typeof progress.progress === "number") return Math.round(progress.progress);
  return null;
}

