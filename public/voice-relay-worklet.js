/* Mau-Mau Candeias V40.50 — captura de voz do relay fora da thread principal. */
class MauMauVoiceRelayCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.targetRate = Math.max(8000, Math.min(24000, Number(opts.targetRate) || 16000));
    this.frameSize = Math.max(160, Math.min(1280, Number(opts.frameSize) || 640));
    this.vadThreshold = Math.max(0.0005, Math.min(0.1, Number(opts.vadThreshold) || 0.0045));
    this.hangoverFrames = Math.max(0, Math.min(20, Number(opts.hangoverFrames) || 4));
    this.hangover = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Uint8Array(this.frameSize);
    this.frameIndex = 0;
    this.energy = 0;
  }

  encodeMuLaw8(value) {
    const v = Math.max(-1, Math.min(1, Number(value) || 0));
    const sign = v < 0 ? -1 : 1;
    const mag = Math.abs(v);
    const mu = 255;
    const compressed = sign * Math.log1p(mu * mag) / Math.log1p(mu);
    return Math.max(0, Math.min(255, Math.round((compressed + 1) * 127.5)));
  }

  pushSample(sample) {
    const v = Math.max(-1, Math.min(1, sample || 0));
    this.energy += v * v;
    this.frame[this.frameIndex++] = this.encodeMuLaw8(v);
    if (this.frameIndex < this.frameSize) return;

    const rms = Math.sqrt(this.energy / this.frameSize);
    if (rms >= this.vadThreshold) this.hangover = this.hangoverFrames;
    else if (this.hangover > 0) this.hangover--;

    if (rms >= this.vadThreshold || this.hangover > 0) {
      const payload = this.frame;
      this.port.postMessage({ type: 'voice-frame', rms, pcm: payload.buffer }, [payload.buffer]);
    }

    this.frame = new Uint8Array(this.frameSize);
    this.frameIndex = 0;
    this.energy = 0;
  }

  process(inputs) {
    const input = inputs?.[0]?.[0];
    if (!input || !input.length) return true;

    const step = this.targetRate / sampleRate;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.phase += step;
      if (this.phase >= 1) {
        this.pushSample(this.sum / Math.max(1, this.count));
        this.phase -= 1;
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('mau-mau-voice-relay-capture', MauMauVoiceRelayCaptureProcessor);
