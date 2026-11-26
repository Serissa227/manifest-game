// 《月港的市声》：明的港口（漳州月港、泉州、宁波、广州……白天码头边的市）。
// 地方特色第一阶段重编：地方乐器领奏（复古合成版的衬底用合成的拨奏低音）。
// G 徵调五声（G A C D E；有 C、没有 B），4/4（每分钟 112 拍），热闹、碎、亮，旋律用“鱼咬尾”（下一句从上一句的尾音起）：
// - 引子：锣鼓开场——板鼓领起，“匡 · 才 · 匡 · 才 · | 匡 才 匡 才 匡 · · ·”（大锣、铙钹、堂鼓），小锣“台”两声，梆笛在高处一声长呼；
// - A：梆笛高八度领奏（笛膜的沙、倚音与十六分音符的“花”），扬琴分解，木鱼一拍一下，小锣第二拍“台”，堂鼓、铙钹点板；
// - A′：二胡接过来，音与音之间滑着走（圆滑线、上滑音、揉弦）；
// - B：琵琶唱（长音是轮指的一串颗粒），扬琴与笙托着，锣鼓收小；
// - A″：唢呐领、梆笛高八度、二胡同奏（民间的“吹打”），锣鼓全上；尾声锣鼓收“匡 才 匡 · | 匡——”。
// 和声只用五声音里的挂留（G 挂二、C 挂二、A 挂四、D 挂四：笙的长音是四度、五度叠起来的），不写西洋的大小三和弦
// （10-11 东亚宫廷复核：原来的 C 六、A 小七被笙的三个音截成 C 大三、A 小三和弦，扬琴的“10”又弹出三音，改成挂留；旋律不动）。
import type { TrackDef } from "../score";

