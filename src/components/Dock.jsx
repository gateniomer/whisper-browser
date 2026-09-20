export default function Dock({
  recording,
  liveActive,
  elapsed,
  disabledRecord,
  disabledLive,
  onRecord,
  onLive,
}) {
  return (
    <footer className="dock">
      <button
        className={recording ? "btn stop" : "btn"}
        onClick={onRecord}
        disabled={disabledRecord}
      >
        <span className="btnIcon">{recording ? "■" : "●"}</span>
        {recording ? `Stop · ${elapsed}s` : "Record"}
      </button>

      <button
        className={liveActive ? "btn stop" : "btn primary"}
        onClick={onLive}
        disabled={disabledLive}
      >
        <span className="btnIcon">{liveActive ? "■" : "◉"}</span>
        {liveActive ? "Stop live" : "Go live"}
      </button>
    </footer>
  );
}
