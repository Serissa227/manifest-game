// 曲谱的数据结构与“演奏”：把一首曲目的某一遍展开成按时间排好的音符事件（纯函数，确定性，可测试）。
//
// 一首曲目（TrackDef）由这些部分组成：
// - 声部（voices）：一件乐器 + 音量、声像、混响；伴奏声部另带伴奏型（pattern），按段落的和弦自动生成；
// - 段落（sections）：小节数、和弦进行、若干旋律行（ABC 记谱，见 abc.ts）；
// - 曲式（forms）：每一遍依次演奏哪些段落、每段由哪些声部演奏什么、力度与速度。第 n 遍用 forms[n % 长度]，
//   这样同一首曲子循环时配器会变化，不会一遍遍完全相同；
// - 留白（rest）：一遍奏完后停几秒，只剩环境声，再开始下一遍。
//
// 时值单位一律是八分音符（ABC 的 L:1/8）：3/4 拍每小节 6 个单位、6/8 拍 6 个、4/4 拍 8 个。
import { parseAbc, type AbcLine } from "./abc";
import { chordTone, diatonicShift, parseChord, parseKey, rootIn, voiceLead, type Chord, type Key } from "./theory";

/** 伴奏型。steps 是空格分隔的记号，每个记号占 grid 个单位（缺省 1，即八分音符），循环铺满整段。 */
export type Pattern =
  | {
      /**
       * 分解和弦 / 低音线：记号是和弦音（1 3 5 7 8 10 12 14 15 17 b，可加 , ' 降升八度，用 + 连成双音），“.” 延长上一个音，“-” 休止。
       * B 是和弦的低音（斜线和弦的低音，否则为根音）放在 [low, low+12) 里——与 b 不同，它不会跑到根音下方的另一个八度，适合给音域有限的乐器写低音线。
       */
      kind: "arp";
      /** 根音所在八度的下限（MIDI）：根音放进 [low, low+12) */
      low: number;
      steps: string;
      grid?: number;
      /** 每个音至少响几个记号的长度（缺省 1：到下一个音为止） */
      ring?: number;
    }
  | {
      /** 扫弦：D 重下扫、d 轻下扫、U 重上扫、u 轻上扫、x 闷音、“.” 延长、“-” 止音 */
      kind: "strum";
      /** 低音弦的下限（MIDI），和弦按吉他式的开放排列铺到 high 以内 */
      low: number;
      high: number;
      steps: string;
      grid?: number;
      /** 相邻两弦的间隔（秒，缺省 0.012） */
      spread?: number;
    }
  | {
      /** 长音和弦（弦乐、人声）：换和弦时各声部就近进行 */
      kind: "pad";
      low: number;
      high: number;
      /** 声部数（缺省 3） */
      size?: number;
    }
  | {
      /** 持续音（风笛式、乌德琴空弦式）：整段持续这些 MIDI 音 */
      kind: "drone";
      notes: number[];
    }
  | {
      /** 打击乐：每个字符一个格（空格忽略），字符 → [鼓点名, 力度]；“.” 不奏 */
      kind: "drum";
      steps: string;
      grid?: number;
      hits: Record<string, readonly [string, number]>;
    };

/** 声部。 */
export interface VoiceDef {
  /** 乐器（instruments.ts 的键） */
  inst: string;
  /** 音量（线性，缺省 0.5） */
  gain?: number;
  /** 声像 −1（左）…1（右） */
  pan?: number;
  /** 混响送量 0–1（缺省 0.25） */
  reverb?: number;
  /** 伴奏型；可以有多个变体，曲式里写“声部.变体” */
  pattern?: Pattern | Readonly<Record<string, Pattern>>;
  /**
   * 和弦声部（管弦版的采样长音乐器）：每个音各自起音、释音，可以同时奏几个音（分部的弦乐长音、圆号的和弦）；
   * 同音高前后相接的连音合成一个长音。不写时是旋律声部：同时只奏一个音，按乐句连贯。
   */
  poly?: boolean;
}

