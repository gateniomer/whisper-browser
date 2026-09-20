/**
 * Runtime capability helpers shared by engine backends.
 *
 * Engines can run in a Web Worker or on the main thread, so "can this context
 * use WebGPU?" must be answered where the engine actually lives.
 */

export function webgpuInThisContext() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function isSecureContextHere() {
  if (typeof self !== "undefined" && "isSecureContext" in self) {
    return self.isSecureContext;
  }
  return true;
}

// requestAdapter() can hang in some environments (headless, VMs, odd drivers).
export function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// Presence of navigator.gpu isn't enough — an adapter must actually be
// grantable in this context (the worker can differ from the window). One
// request only, so we don't spam "No available adapters". The timeout is
// generous because mobile GPUs can be slow to come up.
export async function webgpuUsableHere() {
  if (!webgpuInThisContext()) return false;
  try {
    const adapter = await withTimeout(navigator.gpu.requestAdapter(), 2500);
    return !!adapter;
  } catch {
    return false;
  }
}
