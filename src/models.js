// Which ONNX files transformers.js loads depends on the dtype, which depends on
// the backend and the model. Keep this in one place so the engine and the
// download manager always agree.
const SUFFIX = {
  fp32: "",
  fp16: "_fp16",
  q8: "_quantized",
  q4: "_q4",
  q4f16: "_q4f16",
  int8: "_int8",
  uint8: "_uint8",
};

export function isLargeModel(modelId) {
  return /large|turbo/i.test(modelId);
}

export function dtypesFor(modelId, device) {
  // WASM uses the compact q8 weights.
  if (device !== "webgpu") return "q8";
  // Large models ship their fp32 encoder as external data
  // (encoder_model.onnx_data, ~2.5 GB) which won't fit GPU buffer limits or
  // load in the browser. Use self-contained 4-bit weights instead.
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

// Approximate download size (MB) of the two ONNX files, per backend.
const SIZES_MB = {
  "onnx-community/whisper-tiny": { webgpu: 151, wasm: 41 },
  "onnx-community/whisper-base": { webgpu: 291, wasm: 77 },
  "onnx-community/whisper-small": { webgpu: 968, wasm: 249 },
  "onnx-community/whisper-large-v3-turbo": { webgpu: 759, wasm: 1085 },
};

export function sizeLabel(modelId, device) {
  const mb = SIZES_MB[modelId]?.[device];
  if (!mb) return "";
  return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`;
}
