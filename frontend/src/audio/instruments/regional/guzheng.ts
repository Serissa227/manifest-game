// 古筝（明的筝，十三到十五弦）：玳瑁的义甲拨在弦的右端，起音一声“铮”，比日本的筝亮、余音更长，桐木面板的共鸣在中频；
// 左手在雁柱左边按弦：上滑音（拨了再按上去）写 !bend!，颤音（吟）写 !vib!，句尾的下滑写 !fall!，刮奏用很快的一串音。
// 与旧的 zheng（经典世界的东方港口曲在用，不动）、日本的 koto 分开：这一件给明的茶楼、江上的夜船用（第九批 A01）。
import type { RegionalDef } from "./types";

export const GUZHENG: RegionalDef = {
  key: "guzheng",
  region: "ming",
  name: { zh: "古筝", en: "Guzheng" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 3.4,
      tilt: 0.55,
      bright: 0.86,
      pick: 0.1,
      damp: 0.14,
      thump: 0.08,
      body: [[220, 1.1, 3], [520, 1.3, 2], [1800, 1.4, 3], [3800, 1.1, 2]],
      lp: 9500,
      max: 5,
    },
    level: 0.88,
    // 吟：比提琴一类的揉弦慢、宽
    pluckVib: { rate: 5.2, depth: 0.022, delay: 0.08 },
  },
  // G 宫的五声（G A B D E）：刮奏上去、上滑音、吟、句尾落下
  demo: { key: "G major", qpm: 80, bars: 4, abc: "D/2E/2G/2A/2 B/2d/2e/2g/2 a4 | g2 e2 !bend!d4 | B2 A G !vib!E4 | D2 E G !vib!G4" },
};
