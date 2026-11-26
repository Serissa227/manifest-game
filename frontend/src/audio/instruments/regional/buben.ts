// 布本鼓（罗斯的 buben：带铃片的框鼓，说唱人与集市上的跳熊人敲它）：手掌打在皮上一声闷的“嘭”，铃片跟着“哗”一下；
// buben 是正击，buben_shake 是摇（铃片连响、皮几乎不响）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BUBEN: RegionalDef = {
  region: "north_europe",
  name: { zh: "布本鼓（铃鼓）", en: "Buben (frame drum with jingles)" },
  drums: {
    buben: { layers: [skin(190, 125, 0.02, 0.2, 0.8, [[1.6, 0.25, 0.08]], 0.0005), hiss(4500, 11000, 0.12, 0.65, { attack: 0.0015, taps: 3 })] },
    buben_shake: { layers: [hiss(4500, 11000, 0.16, 0.8, { attack: 0.02, taps: 5 }), skin(200, 150, 0.02, 0.05, 0.12, undefined, 0.002)] },
  },
  demo: { key: "C major", qpm: 120, bars: 4, drum: [{ steps: "B.s.B.sbB.s.BsB.", hits: { B: ["buben", 0.85], b: ["buben", 0.5], s: ["buben_shake", 0.55] } }] },
};
