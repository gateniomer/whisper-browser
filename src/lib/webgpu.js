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
//
// A single early requestAdapter() can resolve null while the GPU process and
// driver are still starting (common on mobile), so retry a few times before
// concluding there is no GPU. We only require an *adapter*: some devices grant
// one but are slow/flaky at requestDevice(), and the engine has its own
// GPU→CPU fallback at load/run time, so a false negative here is worse than a
// false positive. navigator.gpu is absent entirely in insecure contexts.
export async function probeWebGPU() {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return typeof window !== "undefined" && !window.isSecureContext
      ? "insecure"
      : "unsupported";
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const adapter = await withTimeout(navigator.gpu.requestAdapter(), 3000);
      if (adapter) return "ready";
    } catch {
      // Some builds reject instead of resolving null; treat as "not yet".
    }
    if (attempt < 2) await sleep(400 * 2 ** attempt);
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
