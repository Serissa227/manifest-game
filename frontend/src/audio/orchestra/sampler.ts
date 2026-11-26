// 采样器：把管弦版的音符变成 Web Audio 节点（缓冲源 → 音符增益 → 声部总线）。
//
// - 一次性（拨奏、跳弓、竖琴、定音鼓、钟琴……）：按音高挑最近的采样点，用播放速率移调，从起音放，到音符时值（加上 ring）后释音；
// - 长音：从“奏稳”前 attack 秒开始放（跳过过慢的渐强），奏稳之后的循环段接着放——每到循环终点，另起一个缓冲源从循环起点接上，
//   接缝处按两段的相关系数交叉淡化（相关高的接近线性、不相关的等功率），多长的音都能奏，且接缝没有断点与咔嗒声；
// - 旋律声部（乐句）：前一个音与后一个音（圆滑相连时）在音符交界处等功率交叉淡化，后一个音从它的“奏稳”处接进来，不重新起音；
//   不圆滑的相邻两音，前一个音在后一个音开始时很快收掉，后一个音照常起音；
// - 两个采样点叠奏（圆号组、长号组）：第二个晚 12 毫秒、高 7 音分，像两个人一起吹；
// - 定音鼓写了 !trem! 的音用滚奏的采样（循环），从一半的力度渐强到满；吊镲渐强在音符结束时最响（跳过开头多出来的部分）。
// 所有采样都从已加载的缓冲里取；万一没加载（不该发生），这个音就不奏，不报错。
import type { NoteEvent } from "../score";
import type { Loaded, SampleBank } from "./bank";
import type { SampledSpec } from "./instruments";
import { hitOf, layerFor, pickHit, pickZones, type Pick } from "./pick";
import { SAMPLE_SETS, type SampleZone } from "./samples";

type Sources = Set<AudioScheduledSourceNode>;

/** 叠奏的第二个采样点：晚这么多秒、高这么多音分。 */
const PAIR_DELAY = 0.012;
const PAIR_CENTS = 7;
/** 滑音（!slide!）：从下方 1.5 个半音滑上来。 */
const SLIDE = Math.pow(2, -1.5 / 12);
/** 分弓：前后两个音都至少这么长（秒）才连着奏；更快的音各自起音，清楚。 */
export const DETACHE_MIN = 0.25;
/** 分弓：后一个音从“奏稳”前这么多秒开始（留一点换弓、换气的颗粒）。 */
const DETACHE_BACK = 0.05;

/**
 * 长音实际用的起音（秒）：乐器的 attack，但不超过音长的 35%（快的经过音从更靠近“奏稳”处开始，不会还没响起来就结束了），
 * 也不短于 30 毫秒。
 */
export function effectiveAttack(attack: number, d: number): number {
  return Math.max(0.03, Math.min(attack, d * 0.35));
}

/** 力度 → 增益：力度的 1.25 次方（力度 0.8 约 −2.4 dB，0.5 约 −7.5 dB）。力度层另外决定音色。 */
export function velocityGain(v: number): number {
  return Math.pow(Math.max(0, Math.min(1.3, v)), 1.25);
}

const curves = new Map<string, Float32Array>();

/**
 * 交叉淡化曲线（0…1 的 n 个点）：两段信号的相关系数为 rho 时，淡入 sin θ、淡出 cos θ 再除以 √(1 + rho·sin 2θ)，
 * 叠加后的响度处处不变——rho = 0（互不相关，例如不同音高）就是等功率，rho = 1（完全相关，循环接缝对齐了相位）接近线性。
 */
export function fadeCurve(rho: number, fadeIn: boolean, n = 64): Float32Array {
  const r = Math.round(Math.max(0, Math.min(1, rho)) * 10) / 10;
  const key = `${r}:${fadeIn ? 1 : 0}:${n}`;
  let c = curves.get(key);
  if (c) return c;
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = ((i / (n - 1)) * Math.PI) / 2;
    const norm = Math.sqrt(1 + r * Math.sin(2 * th));
    c[i] = (fadeIn ? Math.sin(th) : Math.cos(th)) / norm;
  }
  curves.set(key, c);
  return c;
}

function scaled(curve: Float32Array, k: number): Float32Array {
  const out = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] * k;
  return out;
}

function keep(set: Sources, node: AudioScheduledSourceNode): void {
  set.add(node);
  node.addEventListener("ended", () => set.delete(node));
}

