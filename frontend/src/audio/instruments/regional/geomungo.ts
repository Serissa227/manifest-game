// 玄琴（거문고，朝鲜）：六根丝弦，右手握一根竹片（술대）往下“砸”，竹片同时打在琴面的皮垫（대모）上——“噔”的一声闷响跟着低沉、粗的弦音；
// 左手在很高的琴柱（괘）上按弦，揉得又深又慢（!vib!），推上去写 !bend!。士人的琴，低、重、刚，音少而有分量。
import type { RegionalDef } from "./types";

export const GEOMUNGO: RegionalDef = {
  key: "geomungo",
  region: "korea",
  name: { zh: "玄琴", en: "Geomungo" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.0,
      tilt: 0.45,
      bright: 0.6,
      pick: 0.13,
      damp: 0.32,
      thump: 0.22,
      // 竹片打在皮垫上
      skin: [165, 0.05, 0.55],
      body: [[95, 1.2, 5], [240, 1.3, 4], [700, 1.4, -3], [1800, 1.2, 1]],
      lp: 4200,
      max: 3.5,
    },
    level: 1.31,
    vib: { rate: 3.6, depth: 0.04, delay: 0.2 },
  },
  // 低音区的界面调：竹片砸下去、深揉、推声
  demo: { key: "A minor", qpm: 66, bars: 3, abc: "A,,2 E,2 A,2 C D | !vib!E,4 D,2 {D,}C,2 | !bend!E,2 D, C, A,, !vib!E,,3" },
};
