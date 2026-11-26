// 《白海的北风》：寰宇世界最北的海路（挪威海、北角、巴伦支海与白海：卑尔根的鳕鱼干船、绕过北角去霍尔莫戈雷的英格兰商船、波莫尔人的小船）。
// 地方特色第二阶段（北欧）：经典世界《北风与白鲸》（seaNorth.ts）的旋律、和声与段落原样不动，换成北方的地方乐器来奏——
// 经典世界的那一首逐采样不变（它在经典世界的北方冷海上照旧），这一首只给寰宇世界的音乐分区用（zones.ts 的 arctic、white_sea……）。
// D 多利亚调式，6/8 拍（附点四分音符每分钟 56 拍），浪大而沉：
// - 引子：山羊角号在远处吹起帆动机（A → D → A），风笛的持续音管守着 D 与 A 的空五度（原曲就写着“像风笛”）；
// - A：尼克尔哈帕领那条带多利亚还原 B 的宽旋律，古斯里琴弹分解和弦（代替卡恩特勒琴），萨米人的框鼓在第一、四拍；
//   再奏时罗斯的小钟在每小节后半点一颗冰晶似的高音；
// - B：山羊角号吹号角式的旋律，尼克尔哈帕在高处拉长音；最后一遍古多克在低八度跟着尼克尔哈帕。
// 复古合成版的衬底：大提琴组一小节一个长音、人声“呜——”像北风。
import type { TrackDef } from "../score";
import { SEA_NORTH } from "./seaNorth";

const S = SEA_NORTH.sections;

export const SEA_ARCTIC: TrackDef = {
  id: "sea_arctic",
  title: { zh: "白海的北风", en: "North Wind over the White Sea" },
  qpm: SEA_NORTH.qpm,
  meter: SEA_NORTH.meter,
  key: SEA_NORTH.key,
  hall: true,
  voices: {
    // 地方乐器（两套编配共用）
    nyck: { inst: "nyckelharpa", gain: 0.56, pan: -0.14, reverb: 0.36 },
    horn: { inst: "bukkehorn", gain: 0.46, pan: 0.26, reverb: 0.56 },
    gudok: { inst: "gudok", gain: 0.36, pan: 0.18, reverb: 0.34 },
    gusli: { inst: "gusli", gain: 0.34, pan: 0.32, reverb: 0.36, pattern: { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 } },
    drones: { inst: "pipe_drone", gain: 0.36, pan: -0.06, reverb: 0.32, pattern: { kind: "drone", notes: [38, 45] } },
    bells: { inst: "kolokol", gain: 0.2, pan: 0.4, reverb: 0.6 },
    drum: { inst: "perc", gain: 0.46, pan: 0.05, reverb: 0.3, pattern: { kind: "drum", steps: "D..t..", hits: { D: ["bodhran", 0.55], t: ["tip", 0.3] } } },
    // 衬底（合成）
    celli: { inst: "celli", gain: 0.36, pan: 0.1, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "b . . . . ." } },
    choir: { inst: "choir", gain: 0.3, pan: -0.2, reverb: 0.6, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "motif:horn+12 drones choir celli", dyn: 0.46, to: 0.6 },
      { s: "A", play: "mel:nyck gusli drones celli drum", dyn: 0.62 },
      { s: "A", play: "mel2:nyck ice:bells gusli choir celli drum", dyn: 0.66 },
      { s: "B", play: "hmel:horn desc:nyck gusli choir celli drum", dyn: 0.64, to: 0.72 },
      { s: "A", play: "mel2:nyck mel:gudok-12 ice:bells gusli choir celli drones drum", dyn: 0.72 },
      { s: "outro", play: "tag:nyck gusli drones choir", dyn: 0.56, to: 0.36, rit: 0.8 },
    ],
    [
      { s: "intro", play: "motif:horn+12 drones gusli", dyn: 0.44, to: 0.56 },
      { s: "A", play: "mel:gudok gusli drones celli", dyn: 0.6 },
      { s: "A", play: "mel:nyck ice:bells gusli choir celli drum", dyn: 0.64 },
      { s: "B", play: "hmel:nyck gusli choir celli drum", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel2:nyck mel:gudok-12 ice:bells gusli choir celli drones drum", dyn: 0.72 },
      { s: "outro", play: "tag:nyck gusli drones", dyn: 0.54, to: 0.34, rit: 0.8 },
    ],
  ],
  rest: SEA_NORTH.rest,
  level: 0.95,
};
