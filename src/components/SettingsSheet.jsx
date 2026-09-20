import { CloseIcon } from "./Icons.jsx";
import Backdrop from "./Backdrop.jsx";
import Field from "./Field.jsx";
import ModelManager from "./ModelManager.jsx";
import { LANGUAGES } from "../lib/constants.js";

export default function SettingsSheet({
  open,
  onClose,
  language,
  onLanguageChange,
  englishOnly,
  device,
  onDeviceChange,
  onResetDevice,
  gpuStatus,
  notice,
  locked,
  manager,
}) {
  return (
    <>
      <Backdrop open={open} onClick={onClose} />
      <section
        className={"sheet" + (open ? " open" : "")}
        inert={!open}
      >
        <div className="sheetHandle" />
        <div className="sheetHead">
          <h2>Settings</h2>
          <button className="iconBtn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <Field
          label={`Language${englishOnly ? " (model is English-only)" : ""}`}
        >
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={locked || englishOnly}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Device" hint={notice}>
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
          <button
            type="button"
            className="linkBtn"
            onClick={onResetDevice}
            disabled={locked}
          >
            Use recommended (auto)
          </button>
        </Field>

        <ModelManager {...manager} />
      </section>
    </>
  );
}
