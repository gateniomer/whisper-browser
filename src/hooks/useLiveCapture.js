import { useEffect, useRef, useState } from "react";
import workletUrl from "../worklet/pcm-worklet.js?url";
import { LIVE_TUNING } from "../lib/constants.js";

/**
 * Live microphone capture with energy-based voice activity detection.
 *
 * Captures 16 kHz mono PCM via an AudioWorklet, segments on pauses (with
 * adaptive noise floor, hysteresis, pre-roll and trailing-silence trimming),
 * and calls `onSegment({ id, offset, audio, speechSec })` per utterance.
 */
export function useLiveCapture({ onSegment, onError, onLevel, onPartial } = {}) {
  const cbRef = useRef({ onSegment, onError, onLevel, onPartial });
  cbRef.current = { onSegment, onError, onLevel, onPartial };

  const liveRef = useRef(null);
  const activeRef = useRef(false);
  const speechRef = useRef([]);
  const preRollRef = useRef([]);
  const speechMsRef = useRef(0);
  const silenceMsRef = useRef(0);
  const speakingRef = useRef(false);
  const offsetRef = useRef(0);
  const idRef = useRef(0);
  const noiseFloorRef = useRef(0.005);
  const vadRef = useRef(false);
  const lastLevelAtRef = useRef(0);
  const segmentStartRef = useRef(0);
  const lastPartialAtRef = useRef(0);

  const [liveActive, setLiveActive] = useState(false);

  function reset() {
    speechRef.current = [];
    preRollRef.current = [];
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    speakingRef.current = false;
    offsetRef.current = 0;
    // idRef is intentionally NOT reset: segment ids stay unique for the app's
    // lifetime so list keys can never collide across sessions.
    noiseFloorRef.current = 0.005;
    vadRef.current = false;
    segmentStartRef.current = 0;
    lastPartialAtRef.current = 0;
  }

  function flushSegment(sampleRate) {
    const chunks = speechRef.current;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const speechSec = speechMsRef.current / 1000;

    speechRef.current = [];
    preRollRef.current = [];
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    speakingRef.current = false;

    // Drop blips and noise bursts: require a real amount of speech energy.
    if (speechSec < LIVE_TUNING.minSpeechSec || total === 0) return;

    const audio = new Float32Array(total);
    let at = 0;
    for (const c of chunks) {
      audio.set(c, at);
      at += c.length;
    }

    const offset = offsetRef.current;
    offsetRef.current += total / sampleRate;

    cbRef.current.onSegment?.({
      id: ++idRef.current,
      offset,
      audio,
      speechSec,
    });
  }

  function onFrame(samples, sampleRate) {
    const frameMs = (samples.length / sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);

    // Report a throttled input level for the UI meter (~15 Hz).
    const now = performance.now();
    if (now - lastLevelAtRef.current > 66) {
      lastLevelAtRef.current = now;
      cbRef.current.onLevel?.(rms);
    }

    // Adaptive noise floor: track the ambient level while not in speech, then
    // require speech to rise clearly above it. Hysteresis stops rapid toggling.
    if (!vadRef.current) {
      noiseFloorRef.current =
        0.95 * noiseFloorRef.current + 0.05 * Math.min(rms, 0.2);
    }
    const startTh = Math.max(
      LIVE_TUNING.vadMin,
      noiseFloorRef.current * LIVE_TUNING.noiseMult,
    );
    const isSpeech = vadRef.current
      ? rms > startTh * LIVE_TUNING.release
      : rms > startTh;
    if (isSpeech && !vadRef.current) vadRef.current = true;
    if (!isSpeech && vadRef.current) vadRef.current = false;

    if (!speakingRef.current) {
      if (!isSpeech) {
        // Remember a little audio so we don't clip the start of a word.
        const pre = preRollRef.current;
        pre.push(samples);
        const maxPre = Math.ceil((LIVE_TUNING.preRollMs / 1000) * sampleRate);
        let preTotal = pre.reduce((n, c) => n + c.length, 0);
        while (preTotal > maxPre && pre.length) {
          preTotal -= pre.shift().length;
        }
        return;
      }
      // Speech onset.
      speakingRef.current = true;
      speechRef.current = [...preRollRef.current, samples];
      preRollRef.current = [];
      speechMsRef.current = frameMs;
      silenceMsRef.current = 0;
      segmentStartRef.current = offsetRef.current;
      lastPartialAtRef.current = performance.now();
    } else if (isSpeech) {
      speechRef.current.push(samples);
      speechMsRef.current += frameMs;
      silenceMsRef.current = 0;
    } else {
      silenceMsRef.current += frameMs;
      // Keep only a short bit of trailing silence (long silence makes Whisper
      // hallucinate things like "you").
      if (silenceMsRef.current <= LIVE_TUNING.trailingSilenceMs) {
        speechRef.current.push(samples);
      }
      if (silenceMsRef.current > LIVE_TUNING.silenceMs) {
        flushSegment(sampleRate);
        return;
      }
    }

    const bufferedSec =
      speechRef.current.reduce((n, c) => n + c.length, 0) / sampleRate;
    if (bufferedSec > LIVE_TUNING.maxSegmentSec) {
      flushSegment(sampleRate);
      return;
    }

    // Interim text: while still speaking, re-decode the last few seconds and
    // hand them up as a provisional line. Throttled, and only over a bounded
    // window to keep CPU cost low.
    if (
      speakingRef.current &&
      bufferedSec >= 0.5 &&
      now - lastPartialAtRef.current >= LIVE_TUNING.partialMs
    ) {
      lastPartialAtRef.current = now;
      const chunks = speechRef.current;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const maxWindow = Math.floor(LIVE_TUNING.partialWindowSec * sampleRate);
      const start = Math.max(0, total - maxWindow);
      const window = new Float32Array(total - start);
      let at = 0;
      let pos = 0;
      for (const c of chunks) {
        const end = pos + c.length;
        if (end > start) {
          const from = Math.max(0, start - pos);
          window.set(c.subarray(from), at);
          at += c.length - from;
        }
        pos = end;
      }
      cbRef.current.onPartial?.({
        audio: window,
        offset: segmentStartRef.current + start / sampleRate,
      });
    }
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });

      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule(workletUrl);

      const source = ctx.createMediaStreamSource(stream);
      // Cut low rumble/hum so it doesn't pump the VAD.
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;
      highpass.Q.value = 0.7;

      const node = new AudioWorkletNode(ctx, "pcm-processor");
      const gain = ctx.createGain();
      gain.gain.value = 0; // keeps the graph pulled without echoing mic to speakers
      source.connect(highpass);
      highpass.connect(node);
      node.connect(gain);
      gain.connect(ctx.destination);

      reset();
      node.port.onmessage = (e) => {
        if (activeRef.current) onFrame(e.data, ctx.sampleRate);
      };

      liveRef.current = { ctx, stream, source, highpass, node, gain };
      activeRef.current = true;
      setLiveActive(true);
    } catch (err) {
      cbRef.current.onError?.(String(err?.message || err));
    }
  }

  function teardown() {
    const live = liveRef.current;
    if (!live) return;
    try {
      live.node.port.onmessage = null;
      live.source.disconnect();
      live.highpass?.disconnect();
      live.node.disconnect();
      live.gain.disconnect();
      live.stream.getTracks().forEach((t) => t.stop());
      live.ctx.close();
    } catch {
      /* already closed */
    }
    liveRef.current = null;
  }

  async function stop() {
    activeRef.current = false;
    setLiveActive(false);
    const live = liveRef.current;
    if (live && speechRef.current.length) flushSegment(live.ctx.sampleRate);
    teardown();
    cbRef.current.onLevel?.(0);
  }

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      teardown();
    };
  }, []);

  return { liveActive, start, stop };
}
