import { isModelDownloaded, sizeLabel } from "../lib/models.js";

export default function ModelManager({
  models,
  device,
  activeModel,
  cacheUrls,
  downloading,
  pct,
  locked,
  liveActive,
  onDownload,
  onDelete,
  onUse,
}) {
  return (
    <>
      <div className="managerHead">
        <h3>Models</h3>
        <span className="muted small">Stored in your browser</span>
      </div>
      <ul className="modelList">
        {models.map((m) => {
          const downloaded = isModelDownloaded(m.id, device, cacheUrls);
          const isActive = m.id === activeModel;
          const isDownloading = downloading === m.id;
          return (
            <li key={m.id} className={isActive ? "model active" : "model"}>
              <div className="modelInfo">
                <span className="modelName">{m.label}</span>
                <span className="modelMeta">{sizeLabel(m.id, device)}</span>
              </div>
              <div className="modelActions">
                <span className={downloaded ? "badge ok" : "badge"}>
                  {isDownloading
                    ? `Downloading ${pct ?? 0}%`
                    : downloaded
                      ? "Downloaded"
                      : "Not downloaded"}
                </span>
                {!downloaded && (
                  <button
                    className="ghost"
                    onClick={() => onDownload(m.id)}
                    disabled={!!downloading}
                  >
                    Download
                  </button>
                )}
                {downloaded && (
                  <button
                    className="ghost"
                    onClick={() => onDelete(m.id)}
                    disabled={!!downloading || (isActive && liveActive)}
                  >
                    Delete
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() => onUse(m.id)}
                  disabled={isActive || !downloaded || locked}
                >
                  {isActive ? "Active" : "Use"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
