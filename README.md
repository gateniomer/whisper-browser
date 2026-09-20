# Scribe

On-device speech-to-text that runs entirely in the browser. Scribe listens to
your microphone, transcribes live, and never sends your audio anywhere — the
models run locally with WebGPU (or CPU/WASM) and work offline once downloaded.

> The repository is named `whisper-browser` for historical reasons; the app is
> called **Scribe** because it isn't tied to a single model.

## Features

- **Live transcription** with timestamped, append-only lines.
- **Fully local** — audio never leaves the device; no accounts, no servers, no
  telemetry.
- **Multiple models** (Whisper, Moonshine, Distil-Whisper) with an in-app
  download manager — pick what to download and delete it anytime.
- **WebGPU accelerated**, with an automatic CPU (WASM) fallback, and a clear
  indicator when the GPU isn't available.
- **Works offline** after a model is cached in the browser.
- **Mobile-first UI**: one big mic button, live input meter, timer, and a
  settings sheet.
- **No backend.** Deploy it as a static site.

## Supported models

Sizes are approximate download sizes for the two ONNX files, which differ by
backend (WebGPU uses higher precision; CPU uses 8-bit).

| Model | Params | Size | Notes |
| --- | ---: | ---: | --- |
| Whisper Tiny | 39M | ~41 MB | multilingual, fastest Whisper (GPU/CPU) |
| Whisper Base | 74M | ~77 MB | multilingual, default (GPU/CPU) |
| Whisper Small | 244M | ~249 MB | multilingual, more accurate (GPU/CPU) |
| Whisper Large v3 Turbo | 809M | ~1.1 GB | multilingual; runs on CPU |
| Moonshine Tiny | 27M | ~28 MB | English, built for real-time (GPU/CPU) |
| Moonshine Base | 61M | ~63 MB | English, real-time (GPU/CPU) |
| Distil-Whisper Large v3.5 | 756M | ~1.0 GB | English; ~6x faster than large-v3; runs on CPU |
| Cohere Transcribe | 2B | ~2.1 GB | 14 languages, best-in-class accuracy; **requires WebGPU** |
| Parakeet TDT 0.6B v2 | 600M | ~0.7 GB | English, top accuracy (experimental) |
| Parakeet TDT 0.6B v3 | 600M | ~0.7 GB | 25 European languages (experimental) |

Whisper and Distil-Whisper are multilingual/English batch models driven in a
low-latency streaming fashion (voice-activity segmentation). Moonshine is
designed for live transcription and feels the most responsive.

