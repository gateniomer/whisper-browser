// Model catalog + the rules that govern how each one is loaded.
//
// Which ONNX files transformers.js requests depends on the dtype, which depends
// on the backend and the model. Keeping the catalog and those rules together
// means the engine and the download manager can never disagree.

export const DEFAULT_MODEL = "onnx-community/whisper-base";

// family: "whisper" (incl. distil-whisper) or "moonshine" — controls which
//         decode options are valid.
// englishOnly: model only supports English, so "language" shouldn't be offered.
// Each model: family, englishOnly, requiresWebGPU, languages, and a short
// description shown in the in-app info popup.
export const MODELS = [
  {
    id: "onnx-community/whisper-tiny",
    label: "Whisper Tiny — 39M",
    family: "whisper",
    englishOnly: false,
    languages: "Multilingual (99+)",
    description:
      "The smallest and fastest Whisper. Great for quick drafts and low-power devices, but the least accurate of the Whisper family.",
  },
  {
    id: "onnx-community/whisper-base",
    label: "Whisper Base — 74M",
    family: "whisper",
    englishOnly: false,
    languages: "Multilingual (99+)",
    description:
      "A balanced default: good accuracy while staying small and fast on both GPU and CPU.",
  },
  {
    id: "onnx-community/whisper-small",
    label: "Whisper Small — 244M",
    family: "whisper",
    englishOnly: false,
    languages: "Multilingual (99+)",
    description:
      "Noticeably more accurate than Base, and still quick on a GPU. A good accuracy/speed step up.",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo — 809M",
    family: "whisper",
    englishOnly: false,
    languages: "Multilingual (99+)",
    description:
      "Distilled from Whisper large-v3: near-large accuracy at several times the speed. Large, so it runs on the CPU here.",
  },
  {
    id: "onnx-community/moonshine-tiny-ONNX",
    label: "Moonshine Tiny — 27M · real-time",
    family: "moonshine",
    englishOnly: true,
    languages: "English",
    description:
      "A tiny English model built for real-time transcription. The fastest option, ideal for live captions on modest hardware.",
  },
  {
    id: "onnx-community/moonshine-base-ONNX",
    label: "Moonshine Base — 61M · real-time",
    family: "moonshine",
    englishOnly: true,
    languages: "English",
    description:
      "English, designed for streaming. More accurate than Tiny while still very fast — a great default for live English.",
  },
  {
    id: "distil-whisper/distil-large-v3.5-ONNX",
    label: "Distil-Whisper Large v3.5 — 756M",
    family: "whisper",
    englishOnly: true,
    languages: "English",
    description:
      "A distilled large-v3 for English, roughly 6x faster than the original. High accuracy, but large, so it runs on the CPU here.",
  },
  {
    id: "onnx-community/cohere-transcribe-03-2026-ONNX",
    label: "Cohere Transcribe — 2B · 14 langs · large",
    family: "cohere",
    englishOnly: false,
    requiresWebGPU: true,
    languages: "14 languages",
    description:
      "Cohere's dedicated speech model with best-in-class accuracy across 14 languages. Very large, and it requires a WebGPU-capable browser.",
  },
  {
    id: "parakeet-tdt-0.6b-v2",
    label: "Parakeet TDT 0.6B v2 — English",
    family: "parakeet",
    englishOnly: true,
    languages: "English",
    description:
      "NVIDIA Parakeet TDT for English: very high accuracy and fast. Experimental integration in this app.",
  },
  {
    id: "parakeet-tdt-0.6b-v3",
    label: "Parakeet TDT 0.6B v3 — multilingual",
    family: "parakeet",
    englishOnly: false,
    languages: "25 European languages",
    description:
      "NVIDIA Parakeet TDT, multilingual (25 European languages). High accuracy and fast. Experimental integration in this app.",
  },
];

const META = new Map(MODELS.map((m) => [m.id, m]));

export function modelFamily(modelId) {
  return META.get(modelId)?.family ?? "whisper";
}

