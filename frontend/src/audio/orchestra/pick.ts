// 采样的挑选（纯函数，测试直接检查）：一个音用哪个（或哪两个）采样、放多快；一首曲子要加载哪些文件。
// 采样器（sampler.ts）与加载（bank.ts）都用这里的规则，所以“预先加载的”正好是“奏的时候要用的”。
import { realizePass, type NoteEvent, type TrackDef } from "../score";
import { isOrchestral, ORCH_INSTRUMENTS, type SampledSpec } from "./instruments";
import { SAMPLE_SETS, type SampleZone } from "./samples";

/** 一个采样点：同一力度层、同一个音的几次录音（轮换）。 */
interface Position {
  layer: number;
  /** 各次录音的平均音高 */
  pitch: number;
  variants: readonly SampleZone[];
}

const positionCache = new Map<string, Position[]>();

/** 一组采样按（力度层、音）归成采样点。无音高的打击乐每层一个“点”（音高记为 0）。 */
export function positionsOf(set: string): Position[] {
  let out = positionCache.get(set);
  if (out) return out;
  const zones = SAMPLE_SETS[set]?.zones ?? [];
  const groups = new Map<string, SampleZone[]>();
  for (const z of zones) {
    const key = `${z.layer}:${z.pitch === null ? "x" : Math.round(z.pitch)}`;
    const g = groups.get(key);
    if (g) g.push(z);
    else groups.set(key, [z]);
  }
  out = [...groups.values()].map((vs) => {
    const sorted = [...vs].sort((a, b) => a.rr - b.rr);
    const pitch = sorted.reduce((s, z) => s + (z.pitch ?? 0), 0) / sorted.length;
    return { layer: sorted[0].layer, pitch, variants: sorted };
  });
  out.sort((a, b) => a.layer - b.layer || a.pitch - b.pitch);
  positionCache.set(set, out);
  return out;
}

/** 力度 → 力度层（按乐器的分界）。 */
export function layerFor(spec: SampledSpec, v: number): number {
  let l = 0;
  for (const edge of spec.layers ?? []) if (v >= edge) l++;
  return l;
}

/** 一个音挑出的采样：采样、播放速率（移调）、音量权重。 */
export interface Pick {
  zone: SampleZone;
  rate: number;
  weight: number;
}

/** 这一层里离 m 最近的采样点（maxShift 以内）；second 为真时另给出第二近的（不同的音）。 */
function nearestIn(positions: readonly Position[], layer: number, m: number, maxShift: number): Position[] {
  return positions
    .filter((p) => p.layer === layer && Math.abs(p.pitch - m) <= maxShift + 1e-6)
    .sort((a, b) => Math.abs(a.pitch - m) - Math.abs(b.pitch - m) || a.pitch - b.pitch);
}

/**
 * 为音高 m 挑采样：先在要的力度层里找 maxShift 以内最近的采样点，这一层没有就换最近的一层；
 * pair 时再加上同一层里第二近的采样点（两个一起奏，各 −3 dB）。rr 为轮换计数。
 * usable 给出时只考虑它认可的采样（例如已经加载的）。都找不到时返回空数组。
 */
export function pickZones(set: string, m: number, layer: number, rr: number, pair: boolean, maxShift: number, usable?: (z: SampleZone) => boolean): Pick[] {
  const all = positionsOf(set);
  const positions = usable ? all.map((p) => ({ ...p, variants: p.variants.filter(usable) })).filter((p) => p.variants.length > 0) : all;
  const layers = [...new Set(positions.map((p) => p.layer))].sort((a, b) => Math.abs(a - layer) - Math.abs(b - layer) || b - a);
  for (const l of layers) {
    const near = nearestIn(positions, l, m, maxShift);
    if (near.length === 0) continue;
    const chosen = pair && near.length > 1 ? near.slice(0, 2) : near.slice(0, 1);
    const weight = chosen.length > 1 ? Math.SQRT1_2 : 1;
    return chosen.map((p) => {
      const zone = p.variants[rr % p.variants.length];
      return { zone, rate: Math.pow(2, (m - (zone.pitch ?? m)) / 12), weight };
    });
  }
  return [];
}

