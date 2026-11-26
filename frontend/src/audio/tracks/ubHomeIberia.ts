// 《白墙巷的午后》：养成篇·家乡的日常——伊比利亚（诺埃尔的塔里法；自创主角里塞维利亚、里斯本、毕尔巴鄂的家）。旋律原创。
// 午睡过后的白墙小巷：院子里的井、晾着的床单、海峡那边吹来的东风；屋里有人弹维韦拉琴，邻家的姑娘吹竖笛跟着。
// D 大调，3/4 拍（每分钟 100 拍），写成萨拉班德那样“二拍重”的步子（四分 + 附点四分 + 八分）：
// - 引子：维韦拉琴一个人分解和弦，中音竖笛吹养成篇的成长动机（A → D → E → 升F：5 → 1 → 2 → 3），落在属和弦上；
// - A：维韦拉琴唱主题（前半句停在 A 和弦上，B 先“倚”一下再落 A；后半句落回 D），维奥尔琴走低音；
// - A′：竖笛接过来，第六小节换成 C 大三和弦（混合利底亚的还原 C，伊比利亚民歌常有的颜色），维奥尔琴拉对位，维韦拉琴分解，阿杜菲方鼓轻轻地点；
// - B：转到 D 小调——低音一级级走下来（D → C → 降B → A，安达卢西亚的“哀歌”低音），第七小节的降 B → 升 C 是摩尔人留下的增二度；
// - 最后一遍 A′ 全体，维韦拉琴扫弦、响板很轻；尾声回到主音。
// 和声是文艺复兴的三和弦（这一带的音乐本来就是），不用属七与弗拉门戈。衬底（合成的弦乐长音与拨奏低音）很轻，管弦版换成真的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_IBERIA: TrackDef = {
  id: "ub_home_iberia",
  title: { zh: "白墙巷的午后" },
  qpm: 100,
  meter: [3, 4],
  key: "D major",
  voices: {
    vih: { inst: "vihuela", gain: 0.66, pan: -0.14, reverb: 0.3 },
    varp: {
      inst: "vihuela",
      gain: 0.24,
      pan: 0.24,
      reverb: 0.26,
      pattern: {
        a: { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 },
        b: { kind: "arp", low: 50, steps: "1 . 5 . 8 .", ring: 3 },
      },
    },
    vstrum: { inst: "vihuela", gain: 0.2, pan: 0.28, reverb: 0.24, pattern: { kind: "strum", low: 50, high: 69, steps: "D . u D . u" } },
    reca: { inst: "rec_alto", gain: 0.42, pan: 0.08, reverb: 0.34 },
    gamba: { inst: "gamba", gain: 0.4, pan: 0.2, reverb: 0.28 },
    adufe: {
      inst: "perc",
      gain: 0.3,
      pan: -0.26,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "A.T.t.", hits: { A: ["adufe", 0.5], T: ["adufe_tek", 0.4], t: ["adufe_tek", 0.24] } },
        s: { kind: "drum", steps: "a.....", hits: { a: ["adufe", 0.3] } },
      },
    },
    cast: { inst: "perc", gain: 0.3, pan: 0.32, reverb: 0.2, pattern: { kind: "drum", steps: "R...c.", hits: { R: ["castanet_roll", 0.36], c: ["castanet", 0.24] } } },
    // 衬底（合成）：很轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.12, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 69, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | G/D | D | A",
      lines: {
        arpi: "D,A,DFAd | D,B,DGBd | D,A,DFAd | A,EAc e2",
        // 成长动机：A → D → E → 升F
        mot: "z6 | z6 | A2 d2 e2 | f4 e2",
      },
    },
    A: {
      bars: 8,
      chords: "D | G | D | A | Bm | G | Em*3 A*3 | D",
      lines: {
        mel: "F2 A3 G | B2 d3 c | d3 c B A | B2 A4 | d2 B3 F | G2 B3 d | e2 d c B A | d4 z2",
        abass: "D,4 F,2 | G,4 E,2 | F,4 D,2 | A,,2 C,2 E,2 | B,,4 D,2 | G,,4 B,,2 | E,3 A,,3 | D,6",
      },
    },
    A2: {
      bars: 8,
      // 第六小节换成还原 C 的 C 大三和弦
      chords: "D | G | D | A | Bm | C | Em*3 A*3 | D",
      lines: {
        mel2: "F2 A3 G | B2 d3 c | d3 c B A | B2 A4 | d2 B3 F | =c2 e3 d | e2 d c B A | d4 z2",
        cnt: "D,4 F,2 | G,4 E,2 | F,4 D,2 | A,,2 C,2 E,2 | B,,4 D,2 | =C,4 E,2 | E,3 A,,3 | D,6",
      },
    },
    B: {
      bars: 8,
      chords: "Dm | C | Bb | A | Dm | Gm | Bb*3 A*3 | A",
      lines: {
        // D 小调：句句往下落；第七小节 降B → 升C 的增二度
        bm: "=f3 e d2 | e3 d =c2 | d3 =c _B2 | c2 A4 | A2 d2 =f2 | g3 =f e d | d2 _B2 ^c2 | c4 A2",
        // 安达卢西亚的“哀歌”低音：D → C → 降B → A
        bb: "D,6 | =C,6 | _B,,6 | A,,6 | D,6 | G,,6 | _B,,3 A,,3 | A,,6",
      },
    },
    coda: {
      bars: 4,
      chords: "D | G | A | D",
      lines: {
        end: "F2 A3 G | B2 d3 B | e3 c3 | d6",
        endb: "D,6 | G,,6 | A,,6 | D,6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "arpi:vih mot:reca pad", dyn: 0.5, to: 0.58 },
      { s: "A", play: "mel:vih abass:gamba pad", dyn: 0.6 },
      { s: "A2", play: "mel2:reca cnt:gamba varp.a adufe.s pz", dyn: 0.62 },
      { s: "B", play: "bm:reca bb:gamba varp.b pad", dyn: 0.6 },
      { s: "B", play: "bm:gamba-12 bb:pz varp.a adufe.s pad", dyn: 0.6, to: 0.64 },
      { s: "A2", play: "mel2:reca mel2:vih cnt:gamba vstrum cast adufe.a pz", dyn: 0.68 },
      { s: "coda", play: "end:reca endb:gamba varp.b pad", dyn: 0.6, to: 0.42, rit: 0.82 },
    ],
    [
      { s: "A", play: "mel:reca abass:gamba varp.b pad", dyn: 0.58 },
      { s: "A2", play: "mel2:vih cnt:gamba adufe.s pz", dyn: 0.6 },
      { s: "B", play: "bm:vih bb:gamba pad", dyn: 0.6 },
      { s: "B", play: "bm:reca bb:gamba varp.a adufe.s pad", dyn: 0.62 },
      { s: "A2", play: "mel2:reca mel2:vih cnt:gamba vstrum cast adufe.a pz", dyn: 0.68 },
      { s: "coda", play: "end:vih endb:gamba pad", dyn: 0.58, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
