// 编织式的写法（地方乐器的港口曲共用）：把一条旋律拆给两个人一人一音地轮流吹（安第斯排箫的 ira 与 arka），
// 由骨干旋律生成甘美兰的咬合（kotekan：两个声部各奏一半的十六分音符，合起来是连续的一串）与锣的标点。
// 都是纯字符串运算，结果是 ABC 旋律行。

/** ABC 旋律行里的一个音（含前面的装饰与倚音）或休止，及其时值后缀；小节线单独成一项。 */
const TOKEN = /\||(?:![a-z]+!)*(?:\{[^}]*\})?(?:[_^=]?[A-Ga-g][,']*|z)[0-9/]*/g;

/** 时值后缀（“2”“/2”“3/2”）。 */
function lengthOf(token: string): string {
  const m = /[0-9/]*$/.exec(token);
  return m ? m[0] : "";
}

/**
 * 一人一音地轮流（hocket）：part 0 奏第 1、3、5……个音，part 1 奏第 2、4、6……个音，轮不到的位置换成同样长的休止。
 * 休止原样保留，小节线原样保留（每小节的长度不变）。
 */
export function hocket(line: string, part: 0 | 1): string {
  let k = 0;
  return (line.match(TOKEN) ?? [])
    .map((t) => {
      if (t === "|" || /^z/.test(t.replace(/^(?:![a-z]+!)*(?:\{[^}]*\})?/, ""))) return t;
      const mine = k++ % 2 === part;
      return mine ? t : `z${lengthOf(t)}`;
    })
    .join(" ");
}

/**
 * 按音高分声部（号队的轮吹：一支号只吹一两个音，几支号按音高分工，合起来拼出整句——刚果的姆蓬吉、贝宁的象牙号）：
 * 只留音名（升降号 + 字母 + 八度记号，不含时值与装饰）在 keep 里的音，其余换成同样长的休止；休止、小节线原样保留。
 * 几个声部的 keep 合起来覆盖旋律里的每个音名、互不重复时，它们合起来正好是原来的旋律。
 */
export function byPitch(line: string, keep: readonly string[]): string {
  return (line.match(TOKEN) ?? [])
    .map((t) => {
      if (t === "|") return t;
      const bare = t.replace(/^(?:![a-z]+!)*(?:\{[^}]*\})?/, "");
      if (/^z/.test(bare)) return t;
      const name = /^[_^=]?[A-Ga-g][,']*/.exec(bare)?.[0] ?? "";
      return keep.includes(name) ? t : `z${lengthOf(t)}`;
    })
    .join(" ");
}

/** 音阶（MIDI 音高，升序）与 ABC 音名的互换：只认这一组音，按出现的顺序。 */
export interface Ladder {
  /** 从低到高的音名（ABC），例如 ["E", "F", "G", "B", "c", "e"] */
  notes: readonly string[];
}

/**
 * 甘美兰的咬合（imbal / kotekan）：骨干旋律（每拍一个音的音名，按 ladder 里的位置）→ 两个声部的十六分音符。
 * 每一拍朝着这一拍的骨干音“绕”过去：polos 奏 [上邻, ·, 骨干, ·]，sangsih 奏 [·, 上上邻, ·, 上邻]（各自只在自己的格子上），
 * 合起来是 上邻 上上邻 骨干 上邻 的一串，落在下一拍之前；每个声部单独听是一下一下的，两个一咬合就成了流动的一串。
 * 每 beatsPerBar 拍补一条小节线。
 */
export function kotekan(balungan: readonly string[], ladder: Ladder, beatsPerBar = 4): { polos: string; sangsih: string } {
  const at = (name: string, step: number): string => {
    const i = ladder.notes.indexOf(name);
    if (i < 0) throw new Error(`咬合：音 ${name} 不在音阶里`);
    return ladder.notes[Math.min(ladder.notes.length - 1, Math.max(0, i + step))];
  };
  const polos: string[] = [];
  const sangsih: string[] = [];
  balungan.forEach((n, i) => {
    if (i > 0 && i % beatsPerBar === 0) {
      polos.push("|");
      sangsih.push("|");
    }
    polos.push(`${at(n, 1)}/2 z/2 ${n}/2 z/2`);
    sangsih.push(`z/2 ${at(n, 2)}/2 z/2 ${at(n, 1)}/2`);
  });
  return { polos: polos.join(" "), sangsih: sangsih.join(" ") };
}

/** 咬合合成一条（一件乐器两手奏全，例如根德尔）：每拍 上邻 上上邻 骨干 上邻 四个十六分音符。 */
export function woven(balungan: readonly string[], ladder: Ladder, beatsPerBar = 4): string {
  const at = (name: string, step: number): string => {
    const i = ladder.notes.indexOf(name);
    if (i < 0) throw new Error(`咬合：音 ${name} 不在音阶里`);
    return ladder.notes[Math.min(ladder.notes.length - 1, Math.max(0, i + step))];
  };
  return balungan.map((n, i) => `${i > 0 && i % beatsPerBar === 0 ? "| " : ""}${at(n, 1)}/2${at(n, 2)}/2${n}/2${at(n, 1)}/2`).join(" ");
}

/** 骨干旋律写成每拍一个音（四分音符）的 ABC 行，每 beatsPerBar 拍一条小节线。 */
export function beats(balungan: readonly string[], beatsPerBar = 4): string {
  return balungan.map((n, i) => (i > 0 && i % beatsPerBar === 0 ? `| ${n}2` : `${n}2`)).join(" ");
}

/**
 * 锣的标点：每小节只在第 beat 拍（从 1 起）奏这一拍的骨干音（移 shift 个八度记号，例如 ",," 降两个八度），其余休止。
 * bars 指定哪些小节奏（从 0 起；缺省每小节）。
 */
export function punctuate(balungan: readonly string[], beat: number, octave = "", bars?: readonly number[], beatsPerBar = 4): string {
  const n = Math.ceil(balungan.length / beatsPerBar);
  const out: string[] = [];
  for (let b = 0; b < n; b++) {
    const play = !bars || bars.includes(b);
    const note = balungan[b * beatsPerBar + beat - 1];
    const before = (beat - 1) * 2;
    const after = (beatsPerBar - beat) * 2;
    if (!play || !note) out.push(`z${beatsPerBar * 2}`);
    else out.push([before ? `z${before}` : "", `${note}${octave}2`, after ? `z${after}` : ""].filter(Boolean).join(" "));
  }
  return out.join(" | ");
}
