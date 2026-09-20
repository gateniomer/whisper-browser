/**
 * Model storage for the Transformers.js engine.
 *
 * A CacheStorage-backed cache that we fully control, so the app can list and
 * delete models. transformers.js reads/writes through `modelCache`.
 */
import { requiredFiles } from "../models.js";

const CACHE_NAME = "whisper-models";

// Files transformers.js fetches alongside the ONNX graphs.
export const CONFIG_FILES = new Set([
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

function cacheStore() {
  return caches.open(CACHE_NAME);
}

export const modelCache = {
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

/** All cached file URLs (used by the app's model manager). */
export async function listCache() {
  try {
    const cache = await cacheStore();
    const keys = await cache.keys();
    return keys.map((r) => r.url);
  } catch {
    return [];
  }
}

/** Delete every cached file for one model, returning how many were removed. */
export async function deleteModelFiles(modelId) {
  const cache = await cacheStore();
  const keys = await cache.keys();
  let count = 0;
  for (const req of keys) {
    if (req.url.includes(`/${modelId}/`)) {
      await cache.delete(req);
      count++;
    }
  }
  return count;
}

// True when every required ONNX file is already cached, so a load won't hit the
// network (and we can skip the size lookup entirely).
async function fullyCached({ model, device }) {
  const needs = requiredFiles(model, device);
  const urls = await listCache();
  return needs.every((n) =>
    urls.some((u) => u.includes(`/${model}/`) && u.endsWith(n)),
  );
}

// Exact byte total for a model's files, from the HF API. Includes external-data
// shards (`*.onnx_data`) so progress for sharded models is accurate.
async function expectedBytes({ model, device }) {
  try {
    const res = await fetch(
      `https://huggingface.co/api/models/${model}?blobs=true`,
    );
    if (!res.ok) return 0;
    const info = await res.json();
    const wanted = new Set(requiredFiles(model, device));
    let total = 0;
    for (const s of info.siblings || []) {
      const base = String(s.rfilename || "").replace(/^onnx\//, "");
      const isData = base.endsWith("_data") && wanted.has(base.slice(0, -5));
      if (wanted.has(base) || isData || CONFIG_FILES.has(base)) {
        total += s.size || 0;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Progress from transformers.js arrives per file, so a single file's percentage
 * jumps 0→100 repeatedly. Aggregate bytes across files and divide by the model's
 * real total so the reported percentage only moves forward.
 */
export function createProgressTracker(post) {
  let files = new Map();
  let expected = 0;

  return {
    async prepare({ model, device }) {
      files = new Map();
      expected = (await fullyCached({ model, device }))
        ? 0
        : await expectedBytes({ model, device });
    },
    callback: (p) => {
      if (p.file) {
        const entry = files.get(p.file) || { loaded: 0, total: 0 };
        if (typeof p.loaded === "number") entry.loaded = p.loaded;
        if (typeof p.total === "number" && p.total) entry.total = p.total;
        if (p.status === "done" && entry.total) entry.loaded = entry.total;
        files.set(p.file, entry);
      }
      let loaded = 0;
      let total = 0;
      for (const e of files.values()) {
        loaded += e.loaded;
        total += e.total;
      }
      const denom = Math.max(expected, total);
      const overall = denom > 0 ? Math.min(100, (loaded / denom) * 100) : null;
      post({ type: "progress", data: { ...p, overall } });
    },
  };
}
