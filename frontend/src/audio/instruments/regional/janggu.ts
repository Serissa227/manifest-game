// 杖鼓（장구，朝鲜）：沙漏形的鼓身，两面鼓皮各打各的——
// 左面（북편）用手掌或圆头的槌（궁채）打，低、圆、带鼓身的“嗡”，口诀念“쿵”（kung）；
// 右面（채편）绷得很紧，用一根细竹片（열채）打，脆、亮的“덕”（deok）；轻轻带一下的是“기”（gi），竹片抖着连打是“더러러러”；
// 两面一起打是“덩”（deong）。长短（장단，节奏的循环）都由它说了算：굿거리、중모리、자진모리、세마치……
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 左面：低、圆，音高往下沉一点，鼓身的低频共鸣 */
const KUNG = [skin(120, 92, 0.03, 0.55, 1, [[1.58, 0.35, 0.3], [2.1, 0.2, 0.2]], 0.0006), hiss(150, 800, 0.05, 0.25)] as const;
/** 右面：竹片打在绷紧的皮上 */
const DEOK = [skin(520, 480, 0.006, 0.12, 0.7, [[1.6, 0.35, 0.06], [2.3, 0.25, 0.04]], 0.0004), hiss(1800, 8000, 0.018, 0.75, { attack: 0.0008 })] as const;

export const JANGGU: RegionalDef = {
  region: "korea",
  name: { zh: "杖鼓（朝鲜）", en: "Janggu" },
  drums: {
    janggu_kung: { layers: KUNG },
    janggu_deok: { layers: DEOK },
    janggu_gi: { layers: [skin(540, 500, 0.006, 0.06, 0.5, undefined, 0.0004), hiss(2200, 8000, 0.01, 0.5, { attack: 0.0008 })] },
    janggu_deong: { layers: [...KUNG, skin(520, 480, 0.006, 0.1, 0.8, [[1.6, 0.3, 0.05]], 0.0004), hiss(1800, 8000, 0.018, 0.95, { attack: 0.0008 })] },
  },
  // 굿거리（12/8 的四拍）：덩 · 기덕 | 쿵 더러러러 | 쿵 · 기덕 | 쿵 더러러러（每格十六分音符，两轮）
  demo: {
    key: "C major",
    qpm: 100,
    bars: 3,
    drum: [{ grid: 0.5, steps: "D...gkK.drrrK...gkK.drrr", hits: { D: ["janggu_deong", 0.9], g: ["janggu_gi", 0.45], k: ["janggu_deok", 0.7], K: ["janggu_kung", 0.75], d: ["janggu_deok", 0.55], r: ["janggu_gi", 0.4] } }],
  },
};