/** 一个长音在音符上的安排（纯数据，测试检查）：各缓冲源从文件的哪里开始、什么时刻开始与结束、接缝处的淡入淡出。 */
export interface Segment {
  /** 开始的时刻（音频时钟） */
  start: number;
  /** 从文件的哪里开始（秒，不含对齐偏移） */
  offset: number;
  /** 停止的时刻 */
  stop: number;
  /** 淡入：[开始时刻, 长度]（第一段没有） */
  fadeIn: [number, number] | null;
  /** 淡出：[开始时刻, 长度]（最后一段没有） */
  fadeOut: [number, number] | null;
}

/**
 * 长音的缓冲源安排：从 off 处开始放，放到 until 为止；有循环段时每到循环终点另起一段从循环起点接上（交叉淡化 xf）。
 * rate 为播放速率（移调）。没有循环段、或一段就够时只有一段。
 */
export function sustainPlan(zone: SampleZone, rate: number, t0: number, off: number, until: number): Segment[] {
  const loop = zone.loop;
  const end = loop ? loop[1] : zone.length;
  const first = t0 + Math.max(0, end - off) / rate;
  if (!loop || first >= until) {
    return [{ start: t0, offset: off, stop: Math.min(until, t0 + Math.max(0, zone.length - off) / rate), fadeIn: null, fadeOut: null }];
  }
  const [S, E, xf] = loop;
  const w = xf / rate;
  const out: Segment[] = [];
  let start = t0;
  let offset = off;
  for (let k = 0; k < 400; k++) {
    const segEnd = start + (E - offset) / rate;
    const seg: Segment = { start, offset, stop: segEnd, fadeIn: k > 0 ? [start, w] : null, fadeOut: null };
    out.push(seg);
    if (segEnd - w >= until) {
      seg.stop = until;
      break;
    }
    seg.fadeOut = [segEnd - w, w];
    seg.stop = segEnd + 0.005;
    start = segEnd - w;
    offset = S - xf;
  }
  return out;
}

/** 管弦版的采样器（一个音频上下文一个）。 */
export class Sampler {
  /** 各采样组的轮换计数 */
  private readonly turn = new Map<string, number>();

  constructor(
    readonly ctx: BaseAudioContext,
    readonly bank: SampleBank,
  ) {}

  private rr(set: string): number {
    const k = this.turn.get(set) ?? 0;
    this.turn.set(set, k + 1);
    return k;
  }

  private usable = (z: SampleZone): boolean => this.bank.get(z.file) !== undefined;

  /** 按安排排入缓冲源（都接到 dest）。cents 为微调，slide 为真时第一段从下方滑上来。 */
  private sources(loaded: Loaded, zone: SampleZone, rate: number, dest: AudioNode, t0: number, off: number, until: number, out: Sources, cents = 0, slide = false): void {
    const ctx = this.ctx;
    const r = rate * Math.pow(2, cents / 1200);
    const rho = zone.loop?.[3] ?? 0;
    const plan = sustainPlan(zone, r, t0, off, until);
    plan.forEach((seg, k) => {
      const src = ctx.createBufferSource();
      src.buffer = loaded.buffer;
      if (slide && k === 0) {
        src.playbackRate.setValueAtTime(r * SLIDE, seg.start);
        src.playbackRate.setTargetAtTime(r, seg.start + 0.01, 0.045);
      } else src.playbackRate.value = r;
      let node: AudioNode = dest;
      if (seg.fadeIn || seg.fadeOut) {
        const g = ctx.createGain();
        g.gain.value = seg.fadeIn ? 0 : 1;
        if (seg.fadeIn) g.gain.setValueCurveAtTime(fadeCurve(rho, true), seg.fadeIn[0], seg.fadeIn[1]);
        if (seg.fadeOut) g.gain.setValueCurveAtTime(fadeCurve(rho, false), seg.fadeOut[0], seg.fadeOut[1]);
        g.connect(dest);
        node = g;
      }
      src.connect(node);
      src.start(seg.start, loaded.origin + seg.offset);
      src.stop(Math.max(seg.start + 0.01, seg.stop));
      keep(out, src);
    });
  }

  /** 音符增益节点：音量 level，从 start 起 fade 秒淡入（fade 为 0 时直接到位）。 */
  private envelope(dest: AudioNode, level: number, start: number, fade: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(level, start + Math.max(0.002, fade));
    g.connect(dest);
    return g;
  }

