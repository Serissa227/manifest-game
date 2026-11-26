// 《雨季的船歌》：印度沿岸的海（马拉巴尔海岸、科罗曼德尔海岸、孟加拉湾与锡兰的海）——季风一到，雨云压着海面，船歌顺着风走。
// 地方特色第二阶段：印度的地方乐器领奏（复古合成版的衬底只有很轻的合成弦乐长音与大提琴组的萨）。
// 拉格：梅格（Megh，雨季的拉格，萨 = E：E 升F A B D——没有三级与六级的五声，二级与四级之间常常滑过去，像云里的雷）。
// 梅格与马德亚马德·萨朗用的是同一组音，只能靠装饰分辨：二级 Re（升 F）上慢慢地摇（andolan），从四级 Ma（A）滑到 Re（meend，连线 (A F)）；
// Re 的 andolan 往上摆（!andolan-up!：从记谱的升 F 摆向上方约 60 音分、轻轻擦过梅格里没有的降三，不往萨那边掉）——Re 带着 Ma 的倚音，
// 有的唱法在这一摇里隐约带出一点降三，就是这个方向（达尔巴里的降三、降六则往下摆，见 portMughal.ts）；
// 萨与帕是不动的音（achal），长音保持平直（最多从下面滑上来一下），只有缺省的浅揉；推上来的 !bend! 只放在低一个全音也在拉格里的音上（B、E、高 E、高升 F）。
// 塔拉：达德拉（六拍：Dha Dhin Na | Dha Tin Na），一小节 6/8 是一轮；qpm 96 数的是四分音符，即附点四分音符每分钟 64 拍（航行的律动）、
// 达德拉的一个 matra（八分音符）每分钟 192 下。
// - 引子：班苏里一声长呼，水碗的一串音像雨点落下来，坦布拉拨着萨与帕；
// - A（孟加拉的船歌 bhatiyali）：萨朗吉从高处唱下来、拖着长音与滑音（顺流而下的船夫的歌）：两次从 Ma 滑到摇着的 Re，多塔拉在唱腔的空当里弹一串短句，塔布拉打达德拉；
// - A′：班苏里接过来、到高音区，多塔拉低八度跟着（异音）；
// - B（喀拉拉的划船歌 vanchipattu）：一人领唱（萨朗吉，再一遍维纳琴）、众人应和（班苏里与维纳琴低八度齐奏），
//   琴达的左面在每一拍上“咚”、右面的木棍在后半拍上划，小钹一开一闭——桨一下一下地划；
// - A″：班苏里与萨朗吉齐奏（异音），尾声班苏里收在萨上，水碗再落一串雨。
// 印度音乐没有和声：底下只有坦布拉的萨与帕；和弦一律写空五度 E5，只给持续音与衬底找音（梅格的五个音与 E、B 都不成半音）。
import type { TrackDef } from "../score";

/** 一小节的 E5（空五度）重复 n 次。 */
const drone = (n: number) => Array.from({ length: n }, () => "E5").join(" | ");

