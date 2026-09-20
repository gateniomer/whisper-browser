import { useEffect, useRef, useState } from "react";
import { createEngine } from "../lib/engine.js";
import { probeWebGPU, gpuMessage } from "../lib/webgpu.js";

/**
 * Owns the inference engine and all messages with it.
 *
 * The engine may run in a Web Worker (when it can use WebGPU there, e.g.
 * Chrome) or on the main thread (when WebGPU is window-only, e.g. Firefox/
 * Safari). Either way this hook exposes the same small API to the app.
 *
 * @param {{ onResult?: Function, onSegment?: Function, onLiveError?: Function }} callbacks
 */
export function useEngine(callbacks = {}) {
  const engineRef = useRef(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const loadWaitersRef = useRef([]);
  const loadedKeyRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(null);
  const [cacheUrls, setCacheUrls] = useState([]);
  const [parakeetCached, setParakeetCached] = useState([]);
  const [downloading, setDownloading] = useState(null);
  const [gpuStatus, setGpuStatus] = useState("checking");
  const [suggestDevice, setSuggestDevice] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;
    let worker = null;
    let localEngine = null;

    function handle(msg) {
      switch (msg.type) {
        case "progress":
          setProgress(msg.data);
          if (msg.data.status === "progress" || msg.data.status === "initiate") {
            setStatus("loading");
          }
          break;
        case "status":
          // A fresh load clears any previous informational notice.
          if (msg.data === "loading") setNotice(null);
          setStatus(msg.data);
          break;
        case "result":
          cbRef.current.onResult?.(msg.data);
          setStatus("idle");
          break;
        case "segment":
          cbRef.current.onSegment?.(msg);
          break;
        case "loaded": {
          loadedKeyRef.current = msg.key ?? null;
          const waiters = loadWaitersRef.current;
          loadWaitersRef.current = [];
          waiters.forEach((w) => w.resolve());
          break;
        }
        case "cache-list":
          setCacheUrls(Array.isArray(msg.data) ? msg.data : []);
          break;
        case "parakeet-cached":
          setParakeetCached(Array.isArray(msg.data) ? msg.data : []);
          break;
        case "downloaded":
          setDownloading(null);
          break;
        case "download-error":
          setDownloading(null);
          setError(msg.data);
          break;
        case "gpu-fallback":
          // The GPU backend is unusable here (or failed): switch to CPU.
          setNotice(msg.data);
          setGpuStatus("no-adapter");
          setSuggestDevice("wasm");
          break;
        case "notice":
          // Informational only.
          setNotice(msg.data);
          break;
        case "error":
          setError(msg.data);
          setStatus("idle");
          if (msg.live) cbRef.current.onLiveError?.();
          if (msg.fatal) {
            const waiters = loadWaitersRef.current;
            loadWaitersRef.current = [];
            waiters.forEach((w) => w.reject(new Error(msg.data)));
          }
          break;
        default:
          break;
      }
    }

    const workerAdapter = {
      postMessage: (msg, transfer) => worker?.postMessage(msg, transfer),
    };

    function useLocalEngine() {
      localEngine = createEngine(handle);
      engineRef.current = {
        postMessage: (msg) => localEngine.handle(msg),
      };
      worker?.terminate();
      worker = null;
    }

    async function decide(caps) {
      if (!caps.webgpu) {
        // The worker can't use WebGPU; check whether the window can, and if so
        // run the engine on the main thread (Firefox/Safari/mobile).
        const windowStatus = await probeWebGPU();
        if (disposed) return;
        if (windowStatus === "ready") {
          useLocalEngine();
          setGpuStatus("ready");
          setNotice(null);
          setSuggestDevice("webgpu");
        } else {
          engineRef.current = workerAdapter;
          setGpuStatus(windowStatus);
          setNotice(gpuMessage(windowStatus));
          setSuggestDevice("wasm");
        }
      } else {
        engineRef.current = workerAdapter;
        setGpuStatus("ready");
        setSuggestDevice("webgpu");
      }

      setReady(true);
      engineRef.current.postMessage({ type: "list" });
    }

    worker = new Worker(new URL("../worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      if (e.data?.type === "caps") {
        decide(e.data);
        return;
      }
      handle(e.data);
    };
    worker.onerror = (e) => setError(e.message);
    worker.postMessage({ type: "caps" });

    return () => {
      disposed = true;
      worker?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function post(msg, transfer) {
    engineRef.current?.postMessage(msg, transfer);
  }

  function loadModel({ model, device }) {
    if (loadedKeyRef.current === `${model}|${device}`) return Promise.resolve();
    return new Promise((resolve, reject) => {
      loadWaitersRef.current.push({ resolve, reject });
      post({ type: "load", model, device });
    });
  }

  function downloadModel({ model, device }) {
    setError(null);
    setDownloading(model);
    post({ type: "download", model, device });
  }

  function deleteModel(model) {
    post({ type: "delete", model });
  }

  function transcribe(payload, transfer) {
    post({ type: "transcribe", ...payload }, transfer);
  }

  return {
    ready,
    status,
    setStatus,
    progress,
    cacheUrls,
    parakeetCached,
    downloading,
    gpuStatus,
    suggestDevice,
    notice,
    error,
    setError,
    loadModel,
    downloadModel,
    deleteModel,
    transcribe,
  };
}
