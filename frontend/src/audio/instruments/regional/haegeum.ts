// 奚琴（해금，朝鲜）：两根丝弦夹在弓毛里，没有指板——左手只是把弦往里“拉”，音高全凭手感，所以音与音之间总是滑着走、
// 音准带一点游移（drift 大）；琴筒是竹根挖成、蒙木板（不是二胡的蟒皮），鼻音更“扁”、弓噪更沙。揉弦深（!vib!），
// 上滑写 !bend!、下滑写 !fall!，连音写圆滑线。宫廷乐与民间的乐队里都有。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const HAEGEUM: RegionalDef = {
  key: "haegeum",
  region: "korea",
  name: { zh: "奚琴（朝鲜）", en: "Haegeum" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.7)) * (0.35 + bump(f, 750, 0.4, 0.45) + bump(f, 1500, 0.45, 0.85) + bump(f, 2900, 0.45, 0.6)) * roll(f, 5000, 3),
    attack: 0.07,
    release: 0.12,
    vib: { rate: 5.4, depth: 18, delay: 0.2 },
    vibBoost: 2.6,
    breath: { level: 0.02, q: 0.6, ratio: 5 },
    pulse: { level: 0.13, q: 0.8, ratio: 3.5 },
    chiff: 0.045,
    tongue: 0.72,
    glide: 0.12,
    drift: 7,
    level: 0.37,
  },
  // 界面调：滑过去的连音、折音、深揉
  demo: { key: "A minor", qpm: 72, bars: 4, abc: "!bend!A3 c (d e3) | !vib!e4 (d c) (c B) | (A2 c2) !bend!d2 (c A) | A2 !vib!E4 z2" },
};