/** 一小节重复 n 次（| 隔开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

export const PORT_MING: TrackDef = {
  id: "port_ming",
  title: { zh: "月港的市声", en: "Market Voices of Yuegang" },
  qpm: 112,
  meter: [4, 4],
  key: "G mixolydian",
  voices: {
    dizi: { inst: "bangdi", gain: 0.42, pan: -0.14, reverb: 0.3 },
    erhu: { inst: "erhu", gain: 0.5, pan: 0.14, reverb: 0.3 },
    pipa: { inst: "pipa", gain: 0.5, pan: 0.24, reverb: 0.26 },
    xiao: { inst: "xiao", gain: 0.46, pan: -0.2, reverb: 0.38 },
    suona: { inst: "suona", gain: 0.4, pan: -0.04, reverb: 0.3 },
    yangqin: { inst: "yangqin", gain: 0.24, pan: 0.32, reverb: 0.3, pattern: { kind: "arp", low: 55, steps: "1 5 8 5 10 8 5 8", ring: 2 } },
    sheng: { inst: "sheng", gain: 0.22, pan: -0.26, reverb: 0.38, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    xiaoluo: { inst: "xiaoluo", gain: 0.2, pan: 0.28, reverb: 0.3 },
    daluo: { inst: "daluo", gain: 0.26, pan: -0.06, reverb: 0.4 },
    muyu: { inst: "perc", gain: 0.18, pan: -0.22, reverb: 0.26, pattern: { kind: "drum", steps: "w.w.w.w.", hits: { w: ["woodblock", 0.32] } } },
    bangu: {
      inst: "perc",
      gain: 0.2,
      pan: 0.12,
      reverb: 0.24,
      pattern: {
        intro: { kind: "drum", steps: "b.bbb.b.b.b.b...b.......b.......", hits: { b: ["bangu", 0.8] } },
        a: { kind: "drum", steps: "b.bb.b.b", hits: { b: ["bangu", 0.55] } },
      },
    },
    tanggu: {
      inst: "perc",
      gain: 0.3,
      pan: 0.04,
      reverb: 0.3,
      pattern: {
        intro: { kind: "drum", steps: "T...T...T.T.TTTT................", hits: { T: ["tanggu", 0.8] } },
        a: { kind: "drum", steps: "T...t.T.", hits: { T: ["tanggu", 0.7], t: ["tanggu", 0.4] } },
        full: { kind: "drum", steps: "T.tTT.tT", hits: { T: ["tanggu", 0.8], t: ["tanggu", 0.45] } },
        coda: { kind: "drum", steps: "T.T.T...T.......", hits: { T: ["tanggu", 0.9] } },
      },
    },
    bo: {
      inst: "perc",
      gain: 0.22,
      pan: 0.18,
      reverb: 0.32,
      pattern: {
        intro: { kind: "drum", steps: "..C...C..C.C....................", hits: { C: ["bo", 0.75] } },
        a: { kind: "drum", steps: "....c...", hits: { c: ["bo_mute", 0.6] } },
        full: { kind: "drum", steps: "..C...C.", hits: { C: ["bo", 0.6] } },
        coda: { kind: "drum", steps: ".C.C............", hits: { C: ["bo", 0.8] } },
      },
    },
    // 衬底（合成）：拨奏的低音
    bass: { inst: "pizz", gain: 0.3, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 43, steps: "1 . 5, . 1 . 5, .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Gsus2 | Gsus2 | Gsus2 | Gsus2",
      lines: {
        call: "z8 | z8 | !bend!a4 {b}a g e2 | d e g a !vib!g4",
        luo: "z8 | z8 | z2 f2 z2 f2 | z2 f2 z4",
        kuang: "G,2 z2 G,2 z2 | G, z G, z G,2 z2 | z8 | z8",
      },
    },
    A: {
      bars: 8,
      chords: "Gsus2 | Csus2 | Gsus2 | Asus4 | Dsus4 | Gsus2 | Csus2 | Gsus2",
      lines: {
        mel: "d2 e/2d/2c A2 c d | e2 {g}e d c2 A c | d4 c/2d/2c/2A/2 G2 | A2 G E D4 | D2 E G A2 c2 | d c A c d2 e2 | g/2e/2d/2e/2 d c A2 G E | G6 z2",
        // 二胡：同一条旋律，音与音之间滑着走
        hu: "(d2 e/2d/2c) A2 (c d) | !vib!e2 (e d) c2 (A c) | !vib!d4 (c/2d/2c/2A/2) G2 | !bend!A2 (G E) !vib!D4 | D2 (E G) A2 !bend!c2 | (d c A c) d2 !vib!e2 | (g/2e/2d/2e/2) (d c) A2 (G E) | !vib!G6 z2",
        luo: rep("z2 f2 z4", 8),
        kuang: "G,4 z4 | z8 | z8 | z8 | G,4 z4 | z8 | z8 | z8",
      },
    },
    B: {
      bars: 8,
      chords: "Csus2 | Csus2 | Asus4 | Gsus2 | Csus2 | Gsus2 | Dsus4 | Csus2",
      lines: { bmel: "c4 d2 e2 | g4 e2 d2 | c2 A2 c d e2 | d8 | e2 g2 a2 g e | d4 c2 A2 | G2 A c d2 e d | c6 z2" },
    },
    coda: {
      bars: 2,
      chords: "Gsus2 | Gsus2",
      lines: {
        end: "g2 z2 [G,DG]2 z2 | z8",
        kuang: "G,2 z G, G,2 z2 | G,4 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:dizi+12 luo:xiaoluo kuang:daluo bangu.intro tanggu.intro bo.intro", dyn: 0.7 },
      { s: "A", play: "mel:dizi+12 yangqin luo:xiaoluo kuang:daluo muyu bangu.a tanggu.a bo.a bass", dyn: 0.66 },
      { s: "A", play: "hu:erhu yangqin sheng luo:xiaoluo muyu tanggu.a bo.a bass", dyn: 0.68 },
      { s: "B", play: "bmel:pipa yangqin sheng muyu bass", dyn: 0.64 },
      { s: "A", play: "mel:suona mel:dizi+12 hu:erhu sheng luo:xiaoluo kuang:daluo muyu bangu.a tanggu.full bo.full bass", dyn: 0.72 },
      { s: "coda", play: "end:pipa kuang:daluo tanggu.coda bo.coda", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "hu:erhu yangqin muyu tanggu.a bass", dyn: 0.64 },
      { s: "B", play: "bmel:pipa bmel:xiao yangqin sheng muyu bass", dyn: 0.64 },
      { s: "A", play: "mel:suona mel:dizi+12 hu:erhu sheng luo:xiaoluo kuang:daluo muyu bangu.a tanggu.full bo.full bass", dyn: 0.72 },
      { s: "coda", play: "end:pipa kuang:daluo tanggu.coda bo.coda", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.16,
};
