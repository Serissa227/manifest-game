// 乐理小工具：音高、调式与调号、和弦记号、和弦音的排列。纯函数，引擎、曲谱与测试共用。
// 音高一律用 MIDI 编号（中央 C = 60），允许小数：阿拉伯木卡姆里的“降半个半音”（四分之一音）写成 .5。

/** MIDI 编号 → 频率（Hz），A4 = 440。 */
export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 音名字母在 C 大调里的半音位置。 */
export const LETTER_PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;

/**
 * 调式音阶（相对主音的半音数）。除了七种教会调式，另有两种木卡姆：
 * bayati（巴亚提：第二级降四分之一音）与 hijaz（希贾兹：小二度 + 增二度）；
 * 地方特色第二阶段又加了 rast（拉斯特：三级与七级是“中立”的，降四分之一音）与波斯的 chahargah
 * （查哈尔加：二级与六级是 koron——降约四分之一音，二、三级之间与六、七级之间各是约 250 音分的大跨度）。
 * 四分之一音按 24 平均律近似（真的 koron 与中立音程因人因地而异，大约低 40–60 音分）。
 */
export const MODES: Readonly<Record<string, readonly number[]>> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  bayati: [0, 1.5, 3, 5, 7, 8, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  rast: [0, 2, 3.5, 5, 7, 9, 10.5],
  chahargah: [0, 1.5, 4, 5, 7, 8.5, 11],
};

/** ABC 记谱的调式缩写（取前三个字母，大小写不限）。 */
const MODE_ALIAS: Readonly<Record<string, string>> = {
  "": "ionian",
  maj: "ionian",
  ion: "ionian",
  m: "aeolian",
  min: "aeolian",
  aeo: "aeolian",
  dor: "dorian",
  phr: "phrygian",
  lyd: "lydian",
  mix: "mixolydian",
  loc: "locrian",
  bay: "bayati",
  hij: "hijaz",
  ras: "rast",
  cha: "chahargah",
};

/** 调：主音、调式与由它推出的调号（每个音名字母的升降，单位半音，可以是 ±0.5）。 */
export interface Key {
  /** 主音的音级（0–11，C = 0） */
  tonic: number;
  mode: string;
  /** 音阶各级的半音位置（可有小数）：从主音（0–11）开始单调上行，最后一级小于主音 + 12 */
  scale: readonly number[];
  /** 调号：音名字母 → 升降 */
  signature: Readonly<Record<string, number>>;
}

/** 解析调名：“D dorian”“Ddor”“Am”“G mix”“D bayati”。不认识时抛错（曲谱写错要在测试里暴露）。 */
export function parseKey(text: string): Key {
  const m = /^\s*([A-Ga-g])([#b]?)\s*([A-Za-z]*)\s*$/.exec(text);
  if (!m) throw new Error(`无法解析调名：${text}`);
  const letter = m[1].toUpperCase();
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const alias = m[3].toLowerCase();
  const mode = MODE_ALIAS[alias === "m" ? "m" : alias.slice(0, 3)];
  if (!mode) throw new Error(`不认识的调式：${text}`);
  const tonic = (LETTER_PC[letter] + acc + 12) % 12;
  const steps = MODES[mode];
  const start = LETTERS.indexOf(letter as (typeof LETTERS)[number]);
  const signature: Record<string, number> = {};
  const scale: number[] = [];
  for (let i = 0; i < 7; i++) {
    const l = LETTERS[(start + i) % 7];
    const target = tonic + steps[i];
    let off = target - LETTER_PC[l];
    while (off > 6) off -= 12;
    while (off <= -6) off += 12;
    signature[l] = off;
    scale.push(target);
  }
  return { tonic, mode, scale, signature };
}

/** 音级（可有小数）规范到 [0, 12)。 */
export function pc(m: number): number {
  return ((m % 12) + 12) % 12;
}

/** 某个音高在调内音阶上的级数（取最近的一级）。 */
function degreeOf(key: Key, midi: number): { degree: number; octave: number; offset: number } {
  const p = pc(midi);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 7; i++) {
    const s = pc(key.scale[i]);
    let d = p - s;
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    if (Math.abs(d) < Math.abs(bestDist)) {
      bestDist = d;
      best = i;
    }
  }
  // 以主音所在八度为基准：音阶第一级的实际 MIDI = 12·oct + scale[0]
  const base = midi - bestDist;
  const octave = Math.round((base - key.scale[best]) / 12);
  return { degree: best, octave, offset: bestDist };
}

/** 在调内按音阶级数移动（steps = −2 是下方三度，+5 是上方六度）；调外的变化音保持与原音级的偏差。 */
export function diatonicShift(key: Key, midi: number, steps: number): number {
  const { degree, octave, offset } = degreeOf(key, midi);
  const total = degree + steps;
  const d = ((total % 7) + 7) % 7;
  const oct = octave + Math.floor(total / 7);
  return 12 * oct + key.scale[d] + offset;
}

// ───────────────────────────── 和弦

/** 和弦：根音与各音（相对根音的半音），可带转位低音。 */
export interface Chord {
  symbol: string;
  root: number;
  /** 从根音起的各音（半音，升序，不含八度重复） */
  tones: readonly number[];
  /** 第三音的位置（挂留和弦是挂留音；没有三音的五度和弦为 null） */
  third: number | null;
  fifth: number | null;
  /** 七音、六音或九音（没有时为 null） */
  ext: number | null;
  /** 低音的音级（斜线和弦的低音；否则为根音） */
  bass: number;
}

const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "69": [0, 4, 7, 9, 14],
  "9": [0, 4, 7, 10, 14],
  "5": [0, 7],
};

