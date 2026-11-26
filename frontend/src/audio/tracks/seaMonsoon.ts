// 《季风之路》：阿拉伯海与印度洋（红海口、霍尔木兹、古吉拉特、马拉巴尔、锡兰、马尔代夫的海路；夏季西南、冬季东北的季风推着三角帆）。
// D 利底亚（升 G：比大调多一点“往外飘”的光，近于北印度晚上的耶曼调），4/4 拍（每分钟 84 拍），鼓按 3 + 3 + 2 分拍（咚 · · 卡 · · 嗒 ·），
// 宽、长、不急——一阵季风要吹好几个月。开头奈伊笛吹起全作的起帆动机（A → D → A）；A 段奈伊笛唱一条带倚音与滑音的长旋律，
// 升 C → E → 升 F、升 G 的进行是利底亚的味道；再来时乌德琴低八度跟着；
// B 段换到 D 混合利底亚（还原 C 与还原 G：季风转向了），竖拉提琴唱一段更热切的旋律。
// 地方特色第二阶段重编（旋律、段落与 3 + 3 + 2 不变）：这片海上来往的是阿拉伯与波斯的三角帆船——
// 奈伊笛、乌德琴换成地方乐器的新版（nay、ud），B 段的提琴换成波斯的卡曼恰，分解音换成波斯的桑图尔，
// 底下的持续音由真的坦布拉弹（“五 — 一 — 一 — 低一”，印度洋这一头的那层光），鼓换成达布卡，
// 后半由水手们按 3 + 3 + 2 拍手（平掌与空心掌），拍手的几段里鼓换成海湾采珠船歌“菲吉里”的一套——贾赫拉陶罐（掌拍罐口的“嗡”）与米尔瓦斯小鼓，
// 里克鼓的铜钹轻轻点在空拍上。
// 和声不再写西洋的三和弦（原来的弦乐和弦长音拿掉）：只有 D–A 的持续音，低音的拨奏跟着旋律的落脚点（D、A、E）走。
import type { TrackDef } from "../score";

/** 坦布拉的一轮（两小节：A3 — D4 — D4 — D3），铺满 bars 小节。 */
function tanpura(bars: number): string {
  return Array.from({ length: bars }, (_, i) => (i % 2 === 0 ? "A,4 D4" : "D4 D,4")).join(" | ");
}

