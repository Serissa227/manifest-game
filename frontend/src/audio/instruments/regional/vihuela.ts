// 维韦拉琴（vihuela de mano，文艺复兴的西班牙）：六组羊肠复弦，两根同度（不是八度）略有音差，平背、腰身像吉他而琴身更大；
// 用手指的肉拨（不是指甲，也不是拨片），音头软、带一点鼻音（1.2 kHz 一带），比鲁特琴亮、比后来的吉他余音短。
// 弹法：单音的“变奏”（diferencias：一串八分音符的经过句）、和弦的扫弦（rasgueado，写 strum 伴奏型）、句尾的倚音。
// 与原有的 guitar（尼龙弦吉他，经典世界在用）不同：复弦、羊肠、余音短、中频更“说话”。
import type { RegionalDef } from "./types";

export const VIHUELA: RegionalDef = {
  key: "vihuela",
  region: "iberia_italy",
  name: { zh: "维韦拉琴", en: "Vihuela" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.0,
      tilt: 0.45,
      bright: 0.68,
      pick: 0.17,
      damp: 0.21,
      course: 2.5,
      thump: 0.06,
      onset: 0.002,
      body: [[98, 1.6, 4], [205, 1.4, 4], [480, 1.3, 1.5], [1250, 1.2, 2.5], [2600, 1.1, 1], [4200, 1, -4]],
      lp: 7800,
      max: 3.5,
    },
    level: 0.92,
  },
  // G 小调：一句变奏（八分音符的经过句，句尾倚音），再扫两下和弦（罗曼内斯卡的 降B — F — g — D）
  demo: {
    key: "G minor",
    qpm: 96,
    bars: 4,
    abc: "d c B c d f e d | c B A G ^F A d2 | [B,DFB]2 [B,DFB] [B,DFB] [F,CFA]2 [F,CFA]2 | [G,DGB]2 [D,A,D^F]2 {A}G4",
  },
};
