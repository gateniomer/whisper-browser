import { fmt } from "../lib/format.js";
import StateCard from "./StateCard.jsx";

export default function Stage({
  error,
  showEmpty,
  state,
  onChooseModel,
  liveActive,
  segments,
  partial,
  endRef,
}) {
  return (
    <main className="stage">
      {error && <div className="banner error">{error}</div>}

      {showEmpty && <StateCard state={state} onChooseModel={onChooseModel} />}

      {!showEmpty && (
        <ul className="lines">
          {segments.length === 0 && (
            <li className="line muted" key="empty">
              {liveActive
                ? "Listening… start speaking."
                : "No speech captured yet."}
            </li>
          )}
          {segments.map((s) => (
            <li className="line" key={s.key ?? s.id ?? s.offset}>
              <time>{fmt(s.offset)}</time>
              <span>{s.text}</span>
            </li>
          ))}
          {partial && (
            <li className="line partial" key="partial">
              <time>{fmt(partial.offset)}</time>
              <span>{partial.text}</span>
            </li>
          )}
          <li key="end" ref={endRef} />
        </ul>
      )}
    </main>
  );
}
