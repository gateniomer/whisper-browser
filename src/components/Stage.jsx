import { fmt } from "../lib/format.js";
import StateCard from "./StateCard.jsx";

export default function Stage({
  error,
  showEmpty,
  state,
  onChooseModel,
  liveActive,
  segments,
  endRef,
}) {
  return (
    <main className="stage">
      {error && <div className="banner error">{error}</div>}

      {showEmpty && <StateCard state={state} onChooseModel={onChooseModel} />}

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
