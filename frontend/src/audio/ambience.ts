// 环境声：海浪、风、索具、船身、海鸥、雨、雷。全部实时合成——
// - 海浪：每一道浪是一段粉红噪声，经过随浪头升降的低通，音量先涨后落；海上浪大而疏，港内是轻轻拍岸的小浪；
// - 拍船身：浪头打到船壳上的一记“啪”（一小团低通噪声加一声船壳的闷响，dsp.slap），海上跟着每道浪头，港内是拍在码头木桩上的小浪；
// - 风：持续的噪声经过缓慢漂移的带通，阵风时音量与音色起伏；风力越大越响、越尖；
// - 索具：风吹过缆绳的呜呜声（窄带通的噪声，音高随阵风飘），风力 4 级以上才有，暴风雨时最响；
// - 船身的吱呀：木头摩擦的“粘—滑”（dsp.creak），海上随风浪几秒一声，港内停着的船偶尔一声（远一些、暗一些）；
// - 海鸥：一串两三声的叫（dsp.gull），港内常有，海上偶尔（风大、下雨、暴风雨时没有），标题画面远远地有；
// - 雨：高通的白噪声；暴风雨时更密，另有远处的雷声（低通的布朗噪声，几秒长）。
// 场景（海上 / 港口 / 标题画面）与天况变化时，持续的层在几秒内平滑过渡，浪、吱呀与海鸥按新的参数一道道生成。
// 音量都放在音乐之下：缺省音量时海上整体约 −40 dBFS（暴风雨约 −30），港内更轻。
//
// 注意：循环播放的噪声直接接进双二阶滤波器时，某些缓冲长度（例如 44.1 kHz 下 130095 个采样）在 Chromium 里几秒后会发散成非数，
// 把整个输出（经过压限器）一起毁掉；所以噪声源一律先经过一个增益节点再进滤波器（见 loop()）。
import type { SkyKind } from "../ipc/types";
import { creak, gull, noise, slap } from "./dsp";
import { rng } from "./score";

/** 环境声的场景。 */
export interface AmbienceScene {
  place: "sea" | "port" | "title" | "none";
  sky: SkyKind | null;
  /** 风力 0–10 */
  wind: number;
}

function buffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return b;
}

/** 持续的一层：循环噪声 → 滤波 → 音量。 */
interface Layer {
  filter: BiquadFilterNode;
  gain: GainNode;
}

/** 每种采样预先（按需）算几个变体，轮流用。 */
const VARIANTS = { creak: 5, gull: 6, slap: 4 } as const;
type SampleKind = keyof typeof VARIANTS;

