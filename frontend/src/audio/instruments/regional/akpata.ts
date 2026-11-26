// 阿克帕塔（贝宁王国埃多人的弓琴，akpata）：一个长方的木箱上插着七根弯弓，每根弓上绷一根弦，木箱上开着音孔；
// 说书人（埃多人叫“阿克帕塔艺人”）晚上弹着它唱贝宁历代国王的故事——两只手拨出一圈固定的音型，一边弹一边唱。
// 与刚果的恩桑比是同一类（pluriarc），木箱大、弦绷得紧一些：比恩桑比亮、余音长，但没有科拉琴大葫芦与牛皮的“噗”，
// 声音是木头的、温的、带一点空箱子的“嗡”。
import type { RegionalDef } from "./types";

export const AKPATA: RegionalDef = {
  key: "akpata",
  region: "guinea",
  name: { zh: "阿克帕塔（埃多弓琴）", en: "Akpata (Edo bow lute)" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.7,
      tilt: 0.42,
      bright: 0.6,
      pick: 0.2,
      damp: 0.2,
      thump: 0.07,
      body: [[150, 1.1, 5], [420, 1.3, 3], [1500, 1.2, 1.5]],
      lp: 6500,
      max: 2.6,
    },
    level: 1.0,
  },
  // D 上的五声（D E G A C）：两手交替拨一圈，再唱一句从高处落下来的
  demo: { key: "D mixolydian", qpm: 100, bars: 4, abc: "D,2 A, D C A, E D | C,2 G, C D G, E C | A2 G E D E G A | c A G E D4" },
};
