import { fmt } from "../lib/format.js";

export default function Stage({
  error,
  showEmpty,
  activeDownloaded,
  onChooseModel,
  liveActive,
  segments,
  endRef,
}) {
  return (
    <main className="stage">
      {error && <div className="banner error">{error}</div>}

      {showEmpty && (
        <EmptyState hasModel={activeDownloaded} onChoose={onChooseModel} />
      )}

      {!showEmpty && (
        <ul className="lines">
          {segments.length === 0 && (
            <li className="line muted">
              {liveActive
                ? "Listening… start speaking."
                : "No speech captured yet."}
            </li>
          )}
          {segments.map((s) => (
            <li className="line" key={s.id}>
              <time>{fmt(s.offset)}</time>
              <span>{s.text}</span>
            </li>
          ))}
          <li ref={endRef} />
        </ul>
      )}
    </main>
  );
}

function EmptyState({ hasModel, onChoose }) {
  return (
    <div className="empty">
      <div className="emptyIcon">🎙️</div>
      <h2>{hasModel ? "Ready when you are" : "No model loaded"}</h2>
      <p>
        {hasModel
          ? "Tap the mic to start live, on-device captions."
          : "Download a model to get started — it runs entirely in your browser."}
      </p>
      {!hasModel && (
        <button className="primary" onClick={onChoose}>
          Choose a model
        </button>
      )}
    </div>
  );
}