/** 段落。 */
export interface SectionDef {
  bars: number;
  /** 和弦：每小节一格，用 | 分开；一小节里写几个和弦时平分，或写 C*4 G*2 指定各占几个单位 */
  chords?: string;
  /** 旋律行：名字 → ABC */
  lines?: Readonly<Record<string, string>>;
  /** 弱起的长度（单位）：旋律行开头这么长的部分落在上一段的末尾 */
  pickup?: number;
}

/** 曲式中的一步：演奏一个段落。 */
export interface Step {
  /** 段落名 */
  s: string;
  /**
   * 空格分隔：“旋律行:声部”演奏旋律（后面可加 +12 / -12 移八度，~-2 在调内向下平行三度，~2 向上三度），
   * “声部”或“声部.变体”演奏伴奏型。
   */
  play: string;
  /** 力度 0–1（缺省 0.8）；to 为段末的力度（渐强 / 渐弱） */
  dyn?: number;
  to?: number;
  /** 速度倍数（缺省 1）；rit 为段末的速度倍数（渐慢） */
  tempo?: number;
  rit?: number;
}

/** 一首曲目。 */
export interface TrackDef {
  id: string;
  /**
   * 曲名。en 可以不写：寰宇先只做中文（2026-10-18 起），之后新写的曲子只起中文名，英文界面回退中文（见 labels.ts 的 trackTitle）；
   * 已有的英文名保留。
   */
  title: { zh: string; en?: string };
  /** 每分钟四分音符数 */
  qpm: number;
  meter: readonly [number, number];
  /** 调（theory.parseKey 的写法） */
  key: string;
  voices: Readonly<Record<string, VoiceDef>>;
  sections: Readonly<Record<string, SectionDef>>;
  forms: readonly (readonly Step[])[];
  /** 一遍奏完后的留白（秒）[最短, 最长] */
  rest: readonly [number, number];
  /** 混响湿度倍数（缺省 1） */
  space?: number;
  /** 整首的音量倍数（缺省 1）：混音时整体微调用 */
  level?: number;
  /** 用“大厅”混响（更长、预延迟更长、尾巴更暗）代替缺省的房间混响：大编制的曲子 */
  hall?: boolean;
  /** 拍点律动：每拍的起点相对拍长提前（负）或推后（正），如波尔斯卡舞第二拍略早 */
  groove?: readonly number[];
  /** 时间抖动（秒，缺省 0.006） */
  humanize?: number;
}

/** 一个音符事件。 */
export interface NoteEvent {
  /** 起点（秒，从这一遍开始算） */
  t: number;
  /** 时值（秒） */
  d: number;
  /** 力度 0–1 */
  v: number;
  voice: string;
  /** 音高（MIDI，可有小数）；打击乐为 0 */
  m: number;
  /** 打击乐的鼓点名 */
  hit?: string;
  /** 与下一个音圆滑相连（同一声部） */
  legato?: boolean;
  /** 装饰：slide 滑音、trem 震音、bend 按上来、fall 往下落、vib 深揉、andolan 慢摇（同时带 vib，往下摆）、up（andolan 往上摆） */
  deco?: readonly string[];
}

/** 展开后的一遍。 */
export interface Pass {
  events: NoteEvent[];
  /** 这一遍的长度（秒，不含尾部的混响与留白） */
  length: number;
  /** 各段的起点（秒）与它在曲式里的序号 */
  steps: { t: number; step: number }[];
}

/** 每小节的单位数（八分音符个数）。 */
export function barUnits(meter: readonly [number, number]): number {
  return (meter[0] * 8) / meter[1];
}

/** 一个单位（八分音符）的秒数。 */
export function unitSeconds(qpm: number): number {
  return 30 / qpm;
}

/** 拍长（单位）：复拍子（6/8、9/8、12/8）以附点四分音符为一拍，其余以四分音符为一拍。 */
export function beatUnits(meter: readonly [number, number]): number {
  return meter[1] === 8 && meter[0] % 3 === 0 ? 3 : 8 / meter[1];
}

// ───────────────────────────── 随机数（确定性）

