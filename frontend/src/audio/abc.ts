// ABC 记谱（子集）解析：曲谱里的旋律都用它书写，可以用任何 ABC 工具试听、修改。
// 支持：
// - 音名与八度：C 是中央 C（MIDI 60），小写 c 高八度，' 与 , 再升 / 降一个八度；
// - 升降号：^ _ =（升、降、还原）、^^ __（重升、重降）、^/ _/（升 / 降四分之一音，木卡姆用）。
//   调号来自曲目的调；小节内写出的升降号一直作用到小节线（ABC 2.1 的规则）；
// - 时值：以单位时值 L 为 1（曲谱都用 L:1/8），A2、A/2、A/、A3/2、A//；
// - 休止 z（x 同 z）；小节线 |（|| |] [| 同样当小节线）；连音线 -（与下一个同音相连）；
// - 和弦 [DFA]2；倚音 {g}（不占时值）；装饰：~ 回旋音、. 断奏、!slide! 滑音、!trem! 震音、!accent! 重音、
//   !bend! 从低一个全音处按上来、!fall! 句尾往下落、!vib! 揉得更深（地方乐器的弯音与揉弦）、
//   !andolan! 北印度拉格的慢摇（解析成 vib 与 andolan 两个装饰：它是一种揉，不认识 andolan 的地方照深揉处理），从记谱音往下摆
//   （达尔巴里的降三摆向二级、降六摆向五级）；!andolan-up! 往上摆（解析成 vib、andolan、up：梅格的二级带着四级的倚音，摆向上方）；
// - 连线 ( ) 圆滑奏；三连音 (3、二连音 (2、四连音 (4；附点节奏 > <；
// - 行内注释 % 到行尾；引号里的和弦记号忽略（和弦另写在段落的 chords 里）。
// 不支持反复记号：段落的重复由曲目的 form 决定。
import type { Key } from "./theory";
import { LETTER_PC } from "./theory";

/** 解析出的一个音（或和弦）。 */
export interface AbcNote {
  /** 起点（单位时值，从本行开头起算） */
  at: number;
  /** 时值（单位时值） */
  len: number;
  /** 音高（MIDI，可有小数）；和弦时多个 */
  pitches: number[];
  /** 倚音（MIDI），在本音之前极快地奏出 */
  grace: number[];
  /** 装饰：roll 回旋音、stacc 断奏、slide 滑音、trem 震音、accent 重音、bend 按上来、fall 往下落、vib 深揉、andolan 慢摇（同时带 vib，往下摆）、up（andolan 改成往上摆） */
  deco: string[];
  /** 与下一个音圆滑相连（连线之内） */
  slur: boolean;
}

/** 一行旋律的解析结果。 */
export interface AbcLine {
  notes: AbcNote[];
  /** 各小节线的位置（单位时值） */
  bars: number[];
  /** 总长（单位时值） */
  length: number;
}

const DECO: Readonly<Record<string, string>> = {
  slide: "slide",
  trem: "trem",
  tremolo: "trem",
  accent: "accent",
  ">": "accent",
  roll: "roll",
  staccato: "stacc",
  // 地方乐器的弯音（见 engine.ts 的 BEND、FALL）：从低一个全音处按上来、句尾往下落、揉得更深
  bend: "bend",
  fall: "fall",
  vib: "vib",
  andolan: "andolan",
  "andolan-up": "up",
};

/**
 * 一个记号带出几个装饰：andolan 是一种揉（vib），同时记 vib，曲谱的检查与只认识 vib 的乐器都把它当深揉；
 * !andolan-up! 是往上摆的 andolan，记 vib、andolan 与 up（up 只跟着 andolan 出现）。
 */
const DECO_ALSO: Readonly<Record<string, readonly string[]>> = { andolan: ["vib"], up: ["vib", "andolan"] };

