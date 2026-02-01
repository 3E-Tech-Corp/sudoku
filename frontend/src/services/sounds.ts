// Sound effects using Web Audio API (no external files needed)

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.3) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Silently fail if audio not available
  }
}

function playNoise(duration: number, volume = 0.1) {
  try {
    const ctx = getAudioContext();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch {
    // Silently fail
  }
}

export const sounds = {
  /** Soft card shuffle — quick bursts of noise */
  shuffle() {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => playNoise(0.05, 0.08), i * 60);
    }
  },

  /** Card flip — rising tone */
  flip() {
    const ctx = getAudioContext();
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  },

  /** Card place — soft click */
  cardPlace() {
    playTone(600, 0.08, 'sine', 0.2);
  },

  /** Operator selected — slightly different click */
  operatorSelect() {
    playTone(800, 0.06, 'triangle', 0.15);
  },

  /** Row complete — pleasant ding */
  rowComplete() {
    playTone(523, 0.15, 'sine', 0.25); // C5
    setTimeout(() => playTone(659, 0.15, 'sine', 0.25), 100); // E5
    setTimeout(() => playTone(784, 0.2, 'sine', 0.25), 200); // G5
  },

  /** Error — low buzz */
  error() {
    playTone(200, 0.2, 'sawtooth', 0.1);
  },

  /** Win — triumphant fanfare */
  win() {
    const notes = [
      { freq: 523, delay: 0 },    // C5
      { freq: 659, delay: 100 },   // E5
      { freq: 784, delay: 200 },   // G5
      { freq: 1047, delay: 350 },  // C6
      { freq: 784, delay: 500 },   // G5
      { freq: 1047, delay: 600 },  // C6
    ];
    notes.forEach(({ freq, delay }) => {
      setTimeout(() => playTone(freq, 0.3, 'sine', 0.3), delay);
    });
  },

  /** Undo — descending blip */
  undo() {
    playTone(500, 0.08, 'sine', 0.15);
    setTimeout(() => playTone(400, 0.08, 'sine', 0.15), 50);
  },
};
