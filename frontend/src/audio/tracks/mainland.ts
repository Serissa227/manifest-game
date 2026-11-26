// 中南半岛与菲律宾的曲子共用的小工具（第九批配乐·地方特色第二阶段）：都是纯字符串运算，结果是 ABC 旋律行。
// 暹罗 piphat 乐队是“异音”（heterophony）：同一条骨干（luk tok，每拍一个音）由几件乐器各用自己的说法同时奏——
// 围锣奏骨干本身（句尾隔八度）、高音木琴把它绕成一串八分音符、低音木琴切分着逗、皮奈拉长了唱。
// 这里由骨干生成前三种说法；骨干的音名可以带四分之一音的记号（_/B、_/E：暹罗七平均律的近似）。
import type { Ladder } from "./weave";

/** ABC 音名拆成升降号、字母与八度记号。 */
function parts(name: string): { acc: string; letter: string; marks: string } {
  const m = /^((?:\^\/|_\/|\^\^|__|[_^=])?)([A-Ga-g])([,']*)$/.exec(name);
  if (!m) throw new Error(`不认识的音名：${name}`);
  return { acc: m[1], letter: m[2], marks: m[3] };
}

/** 移八度：k 为正往上、为负往下（ABC：小写高八度，' 与 , 再升降）。 */
export function octave(name: string, k: number): string {
  const { acc, letter, marks } = parts(name);
  // 以“大写无记号”为 0 级：小写 +1，每个 ' +1，每个 , −1
  const level = (letter === letter.toLowerCase() ? 1 : 0) + [...marks].reduce((s, c) => s + (c === "'" ? 1 : -1), 0) + k;
  const upper = letter.toUpperCase();
  if (level >= 1) return `${acc}${upper.toLowerCase()}${"'".repeat(level - 1)}`;
  return `${acc}${upper}${",".repeat(-level)}`;
}

function indexIn(ladder: Ladder, name: string): number {
  const i = ladder.notes.indexOf(name);
  if (i < 0) throw new Error(`音 ${name} 不在音阶里`);
  return i;
}

function stepOf(ladder: Ladder, name: string, k: number): string {
  const i = indexIn(ladder, name) + k;
  return ladder.notes[Math.min(ladder.notes.length - 1, Math.max(0, i))];
}

/**
 * 去下一个骨干音的“经过音”：差两级以上时从它的近旁过去；只差一级时绕到它的另一侧（一个小小的回音）；同音时用上邻音。
 */
function passing(ladder: Ladder, from: string, to: string): string {
  const a = indexIn(ladder, from);
  const b = indexIn(ladder, to);
  if (b === a) return stepOf(ladder, from, 1);
  if (b - a >= 2) return stepOf(ladder, to, -1);
  if (b - a === 1) return stepOf(ladder, to, 1);
  if (a - b >= 2) return stepOf(ladder, to, 1);
  return stepOf(ladder, to, -1);
}

/**
 * 木琴的加花（暹罗的拉那·艾、缅甸的鼓圈都用得上）：骨干每拍一个音 → 每拍两个八分音符 [骨干音, 去下一拍的经过音]，
 * 一条连续的八分音符，每拍的开头都落回骨干。dense 为 true 时每拍四个十六分音符 [骨干, 上邻, 骨干, 经过音]（快板 chan diao）。
 * next 为这一段之后的第一个骨干音（最后一拍的经过音朝它去），缺省为本段的第一个。
 */
export function paraphrase(core: readonly string[], ladder: Ladder, dense = false, next?: string, beatsPerBar = 4): string {
  return core
    .map((p, i) => {
      const q = core[i + 1] ?? next ?? core[0];
      const bar = i > 0 && i % beatsPerBar === 0 ? "| " : "";
      const pass = passing(ladder, p, q);
      return dense ? `${bar}${p}/2${stepOf(ladder, p, 1)}/2${p}/2${pass}/2` : `${bar}${p} ${pass}`;
    })
    .join(" ");
}

/** 围锣的骨干：每拍一个四分音符，每小节最后一拍（句尾、“恰”的位置）低八度一起敲。 */
export function gongCircle(core: readonly string[], beatsPerBar = 4): string {
  return core
    .map((p, i) => {
      const bar = i > 0 && i % beatsPerBar === 0 ? "| " : "";
      return i % beatsPerBar === beatsPerBar - 1 ? `${bar}[${octave(p, -1)}${p}]2` : `${bar}${p}2`;
    })
    .join(" ");
}

/**
 * 低音木琴的切分（拉那·通）：低八度，一小节 “· a b · c2 d2”、下一小节 “a2 · b · c d2”，交替着留空与抢拍；
 * 骨干的长度要是整小节。
 */
export function syncopate(core: readonly string[], beatsPerBar = 4): string {
  const bars: string[] = [];
  for (let b = 0; b * beatsPerBar < core.length; b++) {
    const [a, x, c, d] = core.slice(b * beatsPerBar, b * beatsPerBar + 4).map((n) => octave(n, -1));
    bars.push(b % 2 === 0 ? `z ${a} ${x} z ${c}2 ${d}2` : `${a}2 z ${x} z ${c} ${d}2`);
  }
  return bars.join(" | ");
}

/** 每 n 个取一个（暹罗“三层速度”里，快一层的骨干由慢一层的骨干每两拍取一个音得来，句尾的音都留着）。 */
export function contract<T>(core: readonly T[], n = 2): T[] {
  return core.filter((_, i) => i % n === n - 1);
}
