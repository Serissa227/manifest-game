// 音乐引擎（Web Audio）：把曲目展开出的音符事件排进音频时钟，边播边往前排（前瞻调度），一遍奏完留白再奏下一遍。
//
// 信号链：
//   各声部 → 声像 → 曲目总线（淡入淡出用）→ 曲目压低（短乐句时）─┬─→ 音乐总线（音乐音量）─┐
//                   └→ 混响送量 → 曲目混响推子 → 曲目压低 → 混响（房间，或“大厅”）─┘        ├→ 总音量（静音）→ 低切 → 压限 → 输出
//   短乐句（出港、入港、发现、大赚）→ 自己的总线 → 音乐总线（不被压低）                      │
//   环境声（ambience.ts）→ 环境声总线（环境音量）───────────────────────────────────────────┤
//   音效（sfx/：按钮、交易、航海、海战）→ 音效总线（音效音量）────────────────────────────────┘
//
// 音效与音乐、环境声共用这个音频上下文与总音量（静音同样静掉音效），各有各的音量；短乐句奏着时音效压低一点（sfx/player.ts 的 jingle）。
// 换曲时新曲淡入、旧曲淡出（旧曲不再排新音，已排的音在推子后面静静结束）。
// 短乐句奏的几秒里，正在放的曲子（连同它的混响送量）压低约 10 dB，奏完再慢慢回来，不打断主曲。
// 拨弦、击奏与鼓点的采样在后台分片预先算好（每次调度最多占用几毫秒），避免画面卡顿。
// 管弦版的曲子用真实乐器的采样（orchestra/）：开始一首之前由导演先把它要用的采样加载好（prepare / ready），采样器照同样的调度排音。
// 采样没到时导演先放同一首的合成版；采样到了用 handoff 在合成版的下一段开头换成管弦版（两套的分段时刻一样时），听起来是同一首接着奏。
import { Ambience, type AmbienceScene } from "./ambience";
import { drum, mallet, pluck, reverbIR, noise } from "./dsp";
import { DRUMS, INSTRUMENTS, type Instrument, type PluckVib, type SustainSpec } from "./instruments";
import { downloaded, focusDownloads, orderIdle, SampleBank, type Priority } from "./orchestra/bank";
import { isOrchestral, ORCH_INSTRUMENTS, type SampledSpec } from "./orchestra/instruments";
import { filesFor } from "./orchestra/pick";
import { Sampler } from "./orchestra/sampler";
import { realizePass, rng, seedOf, type NoteEvent, type TrackDef } from "./score";
import { SfxPlayer } from "./sfx/player";
import { midiToHz, parseKey } from "./theory";

/** 采样缓存的上限（字节）。 */
const CACHE_BYTES = 64 * 1024 * 1024;
/** 每个鼓点预先算几个变体。 */
const DRUM_VARIANTS = 4;
/** 乐句内两音的间隔超过这么多秒就另起一个乐句。 */
const PHRASE_GAP = 0.09;

/** 换编配（handoff）时，新的一套至少提前这么久排好（秒）：离下一段更近时等再下一段。 */
const HANDOFF_LEAD = 0.6;
/** 换编配时旧的一套在接上的那一刻起淡出的时间（秒）：长音的尾巴收得自然一点。 */
const HANDOFF_FADE = 0.6;
/** 两套编配的分段时刻差多少以内算一样（秒）：各自开头有几毫秒的“人味”抖动，听不出来。 */
const HANDOFF_SLACK = 0.02;

/** 短乐句奏的时候，正在放的曲子压低到这个倍数（约 −10 dB）。 */
export const DUCK = 0.32;

/** 缺省的音效音量（与 prefs.ts 的缺省一致）：此时音效总线的增益正好是 1，音效表（sfx/events.ts）里的音量就是按这时量的。 */
export const SFX_DEFAULT = 0.7;

/** 音效音量（0–1）→ 音效总线的增益：按平方映射（与音乐、环境声一样听感更均匀），缺省音量时为 1，最大约 +6 dB。 */
export function sfxGain(v: number): number {
  const x = Math.max(0, Math.min(1, v));
  return (x * x) / (SFX_DEFAULT * SFX_DEFAULT);
}

/** “大厅”混响：比房间（2.4 秒）长，3.4 秒；预延迟 30 毫秒，早期反射散得更开，尾巴更暗（大编制的主题曲、外洋、北海与风暴用）。 */
export const HALL = { pre: 0.03, early: 0.09, dark: 1100 } as const;

/** 已排定的音源：结束时自动移出（淡出换曲时停掉仍在响的）。 */
type Sources = Set<AudioScheduledSourceNode>;

/** 乐器：合成版（instruments.ts）或管弦版的采样乐器（orchestra/instruments.ts，键以 “o.” 开头）。 */
export type AnyInstrument = Instrument | SampledSpec;

/** 按键找乐器（两张表都找）；没有时为 undefined。 */
export function instrumentOf(id: string): AnyInstrument | undefined {
  if (Object.prototype.hasOwnProperty.call(INSTRUMENTS, id)) return INSTRUMENTS[id];
  return isOrchestral(id) ? ORCH_INSTRUMENTS[id] : undefined;
}

/**
 * 齐奏各振荡器的音分偏移：voices 个，在 ±spread/2 之内均匀错开；只有一个时不偏。
 * 没写 unison 的长音乐器沿用旧的两个振荡器（±detune/2）。
 */
export function unisonOffsets(spec: SustainSpec): number[] {
  const n = Math.max(1, Math.round(spec.unison?.voices ?? 0));
  if (spec.unison && n > 1) {
    const s = spec.unison.spread;
    return Array.from({ length: n }, (_, i) => -s / 2 + (s * i) / (n - 1));
  }
  if (spec.kind === "pad" && (spec.detune ?? 0) > 0) return [-(spec.detune ?? 0) / 2, (spec.detune ?? 0) / 2];
  return [0];
}

/**
 * 短乐句移到正在放的曲子的调上（半音数，−6…+5）：大调式（伊奥尼亚、利底亚、混合利底亚）移到同一个主音，
 * 其余（小调、多利亚、弗里几亚、木卡姆……）移到关系大调（主音 + 小三度），这样短乐句与压低了的主曲不打架。
 */
export function cueShift(trackKey: string, cueKey: string): number {
  const k = parseKey(trackKey);
  const c = parseKey(cueKey);
  const major = k.mode === "ionian" || k.mode === "lydian" || k.mode === "mixolydian";
  const target = major ? k.tonic : (k.tonic + 3) % 12;
  let d = (((target - c.tonic) % 12) + 12) % 12;
  if (d > 5) d -= 12;
  return d;
}

function keep(set: Sources, node: AudioScheduledSourceNode): void {
  set.add(node);
  node.addEventListener("ended", () => set.delete(node));
}

/**
 * 循环播放的噪声进滤波器之前先经过的一个增益节点（增益 1）：Chromium 里循环的缓冲源直接接双二阶滤波器时，
 * 某些缓冲长度（例如 44.1 kHz 下 130095 个采样）几秒后滤波器会发散成非数，经过压限器把整个输出一起毁掉。隔一个节点就不会。
 */
export function noiseTap(ctx: BaseAudioContext): GainNode {
  return ctx.createGain();
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, data.length), ctx.sampleRate);
  buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return buf;
}

/**
 * 弯音的形状（地方乐器的装饰）：
 * - bend：从低一个全音处“按”上来——先停 BEND_HOLD 秒再滑到本音（筝的后押、西塔琴的 meend、琵琶的推弦、二胡与尺八的上滑）；
 * - fall：奏到 FALL_AT 处往下落一个全音（尺八、奈伊笛的句尾，二胡的下滑）；
 * - vib：揉弦 / 揉音加深（筝的 yuri、乌德琴与西塔琴的颤音、二胡的揉弦、尺八的 yuri）；
 * - andolan：北印度拉格的慢摇（达尔巴里的降三、降六，梅格的二级），记谱时同时带 vib（见 abc.ts）。
 *   摇法属于拉格、不属于乐器：哪件乐器奏都按 ANDOLAN 一样慢、一样宽（萨朗吉与低八度的鲁德拉维纳琴奏同一句时摆得一样）。
 *   andolan 是单边的：记谱音是摆动的一端，不越过它——缺省往下摆（达尔巴里的降三、降六本来就比十二平均律的降 E、降 A 低，
 *   降三摆向二级、降六摆向五级，不往上冲）；带 up 装饰（!andolan-up!）时往上摆（梅格的二级带着四级的倚音，摆向上方）。
 */
