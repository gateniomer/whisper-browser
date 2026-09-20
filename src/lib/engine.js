/**
 * Engine router.
 *
 * The app talks to one engine over a single message protocol. This router picks
 * the right inference backend per model family, so several runtimes can coexist:
 *
 *   - transformers: Whisper, Moonshine, Cohere  (Transformers.js + ORT Web)
 *   - parakeet:     NVIDIA Parakeet TDT          (parakeet.js)   [next]
 *   - nemotron:     NVIDIA Nemotron 3.5 streaming (raw ORT)      [later]
 *
 * Messages that don't name a model (caps, list) go to the default backend.
 */
import { createTransformersEngine } from "./engines/transformers.js";
import { createParakeetEngine } from "./engines/parakeet.js";
import { modelFamily } from "./models.js";

const BACKEND_BY_FAMILY = {
  whisper: "transformers",
  moonshine: "transformers",
  cohere: "transformers",
  parakeet: "parakeet",
  // nemotron: "nemotron",
};

export function createEngine(post) {
  const backends = {
    transformers: createTransformersEngine(post),
    parakeet: createParakeetEngine(post),
    // nemotron: createNemotronEngine(post),
  };

  function backendFor(family) {
    return backends[BACKEND_BY_FAMILY[family]] ?? backends.transformers;
  }

  return {
    handle(msg) {
      // `list` is broadcast so every backend can report its own cache: the
      // transformers backend answers with cached URLs, parakeet with model ids.
      if (msg.type === "list") {
        Object.values(backends).forEach((backend) => backend.handle(msg));
        return;
      }
      const family = msg.model ? modelFamily(msg.model) : null;
      return backendFor(family).handle(msg);
    },
  };
}