export class Ambience {
  private readonly pink: AudioBuffer;
  private readonly brown: AudioBuffer;
  private readonly white: AudioBuffer;
  private readonly wind: Layer;
  private readonly rigging: Layer;
  private readonly rain: Layer;
  private readonly samples = new Map<string, AudioBuffer>();
  private scene: AmbienceScene = { place: "none", sky: null, wind: 0 };
  private nextWave = 0;
  private nextGust = 0;
  private nextThunder = 0;
  private nextCreak = 0;
  private nextSlap = 0;
  private nextGull = 0;
  private readonly rand = rng(20260928);

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
  ) {
    const sr = ctx.sampleRate;
    this.pink = buffer(ctx, noise("pink", 6, sr, 3));
    this.brown = buffer(ctx, noise("brown", 6, sr, 4));
    this.white = buffer(ctx, noise("white", 3, sr, 5));
    this.wind = this.layer(this.brown, "bandpass", 500, 0.8);
    this.rigging = this.layer(this.white, "bandpass", 900, 14);
    this.rain = this.layer(this.white, "highpass", 2200, 0.5);
  }

  /** 循环播放一段噪声，先经过一个增益节点（见文件头的注意），返回这个增益节点。 */
  private loop(buf: AudioBuffer, at: number, offset: number, stop?: number): GainNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const pre = this.ctx.createGain();
    src.connect(pre);
    src.start(at, offset);
    if (stop !== undefined) src.stop(stop);
    return pre;
  }

  private layer(buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number): Layer {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.loop(buf, this.ctx.currentTime, 0).connect(filter).connect(gain).connect(this.out);
    return { filter, gain };
  }

  /** 第 i 个变体的采样（第一次用到时才算）。 */
  private sample(kind: SampleKind, i: number): AudioBuffer {
    const key = `${kind}:${i % VARIANTS[kind]}`;
    let b = this.samples.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate;
      const seed = { creak: 7001, gull: 8001, slap: 9001 }[kind] + (i % VARIANTS[kind]) * 97;
      b = buffer(this.ctx, kind === "creak" ? creak(sr, seed) : kind === "gull" ? gull(sr, seed) : slap(sr, seed));
      this.samples.set(key, b);
    }
    return b;
  }

  /** 放一个采样：音量、声像、低通（远处的更暗）、快慢（音高）。 */
  private play(kind: SampleKind, at: number, level: number, pan: number, lp = 0, rate = 1): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.sample(kind, Math.floor(this.rand() * 1000));
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    let head: AudioNode = src;
    if (lp > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      f.Q.value = 0.5;
      head = f;
      src.connect(f);
    }
    head.connect(g).connect(p).connect(this.out);
    src.start(at);
  }

  /** 换场景：持续的层在约 3 秒内过渡到新的音量。 */
  set(scene: AmbienceScene): void {
    const prev = this.scene;
    this.scene = scene;
    const now = this.ctx.currentTime;
    if (prev.place !== scene.place) {
      this.nextWave = now + 0.2;
      this.nextCreak = now + 1 + this.rand() * 2;
      this.nextSlap = now + 0.5 + this.rand();
      this.nextGull = now + 2 + this.rand() * 4;
    }
    const w = Math.max(0, Math.min(10, scene.wind));
    const storm = scene.sky === "storm";
    const outdoors = scene.place === "sea" || scene.place === "port";
    let wind = outdoors ? 0.02 + w * 0.028 : 0;
    if (scene.place === "port") wind *= 0.6;
    if (storm) wind = Math.max(wind, 0.32);
    this.wind.gain.gain.setTargetAtTime(wind, now, 1.2);
    this.wind.filter.frequency.setTargetAtTime(storm ? 950 : 380 + w * 45, now, 1.5);
    // 索具：风力 4 级以上才呜呜作响，港内停着的船小一些
    let rigging = outdoors ? Math.max(0, w - 3) * 0.05 : 0;
    if (scene.place === "port") rigging *= 0.4;
    if (storm) rigging = Math.max(rigging, 0.45);
    this.rigging.gain.gain.setTargetAtTime(rigging, now, 1.5);
    this.rigging.filter.frequency.setTargetAtTime(storm ? 1250 : 700 + w * 45, now, 2);
    const rain = !outdoors ? 0 : storm ? 0.22 : scene.sky === "rain" ? 0.12 : 0;
    this.rain.gain.gain.setTargetAtTime(rain, now, 1.5);
    if (storm && this.nextThunder === 0) this.nextThunder = now + 4 + this.rand() * 6;
    if (!storm) this.nextThunder = 0;
  }

  /** 每次调度时调用：安排下一道浪、下一阵风、下一声吱呀、海鸥与雷。 */
  tick(now: number): void {
    const s = this.scene;
    if (s.place === "none") return;
    const w = Math.max(0, Math.min(10, s.wind));
    const storm = s.sky === "storm";
    const calm = s.sky === "fog" ? 0.7 : 1;
    if (now + 0.3 >= this.nextWave) {
      const at = Math.max(now, this.nextWave);
      if (s.place === "port") {
        this.wave(at, 0.6 + this.rand() * 0.6, 0.9 + this.rand() * 1.2, 0.18 * calm, 650);
        this.nextWave = at + 1.4 + this.rand() * 2.2;
      } else {
        const big = s.place === "title" ? 0.55 : 0.75 + w * 0.05 + (storm ? 0.4 : 0);
        const rise = 1.4 + this.rand() * 1.4;
        this.wave(at, rise, 2.2 + this.rand() * 2.4, 0.3 * big * calm, 900 + w * 90 + (storm ? 600 : 0));
        // 浪头打在船壳上（标题画面没有船）
        if (s.place === "sea") this.play("slap", at + rise * (0.85 + this.rand() * 0.2), (0.07 + w * 0.008 + (storm ? 0.05 : 0)) * calm, (this.rand() * 2 - 1) * 0.5, 0, 0.9 + this.rand() * 0.2);
        this.nextWave = at + (storm ? 2 : 3.2) + this.rand() * 3.5;
      }
    }
    if (now >= this.nextGust && s.place !== "title") {
      const base = this.wind.gain.gain.value;
      const k = 0.7 + this.rand() * 0.6;
      this.wind.gain.gain.setTargetAtTime(base * k, now, 0.9 + this.rand());
      this.wind.filter.frequency.setTargetAtTime((storm ? 850 : 330 + w * 40) * (0.8 + this.rand() * 0.5), now, 1.2);
      // 缆绳的呜呜声跟着阵风飘
      this.rigging.filter.frequency.setTargetAtTime((storm ? 1250 : 700 + w * 45) * (0.85 + this.rand() * 0.35), now, 0.8);
      this.nextGust = now + 2 + this.rand() * 3;
    }
    // 拍船身、拍码头木桩的小浪
    if (now + 0.3 >= this.nextSlap && s.place !== "title") {
      const at = Math.max(now, this.nextSlap);
      if (s.place === "port") {
        this.play("slap", at, 0.035 * calm, (this.rand() * 2 - 1) * 0.7, 1400, 0.95 + this.rand() * 0.2);
        this.nextSlap = at + 1.2 + this.rand() * 2.4;
      } else {
        this.play("slap", at, (0.03 + w * 0.004) * calm, (this.rand() * 2 - 1) * 0.6, 0, 0.9 + this.rand() * 0.25);
        this.nextSlap = at + (storm ? 0.8 : 1.6) + this.rand() * 2.2;
      }
    }
    // 船身的吱呀
    if (now + 0.3 >= this.nextCreak && s.place !== "title") {
      const at = Math.max(now, this.nextCreak);
      if (s.place === "port") {
        this.play("creak", at, 0.05, (this.rand() * 2 - 1) * 0.8, 1800, 0.85 + this.rand() * 0.3);
        this.nextCreak = at + 8 + this.rand() * 12;
      } else {
        const hard = storm ? 1.5 : 0.8 + w * 0.05;
        this.play("creak", at, (0.07 + this.rand() * 0.05) * hard, (this.rand() * 2 - 1) * 0.7, 0, 0.8 + this.rand() * 0.4);
        this.nextCreak = at + (storm ? 1.8 + this.rand() * 3 : (4 + this.rand() * 6) / (0.7 + w * 0.06));
      }
    }
    // 海鸥：港内常有，海上偶尔；风大、下雨、暴风雨时不出来，雾里少
    if (now + 0.3 >= this.nextGull) {
      const at = Math.max(now, this.nextGull);
      const quiet = storm || s.sky === "rain" || (s.place === "sea" && w >= 7);
      if (!quiet) this.gulls(at, s.place === "port" ? 0.07 : 0.04, s.place === "port" ? 3800 : 2600);
      const gap = s.place === "port" ? 7 + this.rand() * 10 : s.place === "title" ? 14 + this.rand() * 16 : 25 + this.rand() * 35;
      this.nextGull = at + gap * (s.sky === "fog" ? 2 : 1);
    }
    if (this.nextThunder > 0 && now + 0.3 >= this.nextThunder) {
      this.thunder(Math.max(now, this.nextThunder));
      this.nextThunder = this.nextThunder + 12 + this.rand() * 22;
    }
  }

  /** 一串海鸥叫：一两只，各叫两三声；远的更暗、更轻。 */
  private gulls(at: number, level: number, lp: number): void {
    const birds = this.rand() < 0.35 ? 2 : 1;
    for (let b = 0; b < birds; b++) {
      const pan = (this.rand() * 2 - 1) * 0.8;
      const rate = 0.9 + this.rand() * 0.25;
      const far = b > 0 ? 0.6 : 1;
      let t = at + b * (0.4 + this.rand() * 0.8);
      const calls = 1 + Math.floor(this.rand() * 3);
      for (let k = 0; k < calls; k++) {
        this.play("gull", t, level * far * (0.8 + this.rand() * 0.4), pan, lp * far, rate * (0.97 + this.rand() * 0.06));
        t += 0.3 + this.rand() * 0.3;
      }
    }
  }

  /** 一道浪：音量涨 rise 秒、落 fall 秒，低通随浪头打开到 bright Hz。 */
  private wave(at: number, rise: number, fall: number, level: number, bright: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(220, at);
    lp.frequency.linearRampToValueAtTime(bright, at + rise);
    lp.frequency.linearRampToValueAtTime(260, at + rise + fall);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + rise);
    g.gain.linearRampToValueAtTime(level * 0.25, at + rise + fall * 0.5);
    g.gain.linearRampToValueAtTime(0, at + rise + fall);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (this.rand() * 2 - 1) * 0.6;
    this.loop(this.pink, at, this.rand() * 5, at + rise + fall + 0.1).connect(lp).connect(g).connect(pan).connect(this.out);
  }

  /** 远处的雷：一阵低沉的隆隆声。 */
  private thunder(at: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160 + this.rand() * 140;
    const g = ctx.createGain();
    const len = 3 + this.rand() * 3;
    const peak = 0.45 + this.rand() * 0.3;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.08 + this.rand() * 0.3);
    g.gain.setTargetAtTime(peak * 0.5, at + 0.6, 0.4);
    g.gain.setTargetAtTime(0, at + 1.2, len / 4);
    this.loop(this.brown, at, this.rand() * 4, at + len + 2).connect(lp).connect(g).connect(this.out);
  }
}
