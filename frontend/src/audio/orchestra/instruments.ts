// 管弦版的乐器：真实乐器的采样（VSCO 2 Community Edition，CC0，见 samples.ts），每件乐器的一种奏法一组采样。
// 三种演奏方式：
// - sustain 长音（弦乐组揉弦、颤弓，木管，铜管）：按音高选最近的采样点、用播放速率移调；奏稳之后的一段循环（接缝处交叉淡化），
//   多长的音都能奏；旋律声部按乐句连贯（音与音之间交叉淡化，不重新起音），和弦声部（声部定义写 poly）每个音各自起音、释音；
// - shot 一次性（拨奏、跳弓、竖琴、定音鼓、钟琴、马林巴、管钟）：从头放，到音符时值后按释音收掉；
// - hits 无音高的打击乐（军鼓、大鼓、钹、铃鼓、三角铁……）：按鼓点名取一组采样。
// level 经过校准（本地试音台，与合成版同一把尺子：声部音量 0.5、力度 0.8 时领奏“奏的时候”约 −26 dB），曲谱里的 gain 直接是混音比例。

/** 采样乐器。 */
export interface SampledSpec {
  kind: "sampled";
  mode: "sustain" | "shot" | "hits";
  /** 采样组（samples.ts 的键）；hits 为空串 */
  set: string;
  /** 定音鼓：写了 !trem! 的音改用这一组（滚奏的长音，循环），由弱渐强 */
  roll?: string;
  /** hits：鼓点名 → 采样组 */
  hits?: Readonly<Record<string, string>>;
  /** hits：旋律行（ABC）里的音高 → 鼓点名。滚奏、渐强这类要写时值的，用旋律行写在打击乐声部上 */
  keys?: Readonly<Record<number, string>>;
  /** hits：各鼓点的音量校准（乘在 level 上） */
  hitGain?: Readonly<Record<string, number>>;
  /** 音域（MIDI，含两端）：曲谱里的音都要在这里面，且离最近的采样点不超过 maxShift（测试逐音检查） */
  range: readonly [number, number];
  /** 移调上限（半音）：离最近的采样点最多这么远 */
  maxShift: number;
  /** 力度层的分界：力度 ≥ layers[i] 时用第 i+1 层（这件乐器在这个音附近没有那一层时用最近的一层）。层只管音色，响度由力度决定 */
  layers?: readonly number[];
  /** 两个最近的采样点叠在一起奏（“齐奏”：圆号组、长号组），略错开时间与音分；圆号 C4–D5 之间没有采样点，也靠它把两头拉过来 */
  pair?: boolean;
  /** 长音的起音（秒）：从“奏稳”前这么多秒开始放，跳过过慢的渐强（VSCO 的弱奏长音有的要一两秒才上来）；和弦声部用 padAttack */
  attack: number;
  /** 和弦声部（poly）的起音（秒），通常更从容 */
  padAttack?: number;
  /** 释音（秒） */
  release: number;
  /** 连奏：前后两个音交叉淡化的长度（秒） */
  legato?: number;
  /**
   * 没写圆滑线、但前后紧接着的两个音：tongued 各自起音（小号、长号的号角）；缺省是“分弓”——
   * 像连奏一样交叉淡化，只是后一个音从“奏稳”前一点开始，留一点换弓、换气的颗粒（短于 0.25 秒的快音仍各自起音）
   */
  detache?: "tongued";
  /** 一次性采样：音符结束后还让它响多久再收（竖琴、钟琴的余音；秒） */
  ring?: number;
  /** 音量校准 */
  level: number;
}

