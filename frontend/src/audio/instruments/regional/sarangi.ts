// 萨朗吉（北印度的弓弦乐器）：一整块木头挖成，琴面蒙羊皮，三根羊肠弦不按在指板上，而是用指甲根从侧面贴着弦滑——
// 所以音与音之间几乎都是滑过去的（滑音长），揉得深，声音最像人声，宫廷里给歌者伴奏、跟着唱腔走。
// 拉格里要“摇”的音（达尔巴里的降三、降六，梅格的二级）写 !andolan!：按 engine.ts 的 ANDOLAN 慢慢地摇（每秒一下半，从记谱音往下摆；
// 梅格的二级往上摆，写 !andolan-up!），
// 与同一句的鲁德拉维纳琴摇得一样；!vib! 是自己的深揉（快，给不是 andolan 的长音）。
// 琴身里另有三十多根钢丝的共鸣弦（tarab）：主弦拉到哪个音，对得上的几根就跟着“嗡”地亮起来，换音以后还响一会儿——萨朗吉身后那层光。
// 共鸣弦按常见的做法调成半音阶（C4–D5 每个半音一根，另加低处的萨与帕），什么拉格都对得上。
import type { SustainSpec } from "../../instruments";
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

/** 萨朗吉的弓弦与琴身；tarab 为共鸣弦的音高（MIDI）。 */
export function sarangiSpec(tarab: readonly number[]): SustainSpec {
  return {
    kind: "bowed",
    // 羊皮琴面的“哼”（520 Hz）、人声一样的第二共振峰（1.1 kHz）、亮的一层（2.7 kHz）
    amps: (n, f) => (1 / Math.pow(n, 0.72)) * (0.35 + bump(f, 520, 0.4, 0.7) + bump(f, 1100, 0.35, 0.9) + bump(f, 2700, 0.45, 0.55) + bump(f, 3700, 0.35, 0.25)) * roll(f, 6000, 3),
    attack: 0.08,
    release: 0.18,
    vib: { rate: 5.4, depth: 12, delay: 0.22 },
    vibBoost: 3,
    breath: { level: 0.012, q: 0.7, ratio: 6 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    chiff: 0.025,
    tongue: 0.78,
    glide: 0.13,
    drift: 5,
    sympathetic: { notes: tarab, level: 0.5, q: 260 },
    level: 0.36,
  };
}

/** 半音阶的共鸣弦：C4–D5 每个半音一根，加低处的 G3 与 C3。 */
export const SARANGI_TARAB: readonly number[] = [48, 55, ...Array.from({ length: 15 }, (_, i) => 60 + i)];

export const SARANGI: RegionalDef = {
  key: "sarangi",
  region: "india",
  name: { zh: "萨朗吉", en: "Sarangi" },
  instrument: sarangiSpec(SARANGI_TARAB),
  // 达尔巴里（萨 = C）：唱腔一样的一句，滑过去的连音、慢慢摇着的降三级与降六级（andolan）、句尾落下
  demo: { key: "C minor", qpm: 66, bars: 4, abc: "(C2 D2) !andolan!E4 | (F D) (C B,) !bend!C4 | G !andolan!A3 B2 (A G) | !fall!C8" },
};
