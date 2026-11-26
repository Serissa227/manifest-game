// 《闽海长风》：明的沿海（东海、台湾海峡与南海北部；泉州、漳州月港、宁波双屿、广州的福船与鸟船）。
// 地方特色第二阶段重编（东亚宫廷）：地方乐器领奏，旋律与段落照旧（复古合成版的衬底用合成的拨奏低音）；和声改成五声的挂留（见下）。
// D 商调五声（D E G A C），4/4 拍（每分钟 96 拍），是船工的号子：
// - 引子：一声大锣，扬琴一串商调的刮奏，曲笛吹起全作的起帆动机（A → D → A），堂鼓起来；
// - A：曲笛领唱两小节，水手们答两小节（二胡与笙齐奏“嘿——哟，嘿哟——”，笙的簧像一船人一起吼），
//   堂鼓一下下催着摇橹（咚 · · · 咚 · 咚 ·），拍板敲在摇橹的空拍上；再来时琵琶低八度跟着领唱；
// - B：开到外海——换成闽南的南音（上四管：洞箫、二弦、琵琶、三弦，加拍板）：洞箫拉长了唱（带上滑与揉音），琵琶低八度弹同一条旋律，
//   三弦跟着琵琶走骨干（点挑的同音反复），四件各奏各的花、合在同一条旋律上（支声），拍板只打每小节的“板”（强拍）；
//   南音没有和声，也没有鼓：这一段不用笙、扬琴的分解与堂鼓（上四管只有拍板），只留很轻的拨奏低音；第二次二胡（代二弦）与琵琶接过来；
//   南音是细乐，这一段比号子轻（力度 0.5–0.54，号子 0.64–0.74），最后一遍号子锣鼓一齐回来才是全曲最响的地方；
// - 最后再来一遍号子，锣、鼓一齐，尾声箫吹完最后一句，大锣收。
// 和声只用五声音阶里的音搭成的空五度与挂留（D 挂四、D 挂二、C 挂二、G 挂二、A 挂四：笙的和音是四度、五度叠起来的），
// 扬琴的分解只走根音、五度、八度与挂留音——不写西洋的大小三和弦（10-11 复核：原来的 C 六、A 小七被笙的三个音截成 C 大三、A 小三和弦，改掉）。
import type { TrackDef } from "../score";

