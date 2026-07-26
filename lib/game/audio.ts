/**
 * WebAudio による効果音・BGM生成器（外部アセット不要）
 */

export type SfxName =
  | "shot"
  | "laser"
  | "missile"
  | "wave"
  | "rail"
  | "hit"
  | "explode"
  | "bigExplode"
  | "item"
  | "powerup"
  | "damage"
  | "bomb"
  | "select"
  | "confirm"
  | "cancel"
  | "stageClear"
  | "gameOver"
  | "warning"
  | "extend";

interface SfxDef {
  type: OscillatorType;
  from: number;
  to: number;
  dur: number;
  gain: number;
  noise?: boolean;
  sweepQ?: number;
}

const SFX: Record<SfxName, SfxDef> = {
  shot: { type: "square", from: 880, to: 420, dur: 0.07, gain: 0.16 },
  laser: { type: "sawtooth", from: 1400, to: 600, dur: 0.12, gain: 0.14 },
  missile: { type: "triangle", from: 320, to: 720, dur: 0.14, gain: 0.16 },
  wave: { type: "sine", from: 240, to: 90, dur: 0.22, gain: 0.2 },
  rail: { type: "sawtooth", from: 180, to: 1600, dur: 0.18, gain: 0.18 },
  hit: { type: "square", from: 520, to: 240, dur: 0.05, gain: 0.1 },
  explode: { type: "sawtooth", from: 300, to: 40, dur: 0.3, gain: 0.24, noise: true },
  bigExplode: { type: "sawtooth", from: 200, to: 24, dur: 0.85, gain: 0.34, noise: true },
  item: { type: "sine", from: 660, to: 1320, dur: 0.14, gain: 0.18 },
  powerup: { type: "triangle", from: 440, to: 1760, dur: 0.32, gain: 0.2 },
  damage: { type: "square", from: 220, to: 60, dur: 0.3, gain: 0.26, noise: true },
  bomb: { type: "sine", from: 900, to: 30, dur: 1.0, gain: 0.3, noise: true },
  select: { type: "square", from: 620, to: 700, dur: 0.05, gain: 0.1 },
  confirm: { type: "square", from: 700, to: 1400, dur: 0.14, gain: 0.16 },
  cancel: { type: "square", from: 500, to: 220, dur: 0.12, gain: 0.14 },
  stageClear: { type: "triangle", from: 520, to: 1560, dur: 0.6, gain: 0.22 },
  gameOver: { type: "sawtooth", from: 400, to: 60, dur: 1.2, gain: 0.24 },
  warning: { type: "square", from: 880, to: 880, dur: 0.18, gain: 0.2 },
  extend: { type: "sine", from: 880, to: 2640, dur: 0.5, gain: 0.22 },
};

/** ステージテーマごとの簡易 BGM（ベースライン + アルペジオ） */
const SCALES: number[][] = [
  [0, 3, 5, 7, 10], // minor pentatonic
  [0, 2, 3, 7, 8], // dark
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 1, 5, 7, 8], // phrygian-ish
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterSfx: GainNode | null = null;
  private masterBgm: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmSeed = 0;
  private sfxVolume = 0.6;
  private bgmVolume = 0.35;
  private enabled = false;
  private lastPlayed: Record<string, number> = {};

  /** ユーザー操作をきっかけに初期化する必要がある */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext
        : undefined;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.masterSfx = ctx.createGain();
    this.masterSfx.gain.value = this.sfxVolume;
    this.masterSfx.connect(ctx.destination);
    this.masterBgm = ctx.createGain();
    this.masterBgm.gain.value = this.bgmVolume * 0.5;
    this.masterBgm.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.enabled = true;
  }

  setVolumes(sfx: number, bgm: number) {
    this.sfxVolume = sfx;
    this.bgmVolume = bgm;
    if (this.masterSfx) this.masterSfx.gain.value = sfx;
    if (this.masterBgm) this.masterBgm.gain.value = bgm * 0.5;
  }

  play(name: SfxName, pitchShift = 1, throttleMs = 0) {
    if (!this.enabled || !this.ctx || !this.masterSfx || this.sfxVolume <= 0) return;
    const now = performance.now();
    if (throttleMs > 0) {
      const last = this.lastPlayed[name] ?? -Infinity;
      if (now - last < throttleMs) return;
      this.lastPlayed[name] = now;
    }
    const def = SFX[name];
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(def.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + def.dur);
    g.connect(this.masterSfx);

    const osc = ctx.createOscillator();
    osc.type = def.type;
    osc.frequency.setValueAtTime(def.from * pitchShift, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, def.to * pitchShift), t + def.dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + def.dur + 0.02);

    if (def.noise && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(def.gain * 0.8, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + def.dur);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2400, t);
      filter.frequency.exponentialRampToValueAtTime(200, t + def.dur);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(this.masterSfx);
      src.start(t);
      src.stop(t + def.dur);
    }
  }

  startBgm(seed: number, tempoMs = 150) {
    if (!this.enabled || !this.ctx) return;
    this.stopBgm();
    this.bgmSeed = seed;
    this.bgmStep = 0;
    this.bgmTimer = window.setInterval(() => this.bgmTick(), tempoMs);
  }

  stopBgm() {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private bgmTick() {
    if (!this.ctx || !this.masterBgm || this.bgmVolume <= 0) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const scale = SCALES[this.bgmSeed % SCALES.length];
    const root = 55 * Math.pow(2, ((this.bgmSeed % 5) - 2) / 12);
    const step = this.bgmStep++;

    // ベース（4分ごと）
    if (step % 4 === 0) {
      const bassNote = scale[(step / 4) % scale.length];
      this.tone(root * Math.pow(2, bassNote / 12), "triangle", 0.34, 0.18, t);
    }
    // アルペジオ
    const note = scale[(step * 3 + (step >> 3)) % scale.length];
    const oct = 2 + ((step >> 2) % 2);
    this.tone(root * Math.pow(2, note / 12) * Math.pow(2, oct), "square", 0.12, 0.06, t);
    // ハイハット的ノイズ
    if (step % 2 === 1 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6000;
      src.connect(hp);
      hp.connect(g);
      g.connect(this.masterBgm);
      src.start(t);
      src.stop(t + 0.06);
    }
  }

  private tone(freq: number, type: OscillatorType, dur: number, gain: number, t: number) {
    if (!this.ctx || !this.masterBgm) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.masterBgm);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  dispose() {
    this.stopBgm();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.enabled = false;
  }
}
