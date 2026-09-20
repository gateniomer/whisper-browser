import { APP_NAME } from "../lib/constants.js";

export default function Splash({ label }) {
  return (
    <div className="app splash">
      <div className="splashInner">
        <div className="splashLogo">🎙️</div>
        <div className="splashName">{APP_NAME}</div>
        <div className="spinner" />
        <div className="splashLabel">{label}</div>
      </div>
    </div>
  );
}