export const BEND = { depth: Math.pow(2, -2 / 12), hold: 0.06, tc: 0.05 } as const;
export const FALL = { depth: Math.pow(2, -2 / 12), at: 0.62, tc: 0.12 } as const;
export const PLUCK_VIB = { rate: 5.6, depth: 0.011, delay: 0.16 } as const;
/**
 * andolan：每秒 rate 下、摆幅 ±depth 音分，delay 秒后以时间常数 tc 慢慢摇开；摆动的中心同时以 tc 移到记谱音下方 depth 音分处
 * （带 up 时移到上方），所以音高在记谱音与约 2 × depth 音分外之间来回、不越过记谱音。
 */
export const ANDOLAN = { rate: 1.4, depth: 32, delay: 0.12, tc: 0.25 } as const;
/** andolan 在拨弦的播放速率上的幅度（±ANDOLAN.depth 音分）；中心偏到 1 ∓ 这个幅度，记谱音（速率 1）正好是一端。 */
const ANDOLAN_RATE_DEPTH = Math.pow(2, ANDOLAN.depth / 1200) - 1;

/** andolan 往哪边摆：带 up 往上（+1），缺省往下（−1）。 */
export function andolanDir(deco: readonly string[] | undefined): 1 | -1 {
  return deco?.includes("up") ? 1 : -1;
}

/** 拨弦弯音的音高倍数（按 bend、fall 两种装饰）：音符开始后 tau 秒、时值 d 秒处的播放速率。 */
export function bendCurve(deco: readonly string[] | undefined, tau: number, d: number): number {
  let r = 1;
  if (deco?.includes("bend")) r *= tau < BEND.hold ? BEND.depth : 1 - (1 - BEND.depth) * Math.exp(-(tau - BEND.hold) / BEND.tc);
  if (deco?.includes("fall")) {
    const at = d * FALL.at;
    if (tau > at) r *= FALL.depth + (1 - FALL.depth) * Math.exp(-(tau - at) / (d * FALL.tc));
  }
  return r;
}

/**
 * 把弯音与揉弦排到一个拨弦的缓冲源上。noteStart 是音符的开始（震音的每一下都按同一条曲线接着走），
 * hitStart 是这一下的开始，stopAt 是它停下的时刻（揉弦的低频振荡器同时停）。没有这几种装饰时什么也不做。
 * vib 为乐器自己的揉弦（Instrument 的 pluckVib），不写时按 PLUCK_VIB；写了 andolan 的音不看它，按 ANDOLAN 慢摇（中心往下偏，带 up 往上偏）。
 * pluckVib 写了 lift 时，摆动的中心随深度一起往上偏 lift × depth（lift 为 1 时从记谱音往上摆、不往下沉）。
 */
function bendBuffer(ctx: BaseAudioContext, src: AudioBufferSourceNode, ev: NoteEvent, noteStart: number, hitStart: number, stopAt: number, out: Sources, vib?: PluckVib): void {
  const deco = ev.deco;
  if (!deco || !(deco.includes("bend") || deco.includes("fall") || deco.includes("vib"))) return;
  const rate = src.playbackRate;
  const tau = hitStart - noteStart;
  if (deco.includes("bend") || deco.includes("fall")) {
    rate.setValueAtTime(bendCurve(deco, tau, ev.d), hitStart);
    if (deco.includes("bend")) rate.setTargetAtTime(1, Math.max(hitStart, noteStart + BEND.hold), BEND.tc);
    if (deco.includes("fall")) rate.setTargetAtTime(FALL.depth, Math.max(hitStart, noteStart + ev.d * FALL.at), ev.d * FALL.tc);
  }
  if (deco.includes("vib") && stopAt > hitStart) {
    const andolan = deco.includes("andolan");
    const lfo = ctx.createOscillator();
    lfo.frequency.value = andolan ? ANDOLAN.rate : (vib?.rate ?? PLUCK_VIB.rate);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, hitStart);
    if (andolan) {
      const at = Math.max(hitStart, noteStart + ANDOLAN.delay);
      depth.gain.setTargetAtTime(ANDOLAN_RATE_DEPTH, at, ANDOLAN.tc);
      // 单边的慢摇：中心与摆幅一起偏到记谱音的一侧（缺省往下），记谱音是摆动的一端
      rate.setTargetAtTime(1 + andolanDir(deco) * ANDOLAN_RATE_DEPTH, at, ANDOLAN.tc);
    } else {
      const at = Math.max(hitStart, noteStart + (vib?.delay ?? PLUCK_VIB.delay));
      const d = vib?.depth ?? PLUCK_VIB.depth;
      depth.gain.setTargetAtTime(d, at, 0.12);
      // 单边的摆（卡纳提克的 kampita）：中心与深度一起往上偏
      if (vib?.lift) rate.setTargetAtTime(1 + vib.lift * d, at, 0.12);
    }
    lfo.connect(depth).connect(rate);
    lfo.start(hitStart);
    lfo.stop(stopAt);
    keep(out, lfo);
  }
}

/** 合成器：缓存采样与振荡器波形，把音符变成 Web Audio 节点。 */
export class Synth {
  private buffers = new Map<string, AudioBuffer>();
  private bytes = 0;
  private waves = new Map<string, PeriodicWave>();
  private drumTurn = new Map<string, number>();
  private readonly whiteNoise: AudioBuffer;
  /** 管弦版的采样器（引擎创建时接上；离线分析合成版曲目时可以没有） */
  sampler: Sampler | null = null;

  constructor(readonly ctx: BaseAudioContext) {
    this.whiteNoise = toBuffer(ctx, noise("white", 2, ctx.sampleRate, 11));
  }

  private remember(key: string, buf: AudioBuffer): AudioBuffer {
    this.buffers.set(key, buf);
    this.bytes += buf.length * 4;
    // 超出上限时丢掉最久没用的
    for (const [k, b] of this.buffers) {
      if (this.bytes <= CACHE_BYTES) break;
      this.buffers.delete(k);
      this.bytes -= b.length * 4;
    }
    return buf;
  }

  private cached(key: string): AudioBuffer | undefined {
    const b = this.buffers.get(key);
    if (b) {
      // 刷新“最近使用”
      this.buffers.delete(key);
      this.buffers.set(key, b);
    }
    return b;
  }


  /** 拨弦 / 击奏的采样（没有就现算）。 */
  tone(instId: string, inst: Instrument, midi: number): AudioBuffer {
    const m = Math.round(midi * 2) / 2;
    const key = `${instId}:${m}`;
    const hit = this.cached(key);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const seed = seedOf(key);
    const data = inst.kind === "pluck" ? pluck(inst.spec, midiToHz(m), sr, seed) : inst.kind === "mallet" ? mallet(inst.spec, midiToHz(m), sr, seed) : new Float32Array(1);
    return this.remember(key, toBuffer(this.ctx, data));
  }

  /** 鼓点采样：几个变体轮流用。 */
  drum(hit: string, advance = true): AudioBuffer | null {
    const spec = DRUMS[hit];
    if (!spec) return null;
    const turn = this.drumTurn.get(hit) ?? 0;
    if (advance) this.drumTurn.set(hit, turn + 1);
    const key = `drum:${hit}:${turn % DRUM_VARIANTS}`;
    const got = this.cached(key);
    if (got) return got;
    return this.remember(key, toBuffer(this.ctx, drum(spec, this.ctx.sampleRate, seedOf(key))));
  }

