// WebGPU capability probing. WebGPU is a progressive enhancement, so we probe
// it carefully and report *why* it's unavailable rather than just failing.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

// Returns one of: "ready" | "no-adapter" | "unsupported" | "insecure".
// requestAdapter() can resolve null (or, in some Firefox builds, reject) if it
// is called before the GPU stack is ready, so retry with backoff before giving
// up. navigator.gpu is absent entirely in insecure contexts.
export async function probeWebGPU() {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return typeof window !== "undefined" && !window.isSecureContext
      ? "insecure"
      : "unsupported";
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const adapter = await withTimeout(
        navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
        3000,
      );
      if (adapter) {
        // Some browsers/drivers hand out an adapter but fail when a device is
        // actually created, which is the step ONNX Runtime needs.
        try {
          const device = await withTimeout(adapter.requestDevice(), 3000);
          device.destroy?.();
          return "ready";
        } catch {
          /* fall through and retry */
        }
      }
    } catch {
      // Some builds reject instead of resolving null; treat as "not yet".
    }
    await sleep(400 * 2 ** attempt);
  }
  return "no-adapter";
}

export function gpuMessage(status) {
  switch (status) {
    case "insecure":
      return "WebGPU requires an HTTPS (secure) origin, and this page is on HTTP — using CPU (WASM). It works, just slower.";
    case "unsupported":
      return "This browser doesn't support WebGPU — using CPU (WASM). It works, just slower.";
    case "no-adapter":
      return "No WebGPU adapter is available on this device — using CPU (WASM). It works, just slower.";
    default:
      return null;
  }
}