export const SEA_MONSOON: TrackDef = {
  id: "sea_monsoon",
  title: { zh: "季风之路", en: "The Monsoon Road" },
  qpm: 84,
  meter: [4, 4],
  key: "D lydian",
  voices: {
    nay: { inst: "nay", gain: 0.62, pan: -0.12, reverb: 0.38 },
    ud: { inst: "ud", gain: 0.56, pan: 0.18, reverb: 0.26 },
    kamancheh: { inst: "kamancheh", gain: 0.5, pan: 0.12, reverb: 0.34 },
    santur: { inst: "santur", gain: 0.2, pan: 0.34, reverb: 0.36, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 12 8 12 8", ring: 2 } },
    tanpura: { inst: "tanpura", gain: 0.24, pan: -0.26, reverb: 0.36 },
    darb: {
      inst: "perc",
      gain: 0.26,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D..k..t.", hits: { D: ["darb_doum", 0.72], k: ["darb_ka", 0.36], t: ["darb_tek", 0.42] } },
        b: { kind: "drum", steps: "D.tD.tk.", hits: { D: ["darb_doum", 0.74], t: ["darb_tek", 0.42], k: ["darb_ka", 0.34] } },
      },
    },
    claps: { inst: "perc", gain: 0.2, pan: 0.28, reverb: 0.32, pattern: { kind: "drum", steps: "L..P..P.", hits: { L: ["tasfiq_low", 0.45], P: ["tasfiq", 0.38] } } },
    // 菲吉里：陶罐压在 3 + 3 + 2 的第一组与最后一组上，米尔瓦斯把每一组填满
    jahlah: { inst: "perc", gain: 0.28, pan: -0.06, reverb: 0.3, pattern: { kind: "drum", steps: "J..t..J.", hits: { J: ["jahlah", 0.74], t: ["jahlah_tak", 0.46] } } },
    mirwas: { inst: "perc", gain: 0.24, pan: 0.16, reverb: 0.24, pattern: { kind: "drum", steps: "D.TD.TT.", hits: { D: ["mirwas_dum", 0.66], T: ["mirwas_tak", 0.5] } } },
    riq: { inst: "perc", gain: 0.24, pan: -0.3, reverb: 0.22, pattern: { kind: "drum", steps: "..k..k.k", hits: { k: ["riq_ka", 0.3] } } },
    // 衬底（合成）：D–A 的持续音、拨奏的低音（3 + 3 + 2）
    drone: { inst: "drone", gain: 0.3, reverb: 0.3, pattern: { kind: "drone", notes: [38, 45] } },
    bass: { inst: "pizz", gain: 0.3, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . . 1 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: { motif: "z6 A3/2 d/2 | a6 z2", tp: tanpura(2) },
    },
    A: {
      bars: 8,
      // 旋律落在升 C 与升 G 上的两小节，低音换到 A 与 E
      chords: "D5 | D5 | D5 | D5 | D5 | A5 | E5 | A5",
      lines: {
        mel: "{G}F4 E D C D | E2 G2 A4 | B3 A G F E2 | E6 z2 | d3 c B2 A2 | c3 B A2 F2 | G3 A B2 !slide!e2 | e4 c4",
        tp: tanpura(8),
      },
    },
    A2: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | A5 | E5 | D5",
      lines: {
        mel2: "{G}F4 E D C D | E2 G2 A4 | B3 A G F E2 | E6 z2 | f3 e d2 c2 | c3 B A2 F2 | G3 A B2 G2 | A2 F2 D4",
        tp: tanpura(8),
      },
    },
    B: {
      bars: 8,
      // 混合利底亚：还原 C 与还原 G（季风转向了）
      chords: "D5 | D5 | D5 | D5 | D5 | D5 | A5 | A5",
      lines: {
        bmel: "e3 =g e2 =c2 | d3 e f2 a2 | =g3 a =g2 e2 | f6 z2 | =g3 f e2 d2 | e3 d B2 =G2 | A3 B d2 e2 | =g4 e4",
        tp: tanpura(8),
      },
    },
    outro: {
      bars: 2,
      chords: "D5 | D5",
      lines: { tag: "B3 A G2 E2 | F8", tp: tanpura(2) },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:nay tp:tanpura santur drone", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:nay tp:tanpura santur bass drone darb", dyn: 0.64 },
      { s: "A2", play: "mel2:nay mel2:ud-12 tp:tanpura santur bass drone darb riq", dyn: 0.66 },
      { s: "B", play: "bmel:kamancheh tp:tanpura santur bass jahlah mirwas claps riq", dyn: 0.68, to: 0.72 },
      { s: "A2", play: "mel2:nay mel2:ud-12 tp:tanpura santur bass drone darb claps riq", dyn: 0.7 },
      { s: "outro", play: "tag:nay tp:tanpura santur drone", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:nay tp:tanpura drone", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:ud tp:tanpura santur bass drone darb", dyn: 0.62 },
      { s: "B", play: "bmel:nay tp:tanpura santur bass darb.b riq", dyn: 0.66, to: 0.7 },
      { s: "B", play: "bmel:kamancheh bmel:ud-12 tp:tanpura santur bass jahlah mirwas claps riq", dyn: 0.7, to: 0.72 },
      { s: "A2", play: "mel2:nay mel2:ud-12 tp:tanpura santur bass drone darb claps riq", dyn: 0.7 },
      { s: "outro", play: "tag:kamancheh tp:tanpura santur drone", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