  /** 预先算好一个音要用的采样（后台分片调用）。 */
  warm(ev: NoteEvent, instId: string): void {
    const inst = INSTRUMENTS[instId];
    if (!inst) return;
    if (inst.kind === "pluck" || inst.kind === "mallet") this.tone(instId, inst, ev.m);
    else if (inst.kind === "perc" && ev.hit) {
      for (let v = 0; v < DRUM_VARIANTS; v++) {
        const key = `drum:${ev.hit}:${v}`;
        const spec = DRUMS[ev.hit];
        if (spec && !this.buffers.has(key)) this.remember(key, toBuffer(this.ctx, drum(spec, this.ctx.sampleRate, seedOf(key))));
      }
    }
  }


  /** 持续音乐器在某音高的波形（谐波振幅按音高算，共振峰固定在频率上）。 */
  wave(instId: string, spec: SustainSpec, midi: number): PeriodicWave {
    const m = Math.round(midi);
    const key = `${instId}:${m}`;
    let w = this.waves.get(key);
    if (w) return w;
    const f0 = midiToHz(m);
    const count = Math.max(1, Math.min(48, Math.floor(12000 / f0)));
    const real = new Float32Array(count + 1);
    const imag = new Float32Array(count + 1);
    for (let n = 1; n <= count; n++) imag[n] = spec.amps(n, n * f0);
    w = this.ctx.createPeriodicWave(real, imag);
    this.waves.set(key, w);
    return w;
  }

  // ───────────────────────────── 发声

  /** 拨弦 / 击奏的一个音（长音乐器用震音时，重复拨弦；定音鼓写了 !trem! 时滚奏）。 */
  pluckNote(ev: NoteEvent, instId: string, inst: Extract<Instrument, { kind: "pluck" | "mallet" }>, dest: AudioNode, when: number, out: Sources): void {
    const ctx = this.ctx;
    const buf = this.tone(instId, inst, ev.m);
    const level = ev.v * inst.level;
    const release = inst.release ?? (inst.kind === "pluck" ? 0.3 : 0.8);
    if (inst.kind === "mallet" && inst.roll !== undefined && ev.deco?.includes("trem")) {
      this.rollNote(ev, buf, level, inst.roll, release, dest, when, out);
      return;
    }
    const tremolo = inst.kind === "pluck" && inst.tremolo !== undefined && (ev.deco?.includes("trem") || ev.d >= inst.tremolo);
    const hits = tremolo ? Math.max(2, Math.round(ev.d * (inst.kind === "pluck" ? (inst.tremRate ?? 12.5) : 12.5))) : 1;
    const step = ev.d / hits;
    for (let k = 0; k < hits; k++) {
      const t = when + k * step;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (ev.deco?.includes("slide") && k === 0) {
        src.playbackRate.setValueAtTime(Math.pow(2, -1.5 / 12), t);
        src.playbackRate.setTargetAtTime(1, t + 0.01, 0.035);
      }
      const g = ctx.createGain();
      // 震音：下拨重、上拨轻，越到后面越弱一点；写了 tremPattern 的（琵琶的轮指）按它轮流
      const pat = inst.kind === "pluck" ? inst.tremPattern : undefined;
      const accent = pat && pat.length ? pat[k % pat.length] : k % 2 === 0 ? 0.8 : 0.6;
      const v = tremolo ? level * accent * (1 - (0.2 * k) / hits) : level;
      g.gain.setValueAtTime(v, t);
      const end = tremolo ? t + step : t + ev.d;
      const tail = tremolo ? 0.03 : release;
      src.connect(g).connect(dest);
      src.start(t);
      let stopAt = t + buf.duration;
      if (end + tail < t + buf.duration) {
        g.gain.setValueAtTime(v, end);
        g.gain.setTargetAtTime(0, end, tail / 3);
        stopAt = end + tail * 2.5;
        src.stop(stopAt);
      }
      bendBuffer(ctx, src, ev, when, t, stopAt, out, inst.kind === "pluck" ? (inst.pluckVib ?? inst.vib) : undefined);
      keep(out, src);
    }
  }

  /**
   * 滚奏（定音鼓）：每秒 rate 击，两只槌一重一轻、时间与力度各有一点出入，从一半的力度渐强到满；
   * 每一击只响到后面两三击之后（滚奏的“嗡”由接连的击打维持），最后一击照常余响。
   */
  private rollNote(ev: NoteEvent, buf: AudioBuffer, level: number, rate: number, release: number, dest: AudioNode, when: number, out: Sources): void {
    const ctx = this.ctx;
    const strokes = Math.max(3, Math.round(ev.d * rate));
    const step = ev.d / strokes;
    const r = rng(seedOf(`roll:${ev.m}:${ev.t.toFixed(3)}`));
    for (let k = 0; k < strokes; k++) {
      const last = k === strokes - 1;
      const t = when + k * step + (k > 0 ? (r() - 0.5) * step * 0.25 : 0);
      const swell = 0.5 + (0.5 * k) / (strokes - 1);
      const v = level * 0.55 * swell * (k % 2 === 0 ? 1 : 0.86) * (0.92 + r() * 0.16);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 + (r() - 0.5) * 0.006;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      src.connect(g).connect(dest);
      src.start(t);
      const hold = last ? release : step * 2.5;
      if (hold < buf.duration) {
        g.gain.setValueAtTime(v, t + hold);
        g.gain.setTargetAtTime(0, t + hold, last ? release / 3 : 0.06);
        src.stop(t + hold + (last ? release * 2.5 : 0.3));
      }
      keep(out, src);
    }
  }

  /** 打击乐的一击。 */
  drumHit(ev: NoteEvent, inst: Extract<Instrument, { kind: "perc" }>, dest: AudioNode, when: number, out: Sources): void {
    if (!ev.hit) return;
    const buf = this.drum(ev.hit);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = ev.v * inst.level;
    src.connect(g).connect(dest);
    src.start(when);
    keep(out, src);
  }

