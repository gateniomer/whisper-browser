import {
  isModelDownloaded,
  requiresWebGPU,
  sizeLabel,
} from "../lib/models.js";
import { CheckIcon, DownloadIcon, InfoIcon, PlayIcon, TrashIcon } from "./Icons.jsx";

export default function ModelManager({
  models,
  device,
  activeModel,
  cacheUrls,
  parakeetCached,
  downloading,
  pct,
  locked,
  liveActive,
  gpuReady,
  onDownload,
  onDelete,
  onUse,
  onInfo,
}) {
  return (
    <>
      <div className="managerHead">
        <h3>Models</h3>
        <span className="muted small">Stored in your browser</span>
      </div>
      <ul className="modelList">
        {models.map((m) => {
          const downloaded = isModelDownloaded(
            m.id,
            device,
            cacheUrls,
            parakeetCached,
          );
          // Only a downloaded model counts as the active one.
          const isActive = downloaded && m.id === activeModel;
          const isDownloading = downloading === m.id;
          const blockedGPU = requiresWebGPU(m.id) && !gpuReady;

          let status = "Not downloaded";
          let tone = "";
          if (blockedGPU) {
            status = "Needs WebGPU";
            tone = "warn";
          } else if (isDownloading) {
            status = `Downloading ${pct ?? 0}%`;
            tone = "warn";
          } else if (downloaded) {
            status = "Downloaded";
            tone = "ok";
          }

          return (
            <li key={m.id} className={"model" + (isActive ? " active" : "")}>
              <div className="modelInfo">
                <div className="modelTitle">
                  <span className="modelName">{m.label}</span>
                  <button
                    className="infoDot"
                    onClick={() => onInfo(m)}
                    title="About this model"
                    aria-label={`About ${m.label}`}
                  >
                    <InfoIcon size={15} />
                  </button>
                </div>
                <span className="modelMeta">
                  <span>{sizeLabel(m.id, device)}</span>
                  <span className={"modelStatus" + (tone ? " " + tone : "")}>
                    {status}
                  </span>
                </span>
              </div>

              <div className="modelActions">
                {!downloaded && (
                  <button
                    className="iconBtn"
                    onClick={() => onDownload(m.id)}
                    disabled={!!downloading || blockedGPU}
                    title="Download"
                    aria-label={`Download ${m.label}`}
                  >
                    <DownloadIcon />
                  </button>
                )}
                {downloaded && (
                  <button
                    className="iconBtn"
                    onClick={() => onDelete(m.id)}
                    disabled={!!downloading || (isActive && liveActive)}
                    title="Delete"
                    aria-label={`Delete ${m.label}`}
                  >
                    <TrashIcon />
                  </button>
                )}
                <button
                  className={"iconBtn" + (isActive ? " accent" : "")}
                  onClick={() => onUse(m.id)}
                  disabled={isActive || !downloaded || locked || blockedGPU}
                  title={isActive ? "Active" : "Use"}
                  aria-label={isActive ? `${m.label} is active` : `Use ${m.label}`}
                >
                  {isActive ? <CheckIcon /> : <PlayIcon />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
