import { fmt } from "../lib/format.js";

export default function Stage({
  error,
  notice,
  showEmpty,
  activeDownloaded,
  onChooseModel,
  showLive,
  segments,
  endRef,
  showFinal,
  result,
}) {
  return (
    <main className="stage">
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner notice">{notice}</div>}

      {showEmpty && <EmptyState hasModel={activeDownloaded} onChoose={onChooseModel} />}

      {showLive && (
        <ul className="lines">
          {segments.length === 0 && (
            <li className="line muted">Listening… start speaking.</li>
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

      {showFinal && <FinalTranscript result={result} />}
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
          ? "Tap Go live for real-time captions, or Record to transcribe a clip."
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

function FinalTranscript({ result }) {
  return (
    <article className="final">
      <div className="finalHead">
        <h2>Transcript</h2>
        <button
          className="ghost"
          onClick={() => navigator.clipboard.writeText(result.text || "")}
        >
          Copy
        </button>
      </div>
      <p className="finalText">{result.text?.trim() || "(no speech detected)"}</p>

      {result.chunks?.length > 1 && (
        <ul className="lines small">
          {result.chunks.map((c, i) => (
            <li className="line" key={i}>
              <time>{fmt(c.timestamp?.[0])}</time>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