  /**
   * 长音（弦乐群、人声、持续音）：每个音一组失谐的振荡器（齐奏时 unison 个，否则一对 ±detune/2）；
   * 起振相位错开（免得开头几个振荡器同相叠加、冒一下），写了 breath 的再加一层跟着音高走的弓噪。
   */
  padNote(ev: NoteEvent, instId: string, spec: SustainSpec, dest: AudioNode, when: number, out: Sources): void {
    const ctx = this.ctx;
    const wave = this.wave(instId, spec, ev.m);
    const f = midiToHz(ev.m);
    const g = ctx.createGain();
    const level = ev.v * spec.level;
    const attack = Math.min(spec.attack, ev.d * 0.6);
    // 包络的初值为 0：齐奏的振荡器比 when 早起振几毫秒，这段时间必须是静音
    g.gain.value = 0;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + attack);
    g.gain.setValueAtTime(level, when + Math.max(attack, ev.d));
    g.gain.setTargetAtTime(0, when + Math.max(attack, ev.d), spec.release / 3);
    const stop = when + Math.max(attack, ev.d) + spec.release * 2.5;
    g.connect(dest);
    const offsets = unisonOffsets(spec);
    const n = offsets.length;
    // 旧的一对振荡器各 0.5；齐奏按 1/√n（互不相干的几个振荡器叠起来响度约为 √n 倍）
    const each = spec.unison ? 1 / Math.sqrt(n) : n > 1 ? 0.5 : 1;
    offsets.forEach((cents, i) => {
      // 齐奏：第 i 个振荡器早起振 i/n 个周期（振幅包络此时还是 0，听不到），相位就错开了
      const start = spec.unison ? Math.max(0, when - i / (n * f)) : when;
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.setValueAtTime(f, start);
      osc.detune.setValueAtTime(cents, start);
      const og = ctx.createGain();
      og.gain.value = each;
      osc.connect(og).connect(g);
      if (spec.vib && ev.d > spec.vib.delay + 0.3) {
        const lfo = ctx.createOscillator();
        // 齐奏的揉音速度在 0.93–1.07 倍之间错开；旧的一对振荡器照旧是 0.93 与 1 倍
        lfo.frequency.value = spec.vib.rate * (spec.unison && n > 1 ? 0.93 + (0.14 * i) / (n - 1) : n > 1 && i === 0 ? 0.93 : 1);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, when);
        depth.gain.setTargetAtTime(spec.vib.depth, when + spec.vib.delay, 0.4);
        lfo.connect(depth).connect(osc.detune);
        lfo.start(when);
        lfo.stop(stop);
        keep(out, lfo);
      }
      osc.start(start);
      osc.stop(stop);
      keep(out, osc);
    });
    if (spec.breath) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = spec.breath.q;
      band.frequency.value = Math.min(9000, f * spec.breath.ratio);
      const bg = ctx.createGain();
      bg.gain.value = spec.breath.level * 20;
      src.connect(noiseTap(ctx)).connect(band).connect(bg).connect(g);
      const off = rng(seedOf(`pad:${ev.m}:${when.toFixed(3)}`))() * 1.5;
      src.start(when, off);
      src.stop(stop);
      keep(out, src);
    }
  }

  /**
   * 一个乐句（吹奏、弓弦、铜管）：一个振荡器从头奏到尾（齐奏的乐器是几个略有音差的振荡器一起），
   * 音与音之间改频率（圆滑处滑过去，吐音处音量略断），气声 / 弓噪跟着音高走，长音加揉音，铜管每个音有亮度包络。
   * offset 为乐句的时间原点（事件时间 + offset = 音频时钟）。
   */
  phrase(notes: readonly NoteEvent[], instId: string, spec: SustainSpec, dest: AudioNode, offset: number, out: Sources): void {
    const ctx = this.ctx;
    if (notes.length === 0) return;
    const pitches = notes.map((n) => n.m).sort((a, b) => a - b);
    const wave = this.wave(instId, spec, pitches[Math.floor(pitches.length / 2)]);
    const t0 = notes[0].t + offset;
    const last = notes[notes.length - 1];
    const tEnd = last.t + offset + last.d;
    const stop = tEnd + spec.release * 3 + 0.05;
    const lvl = (v: number) => v * spec.level;

    const amp = ctx.createGain();
    // 包络的初值为 0：齐奏的振荡器比 t0 早起振几毫秒，这段时间必须是静音
    amp.gain.value = 0;
    amp.gain.setValueAtTime(0, t0);
    // 振荡器：独奏一个；齐奏几个（音分错开，起振相位错开，揉音速度各不相同），先合到一起再进音量包络
    const offsets = unisonOffsets(spec);
    const oscs = offsets.map((cents) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      if (cents !== 0) o.detune.setValueAtTime(cents, t0);
      return o;
    });
    /** 振荡器合起来的乐音（进音量包络之前；跟着波形起伏的气声用它调制） */
    let tone: AudioNode = oscs[0];
    if (oscs.length > 1) {
      const mix = ctx.createGain();
      mix.gain.value = 1 / Math.sqrt(oscs.length);
      for (const o of oscs) o.connect(mix);
      tone = mix;
    }
    tone.connect(amp);
    const osc = {
      /** 同一条音高自动化作用到每个振荡器 */
      set: (f: number, t: number) => {
        for (const o of oscs) o.frequency.setValueAtTime(f, t);
      },
      glide: (f: number, t: number, tc: number) => {
        for (const o of oscs) o.frequency.setTargetAtTime(f, t, tc);
      },
    };
    let chain: AudioNode = amp;
    if (spec.tremor) {
      // 气息的起伏：音量围着 1 − depth/2 上下 depth/2
      const trem = ctx.createGain();
      trem.gain.value = 1 - spec.tremor.depth / 2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = spec.tremor.rate * (0.9 + 0.2 * rng(seedOf(`trem:${t0.toFixed(3)}`))());
      const lg = ctx.createGain();
      lg.gain.value = spec.tremor.depth / 2;
      lfo.connect(lg).connect(trem.gain);
      lfo.start(t0);
      lfo.stop(stop);
      keep(out, lfo);
      chain.connect(trem);
      chain = trem;
    }
    if (spec.drift) {
      // 音高的慢漂：两个很慢的振荡器叠在一起推每个振荡器的 detune
      for (const [hz, share] of [[0.23, 0.6], [0.37, 0.4]] as const) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = hz * (0.85 + 0.3 * rng(seedOf(`drift:${hz}:${t0.toFixed(3)}`))());
        const g = ctx.createGain();
        g.gain.value = spec.drift * share;
        lfo.connect(g);
        for (const o of oscs) g.connect(o.detune);
        lfo.start(t0);
        lfo.stop(stop);
        keep(out, lfo);
      }
    }
    let blare: BiquadFilterNode | null = null;
    if (spec.blare) {
      blare = ctx.createBiquadFilter();
      blare.type = "lowpass";
      blare.Q.value = 0.8;
      chain.connect(blare);
      chain = blare;
    }
    if (spec.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = spec.lp;
      chain.connect(lp);
      chain = lp;
    }
    chain.connect(dest);
    if (spec.sympathetic) {
      // 共鸣弦：一排很窄的带通（每根弦一个）并在乐句的声音旁边，谐波对得上的那几根“嗡”地亮起来、换音以后还响一会儿
      const sym = ctx.createGain();
      sym.gain.value = spec.sympathetic.level;
      for (const m of spec.sympathetic.notes) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = midiToHz(m);
        bp.Q.value = spec.sympathetic.q;
        chain.connect(bp).connect(sym);
      }
      sym.connect(dest);
    }

    // 揉音：每个振荡器一个（齐奏时速度各不相同），深度一起变
    const vibDepths: GainNode[] = [];
    /** 每个揉音振荡器与它的速度倍数（写了 andolan 的音上换成慢摇的速度，下一个音换回来） */
    const vibLfos: [OscillatorNode, number][] = [];
    if (spec.vib) {
      oscs.forEach((o, i) => {
        const lfo = ctx.createOscillator();
        const mult = oscs.length > 1 ? 0.92 + (0.16 * i) / (oscs.length - 1) : 1;
        lfo.frequency.value = spec.vib!.rate * mult;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t0);
        lfo.connect(depth).connect(o.detune);
        lfo.start(t0);
        lfo.stop(stop);
        keep(out, lfo);
        vibDepths.push(depth);
        vibLfos.push([lfo, mult]);
      });
    }
    // 气声 / 弓噪：带通噪声，跟随音高，经过同一个音量包络
    let band: BiquadFilterNode | null = null;
    if (spec.breath) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      src.loop = true;
      src.loopStart = rng(seedOf(`${t0}`))() * 1.5;
      band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = spec.breath.q;
      const bg = ctx.createGain();
      // 白噪声的均方根是 0.2，带通后只剩一小部分：乘 20 让 level 大致等于气声相对乐音的比例
      bg.gain.value = spec.breath.level * 20;
      src.connect(noiseTap(ctx)).connect(band).connect(bg).connect(amp);
      src.start(t0, src.loopStart);
      src.stop(stop);
      keep(out, src);
    }
    // 吐音 / 起弓的一小声噪声
    let chiff: GainNode | null = null;
    if (spec.chiff) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      chiff = ctx.createGain();
      chiff.gain.setValueAtTime(0, t0);
      src.connect(noiseTap(ctx)).connect(hp).connect(chiff).connect(chain === amp ? dest : chain);
      src.start(t0);
      src.stop(stop);
      keep(out, src);
    }
    // 跟着波形起伏的气声 / 弓噪：带通噪声乘上振荡器自己的波形（每个周期一开一合），再进音量包络
    let pband: BiquadFilterNode | null = null;
    if (spec.pulse) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      src.loop = true;
      pband = ctx.createBiquadFilter();
      pband.type = "bandpass";
      pband.Q.value = spec.pulse.q;
      const mod = ctx.createGain();
      mod.gain.value = 0;
      tone.connect(mod.gain);
      const pg = ctx.createGain();
      pg.gain.value = spec.pulse.level * 20;
      src.connect(noiseTap(ctx)).connect(pband).connect(mod).connect(pg).connect(amp);
      src.start(t0, rng(seedOf(`pulse:${t0.toFixed(3)}`))() * 1.5);
      src.stop(stop);
      keep(out, src);
    }
    // 起音的一口气：每个不圆滑的音开头一团带通噪声（不经过音量包络，起音的那一下本来就先有气后有音）
    let puff: GainNode | null = null;
    let puffBand: BiquadFilterNode | null = null;
    if (spec.puff) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      src.loop = true;
      puffBand = ctx.createBiquadFilter();
      puffBand.type = "bandpass";
      puffBand.Q.value = 0.9;
      puff = ctx.createGain();
      puff.gain.setValueAtTime(0, t0);
      src.connect(noiseTap(ctx)).connect(puffBand).connect(puff).connect(chain === amp ? dest : chain);
      src.start(t0, rng(seedOf(`puff:${t0.toFixed(3)}`))() * 1.5);
      src.stop(stop);
      keep(out, src);
    }

    /** 上一个音是不是 andolan（揉音振荡器的速度要换回来） */
    let prevAndolan = false;
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k];
      const t = n.t + offset;
      const f = midiToHz(n.m);
      const prev = k > 0 ? notes[k - 1] : null;
      const tied = !!prev?.legato;
      const prevEnd = prev ? prev.t + offset + prev.d : t;
      // 音高
      if (k === 0) osc.set(f, t);
      else if (tied) osc.glide(f, Math.max(prevEnd - spec.glide * 0.5, prev!.t + offset), spec.glide / 3);
      else osc.set(f, t);
      if (n.deco?.includes("slide")) {
        osc.set(f * Math.pow(2, -1.5 / 12), t);
        osc.glide(f, t + 0.01, 0.045);
      }
      // 地方乐器的弯音：从低一个全音处慢慢上来（尺八的 meri → kari、二胡的上滑、奈伊笛），句尾往下落
      if (n.deco?.includes("bend")) {
        osc.set(f * BEND.depth, t);
        osc.glide(f, t + BEND.hold * 0.7, BEND.tc * 1.6);
      }
      if (n.deco?.includes("fall")) osc.glide(f * FALL.depth, t + n.d * FALL.at, n.d * FALL.tc);
      band?.frequency.setValueAtTime(Math.min(9000, f * (spec.breath?.ratio ?? 2)), t);
      pband?.frequency.setValueAtTime(Math.min(9000, f * (spec.pulse?.ratio ?? 2)), t);
      if (puff && puffBand && spec.puff && (k === 0 || !tied)) {
        puffBand.frequency.setValueAtTime(Math.min(6000, f * 1.6), t);
        puff.gain.setValueAtTime(spec.puff.level * n.v * 6, t);
        puff.gain.setTargetAtTime(0, t + 0.006, spec.puff.decay / 3);
      }
      // 音量：第一个音起音；吐音处略断；两音之间有空隙时先收掉
      if (k === 0) amp.gain.linearRampToValueAtTime(lvl(n.v), t + spec.attack);
      else if (tied) amp.gain.setTargetAtTime(lvl(n.v), t, 0.03);
      else {
        const gap = t - prevEnd;
        if (gap > 0.015) amp.gain.setTargetAtTime(0, prevEnd, 0.012);
        else amp.gain.setTargetAtTime(lvl(prev!.v) * (spec.tongue ?? 0.3), Math.max(prev!.t + offset + 0.02, t - 0.028), 0.008);
        amp.gain.setTargetAtTime(lvl(n.v), t, spec.attack / 3);
      }
      if (chiff && (k === 0 || !tied)) {
        chiff.gain.setValueAtTime(spec.chiff! * n.v * 5, t);
        chiff.gain.setTargetAtTime(0, t + 0.004, 0.012);
      }
      // 揉音：只加在够长的音上，换音时先收回
      if (spec.vib) {
        const andolan = !!n.deco?.includes("andolan");
        // 写了 vib 装饰的音揉得更深（二胡的揉弦、尺八的 yuri）
        const deep = n.deco?.includes("vib") ? (spec.vibBoost ?? 2.2) : 1;
        for (const depth of vibDepths) {
          depth.gain.setTargetAtTime(0, t, 0.02);
          if (andolan) {
            if (n.d > ANDOLAN.delay + 0.15) depth.gain.setTargetAtTime(ANDOLAN.depth, t + ANDOLAN.delay, ANDOLAN.tc);
          } else if (n.d > spec.vib.delay + 0.15) depth.gain.setTargetAtTime(spec.vib.depth * deep, t + spec.vib.delay, deep > 1 ? 0.3 : 0.12);
        }
        // andolan 的音上揉音振荡器换成慢摇的速度（相位连续，不会咔嗒），下一个音换回乐器自己的速度
        if (andolan || prevAndolan) for (const [lfo, mult] of vibLfos) lfo.frequency.setValueAtTime((andolan ? ANDOLAN.rate : spec.vib.rate) * mult, t);
        prevAndolan = andolan;
        // 单边的慢摇：音高的中心随摆幅一起偏到记谱音的一侧（缺省往下 ANDOLAN.depth 音分，带 up 往上），记谱音是摆动的一端
        if (andolan && n.d > ANDOLAN.delay + 0.15) osc.glide(f * Math.pow(2, (andolanDir(n.deco) * ANDOLAN.depth) / 1200), t + ANDOLAN.delay, ANDOLAN.tc);
        // 单边的深揉（卡纳提克的 kampita）：中心随深度一起往上偏 vibLift × 深度
        if (spec.vibLift && deep > 1 && !andolan && n.d > spec.vib.delay + 0.15) osc.glide(f * Math.pow(2, (spec.vibLift * spec.vib.depth * deep) / 1200), t + spec.vib.delay, 0.3);
      }
      // 铜管的亮度
      if (blare && spec.blare) {
        const top = spec.blare.from + (spec.blare.to - spec.blare.from) * Math.min(1, n.v * 1.1);
        if (k === 0) blare.frequency.setValueAtTime(spec.blare.from, t);
        blare.frequency.setTargetAtTime(top, t, spec.blare.time / 3);
        blare.frequency.setTargetAtTime(spec.blare.from + (top - spec.blare.from) * 0.65, t + spec.blare.time, 0.25);
      }
    }
    amp.gain.setTargetAtTime(0, tEnd, spec.release / 3);
    const f0 = midiToHz(notes[0].m);
    oscs.forEach((o, i) => {
      // 齐奏：第 i 个振荡器早起振 i/n 个周期（振幅包络此时还是 0），各振荡器的相位就错开了
      const start = i === 0 ? t0 : Math.max(0, t0 - i / (oscs.length * f0));
      if (start < t0) o.frequency.setValueAtTime(f0, start);
      o.start(start);
      o.stop(stop);
      keep(out, o);
    });
  }
}

