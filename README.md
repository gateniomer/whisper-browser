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

| Model | Params | WebGPU | CPU (WASM) | Notes |
| --- | ---: | ---: | ---: | --- |
| Whisper Tiny | 39M | ~151 MB | ~41 MB | multilingual, fastest Whisper |
| Whisper Base | 74M | ~291 MB | ~77 MB | multilingual, default |
| Whisper Small | 244M | ~968 MB | ~249 MB | multilingual, more accurate |
| Whisper Large v3 Turbo | 809M | ~759 MB | ~1.1 GB | multilingual; 4-bit on WebGPU |
| Moonshine Tiny | 27M | ~109 MB | ~28 MB | English, built for real-time |
| Moonshine Base | 61M | ~247 MB | ~63 MB | English, real-time |
| Distil-Whisper Large v3.5 | 756M | ~726 MB | ~1.0 GB | English; ~6x faster than large-v3 |

Whisper and Distil-Whisper are multilingual/English batch models driven in a
low-latency streaming fashion (voice-activity segmentation). Moonshine is
designed for live transcription and feels the most responsive.

Large models ship their fp32 encoder as external data (~2.5 GB) that can't load
in a browser, so Scribe automatically uses self-contained 4-bit weights for them
on WebGPU.

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
    engine.js          Inference engine (cache, pipeline, message routing)
    webgpu.js          WebGPU capability probing
    format.js          Small formatting helpers
    constants.js       App name, repo URL, languages, VAD tuning
  worklet/pcm-worklet.js  AudioWorklet that emits PCM frames
  worker.js            Thin wrapper running the engine in a Web Worker
  styles.css           Mobile-first styles
```

## Configuration and tuning

- **Models and precision** — `src/lib/models.js` is the single source of truth
  for the catalog, dtype selection (`fp32`/`q4`/`q8`) and the exact ONNX files
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

## Troubleshooting

- **"CPU" badge / no WebGPU** — the browser or device can't provide a WebGPU
  adapter. On Linux, try Chrome with
  `--enable-features=Vulkan --enable-unsafe-webgpu`; on Firefox, WebGPU may need
  `dom.webgpu.enabled` in `about:config`. Everything still works on CPU.
- **Microphone unavailable** — the page must be served over HTTPS or
  `localhost`.
- **A large model won't load** — the fp32 encoder for large models is external
  data (~2.5 GB); Scribe uses 4-bit instead. If a partial download is left over,
  delete the model in Settings and download again.
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
