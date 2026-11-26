// 口弦（女真、满洲与黑龙江一带的赫哲、鄂温克都有；阿伊努人叫 mukkuri）：铁或竹的簧片衔在嘴前，手指一弹“嘣——”，
// 簧片总在同一个低音上嗡（这里是 G2），嘴的形状把它的某一个泛音放大——旋律就是被挑出来的泛音，所以只奏得出 G2 的整数倍：
// G4（4 倍）、B4（5）、D5（6）、F5（7，偏低的“自然七度”）、G5（8）、A5（9）、B5（10）、D6（12）。曲谱里只写这几个音，弹得密，像马跑。
import type { RegionalDef } from "./types";

export const MUKUN: RegionalDef = {
  // 键名只是标识符：早先误当成满语的口弦名（满语 mukūn 是“穆昆”，氏族、宗族），为了不动曲谱与测试留着
  key: "mukun",
  region: "jurchen",
  name: { zh: "口弦", en: "Jaw harp (kouxian)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 1]],
      attack: 0.003,
      // 手指弹簧片的一下
      strike: [0.12, 0.004, 4000],
      drone: { hz: 98, count: 40, width: 0.09, gain: 1.5, floor: 0.35, t60: 1.2, tilt: 0.75, sweep: 0.8 },
      max: 1.6,
    },
    level: 0.94,
    release: 0.15,
  },
  // 一句马跑一样的泛音旋律
  demo: { key: "G mixolydian", qpm: 104, bars: 4, abc: "G B d G B d g a | g2 f d2 B G2 | G B d g f d B d | G2 d2 G4" },
};
