/**
 * Parakeet engine: NVIDIA Parakeet TDT via parakeet.js (WebGPU/WASM).
 *
 * parakeet.js handles its own log-mel front-end, HF download and IndexedDB
 * caching. We open that same cache (see ./parakeetCache.js) so the model
 * manager can report per-model status and delete a single model.
 *
 * NOTE: experimental — needs on-device validation.
 */
import {
  deleteParakeetRepo,
  isParakeetRepoCached,
} from "./parakeetCache.js";

export function createParakeetEngine(post) {
  let model = null;
  let loadedKey = null;

  let queue = Promise.resolve();
  const enqueue = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  function backendFor(device) {
    return device === "wasm" ? "wasm" : "webgpu";
  }

  // Report which Parakeet models are present in the IndexedDB cache, by model
  // key (so it matches our catalog).
  async function publishCached() {
    try {
      const { MODELS } = await import("parakeet.js");
      const cached = [];
      for (const [key, cfg] of Object.entries(MODELS)) {
        if (await isParakeetRepoCached(cfg.repoId)) cached.push(key);
      }
      post({ type: "parakeet-cached", data: cached });
    } catch {
      post({ type: "parakeet-cached", data: [] });
    }
  }

  async function repoIdFor(modelKey) {
    const { getModelConfig } = await import("parakeet.js");
    return getModelConfig(modelKey)?.repoId ?? null;
  }

  async function getModel({ model: id, device }) {
    const key = `${id}|${device}`;
    if (model && loadedKey === key) return model;

    post({ type: "status", data: "loading" });
    const { fromHub } = await import("parakeet.js");

    model = await fromHub(id, {
      backend: backendFor(device),
      progress: (p) =>
        post({
          type: "progress",
          data: {
            status: "progress",
            file: p.file,
            loaded: p.loaded,
            total: p.total,
            overall: p.total ? Math.min(100, (p.loaded / p.total) * 100) : null,
          },
        }),
    });
    loadedKey = key;

    post({ type: "status", data: "idle" });
    await publishCached();
    return model;
  }

  async function handleTranscribe(msg) {
    const m = await getModel({ model: msg.model, device: msg.device });

    post({ type: "status", data: "transcribing" });

    // parakeet.js transcribes a whole clip; our VAD already hands it one
    // utterance per live segment. The text field is `utterance_text`.
    const result = await m.transcribe(msg.audio, 16000);
    const output = {
      text: (result?.utterance_text ?? result?.text ?? "").trim(),
    };

    if (msg.live) {
      post({ type: "segment", id: msg.id, offset: msg.offset, data: output });
    } else {
      post({ type: "result", data: output });
    }
    post({ type: "status", data: "idle" });
  }

  async function handle(msg) {
    switch (msg.type) {
      case "caps":
        post({
          type: "caps",
          webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
          secure: typeof self !== "undefined" ? !!self.isSecureContext : true,
        });
        return;

      case "list":
        await publishCached();
        return;

      case "load":
        try {
          await enqueue(() => getModel(msg));
          post({ type: "loaded", key: loadedKey });
        } catch (err) {
          post({
            type: "error",
            data: String(err?.message || err),
            fatal: true,
          });
        }
        return;

      case "download":
        enqueue(async () => {
          try {
            await getModel({ model: msg.model, device: msg.device });
            post({ type: "downloaded", model: msg.model });
          } catch (err) {
            post({
              type: "download-error",
              model: msg.model,
              data: String(err?.message || err),
            });
          } finally {
            post({ type: "status", data: "idle" });
            await publishCached();
          }
        });
        return;

      case "delete":
        enqueue(async () => {
          try {
            if (loadedKey && loadedKey.startsWith(`${msg.model}|`)) {
              model = null;
              loadedKey = null;
            }
            const repoId = await repoIdFor(msg.model);
            if (repoId) await deleteParakeetRepo(repoId);
          } catch {
            /* ignore */
          }
          await publishCached();
        });
        return;

      case "transcribe":
        try {
          await enqueue(() => handleTranscribe(msg));
        } catch (err) {
          post({
            type: "error",
            data: String(err?.message || err),
            live: !!msg.live,
          });
        }
        return;

      default:
        return;
    }
  }

  return { handle };
}
