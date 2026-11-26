// 肯当鼓（爪哇与马来的双面手鼓）：鼓手用它领着整个甘美兰——大面的“当”（dhang）低而圆、脚跟压着鼓皮的“咚”（dhung）音高往上滑，
// 小面的拍击“嗒”（tak）、空击“咚”（tung）、闷击“克”（ket）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KENDANG: RegionalDef = {
  region: "nusantara",
  name: { zh: "肯当鼓", en: "Kendang" },
  drums: {
    kendang_dhang: { layers: [skin(150, 105, 0.03, 0.45, 1, [[1.55, 0.2, 0.2]]), hiss(200, 1500, 0.02, 0.3)] },
    kendang_dhung: { layers: [skin(110, 160, 0.08, 0.35, 1), hiss(200, 1500, 0.02, 0.25)] },
    kendang_tak: { layers: [skin(650, 600, 0.01, 0.04, 0.5), hiss(1500, 7000, 0.03, 1)] },
    kendang_tung: { layers: [skin(360, 340, 0.01, 0.25, 0.9, [[1.6, 0.25, 0.12]]), hiss(1000, 4000, 0.01, 0.3)] },
    kendang_ket: { layers: [skin(420, 410, 0.01, 0.06, 0.6), hiss(1200, 5000, 0.015, 0.5)] },
  },
  demo: { key: "C major", qpm: 90, bars: 3, drum: [{ steps: "D.k.t.D.tkt.U.k.D.ktk.tD", hits: { D: ["kendang_dhang", 0.9], U: ["kendang_dhung", 0.85], k: ["kendang_tak", 0.7], t: ["kendang_tung", 0.75] } }] },
};