export const SEA_MING: TrackDef = {
  id: "sea_ming",
  title: { zh: "闽海长风", en: "Long Winds of the Min Sea" },
  qpm: 96,
  meter: [4, 4],
  key: "D dorian",
  // 整体音量（10-11 复核）：南音段改轻（力度 0.5–0.54）以后整首轻了约 1 dB，1.23 → 1.33（两套编配一起改）
  level: 1.33,
  voices: {
    qudi: { inst: "qudi", gain: 0.5, pan: -0.12, reverb: 0.34 },
    xiao: { inst: "xiao", gain: 0.52, pan: -0.18, reverb: 0.4 },
    erhu: { inst: "erhu", gain: 0.44, pan: 0.14, reverb: 0.32 },
    chorus: { inst: "sheng", gain: 0.2, pan: -0.06, reverb: 0.36 },
    pipa: { inst: "pipa", gain: 0.42, pan: 0.24, reverb: 0.3 },
    // 南音的三弦：坐在琵琶旁边
    sanxian: { inst: "sanxian", gain: 0.4, pan: 0.36, reverb: 0.3 },
    yq: { inst: "yangqin", gain: 0.34, pan: 0.3, reverb: 0.36 },
    arp: { inst: "yangqin", gain: 0.2, pan: 0.32, reverb: 0.36, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 10 8 5 8", ring: 2 } },
    sheng: { inst: "sheng", gain: 0.18, pan: -0.24, reverb: 0.38, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    gong: { inst: "daluo", gain: 0.24, pan: 0.1, reverb: 0.55 },
    drum: {
      inst: "perc",
      gain: 0.26,
      pan: 0.06,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "T...T.t.", hits: { T: ["tanggu", 0.72], t: ["tanggu", 0.4] } },
        b: { kind: "drum", steps: "T.t.T.tt", hits: { T: ["tanggu", 0.76], t: ["tanggu", 0.42] } },
        soft: { kind: "drum", steps: "T.......t.......", hits: { T: ["tanggu", 0.5], t: ["tanggu", 0.3] } },
      },
    },
    clap: {
      inst: "perc",
      gain: 0.22,
      pan: -0.22,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "..c...c.", hits: { c: ["paiban", 0.6] } },
        // 南音的“板”：只打每小节的强拍
        ban: { kind: "drum", steps: "c.......", hits: { c: ["paiban", 0.7] } },
      },
    },
    // 衬底（合成）：拨奏的低音
    bass: { inst: "pizz", gain: 0.32, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . 5, . 1 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | Dsus4 | D5",
      lines: {
        gong: "G,8 | z8 | z8 | z8",
        // 扬琴的商调刮奏
        gliss: "D/4E/4G/4A/4c/4d/4e/4g/4 z6 | z8 | z8 | z8",
        motif: "z8 | z6 A3/2 d/2 | !vib!a6 z2 | z8",
      },
    },
    A: {
      bars: 8,
      chords: "Dsus4 | Csus2 | Dsus2 | D5 | Gsus2 | Asus4 | Csus2 | D5",
      lines: {
        // 领唱两小节、水手答两小节
        call: "A2 c2 d2 c A | G3 A G E D2 | z8 | z8 | d2 e2 d c A2 | c3 d c A G2 | z8 | z8",
        // 曲笛的领唱：倚音与上滑
        lead: "A2 {d}c2 d2 c A | !bend!G3 A G E D2 | z8 | z8 | d2 {g}e2 d c A2 | !bend!c3 d c A G2 | z8 | z8",
        // 水手们的应答：二胡与笙（二胡最低是 D4，第二句从 D 起），音与音之间滑着走
        hucrew: "z8 | z8 | (D2 D E) !bend!G2 E2 | !vib!D6 z2 | z8 | z8 | D2 E D E2 G2 | !vib!D6 z2",
        gong: "G,8 | z8 | z8 | z8 | z8 | z8 | z8 | z8",
      },
    },
    B: {
      bars: 8,
      chords: "Asus4 | Csus2 | Dsus2 | Asus4 | Csus2 | Gsus2 | Asus4 | Dsus4",
      lines: {
        // 开到外海：拉长了唱
        bmel: "e4 {g}e2 d2 | c4 A2 G2 | !slide!A6 G E | G2 A2 c4 | e4 g2 e2 | d4 c2 A2 | c3 d c A G2 | A4 D4",
        // 洞箫：同一条旋律，上滑与揉音
        xbmel: "!bend!e4 {g}e2 d2 | !vib!c4 A2 G2 | !bend!A6 G E | G2 A2 !vib!c4 | !bend!e4 g2 e2 | !vib!d4 c2 A2 | c3 d c A G2 | !vib!A4 D4",
        // 三弦：同一条旋律的骨干，长音拆成点挑的同音反复（南音里三弦紧跟琵琶）
        gu: "e2 e e e2 d2 | c2 c c A2 G2 | A2 A A A2 G E | G2 A2 c2 c c | e2 e e g2 e2 | d2 d d c2 A2 | c2 d c A2 G2 | A2 A A D4",
      },
    },
    outro: {
      bars: 4,
      chords: "Csus2 | Dsus4 | D5 | D5",
      lines: { tag: "!bend!e4 d2 c2 | A4 G4 | !vib!D8 | z8", gong: "z8 | z8 | G,8 | z8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gong:gong gliss:yq motif:qudi sheng drum.soft", dyn: 0.56, to: 0.64 },
      { s: "A", play: "lead:qudi hucrew:erhu hucrew:chorus arp bass drum clap", dyn: 0.66 },
      { s: "A", play: "lead:qudi call:pipa-12 hucrew:erhu hucrew:chorus gong:gong arp bass drum clap", dyn: 0.7 },
      { s: "B", play: "xbmel:xiao bmel:pipa-12 gu:sanxian-12 bass clap.ban", dyn: 0.5, to: 0.54 },
      { s: "B", play: "xbmel:erhu bmel:pipa gu:sanxian-12 bass clap.ban", dyn: 0.54 },
      { s: "A", play: "lead:qudi call:pipa-12 hucrew:erhu hucrew:chorus gong:gong arp bass drum.b clap", dyn: 0.74 },
      { s: "outro", play: "tag:xiao gong:gong sheng arp bass", dyn: 0.62, to: 0.42, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gong:gong gliss:yq sheng", dyn: 0.54, to: 0.62 },
      { s: "A", play: "call:pipa hucrew:erhu arp bass drum", dyn: 0.64 },
      { s: "B", play: "xbmel:xiao bmel:pipa-12 gu:sanxian-12 bass clap.ban", dyn: 0.5, to: 0.54 },
      { s: "A", play: "lead:qudi hucrew:erhu hucrew:chorus gong:gong arp bass drum clap", dyn: 0.7 },
      { s: "A", play: "lead:qudi call:pipa-12 hucrew:erhu hucrew:chorus gong:gong arp bass drum.b clap", dyn: 0.74 },
      { s: "outro", play: "tag:xiao gong:gong sheng arp bass", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
