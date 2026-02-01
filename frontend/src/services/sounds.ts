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

export const sounds = {
  /** Realistic card shuffle — rapid riffle with bridge finish */
  shuffle() {
    try {
      const ctx = getAudioContext();
      const duration = 1.2;
      const sampleRate = ctx.sampleRate;
      const bufferSize = Math.floor(sampleRate * duration);
      const buffer = ctx.createBuffer(2, bufferSize, sampleRate);

      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);

        // Riffle: ~20 rapid card flicks with accelerating then decelerating rhythm
        const numFlicks = 22;
        for (let f = 0; f < numFlicks; f++) {
          // Timing: accelerate to middle, decelerate at end (like a real riffle)
          const t = f / numFlicks;
          const speed = 1 - 0.6 * Math.sin(t * Math.PI); // faster in middle
          const flickTime = 0.05 + t * 0.75 + (ch * 0.003); // slight stereo offset
          const flickSample = Math.floor(flickTime * sampleRate);
          const flickLen = Math.floor(sampleRate * (0.008 + Math.random() * 0.006));
          const flickVol = (0.15 + Math.random() * 0.15) * speed;

          for (let i = 0; i < flickLen && (flickSample + i) < bufferSize; i++) {
            const env = Math.exp(-i / (flickLen * 0.2));
            data[flickSample + i] += (Math.random() * 2 - 1) * flickVol * env;
          }
        }

        // Bridge finish: softer settling sound at 0.85-1.1s
        const bridgeStart = Math.floor(0.85 * sampleRate);
        const bridgeLen = Math.floor(0.2 * sampleRate);
        for (let i = 0; i < bridgeLen && (bridgeStart + i) < bufferSize; i++) {
          const env = Math.exp(-i / (bridgeLen * 0.15));
          data[bridgeStart + i] += (Math.random() * 2 - 1) * 0.12 * env;
        }

        // Final tap (squaring the deck) at ~1.05s
        const tapStart = Math.floor(1.05 * sampleRate);
        const tapLen = Math.floor(0.015 * sampleRate);
        for (let i = 0; i < tapLen && (tapStart + i) < bufferSize; i++) {
          const env = Math.exp(-i / (tapLen * 0.15));
          data[tapStart + i] += (Math.random() * 2 - 1) * 0.25 * env;
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // High-pass to remove rumble, slight low-pass for realism
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 8000;

      const gain = ctx.createGain();
      gain.gain.value = 0.6;

      source.connect(hp);
      hp.connect(lp);
      lp.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {}
  },

  /** Card deal — single card sliding out of deck */
  deal() {
    try {
      const ctx = getAudioContext();
      const duration = 0.08;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const env = Math.exp(-i / (bufferSize * 0.12));
        data[i] = (Math.random() * 2 - 1) * 0.2 * env;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2000;
      const gain = ctx.createGain();
      gain.gain.value = 0.4;
      source.connect(hp);
      hp.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {}
  },

  /** Card flip — crisp snap sound */
  flip() {
    try {
      const ctx = getAudioContext();
      const duration = 0.12;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      // Sharp attack + quick filtered noise decay
      for (let i = 0; i < bufferSize; i++) {
        const t = i / ctx.sampleRate;
        const attack = t < 0.003 ? t / 0.003 : 1;
        const env = attack * Math.exp(-i / (bufferSize * 0.08));
        // Mix of noise + a subtle tonal click
        const noise = (Math.random() * 2 - 1);
        const tone = Math.sin(2 * Math.PI * 1800 * t) * 0.3;
        data[i] = (noise + tone) * 0.25 * env;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3000;
      bp.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      source.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      source.start();
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