/** 打击乐的鼓点名 → 采样组。 */
export const ORCH_HITS: Readonly<Record<string, string>> = {
  /** 军鼓 */
  snare: "perc.snare",
  /** 军鼓滚奏（长音，循环） */
  sroll: "perc.snareroll",
  /** 大鼓 */
  bd: "perc.bd",
  /** 对击钹 */
  crash: "perc.crash",
  /** 吊镲渐强（约 3.3 秒后最响：曲谱里把它放在要推到的那一拍之前，见 sampler.ts 的 SWELL_LEAD） */
  swell: "perc.swell",
  /** 铃鼓，击 */
  tamb: "perc.tamb",
  /** 铃鼓，摇 */
  shake: "perc.shake",
  /** 三角铁 */
  tri: "perc.tri",
  /** 响棒 */
  claves: "perc.claves",
  /** 木鼓（高、低） */
  loghi: "perc.loghi",
  loglo: "perc.loglo",
  /** 大锣 */
  gong: "perc.gong",
  /** 沙锤 */
  shaker: "perc.shaker",
};

/**
 * 打击乐声部的旋律行：一个音名代表一种鼓点，时值就是它响多久（军鼓滚奏、吊镲渐强要写时值）。
 * C 大鼓、D 军鼓、E 军鼓滚奏、F 对击钹、G 吊镲渐强（在音符结束时最响）、A 铃鼓击、B 铃鼓摇、
 * c 三角铁、d 响棒、e 高木鼓、f 低木鼓、g 大锣、a 沙锤。
 */
export const ORCH_KEYS: Readonly<Record<number, string>> = {
  60: "bd",
  62: "snare",
  64: "sroll",
  65: "crash",
  67: "swell",
  69: "tamb",
  71: "shake",
  72: "tri",
  74: "claves",
  76: "loghi",
  77: "loglo",
  79: "gong",
  81: "shaker",
};

const sus = (set: string, o: Omit<SampledSpec, "kind" | "mode" | "set">): SampledSpec => ({ kind: "sampled", mode: "sustain", set, ...o });
const shot = (set: string, o: Omit<SampledSpec, "kind" | "mode" | "set" | "attack">): SampledSpec => ({ kind: "sampled", mode: "shot", set, attack: 0, ...o });