// ───────────────────────────── 曲目的播放

/** 调度单位：单个音，或一个乐句（同一声部连在一起的音）。 */
type Item = { t: number; voice: string; note: NoteEvent } | { t: number; voice: string; phrase: NoteEvent[] };

/** 按乐句调度的声部：合成版的吹奏、弓弦、铜管，与管弦版的长音旋律声部（不是和弦声部）。 */
export function isPhrased(inst: AnyInstrument, poly?: boolean): boolean {
  return inst.kind === "wind" || inst.kind === "bowed" || inst.kind === "brass" || (inst.kind === "sampled" && inst.mode === "sustain" && !poly);
}

/**
 * 把一遍的事件分成调度单位：吹奏、弓弦、铜管声部（与管弦版的长音旋律声部）按乐句成组（单音声部，同时发声的音只留第一个）；
 * 管弦版的长音和弦声部逐音，同一声部、同一音高前后相接的连音合成一个长音（换和弦时的共同音不重新起音）。
 */
export function scheduleItems(track: TrackDef, events: readonly NoteEvent[]): Item[] {
  const items: Item[] = [];
  const open = new Map<string, NoteEvent[]>();
  /** 和弦声部：声部 + 音高 → 最近一个音在 items 里的位置 */
  const held = new Map<string, number>();
  const flush = (voice: string) => {
    const ph = open.get(voice);
    if (ph && ph.length) items.push({ t: ph[0].t, voice, phrase: ph });
    open.delete(voice);
  };
  for (const ev of events) {
    const vdef = track.voices[ev.voice];
    const inst = instrumentOf(vdef?.inst ?? "");
    if (!inst) continue;
    if (inst.kind === "sampled" && inst.mode === "sustain" && vdef?.poly) {
      const key = `${ev.voice}:${ev.m}`;
      const at = held.get(key);
      const prev = at !== undefined ? items[at] : undefined;
      if (prev && "note" in prev && prev.note.legato && Math.abs(prev.note.t + prev.note.d - ev.t) < 0.02) {
        items[at!] = { ...prev, note: { ...prev.note, d: ev.t + ev.d - prev.note.t, legato: ev.legato } };
        continue;
      }
      held.set(key, items.length);
      items.push({ t: ev.t, voice: ev.voice, note: ev });
      continue;
    }
    if (isPhrased(inst, vdef?.poly)) {
      const ph = open.get(ev.voice);
      if (ph && ph.length) {
        const prev = ph[ph.length - 1];
        const gap = ev.t - (prev.t + prev.d);
        if (Math.abs(ev.t - prev.t) < 0.012) continue;
        if (gap > PHRASE_GAP || ev.t - ph[0].t > 14) flush(ev.voice);
      }
      const cur = open.get(ev.voice) ?? [];
      // 前一个音比这个音晚结束（重叠）：截短到这个音开始
      const prev = cur[cur.length - 1];
      if (prev && prev.t + prev.d > ev.t) cur[cur.length - 1] = { ...prev, d: Math.max(0.03, ev.t - prev.t) };
      cur.push(ev);
      open.set(ev.voice, cur);
    } else items.push({ t: ev.t, voice: ev.voice, note: ev });
  }
  for (const voice of [...open.keys()]) flush(voice);
  items.sort((a, b) => a.t - b.t);
  return items;
}

