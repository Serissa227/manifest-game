// 塔里框鼓（斯瓦希里海岸，带铃片的框鼓）：“嘭”加铃片的“嚓”，塔拉布与婚礼的歌里打拍子；鼓边是“嗒”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TARI: RegionalDef = {
  region: "swahili",
  name: { zh: "塔里框鼓", en: "Tari frame drum" },
  drums: {
    tari: { layers: [skin(150, 100, 0.02, 0.35, 1), hiss(4000, 11000, 0.12, 0.5, { taps: 4 })] },
    tari_tek: { layers: [skin(400, 380, 0.01, 0.08, 0.5), hiss(4000, 11000, 0.1, 0.6, { taps: 3 })] },
  },
  demo: { key: "C major", qpm: 108, bars: 3, drum: [{ steps: "T..t..t.T..t.tt.T..t..t.", hits: { T: ["tari", 0.9], t: ["tari_tek", 0.7] } }] },
};
