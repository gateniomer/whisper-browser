import { InfoIcon, SettingsIcon } from "./Icons.jsx";
import { APP_NAME } from "../lib/constants.js";

const LED = { live: "led-live", rec: "led-rec", idle: "led-idle" };

export default function TopBar({
  mode = "idle",
  modelLabel,
  deviceLabel,
  deviceTitle,
  onOpenAbout,
  onOpenSettings,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className={`led ${LED[mode] ?? LED.idle}`} />
        <div className="brandText">
          <span className="brandName">{APP_NAME}</span>
          <span className="brandSub">{modelLabel || "No model selected"}</span>
        </div>
      </div>
      <div className="topActions">
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