interface VoiceBus {
  input: GainNode;
}

/** 正在播放的一首曲目。 */
export class TrackPlayer {
  readonly bus: GainNode;
  private readonly wet: GainNode;
  private readonly voices = new Map<string, VoiceBus>();
  private items: Item[] = [];
  private cursor = 0;
  private passStart = 0;
  private passLength = 0;
  private nextAt: number | null = null;
  private steps: { t: number; step: number }[] = [];
  private readonly sources: Sources = new Set();
  private stopped = false;
  /** 只排到这一刻为止（换编配时旧的一套在下一段开头停下，见 stopAt） */
  private cutoff = Infinity;
  pass: number;
  /** 奏完一遍后是否继续下一遍（离线分析只奏一遍） */
  loop = true;
  /** 只奏这些声部（离线分析各声部的响度用）；null 为全部 */
  solo: ReadonlySet<string> | null = null;
  /** 整体移调（半音；短乐句移到正在放的曲子的调上） */
  transpose = 0;

  /** reverb 为房间与“大厅”两个混响的入口：曲目写了 hall 的送进大厅。 */
  constructor(
    private readonly synth: Synth,
    readonly track: TrackDef,
    out: AudioNode,
    reverb: { room: AudioNode; hall: AudioNode },
    start: number,
    fade: number,
    from: { pass: number; step: number } | null,
  ) {
    const ctx = synth.ctx;
    this.bus = ctx.createGain();
    this.wet = ctx.createGain();
    const level = track.level ?? 1;
    for (const g of [this.bus, this.wet]) {
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(level, start + Math.max(0.05, fade));
    }
    this.bus.connect(out);
    if (usesSamples(track)) {
      // 管弦版：送进混响之前切掉 180 Hz 以下（真实乐器的低音本来就厚，低频的混响尾巴只会把声音糊成一团）
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = "highpass";
      lowCut.frequency.value = 180;
      lowCut.Q.value = 0.7;
      this.wet.connect(lowCut).connect(track.hall ? reverb.hall : reverb.room);
    } else this.wet.connect(track.hall ? reverb.hall : reverb.room);
    const space = track.space ?? 1;
    for (const [name, v] of Object.entries(track.voices)) {
      const input = ctx.createGain();
      input.gain.value = v.gain ?? 0.5;
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan ?? 0;
      const send = ctx.createGain();
      send.gain.value = (v.reverb ?? 0.25) * space;
      input.connect(pan);
      pan.connect(this.bus);
      pan.connect(send).connect(this.wet);
      this.voices.set(name, { input });
    }
    this.pass = from?.pass ?? 0;
    this.begin(start, from?.step ?? 0);
  }

  private begin(at: number, step: number) {
    const form = this.track.forms[this.pass % this.track.forms.length];
    const p = realizePass(this.track, this.pass, Math.max(0, Math.min(step, form.length - 1)));
    this.items = scheduleItems(this.track, p.events);
    this.cursor = 0;
    this.passStart = at;
    this.passLength = p.length;
    this.steps = p.steps;
    this.nextAt = null;
  }

  /** 预热接下来 seconds 秒内要用的采样（每次最多 budget 毫秒）。 */
  warm(until: number, budget: number): void {
    const t0 = performance.now();
    for (let i = this.cursor; i < this.items.length; i++) {
      const it = this.items[i];
      if (this.passStart + it.t > until) break;
      if ("note" in it) {
        const inst = this.track.voices[it.voice]?.inst ?? "";
        this.synth.warm(it.note, inst);
      }
      if (performance.now() - t0 > budget) return;
    }
  }

  /** 排入开始时间早于 horizon 的音。 */
  tick(horizon: number, now: number): void {
    if (this.stopped) return;
    const until = Math.min(horizon, this.cutoff);
    for (;;) {
      while (this.cursor < this.items.length && this.passStart + this.items[this.cursor].t < until) {
        this.play(this.items[this.cursor++], now);
      }
      if (this.cursor < this.items.length || !this.loop) break;
      if (this.nextAt === null) {
        const [lo, hi] = this.track.rest;
        const r = rng(seedOf(`${this.track.id}:rest:${this.pass}`))();
        this.nextAt = this.passStart + this.passLength + lo + (hi - lo) * r;
      }
      if (this.nextAt >= until) break;
      this.pass += 1;
      this.begin(this.nextAt, 0);
    }
  }

  private play(it: Item, now: number): void {
    const vdef = this.track.voices[it.voice];
    const bus = this.voices.get(it.voice);
    const inst = instrumentOf(vdef?.inst ?? "");
    if (!vdef || !bus || !inst) return;
    if (this.solo && !this.solo.has(it.voice)) return;
    const when = this.passStart + it.t;
    // 已经错过的音（标签页卡顿）不补奏
    if (when < now - 0.05) return;
    const k = this.transpose;
    const unpitched = inst.kind === "perc" || (inst.kind === "sampled" && inst.mode === "hits");
    const shift = (e: NoteEvent): NoteEvent => (k && !unpitched ? { ...e, m: e.m + k } : e);
    if (inst.kind === "sampled") {
      const sampler = this.synth.sampler;
      if (!sampler) return;
      if ("phrase" in it) sampler.phrase(it.phrase.map(shift), inst, bus.input, this.passStart, this.sources);
      else sampler.note(shift(it.note), inst, bus.input, Math.max(when, now), this.sources, !!vdef.poly);
      return;
    }
    if ("phrase" in it) {
      if (inst.kind === "wind" || inst.kind === "bowed" || inst.kind === "brass") this.synth.phrase(it.phrase.map(shift), vdef.inst, inst, bus.input, this.passStart, this.sources);
      return;
    }
    const ev = shift(it.note);
    switch (inst.kind) {
      case "pluck":
      case "mallet":
        this.synth.pluckNote(ev, vdef.inst, inst, bus.input, Math.max(when, now), this.sources);
        break;
      case "perc":
        this.synth.drumHit(ev, inst, bus.input, Math.max(when, now), this.sources);
        break;
      case "pad":
        this.synth.padNote(ev, vdef.inst, inst, bus.input, Math.max(when, now), this.sources);
        break;
      default:
        this.synth.phrase([ev], vdef.inst, inst, bus.input, this.passStart, this.sources);
    }
  }

  /** 只奏一遍（loop 为假）时：这一遍连同 tail 秒的余音已经结束。 */
  finished(now: number, tail: number): boolean {
    return !this.loop && this.cursor >= this.items.length && now > this.passStart + this.passLength + tail;
  }

