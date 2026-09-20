import { InfoIcon, SettingsIcon } from "./Icons.jsx";
import { APP_NAME } from "../lib/constants.js";

const LED = { live: "led-live", rec: "led-rec", idle: "led-idle" };

export default function TopBar({
  mode = "idle",
  modelLabel,
  modelTitle,
  deviceLabel,
  deviceTitle,
  onOpenAbout,
  onOpenSettings,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className={`led ${LED[mode] ?? LED.idle}`} />
        <span className="brandName">{APP_NAME}</span>
      </div>
      <div className="topActions">
        {modelLabel && (
          <button
            className="chip model"
            onClick={onOpenSettings}
            title={modelTitle || undefined}
            aria-label={`Model: ${modelLabel}`}
          >
            <span className="chipText">{modelLabel}</span>
          </button>
        )}
        {deviceLabel && (
          <button
            className={"chip " + (deviceLabel === "GPU" ? "gpu" : "cpu")}
            onClick={onOpenSettings}
            title={deviceTitle || undefined}
            aria-label={`Running on ${deviceLabel}`}
          >
            <span className="chipDot" />
            {deviceLabel}
          </button>
        )}
        <button className="iconBtn" onClick={onOpenAbout} aria-label="About">
          <InfoIcon />
        </button>
        <button
          className="iconBtn"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
