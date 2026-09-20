import { SettingsIcon } from "./Icons.jsx";

const LED = { live: "led-live", rec: "led-rec", idle: "led-idle" };

export default function TopBar({
  mode = "idle",
  statusText,
  notice,
  onOpenSettings,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className={`led ${LED[mode] ?? LED.idle}`} />
        <span className="brandName">Whisper</span>
      </div>
      <div className="topActions">
        {notice && (
          <button
            className="chipWarn"
            onClick={onOpenSettings}
            title={notice}
            aria-label={notice}
          >
            <span className="chipDot" />
            CPU
          </button>
        )}
        <span className="pill">{statusText}</span>
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