/** 管弦版的全部乐器（键以 “o.” 开头，与合成版的乐器分开）。 */
export const ORCH_INSTRUMENTS: Readonly<Record<string, SampledSpec>> = {
  // ───── 弦乐组
  /** 小提琴组：揉弦长音，弱奏柔、强奏亮两层 */
  "o.vn": sus("vn.sus", { range: [55, 91], maxShift: 5, layers: [0.6], attack: 0.14, padAttack: 0.3, release: 0.34, legato: 0.09, level: 1.33 }),
  /** 小提琴组：颤弓（风暴、紧张处） */
  "o.vn.trem": sus("vn.trem", { range: [55, 88], maxShift: 4, attack: 0.05, padAttack: 0.2, release: 0.3, legato: 0.06, level: 0.78 }),
  /** 小提琴组：拨奏 */
  "o.vn.pizz": shot("vn.pizz", { range: [55, 88], maxShift: 4, release: 0.25, level: 1.17 }),
  /** 小提琴组：跳弓（快的八分音符） */
  "o.vn.spic": shot("vn.spic", { range: [55, 88], maxShift: 4, release: 0.12, level: 1.27 }),
  /** 中提琴组：揉弦长音（内声部） */
  "o.va": sus("va.sus", { range: [48, 81], maxShift: 4, attack: 0.16, padAttack: 0.32, release: 0.36, legato: 0.09, level: 2.45 }),
  /** 大提琴组：揉弦长音，两层 */
  "o.vc": sus("vc.sus", { range: [36, 76], maxShift: 4, layers: [0.6], attack: 0.14, padAttack: 0.28, release: 0.36, legato: 0.09, level: 1.17 }),
  /** 大提琴组：拨奏 */
  "o.vc.pizz": shot("vc.pizz", { range: [36, 72], maxShift: 4, release: 0.3, level: 1.24 }),
  /** 大提琴组：跳弓（风暴、海战的固定音型） */
  "o.vc.spic": shot("vc.spic", { range: [36, 72], maxShift: 4, release: 0.14, level: 1.16 }),
  /** 低音提琴：揉弦长音（与大提琴组叠低八度） */
  "o.cb": sus("cb.sus", { range: [26, 55], maxShift: 4.5, attack: 0.12, padAttack: 0.25, release: 0.38, legato: 0.09, level: 2.29 }),
  /** 低音提琴：拨奏 */
  "o.cb.pizz": shot("cb.pizz", { range: [26, 55], maxShift: 4, release: 0.35, level: 1.8 }),
  /** 竖琴 */
  "o.harp": shot("harp", { range: [31, 100], maxShift: 4, release: 0.5, ring: 0.6, level: 2.02 }),
  // ───── 铜管
  /** 圆号组（两个采样点叠奏） */
  "o.hn": sus("hn.sus", { range: [36, 77], maxShift: 7.5, layers: [0.66], pair: true, attack: 0.07, padAttack: 0.2, release: 0.26, legato: 0.07, level: 1.88 }),
  /** 小号 */
  "o.tp": sus("tp.sus", { range: [53, 84], maxShift: 4, attack: 0.04, release: 0.18, legato: 0.05, detache: "tongued", level: 2.26 }),
  /** 长号组（两个采样点叠奏） */
  "o.tb": sus("tb.sus", { range: [36, 67], maxShift: 4, pair: true, attack: 0.06, padAttack: 0.16, release: 0.24, legato: 0.06, detache: "tongued", level: 2.34 }),
  // ───── 木管
  /** 长笛 */
  "o.fl": sus("fl.sus", { range: [60, 96], maxShift: 4, attack: 0.05, release: 0.16, legato: 0.06, level: 2.79 }),
  /** 双簧管，两层 */
  "o.ob": sus("ob.sus", { range: [58, 89], maxShift: 4, layers: [0.66], attack: 0.04, release: 0.14, legato: 0.05, level: 1.55 }),
  /** 单簧管 */
  "o.cl": sus("cl.sus", { range: [50, 89], maxShift: 4, attack: 0.05, release: 0.14, legato: 0.05, level: 2.32 }),
  /** 大管 */
  "o.bn": sus("bn.sus", { range: [40, 72], maxShift: 4, attack: 0.05, release: 0.15, legato: 0.05, level: 2.21 }),
  // ───── 有音高的打击乐
  /** 定音鼓：单击（强、弱两层）；!trem! 滚奏 */
  "o.timp": shot("timp.hit", { roll: "timp.roll", range: [38, 58], maxShift: 4, layers: [0.78], release: 0.9, level: 2.43 }),
  /** 钟琴（星光、钱币的叮当） */
  "o.glock": shot("glock", { range: [79, 108], maxShift: 4, release: 0.8, ring: 0.8, level: 2.75 }),
  /** 马林巴（群岛） */
  "o.marimba": shot("marimba", { range: [41, 96], maxShift: 4, release: 0.4, level: 2.16 }),
  /** 管钟（船钟、钟楼） */
  "o.tubular": shot("tubular", { range: [57, 79], maxShift: 5, release: 2.2, ring: 1.5, level: 2.26 }),
  // ───── 无音高的打击乐
  /** 打击乐：鼓点名见 ORCH_HITS；校准到力度 0.8 时鼓 −30 dB、钹 −31 dB、铃鼓三角铁这些小件 −33～−35 dB（奏的时候的响度） */
  "o.perc": {
    kind: "sampled",
    mode: "hits",
    set: "",
    hits: ORCH_HITS,
    keys: ORCH_KEYS,
    hitGain: { snare: 1.07, sroll: 0.65, bd: 1.29, crash: 1.55, swell: 1.24, tamb: 1.2, shake: 1.23, tri: 1.32, claves: 0.97, loghi: 0.8, loglo: 0.84, gong: 1, shaker: 0.95 },
    range: [0, 127],
    maxShift: 0,
    layers: [0.5, 0.78],
    attack: 0,
    release: 0.2,
    level: 1,
  },
};

/** 是否为管弦版的乐器。 */
export function isOrchestral(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ORCH_INSTRUMENTS, id);
}
