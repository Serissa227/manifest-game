// 特波纳兹特利（阿兹特克的裂缝木鼓）：一段挖空的硬木横放在架上，顶上刻出 H 形的两片舌头，两片舌头两个音（多半隔小三度或大二度）；
// 用包着橡胶（olli）的一对槌敲——起音软，木头的“空”响圆而短，比屯库尔（玛雅，木槌）更暗、更软，敲下去音高往下一沉（橡胶头压着舌头）。
// 祭歌与舞的鼓点用音节来记、来教：“to”是低的舌头、“ti”是高的舌头，“co”“qui”是跟着的轻的一下（toco、tiquiti）。
import type { RegionalDef } from "./types";

export const TEPONAZTLI: RegionalDef = {
  key: "teponaztli",
  region: "mexica",
  name: { zh: "特波纳兹特利", en: "Teponaztli (slit drum)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 0.62], [2.32, 0.16, 0.14], [3.9, 0.06, 0.06], [6.27, 0.025, 0.03]],
      attack: 0.0035,
      strike: [0.12, 0.008, 700],
      tilt: 0.25,
      glide: { from: 1.025, time: 0.025 },
      max: 1.4,
    },
    level: 0.94,
  },
  // 低舌 D、高舌 F（小三度）：to co · ti qui ti · · ，再一遍，最后两下
  demo: { key: "D minor", qpm: 100, bars: 3, abc: "D,2 D, F, F, F, z2 | D,2 D, F, F, F, z2 | D, z F, z D, F, D,2" },
};
