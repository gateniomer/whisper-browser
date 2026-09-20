import { createEngine } from "./lib/engine.js";

const engine = createEngine((msg) => self.postMessage(msg));

self.onmessage = (event) => {
  engine.handle(event.data);
};
