// 塔布拉（萨 = E）：右手鼓 dayan 一定调在曲子的萨上（偶尔调在帕或玛，从来不调在别的音上），所以塔布拉手随身带几只大小不同的右手鼓，
// 曲子的萨换了就换一只。第一阶段的塔布拉（tabla.ts）调在 D4，是《棉布与靛蓝的码头》（萨 = D）的；这一只小一号、调在 E4，
// 给萨 = E 的《雨季的船歌》（梅格）用。音色是同一种：鼓点从第一阶段的四种右手鼓点整体移上一个全音（shape.ts 的 retune：
// 鼓皮层的频率乘 2^(2/12)，泛音的频率比、衰减、噪声层不变），第一阶段的塔布拉一个采样也不变。
// 左手鼓 bayan 不跟着换（低音鼓不按萨定音，推音本来就滑来滑去），曲谱里照旧写 bayan_ge / bayan_go / bayan_ke。
// 鼓点：tabla_e_na（鼓边“叮”）、tabla_e_tin（空击）、tabla_e_tun（鼓心，基音 E4 长鸣）、tabla_e_te（闷击）。
import type { DrumSpec } from "../../dsp";
import { hz, retune } from "./shape";
import { TABLA } from "./tabla";
import type { RegionalDef } from "./types";

/** 从第一阶段的右手鼓（萨 D4）移到萨 E4：上移一个全音。 */
const RATIO = hz(64) / hz(62);

/** 第一阶段塔布拉的一种右手鼓点，移到 E4。 */
function dayan(name: string): DrumSpec {
  const spec = TABLA.drums?.[name];
  if (!spec) throw new Error(`第一阶段的塔布拉没有鼓点 ${name}`);
  return retune(spec, RATIO);
}

export const TABLA_E: RegionalDef = {
  region: "india",
  name: { zh: "塔布拉（萨 = E）", en: "Tabla (Sa = E)" },
  drums: {
    tabla_e_na: dayan("tabla_na"),
    tabla_e_tin: dayan("tabla_tin"),
    tabla_e_tun: dayan("tabla_tun"),
    tabla_e_te: dayan("tabla_te"),
  },
  // 达德拉（六拍：Dha Dhin Na | Dha Tin Na），四分音符每分钟 96 拍，与《雨季的船歌》相同；第二轮末尾闷击一下、鼓心长鸣一声萨
  demo: {
    key: "E mixolydian",
    qpm: 96,
    bars: 3,
    drum: [
      { steps: "ninninnin.tu", hits: { n: ["tabla_e_na", 0.8], i: ["tabla_e_tin", 0.75], t: ["tabla_e_te", 0.65], u: ["tabla_e_tun", 0.85] } },
      { steps: "GG.G..GG.G..", hits: { G: ["bayan_ge", 0.8] } },
    ],
  },
};