  /**
   * 一个音：一次性、打击乐、和弦声部的长音（poly），或乐句外单独的长音。when 为开始的时刻（音频时钟）。
   */
  note(ev: NoteEvent, spec: SampledSpec, dest: AudioNode, when: number, out: Sources, poly = false): void {
    if (spec.mode === "hits") {
      this.hit(ev, spec, dest, when, out);
      return;
    }
    const level = velocityGain(ev.v) * spec.level;
    const layer = layerFor(spec, ev.v);
    if (spec.roll && ev.deco?.includes("trem")) {
      this.roll(ev, spec, dest, when, out, level);
      return;
    }
    const set = spec.set;
    const picks = pickZones(set, ev.m, layer, this.rr(set), spec.mode === "sustain" && !!spec.pair, spec.maxShift, this.usable);
    const slide = !!ev.deco?.includes("slide");
    picks.forEach((p, i) => {
      const loaded = this.bank.get(p.zone.file);
      if (!loaded) return;
      const dt = i > 0 ? PAIR_DELAY : 0;
      const cents = i > 0 ? PAIR_CENTS : 0;
      const L = level * p.zone.gain * p.weight;
      const t = when + dt;
      if (spec.mode === "shot") {
        const g = this.envelope(dest, L, t, 0.002);
        const end = t + ev.d + (spec.ring ?? 0);
        const natural = t + p.zone.length / p.rate;
        let stop = natural;
        if (end + spec.release * 2.5 < natural) {
          g.gain.setValueAtTime(L, end);
          g.gain.setTargetAtTime(0, end, spec.release / 3);
          stop = end + spec.release * 2.5;
        }
        this.sources(loaded, p.zone, p.rate, g, t, 0, stop, out, cents, slide);
        return;
      }
      // 长音
      const attack = effectiveAttack(poly ? (spec.padAttack ?? spec.attack) : spec.attack, ev.d);
      const off = Math.max(0, p.zone.attack - attack);
      const g = this.envelope(dest, L, t, off > 0.005 ? Math.min(0.06, Math.max(0.02, attack * 0.4)) : 0.003);
      const end = t + ev.d;
      g.gain.setValueAtTime(L, end);
      g.gain.setTargetAtTime(0, end, spec.release / 3);
      this.sources(loaded, p.zone, p.rate, g, t, off, end + spec.release * 2.5, out, cents, slide);
    });
  }

  /** 定音鼓的滚奏：滚奏的采样循环着放，从一半的力度渐强到满，最后很快收掉（滚奏后面的重击另写一个音）。 */
  private roll(ev: NoteEvent, spec: SampledSpec, dest: AudioNode, when: number, out: Sources, level: number): void {
    const set = spec.roll!;
    const [p] = pickZones(set, ev.m, 0, this.rr(set), false, spec.maxShift, this.usable);
    if (!p) return;
    const loaded = this.bank.get(p.zone.file);
    if (!loaded) return;
    const L = level * p.zone.gain;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(L * 0.5, when + 0.03);
    const end = when + ev.d;
    g.gain.linearRampToValueAtTime(L, end);
    g.gain.setTargetAtTime(0, end, 0.05);
    g.connect(dest);
    this.sources(loaded, p.zone, p.rate, g, when, 0, end + 0.2, out);
  }

  /** 打击乐的一击：军鼓滚奏按时值循环；吊镲渐强在音符结束时最响；其余放完整个采样（自然衰减）。 */
  private hit(ev: NoteEvent, spec: SampledSpec, dest: AudioNode, when: number, out: Sources): void {
    const name = hitOf(spec, ev);
    const set = spec.hits?.[name ?? ""];
    if (!set) return;
    const zone = pickHit(set, layerFor(spec, ev.v), this.rr(set), this.usable);
    if (!zone) return;
    const loaded = this.bank.get(zone.file);
    if (!loaded) return;
    const L = velocityGain(ev.v) * spec.level * (spec.hitGain?.[name ?? ""] ?? 1) * zone.gain;
    const kind = SAMPLE_SETS[set]?.kind;
    if (kind === "sustain") {
      const g = this.envelope(dest, L, when, 0.004);
      const end = when + ev.d;
      g.gain.setValueAtTime(L, end);
      g.gain.setTargetAtTime(0, end, 0.04);
      this.sources(loaded, zone, 1, g, when, 0, end + 0.15, out);
      return;
    }
    const off = name === "swell" ? Math.max(0, Math.min(zone.peak - 0.2, zone.peak - ev.d)) : 0;
    const g = this.envelope(dest, L, when, off > 0 ? 0.03 : 0.002);
    this.sources(loaded, zone, 1, g, when, off, when + (zone.length - off), out);
  }

