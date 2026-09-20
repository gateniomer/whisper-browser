/**
 * Transformers.js engine: runs Whisper / Moonshine / Cohere through
 * @huggingface/transformers + ONNX Runtime Web. Created by the engine router
 * (../engine.js) and given a `post` function for outgoing messages.
 */
import { pipeline, env } from "@huggingface/transformers";
import {
  dtypesFor,
  modelFamily,
  requiresWebGPU,
  resolveDevice,
} from "../models.js";
import { isNoiseOutput } from "../noise.js";
import {
  isSecureContextHere,
  webgpuInThisContext,
  webgpuUsableHere,
  withTimeout,
} from "./capabilities.js";
import {
  createProgressTracker,
  deleteModelFiles,
  listCache,
  modelCache,
} from "./modelCache.js";

// Never look for models beside the app; always pull from the HF Hub.
env.allowLocalModels = false;

// Serve the onnxruntime-web runtime from the CDN. The bundler cannot statically
// see ort's runtime files (it resolves them at runtime), so in a production
// build they would 404. Pin to the version @huggingface/transformers bundles.
const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
try {
  env.backends.onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  env.backends.onnx.wasm.simd = true;
  // WASM multi-threading only works in a cross-origin-isolated context
  // (COOP/COEP). Set it explicitly when available; otherwise ORT falls back to
  // single-threaded anyway, and setting it would just log a warning.
  if (
    typeof self !== "undefined" &&
    self.crossOriginIsolated &&
    typeof navigator !== "undefined" &&
    navigator.hardwareConcurrency
  ) {
    env.backends.onnx.wasm.numThreads = Math.min(
      navigator.hardwareConcurrency,
      4,
    );
  }
} catch {
  /* older/newer transformers may not expose this */
}

// Route transformers.js model I/O through our own cache so the app can manage
// (list/delete) downloaded models.
env.useCustomCache = true;
env.useBrowserCache = false;
env.customCache = modelCache;

/** Decode options differ by model family (see the catalog in ../models.js). */
function decodeOptions(msg) {
  const family = modelFamily(msg.model);
  if (family === "whisper") {
    // Bound the decoder by audio length so a bad segment can't run long.
    const seconds = msg.audio.length / 16000;
    return {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: !msg.live,
      task: "transcribe",
      max_new_tokens: Math.min(448, Math.max(16, Math.ceil(seconds * 6) + 8)),
      ...(msg.language ? { language: msg.language } : {}),
    };
  }
  if (family === "cohere") {
    return { ...(msg.language ? { language: msg.language } : {}) };
  }
  return {}; // moonshine takes plain audio
}

