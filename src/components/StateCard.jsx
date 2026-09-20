/**
 * Central state card for the stage when there is no transcript yet.
 * kind: 'downloading' | 'loading' | 'no-model' | 'ready'
 */
export default function StateCard({ state, onChooseModel }) {
  const { kind, label, pct } = state;

  if (kind === "no-model") {
    return (
      <div className="empty">
        <div className="emptyIcon">🎙️</div>
        <h2>No model loaded</h2>
        <p>Download a model to get started — it runs entirely in your browser.</p>
        <button className="primary" onClick={onChooseModel}>
          Choose a model
        </button>
      </div>
    );
  }

  if (kind === "ready") {
    return (
      <div className="empty">
        <div className="emptyIcon">🎙️</div>
        <h2>Ready when you are</h2>
        <p>Tap the mic to start live, on-device captions.</p>
      </div>
    );
  }

  const downloading = kind === "downloading";
  return (
    <div className="statecard">
      <div className="spinner" />
      <h2>{downloading ? `Downloading ${label}` : "Loading model…"}</h2>
      <p>
        {downloading
          ? pct != null
            ? `${pct}%`
            : "Starting…"
          : "Preparing it on your device"}
      </p>
      {downloading && (
        <div className="stateBar">
          <div style={{ width: `${pct ?? 0}%` }} />
        </div>
      )}
    </div>
  );
}