  /** 当前位置：第几遍、第几段；在留白中时 resting 为真，rested 是这一遍奏完以后过了几秒（不在留白里时为 0）。 */
  position(now: number): { pass: number; step: number; resting: boolean; rested: number } {
    let step = 0;
    for (const s of this.steps) if (this.passStart + s.t <= now) step = s.step;
    const end = this.passStart + this.passLength;
    const resting = now > end;
    return { pass: this.pass, step, resting, rested: resting ? now - end : 0 };
  }

  /** 这一遍里不早于 after 的下一段：开始的时刻（音频时间）、第几遍、第几段；已在最后一段或留白里时为 null。 */
  nextStep(after: number): { at: number; pass: number; step: number } | null {
    if (this.stopped || this.cutoff !== Infinity) return null;
    for (const s of this.steps) {
      const at = this.passStart + s.t;
      if (at >= after) return { at, pass: this.pass, step: s.step };
    }
    return null;
  }

  /**
   * 另一套编配（同一首曲子）这一遍的分段与这一套一样：从这一遍开始奏的那一段起，各段的序号、段名与相对时刻都相同。
   * 一样时两套可以在段落的开头互相接上。
   */
  sameSteps(other: TrackDef): boolean {
    if (other.id !== this.track.id || this.steps.length === 0) return false;
    const first = this.steps[0].step;
    const mine = this.track.forms[this.pass % this.track.forms.length];
    const theirs = other.forms[this.pass % other.forms.length];
    if (!theirs || theirs.length !== mine.length) return false;
    for (let i = first; i < mine.length; i++) if (mine[i].s !== theirs[i].s) return false;
    const steps = realizePass(other, this.pass, first).steps;
    return steps.length === this.steps.length && steps.every((s, i) => s.step === this.steps[i].step && Math.abs(s.t - this.steps[i].t) < HANDOFF_SLACK);
  }

  /** 奏到 at 为止：at 及以后的音不再排，从 at 起 fade 秒内淡出，之后停掉已排的音源。 */
  stopAt(at: number, fade: number): void {
    if (this.stopped) return;
    this.cutoff = at;
    const level = this.track.level ?? 1;
    for (const g of [this.bus, this.wet]) {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(level, at);
      g.gain.linearRampToValueAtTime(0, at + fade);
    }
    const ctx = this.synth.ctx;
    setTimeout(() => this.halt(), (Math.max(0, at - ctx.currentTime) + fade + 0.2) * 1000);
  }

  /** stopAt 定下的停止时刻（没有时为 Infinity）。 */
  get stopsAt(): number {
    return this.cutoff;
  }

  /** 淡出并停止（不再排新音；淡出结束后停掉已排的音源）。 */
  fadeOut(fade: number): void {
    if (this.stopped) return;
    const ctx = this.synth.ctx;
    const now = ctx.currentTime;
    for (const g of [this.bus, this.wet]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + fade);
    }
    this.stopped = true;
    setTimeout(() => this.halt(), (fade + 0.2) * 1000);
  }

  /** 停掉已排的音源、断开总线。 */
  private halt(): void {
    this.stopped = true;
    for (const s of [...this.sources]) {
      try {
        s.stop();
      } catch {
        // 已经停了
      }
    }
    this.bus.disconnect();
    this.wet.disconnect();
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}

// ───────────────────────────── 引擎

/** 引擎当前的状态（给界面显示“正在播放”）。 */
export interface EngineStatus {
  track: string | null;
  resting: boolean;
  /** 一遍奏完以后在留白里过了几秒（不在留白里时为 0）：养成平时的轮换看它决定什么时候换下一首 */
  rested: number;
  /** 正在放的是管弦版（真实乐器的采样） */
  orchestral: boolean;
}

/** 曲目是否用到管弦版的采样乐器。 */
export function usesSamples(track: TrackDef): boolean {
  return Object.values(track.voices).some((v) => isOrchestral(v.inst));
}

/** 音乐引擎：一个音频上下文（实时或离线）、总线与混响、当前曲目、短乐句与环境声。 */
export class MusicEngine {
  readonly ctx: BaseAudioContext;
  readonly synth: Synth;
  /** 管弦版的采样（按需加载） */
  readonly bank: SampleBank;
  /** 除了正在放的曲子，还要一直留着采样的曲子（短乐句） */
  private keepAlso: readonly TrackDef[] = [];
  private readonly master: GainNode;
  private readonly music: GainNode;
  private readonly amb: GainNode;
  /** 音效总线（音效音量），接在总音量之前 */
  private readonly sfxBus: GainNode;
  /** 音效的播放器（sfx/player.ts）：界面、交易、航海、海战的音效都从这里放 */
  readonly sfx: SfxPlayer;
  /** 两个混响的入口：房间（2.4 秒）与大厅（3.4 秒、预延迟更长、尾巴更暗） */
  private readonly rooms: { room: GainNode; hall: GainNode };
  /** 曲目的干声与混响送量先经过这三个推子（短乐句时一起压低）；短乐句自己直接进音乐总线与混响 */
  private readonly ducks: { dry: GainNode; room: GainNode; hall: GainNode };
  readonly ambience: Ambience;
  private current: TrackPlayer | null = null;
  /** 换编配时还在奏到下一段开头的旧的一套（见 handoff） */
  private leaving: TrackPlayer | null = null;
  private cuePlayer: TrackPlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 离开时的位置：按曲目的定义记（合成版与管弦版各记各的，两者的曲式不必一样） */
  private readonly memory = new Map<TrackDef, { pass: number; step: number; at: number }>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.synth = new Synth(ctx);
    this.bank = new SampleBank(ctx);
    this.synth.sampler = new Sampler(ctx, this.bank);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 30;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(hp).connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.sfx = new SfxPlayer(ctx, this.sfxBus);
    const convolver = (ir: [Float32Array, Float32Array]): ConvolverNode => {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const buf = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
      buf.copyToChannel(ir[0] as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(ir[1] as Float32Array<ArrayBuffer>, 1);
      conv.buffer = buf;
      return conv;
    };
    this.rooms = { room: ctx.createGain(), hall: ctx.createGain() };
    this.rooms.room.connect(convolver(reverbIR(ctx.sampleRate, 2.4, 5))).connect(this.music);
    this.rooms.hall.connect(convolver(reverbIR(ctx.sampleRate, 3.4, 9, HALL))).connect(this.music);
    this.ducks = { dry: ctx.createGain(), room: ctx.createGain(), hall: ctx.createGain() };
    this.ducks.dry.connect(this.music);
    this.ducks.room.connect(this.rooms.room);
    this.ducks.hall.connect(this.rooms.hall);
    this.ambience = new Ambience(ctx, this.amb);
  }

