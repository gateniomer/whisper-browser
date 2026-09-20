import { MicIcon, StopIcon } from "./Icons.jsx";
import { fmt } from "../lib/format.js";

const BAR_SHAPE = [0.45, 0.75, 1, 0.75, 0.45];

export default function Dock({
  liveActive,
  starting,
  elapsed,
  level,
  disabled,
  onToggle,
}) {
  // Map RMS (~0–0.3) to a 0–1 visual level, with a visible idle baseline.
  const visual = Math.min(1, level * 7);

  return (
    <footer className="dock">
      <div className={"meter" + (liveActive ? " on" : "")} aria-hidden="true">
        {BAR_SHAPE.map((shape, i) => (
          <span
            key={i}
            style={{
              height: `${Math.round((0.32 + visual * shape * 0.68) * 100)}%`,
            }}
          />
        ))}
      </div>

      <button
        className={"micbtn" + (liveActive ? " live" : "")}
        onClick={onToggle}
        disabled={disabled}
        aria-label={liveActive ? "Stop live transcription" : "Start live transcription"}
      >
        {liveActive ? <StopIcon /> : <MicIcon />}
      </button>

      <div className="dockLabel">
        {liveActive
          ? `Listening · ${fmt(elapsed)}`
          : starting
            ? "Starting…"
            : "Tap to start live captions"}
      </div>
    </footer>
  );
}