/** mulberry32：给定种子的伪随机数，[0, 1)。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位种子。 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ───────────────────────────── 解析缓存

const keyCache = new Map<string, Key>();
function keyOf(text: string): Key {
  let k = keyCache.get(text);
  if (!k) {
    k = parseKey(text);
    keyCache.set(text, k);
  }
  return k;
}

const lineCache = new Map<string, AbcLine>();
/** 解析段落里的一行旋律（带缓存）。 */
export function lineOf(track: TrackDef, section: string, line: string): AbcLine {
  const id = `${track.id}/${section}/${line}`;
  let parsed = lineCache.get(id);
  if (!parsed) {
    const text = track.sections[section]?.lines?.[line];
    if (text === undefined) throw new Error(`${track.id}：段落 ${section} 没有旋律行 ${line}`);
    parsed = parseAbc(text, keyOf(track.key));
    lineCache.set(id, parsed);
  }
  return parsed;
}

/** 一段的和弦：各和弦的起点与长度（单位）。 */
export interface ChordSpan {
  at: number;
  len: number;
  chord: Chord;
}

/** 解析段落的和弦进行。小节数与段落不符时抛错。 */
export function chordsOf(section: SectionDef, bar: number): ChordSpan[] {
  if (!section.chords) return [];
  const bars = section.chords.split("|").map((b) => b.trim());
  if (bars.length !== section.bars) throw new Error(`和弦进行有 ${bars.length} 小节，段落是 ${section.bars} 小节：${section.chords}`);
  const out: ChordSpan[] = [];
  bars.forEach((text, i) => {
    const items = text.split(/\s+/).filter(Boolean);
    const fixed = items.map((it) => {
      const m = /^(.*)\*(\d+(?:\.\d+)?)$/.exec(it);
      return m ? { sym: m[1], len: Number(m[2]) } : { sym: it, len: 0 };
    });
    const given = fixed.reduce((a, f) => a + f.len, 0);
    const free = fixed.filter((f) => f.len === 0).length;
    const share = free > 0 ? (bar - given) / free : 0;
    let at = i * bar;
    for (const f of fixed) {
      const len = f.len || share;
      out.push({ at, len, chord: parseChord(f.sym) });
      at += len;
    }
    if (Math.abs(at - (i + 1) * bar) > 1e-6) throw new Error(`和弦小节长度不对：${text}`);
  });
  return out;
}

function chordAt(spans: readonly ChordSpan[], at: number): ChordSpan | undefined {
  let found: ChordSpan | undefined;
  for (const s of spans) if (s.at <= at + 1e-9) found = s;
  return found;
}

/** 声部的伴奏型（按变体名取；没有变体名时取唯一或名为 a 的那个）。 */
export function patternOf(voice: VoiceDef, variant?: string): Pattern | undefined {
  const p = voice.pattern;
  if (!p) return undefined;
  if ("kind" in p) return p as Pattern;
  const table = p as Readonly<Record<string, Pattern>>;
  return variant ? table[variant] : (table.a ?? Object.values(table)[0]);
}

// ───────────────────────────── 展开

interface Timeline {
  /** 单位 → 秒（段内，含速度变化与律动） */
  at(u: number): number;
  /** 段的长度（秒） */
  length: number;
}

/** 一段的时间轴：速度（可渐慢）与拍点律动。 */
function timeline(track: TrackDef, step: Step, units: number): Timeline {
  const base = unitSeconds(track.qpm);
  const t0 = step.tempo ?? 1;
  const t1 = step.rit ?? t0;
  // 逐单位累计秒数（速度线性变化）
  const cum = [0];
  for (let u = 0; u < units; u++) {
    const mid = (u + 0.5) / Math.max(1, units);
    cum.push(cum[u] + base / (t0 + (t1 - t0) * mid));
  }
  const bar = barUnits(track.meter);
  const beat = beatUnits(track.meter);
  const groove = track.groove;
  const warp = (u: number): number => {
    if (!groove || groove.length === 0) return u;
    // 小节内按拍点做分段线性变形：第 k 拍的起点移到 k + groove[k]
    const inBar = ((u % bar) + bar) % bar;
    const barStart = u - inBar;
    const k = Math.floor(inBar / beat);
    const beats = Math.round(bar / beat);
    const a = k * beat + (groove[k] ?? 0) * beat;
    const b = k + 1 >= beats ? bar : (k + 1) * beat + (groove[k + 1] ?? 0) * beat;
    const f = (inBar - k * beat) / beat;
    return barStart + a + (b - a) * f;
  };
  const sec = (u: number): number => {
    const w = warp(u);
    if (w <= 0) return w * base;
    if (w >= units) return cum[units] + (w - units) * base;
    const i = Math.floor(w);
    return cum[i] + (cum[i + 1] - cum[i]) * (w - i);
  };
  return { at: sec, length: cum[units] };
}

