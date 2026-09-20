export default function Splash({ label }) {
  return (
    <div className="app splash">
      <div className="splashInner">
        <div className="splashLogo">🎙️</div>
        <div className="splashName">Whisper</div>
        <div className="spinner" />
        <div className="splashLabel">{label}</div>
      </div>
    </div>
  );
}
