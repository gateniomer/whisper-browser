import { pipeline, env } from "@huggingface/transformers";

// Never look for models beside the app; always pull from the HF Hub.
env.allowLocalModels = false;

// Serve the onnxruntime-web runtime from the CDN. The bundler cannot statically
// see ort's runtime files (it resolves them at runtime), so in a production
// build they would 404. Pin to the version @huggingface/transformers bundles.
const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
try {
  env.backends.onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
} catch {
  /* older/newer transformers may not expose this */
}

// ---------------------------------------------------------------------------
// A CacheStorage-backed cache that we fully control, so the UI can list and
// delete models. transformers.js reads/writes through this interface.
// ---------------------------------------------------------------------------
const CACHE_NAME = "whisper-models";

function cacheStore() {
  return caches.open(CACHE_NAME);
}

const modelCache = {
  async match(request) {
    const cache = await cacheStore();
    return (await cache.match(request)) || undefined;
  },
  async put(request, response) {
    const cache = await cacheStore();
    await cache.put(request, response);
  },
  async delete(request) {
    const cache = await cacheStore();
    return cache.delete(request);
  },
};

env.useCustomCache = true;
env.useBrowserCache = false;
env.customCache = modelCache;

async function listCache() {
  try {
    const cache = await cacheStore();
    const keys = await cache.keys();
    return keys.map((r) => r.url);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The engine. Create one per context (a Web Worker or the main thread) and give
// it a `post` function for outgoing messages.
// ---------------------------------------------------------------------------
const NOISE_OUTPUTS = new Set([
  "",
  "you",
  "thank you",
  "thanks",
  "thank you.",
  "bye",
  "bye bye",
  "okay",
  "yeah",
  "hmm",
  "um",
  "uh",
  "oh",
  "music",
  "you.",
  "thank you for watching",
  "please subscribe",
  "subscribe",
]);

function isNoiseOutput(text, speechSec) {
  if (typeof speechSec !== "number" || speechSec >= 1) return false;
  const norm = (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return NOISE_OUTPUTS.has(norm);
}

export function webgpuInThisContext() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function isSecureContextHere() {
  if (typeof self !== "undefined" && "isSecureContext" in self) {
    return self.isSecureContext;
  }
  return true;
}

export function createEngine(post) {
  let transcriber = null;
  let loadedKey = null;

  // Transcriptions run one at a time; live mode can queue several segments.
  let queue = Promise.resolve();
  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  function dtypeFor(device) {
    // WebGPU has no quantized kernel support in all backends, so use fp32 there.
    // WASM runs best with q8 weights.
    return device === "webgpu" ? "fp32" : "q8";
  }

  function createPipeline({ model, device }) {
    return pipeline("automatic-speech-recognition", model, {
      device,
      dtype: dtypeFor(device),
      progress_callback: (p) => post({ type: "progress", data: p }),
    });
  }

  async function getTranscriber({ model, device }) {
    const key = `${model}|${device}`;
    if (transcriber && loadedKey === key) return transcriber;

    post({ type: "status", data: "loading" });

    try {
      transcriber = await createPipeline({ model, device });
      loadedKey = key;
    } catch (err) {
      if (device === "webgpu") {
        post({
          type: "notice",
          data: isSecureContextHere()
            ? "WebGPU failed to initialize — falling back to CPU (WASM)."
            : "WebGPU requires an HTTPS (secure) origin — falling back to CPU (WASM).",
        });
        transcriber = await createPipeline({ model, device: "wasm" });
        loadedKey = `${model}|wasm`;
      } else {
        throw err;
      }
    }

    post({ type: "status", data: "idle" });
    return transcriber;
  }

  async function deleteModel(modelId) {
    const cache = await cacheStore();
    const keys = await cache.keys();
    let n = 0;
    for (const req of keys) {
      if (req.url.includes(`/${modelId}/`)) {
        await cache.delete(req);
        n++;
      }
    }
    if (loadedKey && loadedKey.startsWith(`${modelId}|`)) {
      transcriber = null;
      loadedKey = null;
    }
    return n;
  }

  async function handleTranscribe(msg) {
    const pipe = await getTranscriber(msg);

    post({ type: "status", data: "transcribing" });

    const output = await pipe(msg.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: "transcribe",
      ...(msg.language ? { language: msg.language } : {}),
    });

    if (msg.live && isNoiseOutput(output.text, msg.speechSec)) {
      output.text = "";
      if (output.chunks) output.chunks = [];
    }

    if (msg.live) {
      post({ type: "segment", id: msg.id, offset: msg.offset, data: output });
    } else {
      post({ type: "result", data: output });
    }
  }

  async function handle(msg) {
    if (msg.type === "caps") {
      post({
        type: "caps",
        webgpu: webgpuInThisContext(),
        secure: isSecureContextHere(),
      });
      return;
    }

    if (msg.type === "load") {
      try {
        await enqueue(() => getTranscriber(msg));
        post({ type: "loaded", key: loadedKey });
      } catch (err) {
        post({ type: "error", data: String(err?.message || err), fatal: true });
      }
      return;
    }

    if (msg.type === "list") {
      post({ type: "cache-list", data: await listCache() });
      return;
    }

    if (msg.type === "download") {
      enqueue(async () => {
        try {
          post({ type: "status", data: "loading" });
          const p = await createPipeline({
            model: msg.model,
            device: msg.device,
          });
          try {
            p.dispose?.();
          } catch {
            /* ignore */
          }
          post({ type: "downloaded", model: msg.model });
        } catch (err) {
          post({
            type: "download-error",
            model: msg.model,
            data: String(err?.message || err),
          });
        } finally {
          post({ type: "status", data: "idle" });
          post({ type: "cache-list", data: await listCache() });
        }
      });
      return;
    }

    if (msg.type === "delete") {
      enqueue(async () => {
        await deleteModel(msg.model);
        post({ type: "cache-list", data: await listCache() });
      });
      return;
    }

    if (msg.type !== "transcribe") return;

    try {
      await enqueue(() => handleTranscribe(msg));
    } catch (err) {
      post({
        type: "error",
        data: String(err?.message || err),
        live: !!msg.live,
      });
    }
  }

  return { handle };
}