  /**
   * 一个乐句（旋律声部的长音，同一声部连在一起的音，按时间排好、同时只有一个音）：offset 为事件时间到音频时钟的偏移。
   * 前后紧接的两音在交界处等功率交叉淡化（长度取 legato，不超过前后两音各自的 45%）：圆滑相连的，后一个音从它的“奏稳”处接进来；
   * 没写圆滑线的（分弓），交叉淡化短三成、后一个音从奏稳前 DETACHE_BACK 秒开始，留一点换弓、换气的颗粒——
   * 但小号、长号（detache 为 tongued）与短于 DETACHE_MIN 的快音各自起音，前一个音在后一个音开始时 40 毫秒内收掉。
   */
  phrase(notes: readonly NoteEvent[], spec: SampledSpec, dest: AudioNode, offset: number, out: Sources): void {
    if (notes.length === 0) return;
    const link = (a: NoteEvent, b: NoteEvent): "slur" | "detache" | null => {
      if (Math.abs(b.t - (a.t + a.d)) >= 0.03) return null;
      if (a.legato) return "slur";
      if (spec.detache !== "tongued" && a.d >= DETACHE_MIN && b.d >= DETACHE_MIN) return "detache";
      return null;
    };
    const xfOf = (a: NoteEvent, b: NoteEvent, kind: "slur" | "detache") => Math.min((spec.legato ?? 0.08) * (kind === "detache" ? 0.7 : 1), a.d * 0.45, b.d * 0.45);
    const set = spec.set;
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k];
      const prev = k > 0 ? notes[k - 1] : null;
      const next = k + 1 < notes.length ? notes[k + 1] : null;
      const inKind = prev ? link(prev, n) : null;
      const outKind = next ? link(n, next) : null;
      const tiedIn = inKind !== null;
      const tiedOut = outKind !== null;
      const t = n.t + offset;
      const end = t + n.d;
      const xIn = inKind ? xfOf(prev!, n, inKind) : 0;
      const xOut = outKind ? xfOf(n, next!, outKind) : 0;
      const level = velocityGain(n.v) * spec.level;
      const picks: Pick[] = pickZones(set, n.m, layerFor(spec, n.v), this.rr(set), !!spec.pair, spec.maxShift, this.usable);
      const slide = !!n.deco?.includes("slide");
      picks.forEach((p, i) => {
        const loaded = this.bank.get(p.zone.file);
        if (!loaded) return;
        const dt = i > 0 ? PAIR_DELAY : 0;
        const cents = i > 0 ? PAIR_CENTS : 0;
        const L = level * p.zone.gain * p.weight;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        g.connect(dest);
        let start: number;
        let off: number;
        if (tiedIn) {
          // 连着进来：与前一个音交叉淡化；圆滑的从奏稳处开始，分弓的从奏稳前一点开始
          start = t - xIn / 2 + dt;
          off = inKind === "slur" ? p.zone.attack : Math.max(0, p.zone.attack - DETACHE_BACK);
          g.gain.setValueCurveAtTime(scaled(fadeCurve(0, true), L), start, xIn);
        } else {
          start = t + dt;
          const attack = effectiveAttack(spec.attack, n.d);
          off = Math.max(0, p.zone.attack - attack);
          // 淡入不超过音长的 40%（很短的倚音也不会与后面的交叉淡化重叠）
          const fade = Math.min(n.d * 0.4, off > 0.005 ? Math.min(0.05, Math.max(0.02, attack * 0.4)) : 0.003);
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(L, start + Math.max(0.001, fade));
        }
        let stop: number;
        if (tiedOut) {
          const fo = end - xOut / 2 + dt;
          g.gain.setValueCurveAtTime(scaled(fadeCurve(0, false), L), fo, xOut);
          stop = fo + xOut + 0.005;
        } else {
          // 下一个音紧接着（不圆滑）时很快收掉，否则按释音
          const quick = !!next && next.t + offset - end < 0.04;
          const rel = quick ? Math.min(spec.release, 0.04) : spec.release;
          const e = end + dt;
          g.gain.setValueAtTime(L, Math.max(e, start + 0.01));
          g.gain.setTargetAtTime(0, Math.max(e, start + 0.01), rel / 3);
          stop = Math.max(e, start + 0.01) + rel * 2.5;
        }
        this.sources(loaded, p.zone, p.rate, g, start, off, stop, out, cents, slide && !tiedIn);
      });
    }
  }
}