  /** 开始调度（每 50 毫秒排一次）。 */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), 50);
  }

  /** 实时的音频上下文（离线渲染时为 null）。 */
  private get live(): AudioContext | null {
    return typeof AudioContext !== "undefined" && this.ctx instanceof AudioContext ? this.ctx : null;
  }

  /** 唤醒 / 挂起音频（浏览器挂起、静音或切到后台时）。 */
  resume(): void {
    if (this.live?.state === "suspended") void this.live.resume();
  }

  suspend(): void {
    if (this.live?.state === "running") void this.live.suspend();
  }

  /** 停止调度并关闭音频。 */
  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    void this.live?.close();
  }

  /**
   * 离线分析：从头排好一首曲子的第 pass 遍（只奏这一遍；solo 给出时只奏这些声部）。
   * 用在 OfflineAudioContext 上，返回这一遍的长度（秒）。
   */
  schedulePass(track: TrackDef, pass: number, solo?: readonly string[]): number {
    const p = new TrackPlayer(this.synth, track, this.ducks.dry, this.ducks, 0.05, 0.01, { pass, step: 0 });
    p.loop = false;
    p.solo = solo ? new Set(solo) : null;
    p.tick(Infinity, 0);
    this.current = p;
    return realizePass(track, pass).length + 0.05;
  }

  /**
   * 短乐句（出港、入港、发现、大赚）：在正在放的曲子上方奏一遍，移到那首曲子的调上；奏的时候曲子压低约 10 dB，
   * 奏完 0.8 秒内回来。已有一个短乐句在奏时不叠加，返回 false。at 给出时从那一刻开始（离线分析用），否则尽快开始。
   */
  cue(jingle: TrackDef, at?: number): boolean {
    const now = this.ctx.currentTime;
    if (this.cuePlayer && !this.cuePlayer.finished(now, 0)) return false;
    this.cuePlayer?.fadeOut(0.05);
    const start = at ?? now + 0.12;
    const p = new TrackPlayer(this.synth, jingle, this.music, this.rooms, start, 0.01, { pass: 0, step: 0 });
    p.loop = false;
    p.transpose = this.current && !this.current.isStopped ? cueShift(this.current.track.key, jingle.key) : 0;
    const length = realizePass(jingle, 0).length;
    this.duck(start, start + length);
    // 音效也让一让：压低一点，省掉写了 shy 的层（例如出港时只留铁链，不再升帆）
    this.sfx.jingle(start, start + length);
    this.cuePlayer = p;
    if (at !== undefined) {
      // 离线：没有调度定时器，采样先算好、一次排完
      p.warm(Infinity, Infinity);
      p.tick(Infinity, now);
    } else {
      // 实时：开头一小段的采样先算好，其余跟着调度一点点排（与曲目相同）
      p.warm(start + 0.8, 15);
      p.tick(now + 0.4, now);
    }
    return true;
  }

  /** 把曲目（干声与混响送量）从 from 到 until 压低到 DUCK，之后在 0.8 秒内回到原样。 */
  private duck(from: number, until: number): void {
    const t = Math.max(this.ctx.currentTime, from - 0.15);
    for (const g of [this.ducks.dry, this.ducks.room, this.ducks.hall]) {
      const p = g.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(DUCK, from + 0.05);
      p.setValueAtTime(DUCK, until);
      p.linearRampToValueAtTime(1, until + 0.8);
    }
  }

  /** 音量：music、ambience 与 sfx（音效）为 0–1（按平方映射到增益，听感更均匀），muted 时总音量为 0（音效一起静掉）。 */
  setVolumes(music: number, ambience: number, muted: boolean, sfx = SFX_DEFAULT): void {
    const now = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(v, now + 0.25);
    };
    set(this.music.gain, music * music * 1.9);
    set(this.amb.gain, ambience * ambience);
    set(this.sfxBus.gain, sfxGain(sfx));
    set(this.master.gain, muted ? 0 : 1);
  }

  /** 管弦版：这首曲子（cue 为真时是短乐句，各种移调都算上）要用的采样都已加载。合成版的曲子总是真。 */
  ready(track: TrackDef, cue = false): boolean {
    return this.bank.has(filesFor(track, cue));
  }

  /** 加载这首曲子要用的采样；全部成功时为真（合成版的曲子立即为真）。priority 为 idle 时在后台空闲时下载。 */
  prepare(track: TrackDef, cue = false, priority: Priority = "play"): Promise<boolean> {
    return this.bank.ensure(filesFor(track, cue), priority);
  }

  /** 这首曲子要用的采样都已下载好（可能还没解码）。 */
  arrived(track: TrackDef, cue = false): boolean {
    return downloaded(filesFor(track, cue));
  }

  /** 这首曲子（正要放的）的采样下载排到最前，排着的其他曲子的降回后台。 */
  focus(track: TrackDef): void {
    focusDownloads(filesFor(track));
  }

  /** 后台预取按这个顺序排：前面的曲子（短乐句按各种移调算）的采样先取。 */
  orderBackground(defs: readonly { track: TrackDef; cue?: boolean }[]): void {
    orderIdle(defs.flatMap((d) => filesFor(d.track, d.cue)));
  }

  /** 这首曲子要用的采样里有加载失败的。 */
  failed(track: TrackDef, cue = false): boolean {
    return this.bank.anyFailed(filesFor(track, cue));
  }

  /** 除了正在放的曲子，这些（短乐句）的采样也一直留着。 */
  keepCues(defs: readonly TrackDef[]): void {
    this.keepAlso = defs;
    this.retain();
  }

  private retain(): void {
    const files = new Set<string>();
    if (this.current) for (const f of filesFor(this.current.track)) files.add(f);
    for (const d of this.keepAlso) for (const f of filesFor(d, true)) files.add(f);
    this.bank.retain(files);
  }

  /** 换曲：id 为 null 时只留环境声。同一首曲子（同一个定义）正在播放时什么也不做；同一首换了风格（合成版 ↔ 管弦版）照常交叉淡化。 */
  play(track: TrackDef | null, fade = 2.5): void {
    if (this.current && track && this.current.track === track && !this.current.isStopped) return;
    const now = this.ctx.currentTime;
    this.leaving?.fadeOut(Math.min(fade, 1));
    this.leaving = null;
    if (this.current) {
      // 记住离开的位置：几分钟内回来时从这一段接着奏（而不是每次都从头）
      const pos = this.current.position(now);
      this.memory.set(this.current.track, { pass: pos.pass, step: pos.resting ? 0 : pos.step, at: now });
      this.current.fadeOut(fade);
      this.current = null;
    }
    if (!track) return;
    const mem = this.memory.get(track);
    const from = mem && now - mem.at < 240 ? { pass: mem.pass, step: mem.step } : mem ? { pass: mem.pass + 1, step: 0 } : null;
    this.current = new TrackPlayer(this.synth, track, this.ducks.dry, this.ducks, now + 0.15, Math.min(fade, 1.8), from);
    this.retain();
    // 开头几秒的采样先算好
    this.current.warm(now + 4, 40);
    this.tick();
  }

  /**
   * 同一首曲子换一套编配（先顶上的合成版 → 采样到了的管弦版），不从头奏：
   * 两套这一遍的分段一样时，在正在放的那一套的下一段开头接上——旧的一套只排到那一刻、在那一刻很快淡出，新的一套从那一段奏起。
   * 找不到能接的地方（在最后一段或留白里、两套的曲式不一样、离下一段太近来不及排）时返回 false，由调用方照常交叉淡化。
   */
  handoff(track: TrackDef): boolean {
    const cur = this.current;
    if (!cur || cur.isStopped || cur.track === track || cur.track.id !== track.id) return false;
    const now = this.ctx.currentTime;
    const next = cur.nextStep(now + HANDOFF_LEAD);
    if (!next || !cur.sameSteps(track)) return false;
    cur.stopAt(next.at, HANDOFF_FADE);
    this.leaving?.fadeOut(0.3);
    this.leaving = cur;
    this.current = new TrackPlayer(this.synth, track, this.ducks.dry, this.ducks, next.at, 0.05, { pass: next.pass, step: next.step });
    this.retain();
    // 接上的那一段开头几秒的采样先算好
    this.current.warm(next.at + 4, 40);
    this.tick();
    return true;
  }

  /** 环境声的场景。 */
  setAmbience(scene: AmbienceScene): void {
    this.ambience.set(scene);
  }

  status(): EngineStatus {
    const now = this.ctx.currentTime;
    // 换编配还没到接上的那一刻：听到的仍是旧的一套
    const cur = this.leaving && now < this.leaving.stopsAt ? this.leaving : this.current;
    const pos = cur?.position(now);
    return { track: cur?.track.id ?? null, resting: pos?.resting ?? false, rested: pos?.rested ?? 0, orchestral: !!cur && usesSamples(cur.track) };
  }

  private tick(): void {
    if (this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const horizon = now + 0.4;
    if (this.current) {
      this.current.tick(horizon, now);
      this.current.warm(now + 6, 4);
    }
    const leaving = this.leaving;
    if (leaving) {
      if (now > leaving.stopsAt + HANDOFF_FADE) this.leaving = null;
      else leaving.tick(horizon, now);
    }
    const cue = this.cuePlayer;
    if (cue) {
      // 短乐句奏完、余音也散了：断开它的节点
      if (cue.finished(now, 4)) {
        cue.fadeOut(0.05);
        this.cuePlayer = null;
      } else {
        cue.tick(horizon, now);
        cue.warm(now + 3, 4);
      }
    }
    this.ambience.tick(now);
  }
}
