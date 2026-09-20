// Model catalog + the rules that govern how each one is loaded.
//
// Which ONNX files transformers.js requests depends on the dtype, which depends
// on the backend and the model. Keeping the catalog and those rules together
// means the engine and the download manager can never disagree.

export const DEFAULT_MODEL = "onnx-community/whisper-base";

// family: "whisper" (incl. distil-whisper) or "moonshine" — controls which
//         decode options are valid.
// englishOnly: model only supports English, so "language" shouldn't be offered.
export const MODELS = [
  {
    id: "onnx-community/whisper-tiny",
    label: "Whisper Tiny — 39M",
    family: "whisper",
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-base",
    label: "Whisper Base — 74M",
    family: "whisper",
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-small",
    label: "Whisper Small — 244M",
    family: "whisper",
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo — 809M",
    family: "whisper",
    englishOnly: false,
  },
  {
    id: "onnx-community/moonshine-tiny-ONNX",
    label: "Moonshine Tiny — 27M · real-time",
    family: "moonshine",
    englishOnly: true,
  },
  {
    id: "onnx-community/moonshine-base-ONNX",
    label: "Moonshine Base — 61M · real-time",
    family: "moonshine",
    englishOnly: true,
  },
  {
    id: "distil-whisper/distil-large-v3.5-ONNX",
    label: "Distil-Whisper Large v3.5 — 756M",
    family: "whisper",
    englishOnly: true,
  },
];

const META = new Map(MODELS.map((m) => [m.id, m]));

export function modelFamily(modelId) {
  return META.get(modelId)?.family ?? "whisper";
}

export function isEnglishOnly(modelId) {
  return META.get(modelId)?.englishOnly ?? false;
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
// browser. Use self-contained 4-bit weights for those.
function isLargeModel(modelId) {
  return /large|turbo/i.test(modelId);
}

export function dtypesFor(modelId, device) {
  if (device !== "webgpu") return "q8"; // compact q8 weights for CPU
  if (isLargeModel(modelId)) {
    return { encoder_model: "q4", decoder_model_merged: "q4" };
  }
  return "fp32";
}

export function requiredFiles(modelId, device) {
  const dt = dtypesFor(modelId, device);
  const suffix = (d) => SUFFIX[d] ?? "";
  if (typeof dt === "string") {
    return [
      `encoder_model${suffix(dt)}.onnx`,
      `decoder_model_merged${suffix(dt)}.onnx`,
    ];
  }
  return [
    `encoder_model${suffix(dt.encoder_model)}.onnx`,
    `decoder_model_merged${suffix(dt.decoder_model_merged)}.onnx`,
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
};

export function sizeLabel(modelId, device) {
  const mb = SIZES_MB[modelId]?.[device];
  if (!mb) return "";
  return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`;
}

// A model counts as downloaded when both required ONNX files are in the cache.
export function isModelDownloaded(modelId, device, urls = []) {
  return requiredFiles(modelId, device).every((name) =>
    urls.some((u) => u.includes(`/${modelId}/`) && u.endsWith(name)),
  );
}
