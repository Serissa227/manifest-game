// 科拉琴（西非曼丁的格里奥，竖琴式的琉特）：二十一根弦分两排立在高高的琴码上，琴码顶在一个蒙牛皮的大葫芦上；
// 两只拇指拨低音、两只食指拨高音——“昆本戈”（kumbengo）是一圈圈转的伴奏型，“比里明廷戈”（birimintingo）是插进来的快速走句。
// 声音像竖琴但更“弹”：起音有一点皮面的“噗”，大葫芦给出很低的共鸣，高音清亮、余音中长。
import type { RegionalDef } from "./types";

export const KORA: RegionalDef = {
  key: "kora",
  region: "guinea",
  name: { zh: "科拉琴", en: "Kora" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.4,
      tilt: 0.5,
      bright: 0.7,
      pick: 0.16,
      damp: 0.16,
      thump: 0.05,
      skin: [160, 0.08, 0.16],
      body: [[140, 1.1, 5], [520, 1.3, 2], [2400, 1.2, 3.5], [4200, 1.3, 1.5]],
      lp: 9500,
      max: 3.5,
    },
    level: 1.08,
  },
  // 哈尔迪诺（G 大调一类）上的昆本戈：拇指的低音与食指的高音交替，最后一串比里明廷戈落下来
  demo: {
    key: "G major",
    qpm: 96,
    bars: 4,
    abc: "G,/2d/2 B/2g/2 D/2d/2 B/2g/2 C/2c/2 A/2e/2 D/2d/2 A/2^f/2 | G,/2d/2 B/2g/2 D/2d/2 B/2g/2 C/2c/2 A/2e/2 D/2d/2 A/2^f/2 | g/2^f/2e/2d/2 B/2A/2G/2A/2 B/2d/2e/2d/2 B/2A/2G/2E/2 | [G,DG]8",
  },
};
