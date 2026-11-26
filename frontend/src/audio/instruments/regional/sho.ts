// 笙（日本雅乐的笙，shō）：十七根竹管里十五根有铜簧，含着吹、吸都响；声音细、高、透明，像从云上照下来的光。
// 雅乐里它一直奏“合竹”（aitake）——五六个音叠成的音簇（四度、五度夹着二度，旋律音在里面），换下一个合竹时手指一根根地移（手移り），
// 每口气末尾慢慢鼓起来。起音慢、没有揉音，管与管之间略有音差，音簇里互相轻轻地“拍”。
// 与明的笙（sheng：更亮、起音快、和弦）分开——那件奏三四个音的和弦，这件奏音簇。曲谱里把合竹写成 ABC 的和弦 [B e ^f a b e']。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const SHO: RegionalDef = {
  key: "sho",
  region: "japan",
  name: { zh: "笙（雅乐）", en: "Shō" },
  instrument: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 1.1)) * (0.5 + bump(f, 2200, 0.6, 0.5) + bump(f, 4300, 0.4, 0.12)) * roll(f, 5600, 3),
    attack: 0.6,
    release: 0.75,
    breath: { level: 0.004, q: 1.2, ratio: 3 },
    detune: 3,
    glide: 0.08,
    level: 0.23,
  },
  // 平调（E 上）的四个合竹：乞（E）、一（D）、工（B）、凡（A）一类的音簇，手移り之间不留空
  demo: { key: "E dorian", qpm: 60, bars: 3, abc: "[Be^fab]4 [Ade^fa]4 | [B^fab^c']4 [Ab^c'e'^f']4 | [Be^fabe']8" },
};
