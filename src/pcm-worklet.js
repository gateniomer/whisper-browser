// Streams raw mono PCM frames from the mic to the main thread.
// The AudioContext is created at 16 kHz, so frames arrive already resampled.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
