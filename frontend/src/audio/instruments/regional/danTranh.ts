// 檀筝（đàn tranh，大越的十六弦筝）：钢丝弦、戴着指套弹，起音细而亮、“铮”得比日本的筝与旧的古筝都更薄更脆；
// 左手在琴码左边按弦——“按”（nhấn，写 !bend!）把音推上去、“颤”（rung，写 !vib!）——是越南音乐里最要紧的味道。
import type { RegionalDef } from "./types";

export const DAN_TRANH: RegionalDef = {
  key: "dan_tranh",
  region: "vietnam",
  name: { zh: "檀筝（越南筝）", en: "Đàn tranh" },
  instrument: {
    kind: "pluck",
    // 钢丝：损耗小（damp 0.07）、拨在靠琴码处（pick 0.065），琴身小，共鸣在中高处
    spec: { t60: 2.6, tilt: 0.55, bright: 0.92, pick: 0.065, damp: 0.07, thump: 0.08, body: [[290, 1.2, 3], [1250, 1.4, 2], [3300, 1.2, 3.5]], lp: 11500, max: 4 },
    level: 0.87,
  },
  demo: { key: "C major", qpm: 80, bars: 3, abc: "c d f g a2 g f | !bend!g4 f d c2 | A, C D F !vib!G4" },
};