/** 拍位的轻重：小节第一拍最重，半小节次之，其余拍再次，拍与拍之间最轻。 */
function accent(meter: readonly [number, number], u: number): number {
  const bar = barUnits(meter);
  const beat = beatUnits(meter);
  const p = ((u % bar) + bar) % bar;
  if (p < 1e-6) return 1;
  if (Math.abs(p - bar / 2) < 1e-6 && bar / beat >= 2) return 0.92;
  if (Math.abs(p / beat - Math.round(p / beat)) < 1e-6) return 0.86;
  return 0.8;
}

/** “旋律行:声部+12~-2” → 结构。 */
function parsePlay(token: string): { line?: string; voice: string; variant?: string; shift: number; diatonic: number } {
  const m = /^(?:([\w]+):)?([\w]+)(?:\.([\w]+))?([+-]\d+)?(?:~(-?\d+))?$/.exec(token);
  if (!m) throw new Error(`无法解析演奏记号：${token}`);
  return { line: m[1], voice: m[2], variant: m[3], shift: m[4] ? Number(m[4]) : 0, diatonic: m[5] ? Number(m[5]) : 0 };
}

/** 吉他式开放排列：低音为根音（或斜线低音），往上按五度、八度、三度……铺到 high 以内，最多 6 根弦。 */
export function strumVoicing(chord: Chord, low: number, high: number): number[] {
  const bass = rootIn(chord.bass, low);
  const out = [bass];
  const pcs = chord.tones.map((t) => (chord.root + t) % 12);
  for (let m = bass + 1; m <= high && out.length < 6; m++) {
    if (!pcs.includes(((m % 12) + 12) % 12)) continue;
    // 低音区不放三度（浑浊），相邻两弦至少隔三个半音
    if (m - out[out.length - 1] < 3) continue;
    if (m < bass + 7 && ((m - chord.root) % 12 + 12) % 12 !== 7) continue;
    out.push(m);
  }
  return out;
}

/**
 * 展开一首曲目的第 pass 遍（从曲式的第 from 步开始）。
 * 时间抖动、力度起伏都由 (曲目, 遍数) 决定的随机数给出，同样的输入总得到同样的结果。
 */
