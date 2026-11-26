// 本迪尔（北非与奥斯曼的大框鼓）：低的“嘭”，鼓皮下面绷着的羊肠响弦跟着“嗞——”；鼓边是“嗒”加响弦。苏菲的仪式与街头都用。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BENDIR: RegionalDef = {
  region: "ottoman",
  name: { zh: "本迪尔框鼓", en: "Bendir" },
  drums: {
    bendir: { layers: [skin(95, 70, 0.03, 0.5, 1), hiss(1500, 6000, 0.25, 0.35, { taps: 6 })] },
    bendir_tek: { layers: [skin(300, 280, 0.01, 0.08, 0.5), hiss(1500, 6000, 0.18, 0.4, { taps: 5 }), hiss(2500, 8000, 0.01, 0.4)] },
  },
  demo: { key: "C major", qpm: 92, bars: 3, drum: [{ steps: "B..b..t.B..b.tt.B..b..t.", hits: { B: ["bendir", 0.9], b: ["bendir", 0.5], t: ["bendir_tek", 0.7] } }] },
};
