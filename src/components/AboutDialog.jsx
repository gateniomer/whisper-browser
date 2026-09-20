import { CloseIcon } from "./Icons.jsx";
import Backdrop from "./Backdrop.jsx";
import { APP_NAME, REPO_URL } from "../lib/constants.js";

export default function AboutDialog({ open, onClose }) {
  return (
    <>
      <Backdrop open={open} onClick={onClose} />
      <section
        className={"modal" + (open ? " open" : "")}
        aria-hidden={!open}
        inert={!open}
        role="dialog"
        aria-label={`About ${APP_NAME}`}
      >
        <div className="modalHead">
          <h2>About {APP_NAME}</h2>
          <button className="iconBtn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <p>
          {APP_NAME} turns speech into text entirely on your device. Your audio
          never leaves the browser, and it keeps working offline once a model is
          downloaded.
        </p>
        <p>
          It runs a choice of open speech models — Whisper, Moonshine and
          Distil-Whisper — so you can pick the right balance of speed, size and
          accuracy.
        </p>
        <p className="muted">More models may be added in the future.</p>
        <a
          className="link"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          View source on GitHub ↗
        </a>
      </section>
    </>
  );
}
