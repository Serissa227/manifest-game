// 钟楼的排钟（佛兰德斯与尼德兰的 beiaard：梅赫伦、安特卫普、布鲁日的钟楼，整点前先奏一段 voorslag；英格兰教堂的鸣钟也是这种青铜钟）：
// 写的音高是听到的“打击音”（nominal）；底下有低一个八度的“主音”（prime）、低两个八度的“哼音”（hum，最长），
// 还有一眼就认得出的小三度（tierce，主音上方的小三度）——青铜钟那种又甜又酸的颜色；上方还有五度与八度的分音。
// 与原有的 carillon（以写的音为主音）不同：这里分音按打击音排，哼音更长、小三度更响，敲击声更重，像真的大钟。
import type { RegionalDef } from "./types";

export const BEIAARD: RegionalDef = {
  key: "beiaard",
  region: "north_europe",
  name: { zh: "钟楼排钟（佛兰德斯）", en: "Beiaard (Flemish carillon)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [
        [0.25, 0.32, 8],
        [0.5, 0.48, 5.5],
        [0.6, 0.6, 4.2],
        [0.75, 0.22, 3],
        [1, 1, 3.4],
        [1.25, 0.16, 1.6],
        [1.5, 0.28, 1.3],
        [2, 0.22, 0.9],
        [2.5, 0.08, 0.5],
      ],
      attack: 0.0015,
      strike: [0.3, 0.006, 5500],
      beat: 0.45,
      tilt: 0.35,
      max: 6.5,
    },
    level: 0.78,
    release: 2.5,
  },
  // 整点前的 voorslag：一串下行的快音，然后钟一下一下地敲
  demo: { key: "G major", qpm: 96, bars: 4, abc: "g/2d/2B/2d/2 g/2b/2a/2g/2 d'2 b2 | a/2g/2f/2e/2 d/2e/2f/2g/2 a2 d2 | g2 z2 d2 z2 | G4 z4" },
};
