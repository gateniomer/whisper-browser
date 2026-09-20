import { pipeline, env } from "@huggingface/transformers";

// Never look for models beside the app; always pull from the HF Hub.
env.allowLocalModels = false;

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
  const cache = await cacheStore();
  const keys = await cache.keys();
  return keys.map((r) => r.url);
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
  // If the deleted model is currently loaded, drop it.
  if (loadedKey && loadedKey.startsWith(`${modelId}|`)) {
    transcriber = null;
    loadedKey = null;
  }
  return n;
}

// ---------------------------------------------------------------------------

let transcriber = null;
let loadedKey = null;

// Transcriptions run one at a time. Live mode can queue several segments while
// one is still decoding; serializing keeps them in order and avoids races.
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
    progress_callback: (p) => self.postMessage({ type: "progress", data: p }),
  });
}

async function getTranscriber({ model, device }) {
  const key = `${model}|${device}`;
  if (transcriber && loadedKey === key) return transcriber;

  self.postMessage({ type: "status", data: "loading" });

  // If WebGPU isn't actually available (no adapter, headless/VM, blocklisted
  // GPU), silently fall back to CPU so the app still works.
  try {
    transcriber = await createPipeline({ model, device });
    loadedKey = key;
  } catch (err) {
    if (device === "webgpu") {
      self.postMessage({
        type: "notice",
        data: "WebGPU unavailable on this device — falling back to CPU (WASM).",
      });
      transcriber = await createPipeline({ model, device: "wasm" });
      loadedKey = `${model}|wasm`;
    } else {
      throw err;
    }
  }

  self.postMessage({ type: "status", data: "idle" });
  return transcriber;
}

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

// Whisper loves to emit short phrases like "you" or "thank you" on near-silent
// or noise-only audio. Drop those when the segment had little real speech.
function isNoiseOutput(text, speechSec) {
  if (typeof speechSec !== "number" || speechSec >= 1) return false;
  const norm = (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return NOISE_OUTPUTS.has(norm);
}

async function handleTranscribe(msg) {
  const pipe = await getTranscriber(msg);

  self.postMessage({ type: "status", data: "transcribing" });

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
    self.postMessage({
      type: "segment",
      id: msg.id,
      offset: msg.offset,
      data: output,
    });
  } else {
    self.postMessage({ type: "result", data: output });
  }
}

self.onmessage = async (event) => {
  const msg = event.data;

  // Warm-up: load the model ahead of time so the first segment isn't delayed.
  if (msg.type === "load") {
    try {
      await enqueue(() => getTranscriber(msg));
      self.postMessage({ type: "loaded", key: loadedKey });
    } catch (err) {
      self.postMessage({
        type: "error",
        data: String(err?.message || err),
        fatal: true,
      });
    }
    return;
  }

  // List everything currently stored.
  if (msg.type === "list") {
    self.postMessage({ type: "cache-list", urls: await listCache() });
    return;
  }

  // Download a model into the cache without keeping it loaded.
  if (msg.type === "download") {
    enqueue(async () => {
      try {
        self.postMessage({ type: "status", data: "loading" });
        const p = await createPipeline({ model: msg.model, device: msg.device });
        try {
          p.dispose?.();
        } catch {
          /* ignore */
        }
        self.postMessage({ type: "downloaded", model: msg.model });
      } catch (err) {
        self.postMessage({
          type: "download-error",
          model: msg.model,
          data: String(err?.message || err),
        });
      } finally {
        self.postMessage({ type: "status", data: "idle" });
        self.postMessage({ type: "cache-list", urls: await listCache() });
      }
    });
    return;
  }

  // Remove a model from the cache.
  if (msg.type === "delete") {
    enqueue(async () => {
      await deleteModel(msg.model);
      self.postMessage({ type: "cache-list", urls: await listCache() });
    });
    return;
  }

  if (msg.type !== "transcribe") return;

  try {
    await enqueue(() => handleTranscribe(msg));
  } catch (err) {
    self.postMessage({
      type: "error",
      data: String(err?.message || err),
      live: !!msg.live,
    });
  }
};