export function realizePass(track: TrackDef, pass: number, from = 0): Pass {
  const form = track.forms[pass % track.forms.length];
  const key = keyOf(track.key);
  const bar = barUnits(track.meter);
  const rand = rng(seedOf(`${track.id}#${pass}#${from}`));
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const jitter = track.humanize ?? 0.006;
  const events: NoteEvent[] = [];
  const steps: { t: number; step: number }[] = [];
  let t0 = 0;
  const pads = new Map<string, number[] | null>();

  for (let si = from; si < form.length; si++) {
    const step = form[si];
    const section = track.sections[step.s];
    if (!section) throw new Error(`${track.id}：曲式里的段落 ${step.s} 不存在`);
    const units = section.bars * bar;
    const tl = timeline(track, step, units);
    const spans = chordsOf(section, bar);
    const d0 = step.dyn ?? 0.8;
    const d1 = step.to ?? d0;
    const dynAt = (u: number) => d0 + (d1 - d0) * Math.min(1, Math.max(0, u / units));
    const at = (u: number) => t0 + tl.at(u);
    steps.push({ t: t0, step: si });

    for (const token of step.play.split(/\s+/).filter(Boolean)) {
      const play = parsePlay(token);
      const voice = track.voices[play.voice];
      if (!voice) throw new Error(`${track.id}：声部 ${play.voice} 不存在`);
      if (play.line) {
        // 旋律行
        const line = lineOf(track, step.s, play.line);
        const pickup = section.pickup ?? 0;
        const notes = line.notes;
        for (let ni = 0; ni < notes.length; ni++) {
          const n = notes[ni];
          const u = n.at - pickup;
          const start = at(u) + gauss() * jitter;
          const end = at(u + n.len);
          let dur = end - start;
          const stacc = n.deco.includes("stacc");
          if (stacc) dur *= 0.5;
          let v = dynAt(Math.max(0, u)) * accent(track.meter, u) * (1 + gauss() * 0.05);
          if (n.deco.includes("accent")) v *= 1.18;
          const tone = (m: number) => (play.diatonic ? diatonicShift(key, m, play.diatonic) : m) + play.shift;
          const next = notes[ni + 1];
          const joined = !!next && Math.abs(next.at - (n.at + n.len)) < 1e-6;
          const legato = n.slur && joined;
          // 倚音：从本音的起点之前借极短的时间
          const g = n.grace.length;
          for (let k = 0; k < g; k++) {
            events.push({ t: start - (g - k) * 0.045, d: 0.05, v: v * 0.8, voice: play.voice, m: tone(n.grace[k]), legato: true });
          }
          const deco = n.deco.filter((d) => d === "slide" || d === "trem" || d === "bend" || d === "fall" || d === "vib" || d === "andolan" || d === "up");
          if (n.deco.includes("roll") && n.pitches.length === 1 && dur > 0.3) {
            // 回旋音：主音 – 上邻音 – 主音 – 下邻音 – 主音（上下邻音极短）
            const m = n.pitches[0];
            const up = diatonicShift(key, m, 1);
            const lo = diatonicShift(key, m, -1);
            const third = dur / 3;
            const cut = 0.04;
            events.push({ t: start, d: third - cut, v, voice: play.voice, m: tone(m), legato: true });
            events.push({ t: start + third - cut, d: cut, v: v * 0.75, voice: play.voice, m: tone(up), legato: true });
            events.push({ t: start + third, d: third - cut, v: v * 0.9, voice: play.voice, m: tone(m), legato: true });
            events.push({ t: start + 2 * third - cut, d: cut, v: v * 0.75, voice: play.voice, m: tone(lo), legato: true });
            events.push({ t: start + 2 * third, d: third, v: v * 0.9, voice: play.voice, m: tone(m), legato });
            continue;
          }
          for (const m of n.pitches) {
            events.push({ t: start, d: Math.max(0.03, dur), v, voice: play.voice, m: tone(m), legato: legato || undefined, deco: deco.length ? deco : undefined });
          }
        }
        continue;
      }
      const pattern = patternOf(voice, play.variant);
      if (!pattern) throw new Error(`${track.id}：声部 ${play.voice} 没有伴奏型${play.variant ? ` ${play.variant}` : ""}`);
      realizePattern(pattern, play.voice, play.shift, spans, units, at, dynAt, track.meter, gauss, jitter, events, pads);
    }
    t0 += tl.length;
  }
  // 弱起落在曲首之前时整体后移
  let lead = 0;
  for (const e of events) lead = Math.max(lead, -e.t);
  if (lead > 0) {
    for (const e of events) e.t += lead;
    for (const s of steps) s.t += lead;
  }
  events.sort((a, b) => a.t - b.t || a.m - b.m);
  return { events, length: t0 + lead, steps };
}

function tokens(steps: string): string[] {
  return steps.split(/\s+/).filter(Boolean);
}

