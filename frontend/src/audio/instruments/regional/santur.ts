// 桑图尔（波斯）：梯形的木箱上七十二根钢弦，四根一组，用两支很轻的胡桃木小槌（mezrab）敲——光木头，不包毡，起音亮而硬；
// 没有制音器，一组四根略有音差的弦与旁边的弦一起长长地响，余音“沙沙”地闪（比印度的桑图尔更亮、更长、四弦的拍音更明显）。
// 长音是快速的轮奏（riz，写 !trem! 或够长的音自动轮奏）；波斯的“四击”（chaharmezrab）就是它在主音上快速往复的固定音型。
// 印度的 santoor 不动，两件并存。
import type { RegionalDef } from "./types";

export const SANTUR: RegionalDef = {
  key: "santur",
  region: "persia",
  name: { zh: "桑图尔（波斯）", en: "Santur" },
  instrument: {
    kind: "pluck",
    spec: { t60: 4.2, tilt: 0.4, bright: 0.95, pick: 0.06, damp: 0.055, course: 9, thump: 0.26, onset: 0.002, body: [[320, 1.2, 2], [1150, 1.4, 3], [3600, 1.2, 3]], lp: 11000, max: 4.2 },
    level: 0.9,
    tremolo: 0.45,
    tremRate: 13.5,
  },
  // 查哈尔加（koron 的二级与六级）：一串上行、四击的往复、轮奏的长音
  demo: { key: "C chahargah", qpm: 100, bars: 4, abc: "C D E F G A B c | G c B c A c G c | e d c B !trem!c4 | A G F E !trem!C4" },
};