class Reader {
  i = 0;
  constructor(readonly s: string) {}
  peek(o = 0): string {
    return this.s[this.i + o] ?? "";
  }
  next(): string {
    return this.s[this.i++] ?? "";
  }
  done(): boolean {
    return this.i >= this.s.length;
  }
  fail(msg: string): never {
    throw new Error(`ABC 第 ${this.i} 个字符附近：${msg}（${this.s.slice(Math.max(0, this.i - 12), this.i + 12)}）`);
  }
}

/** 读时值后缀：数字、/、数字/数字。 */
function readLength(r: Reader): number {
  let num = "";
  while (/[0-9]/.test(r.peek())) num += r.next();
  let len = num ? Number(num) : 1;
  while (r.peek() === "/") {
    r.next();
    let den = "";
    while (/[0-9]/.test(r.peek())) den += r.next();
    len /= den ? Number(den) : 2;
  }
  return len;
}

/** 读升降号前缀；没有时返回 null。 */
function readAccidental(r: Reader): number | null {
  const c = r.peek();
  if (c === "^") {
    r.next();
    if (r.peek() === "^") {
      r.next();
      return 2;
    }
    if (r.peek() === "/") {
      r.next();
      return 0.5;
    }
    return 1;
  }
  if (c === "_") {
    r.next();
    if (r.peek() === "_") {
      r.next();
      return -2;
    }
    if (r.peek() === "/") {
      r.next();
      return -0.5;
    }
    return -1;
  }
  if (c === "=") {
    r.next();
    return 0;
  }
  return null;
}

/**
 * 读一个音名（含升降号与八度记号），返回 MIDI。
 * bar 是本小节里已写出的升降号（字母 + 八度 → 升降）；persist 为 false 时（倚音）不写入。
 */
function readPitch(r: Reader, key: Key, bar: Map<string, number>, persist: boolean): number {
  const acc = readAccidental(r);
  const ch = r.next();
  if (!/[A-Ga-g]/.test(ch)) r.fail(`这里应是音名，却是“${ch}”`);
  const letter = ch.toUpperCase();
  let octave = ch === letter ? 4 : 5;
  while (r.peek() === "'" || r.peek() === ",") octave += r.next() === "'" ? 1 : -1;
  const id = `${letter}${octave}`;
  let off: number;
  if (acc !== null) {
    off = acc;
    if (persist) bar.set(id, acc);
  } else off = bar.get(id) ?? key.signature[letter] ?? 0;
  return 12 * (octave + 1) + LETTER_PC[letter] + off;
}

