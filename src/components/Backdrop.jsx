/**
 * Faded overlay behind modal surfaces (settings sheet, about dialog).
 * Clicking it dismisses the surface it belongs to.
 */
export default function Backdrop({ open, onClick }) {
  return (
    <div
      className={"backdrop" + (open ? " show" : "")}
      onClick={onClick}
      aria-hidden="true"
    />
  );
}