export function createTransformersEngine(post) {
  let transcriber = null;
  let loadedKey = null;
  let warmed = false;
  let partialQueued = false;
  let sharedAdapter = null;

  // Transcriptions run one at a time; live mode can queue several segments.
  let queue = Promise.resolve();
  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  const progress = createProgressTracker(post);

  async function createPipeline({ model, device }) {
    const dev = resolveDevice(model, device);
    await progress.prepare({ model, device: dev });
    return pipeline("automatic-speech-recognition", model, {
      device: dev,
      dtype: dtypesFor(model, device),
      progress_callback: progress.callback,
    });
  }

  // Acquire one adapter and hand it to ONNX Runtime, so ORT never makes its
  // own request (which is what fails with "Failed to get GPU adapter" when the
  // browser exposes navigator.gpu but can't actually grant an adapter).
  async function acquireAdapter() {
    if (sharedAdapter) return sharedAdapter;
    try {
      if (!webgpuInThisContext()) return null;
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
    const dev = resolveDevice(model, device);

    if (requiresWebGPU(model) && dev !== "webgpu") {
      throw new Error(
        "This model needs WebGPU — its kernels aren't supported on the CPU. " +
          "Switch Device to WebGPU (Chrome/Edge) or choose another model.",
      );
    }

    if (dev !== device) {
      // e.g. a large Whisper model requested on WebGPU runs on CPU instead.
      post({
        type: "notice",
        data: "Large models run on CPU (WASM) — WebGPU isn't reliable for them yet.",
      });
    }

    if (dev === "webgpu") {
      const adapter = await acquireAdapter();
      try {
        if (!adapter) throw new Error("no adapter");
        return {
          pipe: await createPipeline({ model, device: "webgpu" }),
          device: "webgpu",
        };
      } catch {
        post({ type: "gpu-fallback", data: fallbackNotice() });
        return {
          pipe: await createPipeline({ model, device: "wasm" }),
          device: "wasm",
        };
      }
    }

    return { pipe: await createPipeline({ model, device: dev }), device: dev };
  }

  async function getTranscriber({ model, device }) {
    const key = `${model}|${resolveDevice(model, device)}`;
    if (transcriber && loadedKey === key) return transcriber;

    post({ type: "status", data: "loading" });

    const { pipe, device: effective } = await buildPipeline({ model, device });
    transcriber = pipe;
    loadedKey = `${model}|${effective}`;

    // Warm-up pass: compile the WASM kernels on a short silent clip so the
    // first real utterance isn't the slow one. Result is discarded.
    if (!warmed) {
      warmed = true;
      try {
        await transcriber(new Float32Array(16000));
      } catch {
        /* warming is best-effort */
      }
    }

    post({ type: "status", data: "idle" });
    return transcriber;
  }

  async function dropTranscriber(modelId) {
    if (loadedKey && loadedKey.startsWith(`${modelId}|`)) {
      transcriber = null;
      loadedKey = null;
    }
  }

  async function runTranscribe(msg) {
    const pipe = await getTranscriber(msg);

    // Interim decodes run often; skip the status churn for them.
    if (!msg.partial) post({ type: "status", data: "transcribing" });

    let output;
    try {
      output = await pipe(msg.audio, decodeOptions(msg));
    } catch (err) {
      // GPU kernels can fail at run time (e.g. MatMulNBits on WebGPU). Drop the
      // broken pipeline and tell the app to fall back to CPU.
      if (loadedKey && loadedKey.endsWith("|webgpu")) {
        transcriber = null;
        loadedKey = null;
        post({
          type: "gpu-fallback",
          data: "The GPU backend failed for this model — switching to CPU (WASM).",
        });
      }
      throw err;
    }

    if (msg.live && isNoiseOutput(output.text, msg.speechSec)) {
      output.text = "";
      if (output.chunks) output.chunks = [];
    }

    if (msg.partial) {
      post({ type: "partial", offset: msg.offset, data: output });
    } else if (msg.live) {
      post({ type: "segment", id: msg.id, offset: msg.offset, data: output });
    } else {
      post({ type: "result", data: output });
    }

    // This unit of work is done. Live mode may still have segments queued; the
    // app keeps its controls disabled while any are pending.
    if (!msg.partial) post({ type: "status", data: "idle" });
  }

  async function handle(msg) {
    switch (msg.type) {
      case "caps":
        post({
          type: "caps",
          webgpu: await webgpuUsableHere(),
          secure: isSecureContextHere(),
        });
        return;

      case "load":
        try {
          await enqueue(() => getTranscriber(msg));
          post({ type: "loaded", key: loadedKey });
        } catch (err) {
          post({
            type: "error",
            data: String(err?.message || err),
            fatal: true,
          });
        }
        return;

      case "list":
        post({ type: "cache-list", data: await listCache() });
        return;

      case "download":
        enqueue(async () => {
          try {
            post({ type: "status", data: "loading" });
            const { pipe } = await buildPipeline({
              model: msg.model,
              device: msg.device,
            });
            pipe.dispose?.();
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

      case "delete":
        enqueue(async () => {
          await deleteModelFiles(msg.model);
          await dropTranscriber(msg.model);
          post({ type: "cache-list", data: await listCache() });
        });
        return;

      case "transcribe":
        // Interim decodes are best-effort: keep at most one queued so they
        // can't pile up behind (or in front of) committed segments.
        if (msg.partial) {
          if (partialQueued) return;
          partialQueued = true;
          enqueue(() => runTranscribe(msg))
            .catch(() => {})
            .finally(() => {
              partialQueued = false;
            });
          return;
        }
        try {
          await enqueue(() => runTranscribe(msg));
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
