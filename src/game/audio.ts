export type Sfx = "jump" | "dash" | "star" | "smash" | "crash" | "land";

function midi(m: number) {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Compact 16th motifs (0 = rest). */
const A = [72, 0, 76, 0, 79, 0, 76, 0, 72, 0, 67, 0, 69, 0, 72, 0];
const B = [65, 0, 69, 0, 72, 0, 76, 0, 74, 0, 72, 0, 69, 0, 65, 0];
const C_ = [67, 0, 71, 0, 74, 0, 79, 0, 76, 0, 74, 0, 71, 0, 67, 0];
const D = [76, 0, 79, 0, 84, 0, 79, 0, 76, 0, 72, 0, 74, 0, 76, 0];
const E = [72, 0, 76, 0, 79, 0, 84, 79, 76, 0, 72, 0, 74, 76, 77, 0];
const F = [79, 0, 81, 0, 83, 0, 81, 79, 77, 0, 76, 74, 72, 0, 0, 0];
const G = [77, 0, 81, 0, 84, 81, 77, 0, 79, 0, 83, 0, 86, 83, 79, 0];
const H = [84, 0, 88, 0, 91, 88, 84, 0, 81, 0, 84, 0, 88, 84, 81, 0];
const I = [76, 0, 0, 0, 79, 0, 76, 0, 72, 0, 0, 0, 69, 0, 67, 0];
const J = [65, 0, 69, 0, 72, 0, 77, 0, 74, 0, 0, 0, 71, 0, 67, 0];

function stitch(mots: number[][], order: number[]) {
  const out: number[] = [];
  for (const i of order) out.push(...mots[i]);
  return out;
}

function composeCalm() {
  const mots = [A, B, C_, D, I, J];
  const order = [0, 1, 0, 2, 0, 1, 3, 2, 4, 5, 0, 1, 3, 2, 0, 3];
  const roots = [48, 48, 45, 45, 41, 41, 43, 43, 48, 45, 41, 43, 48, 40, 41, 43];
  return { roots, lead: stitch(mots, order), bpm: 90, hot: false };
}

function composeHot() {
  const mots = [E, F, G, H, A, D];
  const order = [0, 1, 0, 1, 2, 3, 2, 3, 4, 5, 0, 1, 2, 3, 0, 5];
  const roots = [48, 48, 43, 43, 45, 45, 41, 41, 48, 43, 45, 41, 48, 43, 41, 43];
  return { roots, lead: stitch(mots, order), bpm: 132, hot: true };
}

export function createAudio() {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let music: GainNode | null = null;
  let gCalm: GainNode | null = null;
  let gHot: GainNode | null = null;
  let muted = false;
  let noiseBuf: AudioBuffer | null = null;
  let calmBuf: AudioBuffer | null = null;
  let hotBuf: AudioBuffer | null = null;
  let calmSrc: AudioBufferSourceNode | null = null;
  let hotSrc: AudioBufferSourceNode | null = null;
  let baking = false;
  let wantHot = false;

  function ctx(): AudioContext | null {
    if (ac) return ac;
    try {
      ac = new AudioContext({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    master = ac.createGain();
    sfx = ac.createGain();
    music = ac.createGain();
    gCalm = ac.createGain();
    gHot = ac.createGain();
    sfx.gain.value = 0.8;
    music.gain.value = 1;
    gCalm.gain.value = 0.52;
    gHot.gain.value = 0;
    sfx.connect(master);
    gCalm.connect(music);
    gHot.connect(music);
    music.connect(master);
    master.connect(ac.destination);
    master.gain.value = muted ? 0 : 0.9;
    const n = ac.createBuffer(1, 2048, ac.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = n;
    return ac;
  }

  function sched(
    off: OfflineAudioContext,
    dest: AudioNode,
    when: number,
    freq: number,
    type: OscillatorType,
    vol: number,
    dur: number,
  ) {
    if (freq <= 0) return;
    const o = off.createOscillator();
    const g = off.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(Math.max(0.0001, vol), when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  async function bakeOne(spec: ReturnType<typeof composeCalm>) {
    const step = 60 / spec.bpm / 4;
    const dur = spec.lead.length * step + 0.4;
    const sr = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
    const bus = off.createGain();
    bus.gain.value = 1;
    const lp = off.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = spec.hot ? 4200 : 2600;
    bus.connect(lp);
    lp.connect(off.destination);

    for (let i = 0; i < spec.lead.length; i++) {
      const t = i * step;
      const f = spec.lead[i];
      const root = spec.roots[(i / 16) | 0];
      if (f) sched(off, bus, t, midi(f), spec.hot ? "triangle" : "sine", spec.hot ? 0.22 : 0.2, spec.hot ? 0.18 : 0.36);
      if (i % 16 === 0) {
        sched(off, bus, t, midi(root), spec.hot ? "square" : "triangle", spec.hot ? 0.12 : 0.1, spec.hot ? 0.38 : 0.8);
      }
      if (i % 8 === 0) sched(off, bus, t, spec.hot ? 62 : 48, "sine", spec.hot ? 0.14 : 0.08, 0.12);
      if ((i & 63) === 63) await new Promise((r) => setTimeout(r, 0));
    }
    return off.startRendering();
  }

  function loopInto(buf: AudioBuffer, gain: GainNode) {
    const c = ctx();
    if (!c) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
    return src;
  }

  function mix() {
    const c = ctx();
    if (!c || !gCalm || !gHot) return;
    const t = c.currentTime;
    gCalm.gain.cancelScheduledValues(t);
    gHot.gain.cancelScheduledValues(t);
    gCalm.gain.setTargetAtTime(wantHot ? 0 : 0.52, t, 0.12);
    gHot.gain.setTargetAtTime(wantHot ? 0.58 : 0, t, 0.08);
  }

  async function bakeSongs() {
    if (calmBuf) return;
    baking = true;
    try {
      calmBuf = await bakeOne(composeCalm());
      if (gCalm && !calmSrc) calmSrc = loopInto(calmBuf, gCalm);
      await new Promise((r) => setTimeout(r, 50));
      hotBuf = await bakeOne(composeHot());
      if (gHot && !hotSrc) hotSrc = loopInto(hotBuf, gHot);
      mix();
    } catch {
      baking = false;
    }
  }

  function unlock() {
    const c = ctx();
    if (c && c.state === "suspended") void c.resume();
    if (calmBuf && gCalm && !calmSrc) calmSrc = loopInto(calmBuf, gCalm);
    if (hotBuf && gHot && !hotSrc) hotSrc = loopInto(hotBuf, gHot);
  }

  function startMusic() {
    unlock();
    if (!calmBuf && !baking) {
      baking = true;
      setTimeout(() => {
        void bakeSongs();
      }, 1800);
    }
  }

  function setSuper(on: boolean) {
    wantHot = on;
    mix();
  }

  function tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slide?: number,
  ) {
    const c = ctx();
    if (!c || !sfx) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  function noise(dur: number, vol: number, cutoff: number) {
    const c = ctx();
    if (!c || !sfx || !noiseBuf) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfx);
    src.start(t);
    src.stop(t + dur);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  function play(kind: Sfx) {
    const j = 0.92 + Math.random() * 0.16;
    switch (kind) {
      case "jump":
        tone(420 * j, 0.12, "square", 0.12, 680 * j);
        break;
      case "dash":
        noise(0.16, 0.2, 1600);
        tone(180 * j, 0.2, "sawtooth", 0.07, 90);
        break;
      case "star":
        tone(880 * j, 0.1, "sine", 0.1, 1320);
        break;
      case "smash":
        noise(0.14, 0.24, 800);
        tone(140 * j, 0.12, "square", 0.09, 60);
        break;
      case "crash":
        noise(0.32, 0.28, 550);
        tone(200 * j, 0.36, "sawtooth", 0.1, 55);
        break;
      case "land":
        noise(0.06, 0.1, 400);
        break;
    }
  }

  function setMuted(v: boolean) {
    muted = v;
    const c = ctx();
    if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, c?.currentTime ?? 0, 0.02);
  }

  function resume() {
    if (ac && ac.state === "suspended") void ac.resume();
  }

  function suspend() {
    if (ac && ac.state === "running") void ac.suspend();
  }

  function destroy() {
    for (const s of [calmSrc, hotSrc]) {
      if (!s) continue;
      try {
        s.stop();
      } catch {
        /* */
      }
      s.disconnect();
    }
    calmSrc = hotSrc = null;
    if (ac) void ac.close();
    ac = null;
  }

  return { unlock, startMusic, play, setMuted, setSuper, muted: () => muted, resume, suspend, destroy };
}

export type AudioBus = ReturnType<typeof createAudio>;