export function isEnglishOnly(modelId) {
  return META.get(modelId)?.englishOnly ?? false;
}

// Short display name without the parameter/size suffix (e.g. "Whisper Base").
export function modelShortLabel(modelId) {
  const label = META.get(modelId)?.label ?? modelId;
  return label.split(" — ")[0].trim();
}

// Some models need GPU-only kernels (e.g. Cohere's quantized embeddings use
// GatherBlockQuantized, which the CPU/WASM provider doesn't implement).
export function requiresWebGPU(modelId) {
  return META.get(modelId)?.requiresWebGPU ?? false;
}

// ---------------------------------------------------------------------------
// dtypes / files
// ---------------------------------------------------------------------------
const SUFFIX = {
  fp32: "",
  fp16: "_fp16",
  q8: "_quantized",
  q4: "_q4",
  q4f16: "_q4f16",
  int8: "_int8",
  uint8: "_uint8",
};

// Large models (Whisper Large/Turbo, Distil-Large) ship their fp32 encoder as
// external data (encoder_model.onnx_data, ~2.5 GB), which can't load in the
// browser, and their 4-bit WebGPU kernels (MatMulNBits) are unreliable. So they
// run on CPU.
function isLargeModel(modelId) {
  return /large|turbo/i.test(modelId);
}

export function resolveDevice(modelId, device) {
  if (device === "webgpu" && isLargeModel(modelId)) return "wasm";
  return device;
}

export function dtypesFor(modelId, device) {
  const dev = resolveDevice(modelId, device);
  // Cohere Transcribe has no small fp32 export; 4-bit on GPU, 8-bit on CPU.
  if (modelFamily(modelId) === "cohere") return dev === "webgpu" ? "q4" : "q8";
  return dev === "webgpu" ? "fp32" : "q8";
}

export function requiredFiles(modelId, device) {
  const suffix = SUFFIX[dtypesFor(modelId, device)] ?? "";
  return [
    `encoder_model${suffix}.onnx`,
    `decoder_model_merged${suffix}.onnx`,
  ];
}

// ---------------------------------------------------------------------------
// sizes / status
// ---------------------------------------------------------------------------
// Approximate download size (MB) of the two ONNX files, per backend.
const SIZES_MB = {
  "onnx-community/whisper-tiny": { webgpu: 151, wasm: 41 },
  "onnx-community/whisper-base": { webgpu: 291, wasm: 77 },
  "onnx-community/whisper-small": { webgpu: 968, wasm: 249 },
  "onnx-community/whisper-large-v3-turbo": { webgpu: 759, wasm: 1085 },
  "onnx-community/moonshine-tiny-ONNX": { webgpu: 109, wasm: 28 },
  "onnx-community/moonshine-base-ONNX": { webgpu: 247, wasm: 63 },
  "distil-whisper/distil-large-v3.5-ONNX": { webgpu: 726, wasm: 1030 },
  "onnx-community/cohere-transcribe-03-2026-ONNX": { webgpu: 2125, wasm: 2293 },
  "parakeet-tdt-0.6b-v2": { webgpu: 700, wasm: 700 },
  "parakeet-tdt-0.6b-v3": { webgpu: 700, wasm: 700 },
};

export function sizeLabel(modelId, device) {
  const mb = SIZES_MB[modelId]?.[resolveDevice(modelId, device)];
  if (!mb) return "";
  return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`;
}

// A model counts as downloaded when its files are cached. Transformers-family
// models live in our CacheStorage list; Parakeet models live in parakeet.js's
// IndexedDB (reported separately as parakeet model ids).
export function isModelDownloaded(
  modelId,
  device,
  urls = [],
  parakeetCached = [],
) {
  if (!modelId) return false;
  if (modelFamily(modelId) === "parakeet") {
    return parakeetCached.includes(modelId);
  }
  return requiredFiles(modelId, device).every((name) =>
    urls.some((u) => u.includes(`/${modelId}/`) && u.endsWith(name)),
  );
}