function notePc(text: string): number {
  const letter = text[0].toUpperCase();
  const acc = text.slice(1) === "#" ? 1 : text.slice(1) === "b" ? -1 : 0;
  return (LETTER_PC[letter] + acc + 12) % 12;
}

/** 解析和弦记号：“Dm”“G7”“F#m7b5”“C/E”“Dsus4”“G6”“D5”。不认识时抛错。 */
export function parseChord(symbol: string): Chord {
  const m = /^([A-G][#b]?)(maj7|m7b5|madd9|m7|m6|7sus4|sus2|sus4|add9|dim|aug|69|m|7|6|9|5)?(?:\/([A-G][#b]?))?$/.exec(symbol);
  if (!m) throw new Error(`无法解析和弦：${symbol}`);
  const root = notePc(m[1]);
  const tones = QUALITIES[m[2] ?? ""];
  const third = tones.find((t) => t === 2 || t === 3 || t === 4 || t === 5) ?? null;
  const fifth = tones.find((t) => t === 6 || t === 7 || t === 8) ?? null;
  const ext = tones.find((t) => t === 9 || t === 10 || t === 11 || t === 14) ?? null;
  return { symbol, root, tones, third, fifth, ext, bass: m[3] ? notePc(m[3]) : root };
}

/**
 * 把根音放进 [low, low + 12) 的八度，返回它的 MIDI 编号。
 * 伴奏声部据此决定音区：同一个声部里各和弦的根音总在同一个八度窗口内。
 */
export function rootIn(root: number, low: number): number {
  return low + pc(root - low);
}

/**
 * 伴奏型里的和弦音记号 → 相对根音的半音：1 根音、3 三音、5 五音、7 七 / 六 / 九音，
 * 8、10、12、14 是高八度的 1、3、5、7，15、17 再高一个八度；b 是低音（斜线和弦的低音，放在根音下方）。
 * 和弦里没有的音按就近退回：没有三音用五音，没有七音用高八度根音。
 */
export function chordTone(chord: Chord, token: string): number {
  const base = token.replace(/[,']/g, "");
  const shift = 12 * ((token.match(/'/g)?.length ?? 0) - (token.match(/,/g)?.length ?? 0));
  const third = chord.third ?? chord.fifth ?? 0;
  const fifth = chord.fifth ?? 7;
  const ext = chord.ext === null ? 12 : chord.ext === 14 ? 14 : chord.ext;
  let v: number;
  switch (base) {
    case "1":
      v = 0;
      break;
    case "3":
      v = third;
      break;
    case "5":
      v = fifth;
      break;
    case "7":
      v = ext;
      break;
    case "8":
      v = 12;
      break;
    case "10":
      v = third + 12;
      break;
    case "12":
      v = fifth + 12;
      break;
    case "14":
      v = ext + 12;
      break;
    case "15":
      v = 24;
      break;
    case "17":
      v = third + 24;
      break;
    case "b":
      v = chord.bass === chord.root ? 0 : pc(chord.bass - chord.root) - 12;
      break;
    default:
      throw new Error(`不认识的和弦音记号：${token}`);
  }
  return v + shift;
}

/**
 * 在 [lo, hi] 里为和弦排一个密集位置的声部（三到四个音），并尽量贴近上一个排列（共同音保持、其余就近移动）。
 * prev 为空时取最靠近音区中央的排列。弦乐与人声的长音用它，换和弦时各声部平滑进行。
 */
export function voiceLead(chord: Chord, lo: number, hi: number, prev: readonly number[] | null, size = 4): number[] {
  const pcs = chord.tones.map((t) => pc(chord.root + t));
  // 声部数多于和弦音时重复根音
  const want: number[] = [];
  for (let i = 0; i < size; i++) want.push(pcs[i < pcs.length ? i : 0]);
  // 枚举每个音在音区里的所有位置，取与上一个排列距离最小的组合（音数很少，直接穷举）
  const options = want.map((p) => {
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) if (pc(m) === pc(p)) out.push(m);
    return out;
  });
  const center = (lo + hi) / 2;
  let best: number[] | null = null;
  let bestCost = Infinity;
  const pick: number[] = [];
  const walk = (i: number) => {
    if (i === options.length) {
      const sorted = [...pick].sort((a, b) => a - b);
      // 不要同度重复，也不要超过一个八度半的跨度（密集位置）
      for (let k = 1; k < sorted.length; k++) if (sorted[k] === sorted[k - 1]) return;
      if (sorted[sorted.length - 1] - sorted[0] > 19) return;
      let cost = 0;
      if (prev && prev.length === sorted.length) for (let k = 0; k < sorted.length; k++) cost += Math.abs(sorted[k] - prev[k]);
      else cost = Math.abs(sorted.reduce((a, b) => a + b, 0) / sorted.length - center) * sorted.length;
      if (cost < bestCost) {
        bestCost = cost;
        best = sorted;
      }
      return;
    }
    for (const m of options[i]) {
      pick.push(m);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best ?? want.map((p) => rootIn(p, lo));
}
