// 萨拉斯瓦蒂维纳琴（南印度，卡纳提克音乐的“琴中之后”）：波罗蜜木挖成的大琴腹、颈端一只葫芦，四根钢弦在铜片包着的弧形琴桥上——
// 比西塔琴的 jawari 平，只“嗡”一点点（叫 jeevan，“琴的命”）；食指与中指戴金属指甲拨，起音清亮，余音长而圆。
// 品是用蜂蜡粘的，左手把弦往旁边推（不是换品）就能把音推高——卡纳提克的 gamaka 全靠它：
// 从低一个全音处推上来（jaru、odukkal）写 !bend!（只放在低一个全音也在拉格里的音上），句尾往下落写 !fall!；
// 在音与上邻音之间来回摆（kampita）写 !vib!：从记谱音往上推、松回记谱音，不往下沉（pluckVib 的 lift 为 1），每秒四下，最高推上去约 90 音分。
// kampita 只放在会动的音上（汉萨德瓦尼的三级 Ga、七级 Ni），萨与帕是固定音（prakriti），保持平直。
// 琴侧另有三根“节拍弦”（tala 弦），小指在拍点上扫一下萨—帕—萨：曲谱里另写一个声部（同一件乐器）。
import type { RegionalDef } from "./types";

export const SARASWATI_VEENA: RegionalDef = {
  key: "saraswati_veena",
  region: "india",
  name: { zh: "萨拉斯瓦蒂维纳琴", en: "Saraswati Veena" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 4.2,
      tilt: 0.45,
      bright: 0.66,
      pick: 0.11,
      damp: 0.16,
      thump: 0.07,
      onset: 0.0025,
      // 弧形的铜片琴桥：碰得比西塔琴轻（门限高、量小），余音里的高次谐波比没有桥嗡时留得久得多，又不像西塔琴那么“嗞”
      buzz: { at: 0.48, level: 5.5, hp: 1500 },
      // 波罗蜜木的大琴腹（120 Hz 一带的“胸”）、颈端葫芦（260 Hz）、钢弦的亮（2.6 kHz）
      body: [[120, 1.1, 4], [260, 1.3, 3], [700, 1.4, 1.5], [2600, 1.2, 2]],
      lp: 8500,
      max: 5,
    },
    level: 0.82,
    // kampita：从记谱音往上摆到上邻音一带（中心偏上 depth，摆动 ±depth：0 到约 +90 音分），宽而慢
    pluckVib: { rate: 4.2, depth: 0.026, delay: 0.07, lift: 1 },
  },
  // 汉萨德瓦尼（E 升F 升G B 升D：没有四级与六级的五声，明亮、吉祥，音乐会开场的拉格）：
  // 推上来的三级、七级上的 kampita、平直的高萨，三级的 kampita，推上来的二级 · 摇着的三级 · 二级落回萨
  demo: { key: "E major", qpm: 72, bars: 4, abc: "E2 F !bend!G B2 !vib!d2 | e4 d B G2 | F G B2 !vib!G4 | !bend!F2 !vib!G2 !fall!F4" },
};
