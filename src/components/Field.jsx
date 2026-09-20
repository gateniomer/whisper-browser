/**
 * Labelled form field used in the settings sheet: a small uppercase label,
 * a control, and an optional hint below it.
 */
export default function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