export const SEA_INDIA: TrackDef = {
  id: "sea_india",
  title: { zh: "雨季的船歌", en: "Boat Songs of the Rains" },
  qpm: 96,
  meter: [6, 8],
  key: "E mixolydian",
  voices: {
    bansuri: { inst: "bansuri", gain: 0.56, pan: -0.12, reverb: 0.4 },
    sarangi: { inst: "sarangi", gain: 0.5, pan: 0.14, reverb: 0.38 },
    veena: { inst: "saraswati_veena", gain: 0.42, pan: 0.22, reverb: 0.32 },
    dotara: { inst: "dotara", gain: 0.42, pan: 0.28, reverb: 0.3 },
    jalt: { inst: "jaltarang", gain: 0.26, pan: 0.34, reverb: 0.46 },
    tanpura: { inst: "tanpura", gain: 0.34, pan: -0.26, reverb: 0.38, pattern: { kind: "arp", low: 52, steps: "5, . . 8 . . 8 . . 1 . .", ring: 3 } },
    // 塔布拉的达德拉：右手 Na Tin Na | Na Tin Na，左手在 Dha、Dhin、Dha 上。
    // 右手鼓一定调在萨上：这首的萨是 E，用调在 E4 的那只（tablaE.ts）；第一阶段调在 D4 的是 port_india（萨 = D）的
    tabla: { inst: "perc", gain: 0.28, pan: 0.1, reverb: 0.26, pattern: { kind: "drum", steps: "ninnin", hits: { n: ["tabla_e_na", 0.6], i: ["tabla_e_tin", 0.54] } } },
    bayan: { inst: "perc", gain: 0.28, pan: 0.02, reverb: 0.26, pattern: { kind: "drum", steps: "GG.G..", hits: { G: ["bayan_ge", 0.58] } } },
    // 划船歌：琴达的左面在拍上、右面的木棍在后半拍，小钹一开一闭
    che: { inst: "perc", gain: 0.34, pan: 0.24, reverb: 0.3, pattern: { kind: "drum", steps: "E..E..", hits: { E: ["chenda_edam", 0.62] } } },
    chv: { inst: "perc", gain: 0.3, pan: 0.32, reverb: 0.3, pattern: { kind: "drum", steps: "..vv.v", hits: { v: ["chenda_valam", 0.5] } } },
    talam: { inst: "perc", gain: 0.2, pan: -0.3, reverb: 0.32, pattern: { kind: "drum", steps: "C..c..", hits: { C: ["talam", 0.46], c: ["talam_chik", 0.4] } } },
    // 衬底（合成）：很轻的弦乐长音（E–B），大提琴组的低音萨
    pad: { inst: "strings", gain: 0.15, pan: -0.22, reverb: 0.44, pattern: { kind: "pad", low: 59, high: 76, size: 2 } },
    low: { inst: "celli", gain: 0.13, pan: 0.12, reverb: 0.3, pattern: { kind: "arp", low: 40, steps: "1 . . . . . . . . . . .", ring: 12 } },
  },
  sections: {
    // 引子：五（滑上来）· 七 | 平直的高萨——；水碗在第一小节的后半落下一串
    intro: { bars: 2, chords: drone(2), lines: { motif: "z3 !bend!B2 d | e6", drop: "z3 e/d/B/A/F/E/ | z6" } },
    // A：高萨 — 深揉的七 — | 五（从四滑上来）—— | 五 七 高萨 七 | 五 — 四 滑到摇着的二 —— | 二 四 五 — | 七 五 四 二 | 四 — 滑到摇着的二 —— | 萨（从低七滑上来）——
    A: {
      bars: 8,
      chords: drone(8),
      lines: {
        mel: "e3 !vib!d3 | !bend!B6 | B2 d e2 d | B2 (A !andolan-up!F3) | F2 A B3 | d2 B A2 F | (A3 !andolan-up!F3) | !bend!E6",
        // 多塔拉在长音的空当里弹一串短句
        fill: "z6 | z3 d e f | z6 | z3 B A F | z6 | z6 | z6 | z3 F A B",
      },
    },
    // A′：班苏里到高音区——高萨 高二 高四 高二 | 摇着的高二 高萨 七 | 七 高萨 高二 高萨 | 七（从五滑上来）五 | 四 五 七 高萨 七 | 五 四 五（滑上来）| 四 滑到摇着的二 —— | 萨——
    A2: { bars: 8, chords: drone(8), lines: { mel2: "e2 f a2 f | !andolan-up!f3 e2 d | d2 e f2 e | {B}d3 B3 | A B d e2 d | B2 A !bend!B3 | (A2 !andolan-up!F4) | E6" } },
    // B：领唱（row）两小节、应和（resp）两小节，两次
    B: {
      bars: 8,
      chords: drone(8),
      lines: {
        row: "B B B !bend!e3 | d3 B2 A | z6 | z6 | d d d !bend!f3 | e3 d B A | z6 | z6",
        resp: "z6 | z6 | B2 (A !andolan-up!F3) | E2 F !bend!B3 | z6 | z6 | B2 A F2 D | E6",
      },
    },
    // 尾声：五 四 滑到摇着的二 | 萨——（平直）
    outro: { bars: 2, chords: drone(2), lines: { tag: "B2 (A !andolan-up!F3) | E6", drop: "z6 | e/d/B/A/F/E/ z3" } },
  },
  forms: [
    [
      { s: "intro", play: "motif:bansuri drop:jalt+12 tanpura", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:sarangi fill:dotara tanpura tabla bayan low", dyn: 0.62 },
      { s: "A2", play: "mel2:bansuri mel2:dotara-12 tanpura tabla bayan pad low", dyn: 0.64 },
      { s: "B", play: "row:sarangi resp:bansuri resp:veena-12 tanpura che chv talam low", dyn: 0.68 },
      { s: "B", play: "row:veena resp:bansuri resp:sarangi tanpura che chv talam pad low", dyn: 0.7 },
      { s: "A", play: "mel:bansuri mel:sarangi fill:dotara tanpura tabla bayan pad low", dyn: 0.64 },
      { s: "outro", play: "tag:bansuri drop:jalt+12 tanpura", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:bansuri tanpura", dyn: 0.52, to: 0.6 },
      { s: "A2", play: "mel2:bansuri mel2:dotara-12 tanpura tabla bayan low", dyn: 0.62 },
      { s: "B", play: "row:sarangi resp:bansuri resp:veena-12 tanpura che chv talam low", dyn: 0.66 },
      { s: "A", play: "mel:sarangi fill:dotara tanpura tabla bayan pad low", dyn: 0.66 },
      { s: "B", play: "row:veena resp:bansuri resp:sarangi tanpura che chv talam pad low", dyn: 0.7 },
      { s: "outro", play: "tag:sarangi drop:jalt+12 tanpura", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
  level: 1.1,
};
