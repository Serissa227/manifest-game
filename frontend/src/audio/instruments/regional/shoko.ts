// 钲鼓（日本雅乐，shōko）：吊在框里的小铜碟，两根角头的槌敲碟子的里面，“钦”地一声，亮而硬、分音不协和，余音一秒左右；
// 雅乐里敲在节拍上，单击“カ”或左右一快一慢的“カチ”。比祭囃子的当钲（atarigane）重、响得久。旋律行里写一个固定的音（e'' 一带）。
import type { RegionalDef } from "./types";

export const SHOKO: RegionalDef = {
  key: "shoko",
  region: "japan",
  name: { zh: "钲鼓", en: "Shōko" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 0.9], [1.48, 0.5, 0.6], [2.12, 0.55, 0.5], [2.9, 0.35, 0.35], [3.9, 0.25, 0.25], [5.2, 0.12, 0.15]],
      attack: 0.0006,
      strike: [0.6, 0.0025, 10000],
      beat: 4,
      tilt: 0.1,
      max: 1.4,
    },
    level: 0.36,
    release: 0.4,
  },
  // カ · · · カチ · · · | カ · カ · カチ · · ·
  demo: { key: "C major", qpm: 60, bars: 3, abc: "e'2 z2 e'/2e'3/2 z2 | e' z e' z e'/2e'3/2 z2 | e'2 z6" },
};