/** 解析一行 ABC 旋律（调号来自 key）。写错时抛出带位置的错误。 */
export function parseAbc(text: string, key: Key): AbcLine {
  const r = new Reader(text);
  const notes: AbcNote[] = [];
  const bars: number[] = [];
  let pos = 0;
  let bar = new Map<string, number>();
  let deco: string[] = [];
  let grace: number[] = [];
  let inSlur = false;
  let tie = false;
  let tuplet: { left: number; mult: number } | null = null;
  let broken = 1;

  const barLine = () => {
    if (bars[bars.length - 1] !== pos) bars.push(pos);
    bar = new Map();
  };

  const place = (pitches: number[] | null, base: number) => {
    let len = base * broken;
    broken = 1;
    if (tuplet) {
      len *= tuplet.mult;
      if (--tuplet.left <= 0) tuplet = null;
    }
    if (pitches === null) {
      // 休止：连线与装饰都不跨过休止
      pos += len;
      deco = [];
      grace = [];
      tie = false;
      return;
    }
    const prev = notes[notes.length - 1];
    if (tie && prev && prev.at + prev.len === pos && prev.pitches.length === pitches.length && prev.pitches.every((p, k) => p === pitches[k])) {
      prev.len += len;
    } else {
      notes.push({ at: pos, len, pitches, grace, deco, slur: inSlur });
    }
    pos += len;
    deco = [];
    grace = [];
    tie = false;
  };

  while (!r.done()) {
    const c = r.peek();
    if (c === "%") {
      while (!r.done() && r.peek() !== "\n") r.next();
      continue;
    }
    if (/\s/.test(c)) {
      r.next();
      continue;
    }
    if (c === '"') {
      r.next();
      while (!r.done() && r.next() !== '"');
      continue;
    }
    if (c === ":") r.fail("不支持反复记号：段落的重复写在曲目的 form 里");
    if (c === "|" || (c === "[" && r.peek(1) === "|")) {
      r.next();
      while (r.peek() === "|" || r.peek() === "]") r.next();
      barLine();
      continue;
    }
    if (c === "(") {
      r.next();
      if (/[2-9]/.test(r.peek())) {
        const p = Number(r.next());
        const q = p === 3 || p === 6 ? 2 : 3;
        tuplet = { left: p, mult: q / p };
      } else inSlur = true;
      continue;
    }
    if (c === ")") {
      r.next();
      inSlur = false;
      const last = notes[notes.length - 1];
      if (last) last.slur = false;
      continue;
    }
    if (c === "{") {
      r.next();
      while (!r.done() && r.peek() !== "}") {
        if (/[\s/]/.test(r.peek())) {
          r.next();
          continue;
        }
        grace.push(readPitch(r, key, bar, false));
        readLength(r);
      }
      r.next();
      continue;
    }
    if (c === "~") {
      r.next();
      deco.push("roll");
      continue;
    }
    if (c === ".") {
      r.next();
      deco.push("stacc");
      continue;
    }
    if (c === "!") {
      r.next();
      let name = "";
      while (!r.done() && r.peek() !== "!") name += r.next();
      r.next();
      const d = DECO[name];
      if (!d) r.fail(`不认识的装饰 !${name}!`);
      deco.push(...(DECO_ALSO[d] ?? []), d);
      continue;
    }
    if (c === "-") {
      r.next();
      tie = true;
      continue;
    }
    if (c === ">" || c === "<") {
      r.next();
      const prev = notes[notes.length - 1];
      if (!prev || prev.at + prev.len !== pos) r.fail("附点节奏前面必须紧跟一个音");
      const k = c === ">" ? 0.5 : -0.5;
      prev.len += prev.len * k;
      pos += (prev.len / (1 + k)) * k;
      broken = 1 - k;
      continue;
    }
    if (c === "z" || c === "x") {
      r.next();
      place(null, readLength(r));
      continue;
    }
    if (c === "[") {
      r.next();
      const pitches: number[] = [];
      while (!r.done() && r.peek() !== "]") {
        if (/\s/.test(r.peek())) {
          r.next();
          continue;
        }
        pitches.push(readPitch(r, key, bar, true));
        readLength(r);
      }
      r.next();
      place(pitches, readLength(r));
      continue;
    }
    if (/[\^_=A-Ga-g]/.test(c)) {
      const p = readPitch(r, key, bar, true);
      place([p], readLength(r));
      continue;
    }
    if (c === "y") {
      r.next();
      continue;
    }
    r.fail(`不认识的字符“${c}”`);
  }
  const last = notes[notes.length - 1];
  if (last) last.slur = false;
  return { notes, bars, length: pos };
}

/**
 * 检查一行旋律的小节是否完整：每小节 barUnits 个单位；有弱起（pickup）时第一小节为弱起长度、最后一小节短同样的长度。
 * 返回出错的小节序号（从 1 起）与实际长度；全部正确时返回空数组。
 */
export function badBars(line: AbcLine, barUnits: number, pickup = 0): { bar: number; units: number }[] {
  const edges = [0, ...line.bars.filter((b) => b > 0 && b < line.length), line.length];
  const out: { bar: number; units: number }[] = [];
  const n = edges.length - 1;
  for (let k = 0; k < n; k++) {
    const units = edges[k + 1] - edges[k];
    let want = barUnits;
    if (pickup > 0 && k === 0) want = pickup;
    else if (pickup > 0 && k === n - 1) want = barUnits - pickup;
    if (Math.abs(units - want) > 1e-6) out.push({ bar: k + 1, units });
  }
  return out;
}
