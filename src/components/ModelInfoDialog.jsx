import { CloseIcon } from "./Icons.jsx";
import Backdrop from "./Backdrop.jsx";
import { requiresWebGPU, resolveDevice, sizeLabel } from "../lib/models.js";

/**
 * Small popup describing a single model: what it is, its languages, size and
 * where it runs.
 */
export default function ModelInfoDialog({ model, device, gpuReady, onClose }) {
  if (!model) return null;

  const runsOn = requiresWebGPU(model.id)
    ? gpuReady
      ? "WebGPU (GPU)"
      : "Needs WebGPU"
    : resolveDevice(model.id, "webgpu") === "wasm"
      ? "CPU (WASM)"
      : "GPU (WebGPU) or CPU";

  return (
    <>
      <Backdrop open onClick={onClose} className="aboveSheet" />
      <section
        className="modal info open"
        role="dialog"
        aria-label={`About ${model.label}`}
      >
        <div className="modalHead">
          <h2>{model.label}</h2>
          <button className="iconBtn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <p>{model.description}</p>

        <dl className="facts">
          <div>
            <dt>Languages</dt>
            <dd>{model.languages}</dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>{sizeLabel(model.id, device)}</dd>
          </div>
          <div>
            <dt>Runs on</dt>
            <dd>{runsOn}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
