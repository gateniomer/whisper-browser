import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL, MODELS } from "../lib/models.js";

const SETTINGS_KEY = "scribe:settings";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * Model / language / device, persisted to localStorage so the app reopens where
 * the user left off. The device is only persisted once the user picks one
 * manually, so first-run auto-detection still works.
 */
export function usePersistentSettings() {
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = loadSettings();
  const saved = savedRef.current;

  const [model, setModel] = useState(() =>
    MODELS.some((m) => m.id === saved.model) ? saved.model : DEFAULT_MODEL,
  );
  const [language, setLanguage] = useState(saved.language || "en");
  const [device, setDevice] = useState(saved.device || "webgpu");
  const deviceTouchedRef = useRef(!!saved.device);

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          model,
          language,
          ...(deviceTouchedRef.current ? { device } : {}),
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [model, language, device]);

  return {
    model,
    setModel,
    language,
    setLanguage,
    device,
    setDevice,
    deviceTouchedRef,
  };
}