GPU sizes are `fp32` (Cohere uses `q4`); CPU sizes are 8-bit (`q8`). Large
Whisper-family models run on the CPU: their fp32 encoder is external data
(~2.5 GB, too big for the browser) and their 4-bit WebGPU kernels are unreliable
for Whisper, so Scribe uses the accurate q8 CPU weights instead. Cohere
Transcribe runs only on **WebGPU** (its quantized embeddings use the
`GatherBlockQuantized` op, which the CPU/WASM provider doesn't implement).

**Engine architecture.** Models are hosted behind pluggable engines
(`src/lib/engines/`): Transformers.js (Whisper/Moonshine/Cohere) and parakeet.js
(Parakeet). The router in `src/lib/engine.js` picks one per model family, so
adding a runtime doesn't touch the app. Parakeet is experimental; it caches in
IndexedDB, which Scribe reads directly (`engines/parakeetCache.js`) so per-model
Downloaded/Delete work without touching other models.

## How it works

1. **Capture** — an `AudioWorklet` (`src/worklet/pcm-worklet.js`) streams 16 kHz
   mono PCM from the microphone.
2. **Segment** — an energy-based VAD with an adaptive noise floor, hysteresis,
   pre-roll and trailing-silence trimming groups speech into short utterances.
3. **Transcribe** — each utterance goes to Transformers.js, which runs the model
   through ONNX Runtime Web.
4. **Engine placement** — the engine runs in a Web Worker when the worker
   exposes WebGPU (e.g. Chrome); otherwise it runs on the main thread if only the
   window exposes WebGPU (e.g. Firefox/Safari); otherwise it stays in the worker
   on CPU. This is decided once at startup.
5. **Cache** — models are stored in a dedicated `CacheStorage` cache
   (`whisper-models`) that the UI can list and delete.

Live output is append-only: each line is timestamped by its position in the
session and never revised.

## Requirements

- A modern browser with a **secure context** (HTTPS or `localhost`) — required
  for microphone access and WebGPU.
- **WebGPU** for GPU acceleration: Chrome/Edge 113+ (Linux from Chrome 144 on
  recent Intel GPUs), Chrome on Android 121+, Safari 26+. Without it, Scribe
  falls back to CPU/WASM automatically.
- Any modern CPU for the WASM path.
- Node.js 20+ for development.

## Getting started

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. On first run, open **Settings → Models** and
download a model (Whisper Base is a good default; Moonshine Base is the most
responsive for English).

Scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server (HTTPS if certificates exist) |
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Preview the production build |
| `npm run cert` | Generate a self-signed certificate for LAN/HTTPS |

## Testing on a phone (HTTPS)

Microphone and WebGPU require a secure context, so a plain `http://` LAN address
won't work. Generate a certificate and serve over HTTPS:

```bash
npm run cert   # writes certs/key.pem and certs/cert.pem (uses your LAN IP)
npm run dev    # Vite auto-enables HTTPS when certs are present
```

Open the printed `https://<your-lan-ip>:<port>/` on the phone and accept the
self-signed certificate warning. Re-run `npm run cert` if your LAN IP changes.

## Deployment

The build is a static site in `dist/` (`npm run build`). Asset paths are
relative, so it works at a subpath such as GitHub Pages.

- **GitHub Pages** — `.github/workflows/deploy.yml` builds and publishes `dist`
  on every push to `main`. Set **Settings → Pages → Source: GitHub Actions**.
  Note: GitHub Pages cannot send COOP/COEP headers, so the CPU path runs
  single-threaded (WebGPU is unaffected).
- **Netlify / Cloudflare Pages** — build `npm run build`, publish `dist`.
  `public/_headers` enables cross-origin isolation (threaded WASM).
- **Vercel** — same build; add COOP/COEP response headers via `vercel.json`.

The `public/_headers` file sets:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These enable `SharedArrayBuffer` for multi-threaded WASM. They are applied
automatically in dev/preview via `vite.config.js`.

## Privacy

Everything runs in the browser. Audio is processed locally and is never
uploaded. Model files are fetched once from the Hugging Face Hub and then cached
on your device; after that the app works offline. The only network request during
normal use is the (optional) model-size lookup used for download progress.

## Project structure

```
src/
  App.jsx              App shell and composition
  components/          Presentational UI (TopBar, Stage, Dock, SettingsSheet, ...)
  hooks/
    useEngine.js       Engine selection + messaging + model/cache state
    useLiveCapture.js  Microphone capture + VAD segmentation
  lib/
    models.js          Model catalog + dtype/file rules
    engine.js          Engine router (picks a backend per model family)
    engines/
      transformers.js  Whisper / Moonshine / Cohere (Transformers.js)
      parakeet.js      NVIDIA Parakeet (parakeet.js)
    webgpu.js          WebGPU capability probing
    format.js          Small formatting helpers
    constants.js       App name, repo URL, languages, VAD tuning
  worklet/pcm-worklet.js  AudioWorklet that emits PCM frames
  worker.js            Thin wrapper running the engine in a Web Worker
  styles.css           Mobile-first styles
```

## Configuration and tuning

- **Models and precision** — `src/lib/models.js` is the single source of truth
  for the catalog, dtype selection (`fp32`/`q8`) and the exact ONNX files
  each model/backend needs.
- **Live segmentation** — tune `LIVE_TUNING` in `src/lib/constants.js`
  (`silenceMs`, `minSpeechSec`, `vadMin`, `noiseMult`, ...). Raising
  `minSpeechSec`/`noiseMult` filters more background noise; lowering `silenceMs`
  makes captions snappier but fragments sentences.
- **App name / repo link** — `APP_NAME` and `REPO_URL` in
  `src/lib/constants.js`.
- **Adding a model** — add an entry to `MODELS` in `src/lib/models.js` (with its
  `family` and `englishOnly` flags and a size map). Whisper-architecture and
  Moonshine models use the same `encoder_model` / `decoder_model_merged` file
  layout and work with the existing engine.

## Performance

Live transcription is latency-bound, so Scribe applies a few things:

- **WASM multi-threading** — ONNX Runtime Web spreads inference across CPU cores
  only in a **cross-origin-isolated** context. Dev/preview set the
  `COOP`/`COEP` headers, and so does `public/_headers` (Netlify/Cloudflare
  Pages). **GitHub Pages cannot**, so CPU inference there is single-threaded
  (roughly 2–4x slower). Scribe sets `numThreads` when isolation is available.
- **Warm-up pass** — after a model loads, it runs one dummy clip so the WASM
  kernels are compiled before your first real utterance.
- **Bounded decode** — per-segment `max_new_tokens` is capped by audio length so
  a bad segment can't stall the queue.
- **Snappy VAD** — segments flush after ~500 ms of silence (8 s max) so captions
  appear sooner.
- **Interim text** — while you keep speaking, Scribe periodically re-decodes the
  last few seconds and shows them as a provisional (italic) line, then commits
  the final text on a pause. Interim decodes are coalesced and skipped when
  committed work is queued, so they can't build a backlog.

Model choice matters most: **Moonshine Tiny/Base** and **Whisper Tiny** are the
fast options; larger models trade latency for accuracy. WebGPU (when available)
is several times faster than CPU.

## Troubleshooting

- **"CPU" badge / no WebGPU** — the browser or device can't provide a WebGPU
  adapter. On Linux, try Chrome with
  `--enable-features=Vulkan --enable-unsafe-webgpu`; on Firefox, WebGPU may need
  `dom.webgpu.enabled` in `about:config`. Everything still works on CPU.
- **Microphone unavailable** — the page must be served over HTTPS or
  `localhost`.
- **A large model is slow** — large models (Whisper Large/Turbo, Distil-Large)
  run on the CPU on purpose (their fp32 encoder is ~2.5 GB and their 4-bit
  WebGPU kernels are unreliable). Use a smaller model if you need speed. If a
  partial download is left over, delete the model in Settings and download
  again.
- **Cohere Transcribe won't load** — it requires WebGPU and is shown as
  "Needs WebGPU" when the browser has none (its quantized embeddings use an op
  the CPU provider lacks). Use Chrome/Edge, or pick another model.
- **Slow on CPU** — choose a smaller model (Moonshine Tiny or Whisper Tiny).
  Serving with COOP/COEP headers enables multi-threaded WASM.

## Credits

- [OpenAI Whisper](https://github.com/openai/whisper) — MIT
- [Moonshine](https://github.com/usefulsensors/moonshine) (Useful Sensors) — MIT
  for the English models
- [Distil-Whisper](https://github.com/huggingface/distil-whisper) — MIT
- [Transformers.js](https://github.com/huggingface/transformers.js) — Apache-2.0
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) — MIT
- [React](https://react.dev) and [Vite](https://vite.dev)

Model weights remain under their upstream licenses — check each model card
before redistributing them.
