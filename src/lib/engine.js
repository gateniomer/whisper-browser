import { pipeline, env } from "@huggingface/transformers";
import { dtypesFor, modelFamily, requiredFiles } from "./models.js";

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

function webgpuInThisContext() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

// Presence of navigator.gpu isn't enough — verify an adapter is actually
// grantable in this context (worker vs main thread can differ).
async function webgpuUsableHere() {
  if (!webgpuInThisContext()) return false;
  try {
    const adapter = await withTimeout(navigator.gpu.requestAdapter(), 1500);
    return !!adapter;
  } catch {
    return false;
  }
}

function isSecureContextHere() {
  if (typeof self !== "undefined" && "isSecureContext" in self) {
    return self.isSecureContext;
  }
  return true;
}

// requestAdapter() can hang in some environments (headless, VMs, odd drivers).
// Never let that block the engine from reporting its capabilities.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
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

  // Progress arrives per file, so a single file's percentage jumps 0→100 over
  // and over. Aggregate bytes across every file, and use the model's real file
  // sizes (from the HF API) as the denominator so the bar only moves forward.
  const CONFIG_FILES = new Set([
    "config.json",
    "preprocessor_config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "vocab.json",
    "merges.txt",
    "normalizer.json",
  ]);

  let progFiles = new Map();
  let progExpected = 0;

  async function expectedBytes({ model, device }) {
    try {
      const res = await fetch(`https://huggingface.co/api/models/${model}?blobs=true`);
      if (!res.ok) return 0;
      const info = await res.json();
      const wanted = new Set(requiredFiles(model, device));
      let total = 0;
      for (const s of info.siblings || []) {
        const base = String(s.rfilename || "").replace(/^onnx\//, "");
        if (wanted.has(base) || CONFIG_FILES.has(base)) total += s.size || 0;
      }
      return total;
    } catch {
      return 0;
    }
  }

  // True when every required ONNX file is already cached, so a load won't hit
  // the network (and we can skip the size lookup entirely).
  async function fullyCached({ model, device }) {
    const needs = requiredFiles(model, device);
    const urls = await listCache();
    return needs.every((n) =>
      urls.some((u) => u.includes(`/${model}/`) && u.endsWith(n)),
    );
  }

  function onProgress(p) {
    if (p.file) {
      const e = progFiles.get(p.file) || { loaded: 0, total: 0 };
      if (typeof p.loaded === "number") e.loaded = p.loaded;
      if (typeof p.total === "number" && p.total) e.total = p.total;
      if (p.status === "done" && e.total) e.loaded = e.total;
      progFiles.set(p.file, e);
    }
    let loaded = 0;
    let total = 0;
    for (const e of progFiles.values()) {
      loaded += e.loaded;
      total += e.total;
    }
    const denom = Math.max(progExpected, total);
    const overall = denom > 0 ? Math.min(100, (loaded / denom) * 100) : null;
    post({ type: "progress", data: { ...p, overall } });
  }

  async function createPipeline({ model, device }) {
    progFiles = new Map();
    progExpected = (await fullyCached({ model, device }))
      ? 0
      : await expectedBytes({ model, device });
    return pipeline("automatic-speech-recognition", model, {
      device,
      dtype: dtypesFor(model, device),
      progress_callback: onProgress,
    });
  }

  // Acquire one adapter and hand it to ONNX Runtime, so ORT never makes its
  // own request (which is what fails with "Failed to get GPU adapter" when the
  // browser exposes navigator.gpu but can't actually grant an adapter).
  let sharedAdapter = null;
  async function acquireAdapter() {
    if (sharedAdapter) return sharedAdapter;
    try {
      if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
      const adapter = await withTimeout(
        navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
        2500,
      );
      if (!adapter) return null;
      try {
        env.backends.onnx.webgpu.adapter = adapter;
      } catch {
        /* not exposed in every ORT version */
      }
      sharedAdapter = adapter;
      return adapter;
    } catch {
      return null;
    }
  }

  function fallbackNotice() {
    return isSecureContextHere()
      ? "WebGPU couldn't be initialized in this browser — using CPU (WASM). It works, just slower."
      : "WebGPU requires an HTTPS (secure) origin — using CPU (WASM).";
  }

  // Build a pipeline, falling back from WebGPU to WASM if the GPU backend is
  // actually unusable. Returns the effective device for cache-key purposes.
  async function buildPipeline({ model, device }) {
    if (device === "webgpu") {
      const adapter = await acquireAdapter();
      if (!adapter) {
        post({ type: "notice", data: fallbackNotice() });
        return { pipe: await createPipeline({ model, device: "wasm" }), device: "wasm" };
      }
      try {
        return {
          pipe: await createPipeline({ model, device: "webgpu" }),
          device: "webgpu",
        };
      } catch {
        post({ type: "notice", data: fallbackNotice() });
        return { pipe: await createPipeline({ model, device: "wasm" }), device: "wasm" };
      }
    }
    return { pipe: await createPipeline({ model, device }), device };
  }

  async function getTranscriber({ model, device }) {
    const key = `${model}|${device}`;
    if (transcriber && loadedKey === key) return transcriber;

    post({ type: "status", data: "loading" });

    const { pipe, device: effective } = await buildPipeline({ model, device });
    transcriber = pipe;
    loadedKey = `${model}|${effective}`;

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

    // Decode options differ by model family. Whisper (and distil-whisper) take
    // chunking/language/timestamps; live segments skip timestamps because the
    // app timestamps them by segment offset and timestamp decoding costs
    // accuracy on short clips. Moonshine takes plain audio.
    let options = {};
    if (modelFamily(msg.model) === "whisper") {
      options = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: !msg.live,
        task: "transcribe",
        ...(msg.language ? { language: msg.language } : {}),
      };
    }

    const output = await pipe(msg.audio, options);

    if (msg.live && isNoiseOutput(output.text, msg.speechSec)) {
      output.text = "";
      if (output.chunks) output.chunks = [];
    }

    if (msg.live) {
      post({ type: "segment", id: msg.id, offset: msg.offset, data: output });
    } else {
      post({ type: "result", data: output });
    }

    // This unit of work is done. Live mode may still have segments queued; the
    // app keeps its controls disabled while any are pending.
    post({ type: "status", data: "idle" });
  }

  async function handle(msg) {
    if (msg.type === "caps") {
      post({
        type: "caps",
        webgpu: await webgpuUsableHere(),
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
          const { pipe } = await buildPipeline({
            model: msg.model,
            device: msg.device,
          });
          try {
            pipe.dispose?.();
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