function realizePattern(
  p: Pattern,
  voice: string,
  shift: number,
  spans: readonly ChordSpan[],
  units: number,
  at: (u: number) => number,
  dynAt: (u: number) => number,
  meter: readonly [number, number],
  gauss: () => number,
  jitter: number,
  out: NoteEvent[],
  pads: Map<string, number[] | null>,
) {
  switch (p.kind) {
    case "drone": {
      for (const m of p.notes) out.push({ t: at(0), d: at(units) - at(0), v: dynAt(0), voice, m: m + shift });
      return;
    }
    case "pad": {
      // 相同的和弦连成一个长音；换和弦时就近进行
      let prev = pads.get(voice) ?? null;
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        let end = s.at + s.len;
        while (i + 1 < spans.length && spans[i + 1].chord.symbol === s.chord.symbol) end = spans[++i].at + spans[i].len;
        const notes = voiceLead(s.chord, p.low, p.high, prev, p.size ?? 3);
        prev = notes;
        const t = at(s.at);
        for (const m of notes) out.push({ t, d: at(end) - t, v: dynAt(s.at) * 0.9, voice, m: m + shift, legato: true });
      }
      pads.set(voice, prev);
      return;
    }
    case "drum": {
      const grid = p.grid ?? 1;
      const cells = [...p.steps.replace(/\s+/g, "")];
      if (cells.length === 0) return;
      for (let u = 0, i = 0; u < units - 1e-9; u += grid, i++) {
        const ch = cells[i % cells.length];
        if (ch === ".") continue;
        const hit = p.hits[ch];
        if (!hit) throw new Error(`打击乐记号 ${ch} 没有对应的鼓点`);
        const v = hit[1] * dynAt(u) * (1 + gauss() * 0.06);
        out.push({ t: at(u) + gauss() * jitter * 0.6, d: 0.3, v, voice, m: 0, hit: hit[0] });
      }
      return;
    }
    case "arp": {
      const grid = p.grid ?? 1;
      const cells = tokens(p.steps);
      const ring = p.ring ?? 1;
      const steps = Math.round(units / grid);
      for (let i = 0; i < steps; i++) {
        const cell = cells[i % cells.length];
        if (cell === "." || cell === "-") continue;
        const u = i * grid;
        const span = chordAt(spans, u);
        if (!span) continue;
        // 这个音响到下一个非延长记号（至少 ring 格）为止
        let len = 1;
        while (i + len < steps && cells[(i + len) % cells.length] === ".") len++;
        len = Math.max(len, ring);
        const root = rootIn(span.chord.root, p.low);
        const v = dynAt(u) * accent(meter, u) * (1 + gauss() * 0.05);
        const t = at(u) + gauss() * jitter;
        const d = at(Math.min(units + grid * ring, u + len * grid)) - at(u);
        for (const part of cell.split("+")) {
          const m = part === "B" ? rootIn(span.chord.bass, p.low) : root + chordTone(span.chord, part);
          out.push({ t, d, v, voice, m: m + shift });
        }
      }
      return;
    }
    case "strum": {
      const grid = p.grid ?? 1;
      const cells = tokens(p.steps);
      const spread = p.spread ?? 0.012;
      const steps = Math.round(units / grid);
      for (let i = 0; i < steps; i++) {
        const cell = cells[i % cells.length];
        if (cell === "." || cell === "-") continue;
        const u = i * grid;
        const span = chordAt(spans, u);
        if (!span) continue;
        let len = 1;
        while (i + len < steps && cells[(i + len) % cells.length] === ".") len++;
        const voicing = strumVoicing(span.chord, p.low, p.high);
        const t = at(u) + gauss() * jitter;
        const d = at(u + len * grid) - at(u);
        const base = dynAt(u) * accent(meter, u);
        if (cell === "x") {
          voicing.forEach((m, k) => out.push({ t: t + k * 0.004, d: 0.05, v: base * 0.45, voice, m: m + shift }));
          continue;
        }
        const down = cell === "D" || cell === "d";
        const loud = cell === "D" || cell === "U" ? 1 : 0.7;
        // 上扫只扫高音的三四根弦
        const strings = down ? voicing : voicing.slice(-4).reverse();
        strings.forEach((m, k) => {
          const v = base * loud * (down ? 1 - k * 0.04 : 0.85 - k * 0.05) * (1 + gauss() * 0.05);
          out.push({ t: t + k * spread * (down ? 1 : 0.8), d: Math.max(0.05, d - k * spread), v, voice, m: m + shift });
        });
      }
      return;
    }
  }
}