/** 无音高的打击乐：这一组里按力度层（没有这一层用最近的层）与轮换挑一个。 */
export function pickHit(set: string, layer: number, rr: number, usable?: (z: SampleZone) => boolean): SampleZone | null {
  const zones = (SAMPLE_SETS[set]?.zones ?? []).filter((z) => !usable || usable(z));
  if (zones.length === 0) return null;
  const layers = [...new Set(zones.map((z) => z.layer))].sort((a, b) => Math.abs(a - layer) - Math.abs(b - layer) || b - a);
  const inLayer = zones.filter((z) => z.layer === layers[0]).sort((a, b) => a.rr - b.rr);
  return inLayer[rr % inLayer.length];
}

/** 打击乐的一击是哪个鼓点：伴奏型给的鼓点名，或旋律行的音高按 keys 换成鼓点名。 */
export function hitOf(spec: SampledSpec, ev: NoteEvent): string | null {
  if (ev.hit) return ev.hit;
  return spec.keys?.[Math.round(ev.m)] ?? null;
}

/** 声部的乐器（管弦版的采样乐器；不是时为 null）。 */
export function sampledOf(track: TrackDef, voice: string): SampledSpec | null {
  const id = track.voices[voice]?.inst ?? "";
  return isOrchestral(id) ? ORCH_INSTRUMENTS[id] : null;
}

/** 力度在层的分界附近时两层都加载：演奏时的力度（接着离开的那一段奏时，随机数不同）会有这么大的出入。 */
const LAYER_MARGIN = 0.06;

/**
 * 一个音要用到的全部文件：按力度挑中的那一层（力度在分界附近时两层）里挑中的采样点，轮换的几次录音都算上；
 * 那一层在移调上限以内没有采样点时，pickZones 会退到最近的一层，这里也跟着算那一层。
 * 定音鼓的滚奏另用滚奏那一组；打击乐是那个鼓点的整组（很小）。
 */
export function filesForNote(spec: SampledSpec, ev: NoteEvent, shift = 0): string[] {
  const out: string[] = [];
  if (spec.mode === "hits") {
    const set = spec.hits?.[hitOf(spec, ev) ?? ""];
    for (const z of SAMPLE_SETS[set ?? ""]?.zones ?? []) out.push(z.file);
    return out;
  }
  const roll = !!spec.roll && !!ev.deco?.includes("trem");
  const set = roll ? spec.roll! : spec.set;
  const m = ev.m + shift;
  const wanted = roll ? [0] : [...new Set([layerFor(spec, ev.v - LAYER_MARGIN), layerFor(spec, ev.v), layerFor(spec, ev.v + LAYER_MARGIN)])];
  for (const layer of wanted) {
    for (const p of pickZones(set, m, layer, 0, !!spec.pair, spec.maxShift)) {
      const pos = positionsOf(set).find((q) => q.layer === p.zone.layer && q.variants.includes(p.zone));
      for (const z of pos?.variants ?? [p.zone]) out.push(z.file);
    }
  }
  return out;
}

/** 移调范围（短乐句移到正在放的曲子的调上：−6…+5 个半音，见 engine.cueShift）。 */
const CUE_SHIFTS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

const filesCache = [new WeakMap<TrackDef, readonly string[]>(), new WeakMap<TrackDef, readonly string[]>()];

/**
 * 一首曲子（每一遍）要加载的全部文件。cue 为真时是短乐句：各种移调都算上。
 * 合成版的曲子（没有采样乐器）返回空数组。
 */
export function filesFor(track: TrackDef, cue = false): readonly string[] {
  const cache = filesCache[cue ? 1 : 0];
  const hit = cache.get(track);
  if (hit) return hit;
  const files = new Set<string>();
  const specs = new Map<string, SampledSpec | null>();
  for (const v of Object.keys(track.voices)) specs.set(v, sampledOf(track, v));
  if ([...specs.values()].some((s) => s)) {
    for (let pass = 0; pass < track.forms.length; pass++) {
      for (const ev of realizePass(track, pass).events) {
        const spec = specs.get(ev.voice);
        if (!spec) continue;
        for (const k of cue && spec.mode !== "hits" ? CUE_SHIFTS : [0]) for (const f of filesForNote(spec, ev, k)) files.add(f);
      }
    }
  }
  const out = [...files].sort();
  cache.set(track, out);
  return out;
}
