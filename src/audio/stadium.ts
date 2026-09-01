/**
 * Stadium ambience, synthesised rather than sampled.
 *
 * A crowd bed is mostly filtered noise: shaped brown noise for the body, a
 * quieter high band for chatter, both drifting under slow LFOs and pushed
 * through a synthetic reverb. That costs a few hundred bytes of code instead of
 * a megabyte of looping audio, and it never seams.
 *
 * Nothing is created until the first user gesture — browsers suspend an
 * AudioContext built any earlier, and a suspended context that later resumes
 * mid-page tends to pop.
 */

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  crowd: GainNode;
  reverb: ConvolverNode;
}

let engine: Engine | null = null;
let muted = false;

const BED_LEVEL = 0.085;

/** Brown noise: integrated white, which sits far lower than white or pink. */
function brownNoise(ctx: AudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.2;
  }
  return buf;
}

/** Exponentially decaying noise burst — a serviceable large-room impulse. */
function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
  }
  return buf;
}

function drift(ctx: AudioContext, target: AudioParam, rate: number, depth: number) {
  const lfo = ctx.createOscillator();
  const amt = ctx.createGain();
  lfo.frequency.value = rate;
  amt.gain.value = depth;
  lfo.connect(amt).connect(target);
  lfo.start();
}

/** Build the graph. Safe to call repeatedly; only the first call does work. */
export function startAmbience() {
  if (engine) return;
  const Ctor = window.AudioContext ?? (window as unknown as {
    webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;

  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.6, 2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  reverb.connect(wet).connect(master);

  const crowd = ctx.createGain();
  crowd.gain.value = 0;
  crowd.connect(master);
  crowd.connect(reverb);

  const noise = brownNoise(ctx, 4);

  // body of the crowd
  const body = ctx.createBufferSource();
  body.buffer = noise; body.loop = true;
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = "bandpass";
  bodyFilter.frequency.value = 420;
  bodyFilter.Q.value = 0.6;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.9;
  body.connect(bodyFilter).connect(bodyGain).connect(crowd);
  drift(ctx, bodyGain.gain, 0.07, 0.22);
  drift(ctx, bodyFilter.frequency, 0.031, 90);

  // thinner chatter riding on top
  const air = ctx.createBufferSource();
  air.buffer = noise; air.loop = true; air.playbackRate.value = 1.7;
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = "bandpass";
  airFilter.frequency.value = 1750;
  airFilter.Q.value = 0.8;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.16;
  air.connect(airFilter).connect(airGain).connect(crowd);
  drift(ctx, airGain.gain, 0.043, 0.07);

  body.start(); air.start();
  // fade in so it arrives rather than switches on
  crowd.gain.linearRampToValueAtTime(BED_LEVEL, ctx.currentTime + 2.5);

  engine = { ctx, master, crowd, reverb };
  void ctx.resume();
}

export function setMuted(next: boolean) {
  muted = next;
  if (!engine) return;
  const { ctx, master } = engine;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.linearRampToValueAtTime(next ? 0 : 1, ctx.currentTime + 0.25);
}

export const isMuted = () => muted;

/** The ball hitting leather: a short filtered crack over a low thump. */
export function mittPop() {
  if (!engine || muted) return;
  const { ctx, crowd: _c, master, reverb } = engine;
  void _c;
  const t = ctx.currentTime;

  const len = Math.floor(ctx.sampleRate * 0.09);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 5;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 1650; bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  src.connect(bp).connect(g);
  g.connect(master); g.connect(reverb);
  src.start(t); src.stop(t + 0.2);

  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(150, t);
  thump.frequency.exponentialRampToValueAtTime(58, t + 0.11);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.32, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  thump.connect(tg).connect(master);
  thump.start(t); thump.stop(t + 0.18);
}

/**
 * Lift the crowd for a moment. `intensity` 0..1 — a routine call barely stirs
 * them; an umpire getting one wrong brings the place up.
 */
export function crowdSwell(intensity: number) {
  if (!engine || muted) return;
  const { ctx, crowd } = engine;
  const t = ctx.currentTime;
  const peak = BED_LEVEL * (1 + intensity * 4.5);
  crowd.gain.cancelScheduledValues(t);
  crowd.gain.setValueAtTime(crowd.gain.value, t);
  crowd.gain.linearRampToValueAtTime(peak, t + 0.18 + intensity * 0.2);
  crowd.gain.linearRampToValueAtTime(BED_LEVEL, t + 1.6 + intensity * 2.2);
}
