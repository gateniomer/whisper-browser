import { useEffect, useRef, useState } from "react";

const SETTINGS_KEY = "scribe:settings";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * Language / device, persisted to localStorage. The model is intentionally NOT
 * persisted — the user chooses a model each session. The device is only
 * persisted once the user picks one manually, so first-run auto-detection still
 * works.
 */
export function usePersistentSettings() {
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = loadSettings();
  const saved = savedRef.current;

  const [language, setLanguage] = useState(saved.language || "en");
  const [device, setDevice] = useState(saved.device || "webgpu");
  const deviceTouchedRef = useRef(!!saved.device);

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          language,
          ...(deviceTouchedRef.current ? { device } : {}),
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [language, device]);

  return { language, setLanguage, device, setDevice, deviceTouchedRef };
}
