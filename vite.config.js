import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

// Serve HTTPS when certs/key.pem + certs/cert.pem exist. Mobile browsers only
// expose navigator.mediaDevices (the mic) in a secure context, and a plain
// http:// LAN address does not qualify. Generate certs with `npm run cert`.
function httpsConfig() {
  const key = path.resolve(root, "certs/key.pem");
  const cert = path.resolve(root, "certs/cert.pem");
  if (!existsSync(key) || !existsSync(cert)) return undefined;
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const https = httpsConfig();

// Cross-origin isolation enables SharedArrayBuffer (threaded WASM).
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so it works on a subpath (e.g. GitHub Pages /repo/).
  base: "./",
  server: {
    host: true, // expose on the local network
    https,
    headers,
  },
  preview: {
    host: true,
    https,
    headers,
  },
  // Let Vite serve the package as ESM so onnxruntime-web can resolve its .wasm files.
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
  // Keep the AudioWorklet as a real file instead of inlining it as a data URI.
  build: {
    assetsInlineLimit: 0,
  },
});
