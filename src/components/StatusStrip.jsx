/**
 * Slim status strip shown under the header for transient model lifecycle
 * states: downloading, loading or transcribing. Hidden when idle/ready.
 *
 * state: { kind: 'downloading'|'loading'|'transcribing', label?, pct? } | null
 */
export default function StatusStrip({ state }) {
  if (!state) return null;
  const { kind, label, pct } = state;

  const text =
    kind === "downloading"
      ? `Downloading ${label}`
      : kind === "loading"
        ? "Loading model…"
        : "Transcribing…";
  const determinate = kind === "downloading" && pct != null;

  return (
    <div className={`statusStrip ${kind}`}>
      <div className="statusStripRow">
        <span className="spinner tiny" />
        <span className="statusStripLabel">{text}</span>
        {determinate && <span className="statusStripPct">{pct}%</span>}
      </div>
      <div
        className={"statusStripBar" + (determinate ? "" : " indeterminate")}
      >
        <div style={determinate ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  );
}
