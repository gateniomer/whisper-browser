import { CloseIcon } from "./Icons.jsx";
import ModelManager from "./ModelManager.jsx";
import { LANGUAGES } from "../lib/constants.js";

export default function SettingsSheet({
  open,
  onClose,
  language,
  onLanguageChange,
  device,
  onDeviceChange,
  gpuStatus,
  locked,
  manager,
}) {
  return (
    <>
      <div
        className={"sheetBackdrop" + (open ? " show" : "")}
        onClick={onClose}
      />
      <section className={"sheet" + (open ? " open" : "")} aria-hidden={!open}>
        <div className="sheetHandle" />
        <div className="sheetHead">
          <h2>Settings</h2>
          <button className="iconBtn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="field">
          <label>Language</label>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={locked}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Device</label>
          <select
            value={device}
            onChange={(e) => onDeviceChange(e.target.value)}
            disabled={locked}
          >
            <option value="webgpu">
              WebGPU (GPU){gpuStatus === "ready" ? "" : " — may be unavailable"}
            </option>
            <option value="wasm">WASM (CPU)</option>
          </select>
        </div>

        <ModelManager {...manager} />
      </section>
    </>
  );
}
