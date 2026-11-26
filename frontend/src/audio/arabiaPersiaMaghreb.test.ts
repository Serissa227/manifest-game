// 地方特色第二阶段·阿拉伯、波斯、马格里布的曲子：三首新港口曲（《乳香与咖啡的码头》《霍尔木兹的丝毯》《萨累的海门》）
// 与重编的四首（《爱资哈尔的长廊》《卡拉维因的芦笛》《航路的长诗》《季风之路》）——
// 领奏都是地方乐器、衬底很轻；和声只有空五度；拉斯特与查哈尔加的四分之一音真的奏出来；萨马伊·塔基勒（10/8）、马克苏姆、萨伊迪、
// 波斯的阿瓦兹与四击、格纳瓦与安达卢斯努巴的节奏都在；港口风格的对应；经典世界的曲子与港口曲一个不变；
// 经典世界的配乐逐采样不变（曲谱、展开结果、原有乐器与鼓点合成出来的采样，与改动之前记下的指纹比）；重编的四首旋律行一个音没改。
import { describe, expect, it } from "vitest";
import { styleOf, townStyleOf } from "../art/buildings";
import { drum, mallet, pluck, type PluckSpec } from "./dsp";
import { lineOf, patternOf, realizePass, seedOf, unitSeconds, chordsOf, barUnits, type TrackDef } from "./score";
import { CORE_DRUMS, CORE_INSTRUMENTS, INSTRUMENTS } from "./instruments";
import { REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { isOrchestral } from "./orchestra/instruments";
import { ORCH_JINGLES, ORCH_TRACKS } from "./orchestra/tracks";
import { parseKey } from "./theory";
import { TRACKS, type TrackId } from "./tracks";
import { CUE_IDS, JINGLES } from "./tracks/jingles";
import { MUSIC_ZONE_TRACK, PORT_SEA_TRACK, PORT_STYLE_TRACK, portTrackIn, portTrackOf, ZONE_TRACK } from "./zones";
import { TERRA16_FACTIONS, TERRA16_PLACES, TERRA16_REGIONS, terra16PortTrack } from "../test/terra16";

const NEW: readonly TrackId[] = ["port_arabia", "port_persia", "port_maghreb"];
const REDONE: readonly TrackId[] = ["ac_azhar", "ac_fez", "ac_ship", "sea_monsoon"];
const MINE: readonly TrackId[] = [...NEW, ...REDONE];
const NEW_KEYS = ["mizmar", "simsimiyya", "santur", "tar", "setar", "kamancheh", "rabab", "gimbri"];
const NEW_HIT = /^(riq_|tabl_|tasfiq|mirwas_|jahlah|tombak_|daf_|gimbri_|qraqeb)/;

/** 曲式里“旋律行:声部”用到的声部。 */
function melodicVoices(t: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const form of t.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) {
    const m = /^(\w+):(\w+)/.exec(tok);
    if (m) out.add(m[2]);
  }
  return out;
}

/** 某段在第 pass 遍里的起点（秒）与它在曲式里的序号。 */
function stepStart(t: TrackDef, pass: number, section: string): { t: number; index: number } {
  const p = realizePass(t, pass);
  const form = t.forms[pass];
  const index = form.findIndex((s) => s.s === section);
  return { t: p.steps[index].t, index };
}

describe("领奏是地方乐器，衬底很轻", () => {
  for (const id of MINE) {
    it(`${id}：旋律行只交给地方乐器；不是地方乐器、也不是打击乐的声部（合成的持续音、拨奏低音）都很轻`, () => {
      const t = TRACKS[id];
      for (const v of melodicVoices(t)) expect(Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, t.voices[v].inst), `${id} 的 ${v}（${t.voices[v].inst}）`).toBe(true);
      for (const [name, v] of Object.entries(t.voices)) {
        if (v.inst === "perc" || Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, v.inst)) continue;
        expect(v.gain ?? 0.5, `${id} 的衬底 ${name}`).toBeLessThanOrEqual(0.32);
      }
      // 管弦版：管弦的声部只做衬底（音量都很小）
      const o = ORCH_TRACKS[id];
      for (const [name, v] of Object.entries(o.voices)) if (isOrchestral(v.inst)) expect(v.gain ?? 0.5, `${id} 管弦版的 ${name}`).toBeLessThanOrEqual(0.24);
    });

    it(`${id}：和声不写西洋的三和弦——每一段的和弦都是空五度（没有三音）`, () => {
      const t = TRACKS[id];
      const bar = barUnits(t.meter);
      for (const [name, sec] of Object.entries(t.sections)) for (const span of chordsOf(sec, bar)) expect(span.chord.third, `${id} ${name} 的 ${span.chord.symbol}`).toBeNull();
    });
  }

  it("新的地方乐器都用上了", () => {
    const used = new Set<string>();
    const hits = new Set<string>();
    for (const id of MINE) for (const v of Object.values(TRACKS[id].voices)) {
      used.add(v.inst);
      const variants = v.pattern && !("kind" in v.pattern) ? Object.values(v.pattern) : v.pattern ? [v.pattern] : [];
      for (const p of variants) if (p.kind === "drum") for (const [h] of Object.values(p.hits)) hits.add(h);
    }
    for (const k of NEW_KEYS) expect(used.has(k), k).toBe(true);
    for (const h of ["riq_dum", "riq_tak", "riq_ka", "riq_sak", "tabl_dum", "tabl_tak", "tasfiq", "tasfiq_low", "mirwas_dum", "mirwas_tak", "jahlah", "jahlah_tak", "tombak_tom", "tombak_bak", "tombak_riz", "tombak_pelang", "daf_dum", "daf_tak", "daf_ring", "gimbri_slap", "qraqeb", "qraqeb_shut"]) expect(hits.has(h), h).toBe(true);
  });
});

describe("木卡姆、达斯特加与节奏型", () => {
  it("《乳香与咖啡的码头》在 C 拉斯特上：中立的三度与七度（四分之一音）真的奏出来；下行也借降 B", () => {
    const t = TRACKS.port_arabia;
    expect(parseKey(t.key).mode).toBe("rast");
    const ms = realizePass(t, 0).events.filter((e) => !e.hit).map((e) => e.m);
    expect(ms.some((m) => Math.abs((m % 12) - 3.5) < 1e-9)).toBe(true);
    expect(ms.some((m) => Math.abs((m % 12) - 10.5) < 1e-9)).toBe(true);
    expect(ms.some((m) => Math.abs((m % 12) - 10) < 1e-9)).toBe(true);
  });

  it("萨马伊·塔基勒：那一段是 10 的整数倍个八分音符；鼓与低音按 10 个一轮（咚 · · 嗒 · 咚 咚 嗒 · ·）；旋律在每一轮的第一拍起音", () => {
    const t = TRACKS.port_arabia;
    const sec = t.sections.samai;
    expect((sec.bars * barUnits(t.meter)) % 10).toBe(0);
    const darb = patternOf(t.voices.darb, "samai")!;
    expect(darb.kind === "drum" && darb.steps).toBe("D..T.DDT..");
    const riq = patternOf(t.voices.riq, "samai")!;
    expect(riq.kind === "drum" && riq.steps.length).toBe(10);
    const bass = patternOf(t.voices.bass, "samai")!;
    expect(bass.kind === "arp" && bass.steps.split(/\s+/).length).toBe(10);
    // 展开后：达布卡的“咚”落在每轮的 0、5、6，“嗒”落在 3、7
    const { t: t0, index } = stepStart(t, 0, "samai");
    expect(t.forms[0][index].tempo ?? 1).toBe(1);
    const unit = unitSeconds(t.qpm);
    const len = sec.bars * barUnits(t.meter) * unit;
    const darbHits = realizePass(t, 0).events.filter((e) => e.voice === "darb" && e.t >= t0 - 0.02 && e.t < t0 + len - 0.02);
    expect(darbHits.length).toBe(8 * 5);
    for (const e of darbHits) {
      const u = Math.round((e.t - t0) / unit) % 10;
      expect(e.hit === "darb_doum" ? [0, 5, 6] : [3, 7]).toContain(u);
    }
    // 旋律：八轮，每轮第一拍（0、10、……、70）都有音起
    const onsets = new Set(lineOf(t, "samai", "sm").notes.map((n) => n.at));
    for (let c = 0; c < 8; c++) expect(onsets.has(c * 10), `第 ${c + 1} 轮`).toBe(true);
  });

  it("海湾的一段（第二遍）：西姆西米亚琴领奏、乌德琴低八度；米尔瓦斯与陶罐按 3 + 3 + 2 打（“咚”只落在每组的头上：0、3、6），拍手在组尾", () => {
    const t = TRACKS.port_arabia;
    expect(t.forms[0].some((st) => st.s === "khaliji")).toBe(false);
    const st = t.forms[1].find((x) => x.s === "khaliji")!;
    expect(st.play.split(/\s+/)).toEqual(expect.arrayContaining(["kh:simsimiyya", "kh:ud-12", "mirwas", "jahlah"]));
    const mir = patternOf(t.voices.mirwas)!;
    const jah = patternOf(t.voices.jahlah)!;
    if (mir.kind !== "drum" || jah.kind !== "drum") throw new Error("鼓点");
    for (const [i, ch] of [...mir.steps].entries()) if (ch === "D") expect([0, 8]).toContain(i);
    for (const [i, ch] of [...jah.steps].entries()) if (ch === "J") expect([0, 3, 6]).toContain(i % 8);
    const claps = patternOf(t.voices.claps, "khaliji")!;
    if (claps.kind !== "drum") throw new Error("拍手");
    for (const [i, ch] of [...claps.steps].entries()) if (ch !== ".") expect([2, 5, 7]).toContain(i % 8);
    // 旋律：每小节的第 0、3、6 个八分音符都有音起（3 + 3 + 2 的组头）
    const onsets = new Set(lineOf(t, "khaliji", "kh").notes.map((n) => n.at));
    for (let b = 0; b < 8; b++) for (const k of [0, 3, 6]) expect(onsets.has(b * 8 + k), `第 ${b + 1} 小节的第 ${k} 个八分音符`).toBe(true);
  });

  it("红海与海湾的音色进了重编的曲子：《航路的长诗》第二遍由西姆西米亚琴领奏；《季风之路》拍手的几段里换成陶罐与米尔瓦斯（菲吉里）", () => {
    const ship = TRACKS.ac_ship;
    expect(ship.forms[1].some((st) => st.play.split(/\s+/).includes("mel:simsimiyya"))).toBe(true);
    const monsoon = TRACKS.sea_monsoon;
    for (const form of monsoon.forms) for (const st of form) {
      const voices = st.play.split(/\s+/);
      if (st.s === "B" && voices.includes("claps")) expect(voices).toEqual(expect.arrayContaining(["jahlah", "mirwas"]));
    }
  });

  it("马克苏姆（咚 嗒 · 嗒 咚 · 嗒 ·）与萨伊迪（咚 嗒 · 咚 咚 · 嗒 ·）", () => {
    const m = patternOf(TRACKS.port_arabia.voices.darb, "maqsum")!;
    expect(m.kind === "drum" && m.steps.slice(0, 8)).toBe("DT.TD.T.");
    const s = patternOf(TRACKS.port_arabia.voices.tabl)!;
    expect(s.kind === "drum" && s.steps.slice(0, 8)).toBe("DT.DD.T.");
    const ship = patternOf(TRACKS.ac_ship.voices.darb)!;
    expect(ship.kind === "drum" && ship.steps.slice(0, 8)).toBe("DT.TD.T.");
  });

  it("《霍尔木兹的丝毯》在 C 查哈尔加上（koron 的 D 与 A 真的奏出来），6/8；阿瓦兹放慢、不打鼓，四击加快、桑图尔的旋律音与持续音 G 一下一下交替", () => {
    const t = TRACKS.port_persia;
    expect(parseKey(t.key).mode).toBe("chahargah");
    expect(t.meter).toEqual([6, 8]);
    const ms = realizePass(t, 0).events.filter((e) => !e.hit).map((e) => e.m);
    expect(ms.some((m) => Math.abs((m % 12) - 1.5) < 1e-9)).toBe(true);
    expect(ms.some((m) => Math.abs((m % 12) - 8.5) < 1e-9)).toBe(true);
    for (const form of t.forms) {
      for (const st of form) {
        const voices = st.play.split(/\s+/).map((tok) => tok.replace(/^\w+:/, "").replace(/[.+~-].*$/, ""));
        if (st.s === "avaz") {
          expect(st.tempo ?? 1).toBeLessThan(1);
          for (const v of voices) expect(t.voices[v].inst, `阿瓦兹里的 ${v}`).not.toBe("perc");
        }
        if (st.s === "chahar") expect(st.tempo ?? 1).toBeGreaterThan(1);
      }
    }
    const ch = lineOf(t, "chahar", "ch").notes;
    // 前七小节：奇数位的音都是持续音 G4（第八小节收在 c 上）
    for (let i = 1; i < 7 * 6; i += 2) expect(ch[i].pitches[0], `第 ${i} 个音`).toBe(67);
  });

  it("《萨累的海门》：6/8；格纳瓦的两段只有金布里琴、拍皮、卡拉卡布与拍手（管弦版里也没有管弦）；努巴的鼓一小节像 3/4、一小节像 6/8", () => {
    const t = TRACKS.port_maghreb;
    expect(t.meter).toEqual([6, 8]);
    for (const tt of [t, ORCH_TRACKS.port_maghreb]) {
      for (const form of tt.forms) for (const st of form) {
        if (!st.s.startsWith("gnawa") && st.s !== "intro") continue;
        const voices = st.play.split(/\s+/).map((tok) => tok.replace(/^\w+:/, "").replace(/[.+~-].*$/, ""));
        for (const v of voices) expect(["gimbri", "gslap", "qraqeb", "claps"], `${tt === t ? "合成版" : "管弦版"} ${st.s} 的 ${v}`).toContain(v);
        expect(voices).toContain("gimbri");
      }
    }
    const darb = patternOf(t.voices.darb, "nuba")!;
    expect(darb.kind === "drum" && darb.steps).toBe("D.T.T.D..T.k");
    const q = patternOf(t.voices.qraqeb, "a")!;
    expect(q.kind === "drum" && q.steps.slice(0, 6)).toBe("K.sK.s");
    // 金布里琴的固定低音在小五声（D F G A C）上
    const pcs = new Set(lineOf(t, "gnawa", "riff").notes.map((n) => ((n.pitches[0] % 12) + 12) % 12));
    for (const p of pcs) expect([2, 5, 7, 9, 0]).toContain(p);
  });
});

describe("港口风格 → 港口曲（第二阶段）", () => {
  it("阿拉伯与马穆鲁克 → 《乳香与咖啡的码头》，波斯 → 《霍尔木兹的丝毯》，马格里布 → 《萨累的海门》", () => {
    expect(portTrackOf("x", "arabic")).toBe("port_arabia");
    expect(portTrackOf("x", "mamluk")).toBe("port_arabia");
    expect(portTrackOf("x", "persian")).toBe("port_persia");
    expect(portTrackOf("x", "maghreb")).toBe("port_maghreb");
    for (const id of Object.values(PORT_STYLE_TRACK)) expect(TRACKS[id], id).toBeTruthy();
  });

  it("街景照旧借沙漠（只换港口曲，不换画）；没有专属曲的细名照旧回退到沙漠的港口曲", () => {
    for (const s of ["arabic", "mamluk", "persian", "maghreb"]) {
      expect(townStyleOf("x", s), s).toBe("desert");
      expect(styleOf("x", s), s).toBe("desert");
    }
    // 整合后埃塞俄比亚有了自己的港口曲（非洲一支，原来回退到沙漠，见 DECISIONS“测试期望值变更”）；街景照旧借沙漠
    expect(portTrackOf("x", "ethiopian")).toBe("port_ethiopia");
    expect(townStyleOf("x", "ethiopian")).toBe("desert");
  });

  it("经典世界照旧：经典的势力、粗分的建筑风格、七种地域的航海曲、海区分区的航海曲都不变", () => {
    expect(portTrackOf("cuilan", null)).toBe("port_mediterranean");
    expect(portTrackOf("yaohua", null)).toBe("port_eastern");
    expect(portTrackOf("chisha", undefined)).toBe("port_desert");
    expect(portTrackOf("x", "desert")).toBe("port_desert");
    expect(ZONE_TRACK).toEqual({ inner: "sea", north: "sea_north", south: "sea_south", islands: "sea_islands", eastern: "sea_east", newworld: "sea_new", ocean: "ocean" });
    // 整合后红海归《星与三角帆》（奥斯曼与黎凡特一支，原来是 sea_levant，见 DECISIONS“测试期望值变更”）
    expect(MUSIC_ZONE_TRACK.red_sea).toBe("sea_arabic");
    expect(MUSIC_ZONE_TRACK.arabian_sea).toBe("sea_monsoon");
  });
});

// 寰宇世界（data/worlds/terra16）与经典世界、测试世界的真实数据：港口曲按势力写的风格名与停泊海区的 music 对应
// （配乐的数据接线以后，2026-10-11：寰宇的势力写 persian、maghreb、ottoman_maghreb；原来按势力 key、地点 key 认的两张表删了）。
const CLASSIC_TOML: Record<string, string> = {
  ...import.meta.glob<string>("../../../data/factions.toml", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../../data/world/{ports,cities,overseas}.toml", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../../data/worlds/testbed/{ports,cities,sites}.toml", { query: "?raw", import: "default", eager: true }),
};

interface TomlRow {
  key: string;
  faction?: string;
  style?: string;
}

/** 粗读 TOML 的 [[表]]：每一块只取行首的 key、faction、style（字符串值）。 */
function tomlRows(files: Record<string, string>, table: string): TomlRow[] {
  const out: TomlRow[] = [];
  for (const text of Object.values(files)) {
    for (const chunk of text.replace(/\r\n/g, "\n").split(/^\[\[/m).slice(1)) {
      if (!chunk.startsWith(`${table}]]`)) continue;
      const field = (name: string) => new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m").exec(chunk)?.[1];
      const key = field("key");
      if (key) out.push({ key, faction: field("faction"), style: field("style") });
    }
  }
  return out;
}

const TERRA_FACTIONS = new Map(TERRA16_FACTIONS.map((f) => [f.key, f]));
/** 寰宇里这个地点停泊的海区写的 music（城市没有）。 */
const musicAt = (place: string): string | null => {
  const p = TERRA16_PLACES.find((x) => x.key === place);
  return p?.region === null || p?.region === undefined ? null : TERRA16_REGIONS[p.region].music;
};

describe("寰宇世界的真实势力与地点 → 港口曲（地方特色第二阶段）", () => {
  it("读到了数据：寰宇的势力与港口、城市都在", () => {
    expect(TERRA_FACTIONS.size).toBeGreaterThan(50);
    expect(TERRA16_PLACES.length).toBeGreaterThan(150);
  });

  it("这些势力在数据里写的风格名：波斯 persian、马格里布 maghreb、奥斯曼治下的马格里布 ottoman_maghreb；按风格名放三首新曲", () => {
    // 配乐的数据接线（2026-10-11）：原来萨法维、霍尔木兹、摩洛哥、哈夫斯写 desert，阿尔及尔、的黎波里写 ottoman，由前端按势力 key 认；
    // 现在数据写细名，选曲只看风格名（见 DECISIONS“测试期望值变更”）
    const want: Record<string, string> = { safavid: "persian", hormuz: "persian", morocco: "maghreb", hafsid: "maghreb", adal: "desert", algiers: "ottoman_maghreb", tripoli: "ottoman_maghreb", ottoman: "ottoman" };
    for (const [k, style] of Object.entries(want)) expect(TERRA_FACTIONS.get(k)?.style, k).toBe(style);
    // 用真实的势力 key 与风格名
    expect(portTrackOf("safavid", "persian")).toBe("port_persia");
    expect(portTrackOf("hormuz", "persian")).toBe("port_persia");
    expect(portTrackOf("morocco", "maghreb")).toBe("port_maghreb");
    expect(portTrackOf("hafsid", "maghreb")).toBe("port_maghreb");
    expect(portTrackOf("algiers", "ottoman_maghreb")).toBe("port_maghreb");
    expect(portTrackOf("tripoli", "ottoman_maghreb")).toBe("port_maghreb");
    // 阿尔及尔、的黎波里的街景照旧画奥斯曼（只换港口曲，不换画）
    expect(townStyleOf("algiers", "ottoman_maghreb")).toBe("ottoman");
    // 阿达尔写 desert：按风格是沙漠的一首，停在亚丁湾时换成阿拉伯的（下一项）
    expect(portTrackOf("adal", "desert")).toBe("port_desert");
    // 奥斯曼本部、克里米亚与桑海（desert）、葡萄牙（portuguese）
    expect(portTrackOf("ottoman", "ottoman")).toBe("port_ottoman");
    expect(portTrackOf("crimea", "desert")).toBe("port_desert");
    expect(portTrackOf("songhai", "desert")).toBe("port_desert");
    expect(portTrackOf("portugal", "portuguese")).toBe("port_iberia");
    // 不认势力 key：写原来的 desert 就是沙漠的一首
    expect(portTrackOf("safavid", "desert")).toBe("port_desert");
    expect(portTrackOf("x", "arabian")).toBe("port_arabia");
  });

  it("阿拉伯的海（红海、亚丁湾、波斯湾、阿拉伯海：music 写 arabic 一类）上奥斯曼、伊比利亚与沙漠风格的港口放《乳香与咖啡的码头》；别的风格与别的海照旧", () => {
    for (const music of ["arabic", "red_sea", "aden", "persian_gulf", "Arabic", " red-sea "]) {
      expect(portTrackIn("ottoman", "ottoman", music), music).toBe("port_arabia");
      expect(portTrackIn("portugal", "portuguese", music), music).toBe("port_arabia");
      expect(portTrackIn("adal", "desert", music), music).toBe("port_arabia");
      // 波斯风格的霍尔木兹岛、埃塞俄比亚的马萨瓦、威尼斯照旧
      expect(portTrackIn("hormuz", "persian", music), music).toBe("port_persia");
      expect(portTrackIn("ethiopia", "ethiopian", music), music).toBe("port_ethiopia");
      expect(portTrackIn("venice", "venetian", music), music).toBe("port_italy");
    }
    for (const music of [null, undefined, "", "levant", "mediterranean", "indian", "arabian_sea", "sea_arabic"]) {
      expect(portTrackIn("ottoman", "ottoman", music), `${music}`).toBe("port_ottoman");
      expect(portTrackIn("portugal", "portuguese", music), `${music}`).toBe("port_iberia");
    }
    expect(PORT_SEA_TRACK.arabic.port_ottoman).toBe("port_arabia");
  });

  it("停在寰宇世界的真实地点：汉志、也门、巴士拉与马斯喀特、泽拉 → 阿拉伯；霍尔木兹王国与伊斯法罕 → 波斯；摩洛哥、突尼斯、阿尔及尔、的黎波里 → 马格里布", () => {
    // 配乐的数据接线（2026-10-11）：原来按地点 key（PORT_PLACE_TRACK）认的十一处里，停在阿拉伯的海上的六处照旧是阿拉伯的一首；
    // 开罗（内陆城市）、亚历山大（停在黎凡特海）随奥斯曼放《金角湾的集市》，佐法尔、尤尔法、巴林随霍尔木兹王国放《霍尔木兹的丝毯》；
    // 贝鲁特：B5b 把黎凡特海区的东界修到 36°，锚地不再落进阿拉伯海，按奥斯曼的文化与势力放奥斯曼的一首（见 DECISIONS“测试期望值变更”）
    const want: Record<string, TrackId> = {
      suez: "port_arabia",
      jeddah: "port_arabia",
      mocha: "port_arabia",
      aden: "port_arabia",
      basra: "port_arabia",
      muscat: "port_arabia",
      zeila: "port_arabia",
      beirut: "port_ottoman",
      hormuz_port: "port_persia",
      dhofar: "port_persia",
      julfar: "port_persia",
      bahrain: "port_persia",
      isfahan: "port_persia",
      sale: "port_maghreb",
      tetouan: "port_maghreb",
      fez: "port_maghreb",
      tunis: "port_maghreb",
      algiers: "port_maghreb",
      tripoli_port: "port_maghreb",
      // 奥斯曼本部、埃及与两河
      istanbul: "port_ottoman",
      smyrna: "port_ottoman",
      rhodes: "port_ottoman",
      cairo: "port_ottoman",
      alexandria: "port_ottoman",
      aleppo: "port_ottoman",
      baghdad: "port_ottoman",
      // 伊比利亚人在马格里布的驻防城
      tangier: "port_iberia",
      ceuta: "port_iberia",
      mazagan: "port_iberia",
      oran: "port_iberia",
    };
    for (const [place, track] of Object.entries(want)) expect(terra16PortTrack(place), place).toBe(track);
    // 停泊的海：红海、亚丁湾、波斯湾、阿拉伯海写的都是 arabic
    for (const place of ["suez", "jeddah", "mocha", "aden", "basra", "muscat", "zeila", "hormuz_port", "dhofar"]) expect(musicAt(place), place).toBe("arabic");
    expect(musicAt("alexandria")).toBe("levant");
    expect(musicAt("cairo")).toBeNull();
  });

  it("三首新港口曲在寰宇世界里都有地方放；写这三种风格名的势力，它的城都放对应的曲子", () => {
    // 寰宇数据还在写，有几个地点的势力（timucua、innu……）还没有势力条目，跳过它们（与这一支无关）
    const known = TERRA16_PLACES.filter((p) => TERRA_FACTIONS.has(p.faction));
    expect(known.length).toBeGreaterThan(150);
    const heard = new Set(known.map((p) => terra16PortTrack(p.key)));
    for (const id of NEW) expect(heard.has(id), id).toBe(true);
    for (const p of known) {
      const style = TERRA_FACTIONS.get(p.faction)?.style ?? null;
      if (style !== null && Object.prototype.hasOwnProperty.call(PORT_STYLE_TRACK, style) && NEW.includes(PORT_STYLE_TRACK[style])) {
        expect(terra16PortTrack(p.key), p.key).toBe(PORT_STYLE_TRACK[style]);
      }
    }
  });

  it("经典世界与测试世界照旧：停在哪里都只按势力的风格（经典的海区不写 music）", () => {
    const factions = tomlRows(CLASSIC_TOML, "factions");
    const places = [...tomlRows(CLASSIC_TOML, "ports"), ...tomlRows(CLASSIC_TOML, "cities"), ...tomlRows(CLASSIC_TOML, "sites")];
    expect(factions.map((f) => f.key)).toEqual(["cuilan", "jinsui", "chisha", "bichao", "shuangling", "yaohua"]);
    expect(places.length).toBeGreaterThan(30);
    for (const p of places) {
      const f = factions.find((x) => x.key === p.faction);
      expect(portTrackIn(f?.key, f?.style ?? null, undefined), p.key).toBe(portTrackOf(f?.key, f?.style ?? null));
    }
    // 经典的六个势力：港口曲与第九批之前一样（七种粗分风格的那几首）
    expect(factions.map((f) => portTrackOf(f.key, f.style ?? null))).toEqual(["port_mediterranean", "port_lowland", "port_desert", "port_islands", "port_nordic", "port_eastern"]);
  });
});

describe("经典世界的曲子一个不变", () => {
  const CLASSIC: readonly TrackId[] = ["title", "sea", "sea_north", "sea_south", "sea_islands", "sea_east", "sea_new", "ocean", "storm", "port_mediterranean", "port_nordic", "port_lowland", "port_desert", "port_islands", "port_eastern", "port_frontier", "battle"];

  for (const id of CLASSIC) {
    it(`${id}：不用第二阶段的任何乐器与鼓点（两套编配都是）`, () => {
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        for (const v of Object.values(t.voices)) {
          expect(NEW_KEYS).not.toContain(v.inst);
          const variants = v.pattern && !("kind" in v.pattern) ? Object.values(v.pattern) : v.pattern ? [v.pattern] : [];
          for (const p of variants) if (p.kind === "drum") for (const [h] of Object.values(p.hits)) expect(NEW_HIT.test(h), h).toBe(false);
        }
        expect(INSTRUMENTS.oud).toBeTruthy();
      }
    });
  }
});

// ───────────────────────────── 逐采样不变：与改动之前（第一阶段合并后的 main，bbad47d）记下的指纹比

const SR = 44100;

/** 经典世界用到的曲目（主题曲、七首航海曲、风暴、七首港口曲、海战）。 */
const CLASSIC_IDS = ["title", "sea", "sea_north", "sea_south", "sea_islands", "sea_east", "sea_new", "ocean", "storm", "port_mediterranean", "port_nordic", "port_lowland", "port_desert", "port_islands", "port_eastern", "port_frontier", "battle"] as const;

/** 曲目的指纹：声部、段落、曲式、整体参数，以及每一遍展开出来的全部音符事件。 */
function trackPrint(t: TrackDef): string {
  const parts: string[] = [JSON.stringify(t.voices), JSON.stringify(t.sections), JSON.stringify(t.forms), String(t.level ?? 1), String(t.space ?? 1), String(!!t.hall)];
  for (let p = 0; p < t.forms.length; p++) parts.push(JSON.stringify(realizePass(t, p)));
  return seedOf(parts.join("|")).toString(16);
}

/** 原有乐器的指纹：参数、谐波表（四个音区各 16 个谐波）、拨弦与击奏在 220 Hz 合成出来的每一个采样。 */
function instPrint(key: string): string {
  const i = CORE_INSTRUMENTS[key] as unknown as Record<string, unknown>;
  const amps = typeof i.amps === "function" ? [131, 262, 523, 1047].flatMap((f0) => Array.from({ length: 16 }, (_, n) => (i.amps as (n: number, f: number) => number)(n + 1, (n + 1) * f0).toPrecision(10))) : [];
  let audio = "";
  if (i.kind === "pluck") audio = Array.from(pluck(i.spec as PluckSpec, 220, SR, 3)).map((v) => v.toFixed(6)).join(",");
  if (i.kind === "mallet") audio = Array.from(mallet(i.spec as Parameters<typeof mallet>[0], 220, SR, 2)).map((v) => v.toFixed(6)).join(",");
  return seedOf(JSON.stringify(i) + amps.join(",") + audio).toString(16);
}

/** 原有鼓点的指纹：参数与合成出来的每一个采样。 */
function drumPrint(key: string): string {
  const s = CORE_DRUMS[key];
  return seedOf(JSON.stringify(s) + Array.from(drum(s, SR, 5)).map((v) => v.toFixed(6)).join(",")).toString(16);
}

/** 改动之前记下的指纹（[合成版, 管弦版]）。 */
const CLASSIC_BEFORE = {
  tracks: {
    title: ["f8c62857", "7d66ec9e"], sea: ["850e873d", "483b6cc4"], sea_north: ["5bd0c0c7", "64462487"], sea_south: ["5944206", "7b8d8586"],
    sea_islands: ["8de6fa8f", "ad36cee9"], sea_east: ["ee18720e", "a3c33e91"], sea_new: ["2e100678", "7131087f"], ocean: ["f6f71b2", "135427ba"],
    storm: ["277dde01", "4286b4e"], port_mediterranean: ["de37a13d", "d9e1056e"], port_nordic: ["ed14b9f8", "8d7749bd"], port_lowland: ["f0ae15d3", "2f66b684"],
    port_desert: ["490e515b", "9c5cd6cb"], port_islands: ["ba86b80", "325796c6"], port_eastern: ["aa0a3fe0", "d4d10132"], port_frontier: ["fd21706d", "5ce03364"],
    battle: ["35f4f131", "71368ce"],
  },
  cues: { depart: ["6ff71849", "eba15e5a"], arrive: ["fbb39ebf", "ef5bc6c1"], discover: ["db613135", "d50ef20f"], fortune: ["38573d6d", "d23e0bd3"] },
  inst: {
    harp: "2eee2cd", lute: "74fb717b", guitar: "a0061f40", oud: "6dd5cdad", zheng: "cc272a90", ukulele: "3d6e3db7", mandolin: "7193abcc", cittern: "c3cb932e",
    harpsichord: "fd47f955", kantele: "9069c28f", pizz: "42d64f0d", bell: "caccb328", carillon: "eda2ba54", celesta: "c8c68eab", marimba: "8f28f6be",
    logdrum: "36290a04", timpani: "280f50c0", gong: "f646a604", perc: "6f9b7e83", flute: "908b0d37", recorder: "c866318c", ney: "bee3bde6", dizi: "de105e75",
    vivo: "75027f4", fiddle: "6dcf997f", cello: "dbbe6ffd", violins: "ca285712", celli: "780d41", horn: "e99f044c", horns: "6e0ca99c", trumpet: "8919ec35",
    reed: "2dc2119", strings: "2ef538dc", choir: "52d97a61", drone: "65ea0ed6",
  },
  drums: {
    bodhran: "b51fb30e", tip: "b5ddc970", tabor: "c68f9b52", doum: "76f39011", tek: "4779f0f0", ka: "ffac4669", riq: "33661d2b", shake: "32f14ebb",
    shaker: "b8e161ab", pahu: "22f7d7bd", woodblock: "57de6231", clapper: "c8784141", taiko: "3341da82", snare: "26cccfc8", cymbal: "cbb0246c", stomp: "4517c51",
  },
} as const;

describe("经典世界的配乐逐采样不变", () => {
  it("经典曲目与四个短乐句（两套编配）的曲谱与每一遍展开的结果与改动之前一样", () => {
    for (const id of CLASSIC_IDS) expect([trackPrint(TRACKS[id]), trackPrint(ORCH_TRACKS[id])], id).toEqual(CLASSIC_BEFORE.tracks[id]);
    for (const id of CUE_IDS) expect([trackPrint(JINGLES[id]), trackPrint(ORCH_JINGLES[id])], id).toEqual(CLASSIC_BEFORE.cues[id]);
  });

  it("原有乐器与鼓点的参数、谐波表与合成出来的采样与改动之前一样，也没有多出或少掉（拨弦多了可选的 rattle 之后照旧）", () => {
    expect(Object.keys(CORE_INSTRUMENTS)).toEqual(Object.keys(CLASSIC_BEFORE.inst));
    for (const k of Object.keys(CORE_INSTRUMENTS)) expect(instPrint(k), k).toBe(CLASSIC_BEFORE.inst[k as keyof typeof CLASSIC_BEFORE.inst]);
    expect(Object.keys(CORE_DRUMS)).toEqual(Object.keys(CLASSIC_BEFORE.drums));
    for (const k of Object.keys(CORE_DRUMS)) expect(drumPrint(k), k).toBe(CLASSIC_BEFORE.drums[k as keyof typeof CLASSIC_BEFORE.drums]);
  });
});

/** 每段的旋律行（不含和弦）：段名 → “小节数:指纹”；only 给出时每段只取这些行（重编时新加的行，例如坦布拉，不算）。 */
function linesPrint(t: TrackDef, only: Readonly<Record<string, readonly string[]>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, sec] of Object.entries(t.sections)) {
    if (!only[name]) continue;
    const lines = Object.fromEntries(Object.entries(sec.lines ?? {}).filter(([k]) => only[name].includes(k)));
    out[name] = `${sec.bars}:${seedOf(JSON.stringify(lines)).toString(16)}`;
  }
  return out;
}

/** 重编之前（bbad47d）的旋律行与速度、拍号、调。 */
const REDONE_BEFORE: Readonly<Record<string, { lines: Readonly<Record<string, readonly string[]>>; print: Readonly<Record<string, string>>; meta: string }>> = {
  ac_azhar: { lines: { intro: ["gliss"], A: ["mel"] }, print: { intro: "2:faa7d749", A: "8:a3bc1001" }, meta: "72 4/4 C major" },
  ac_fez: { lines: { A: ["mel"], B: ["bmel"] }, print: { A: "8:bab96ba4", B: "8:d22e5cf7" }, meta: "96 6/8 A phrygian" },
  ac_ship: { lines: { intro: ["taqsim"], A: ["mel"], tag: ["tag"] }, print: { intro: "2:cede10e6", A: "8:6333c117", tag: "2:adc4a937" }, meta: "92 4/4 D bayati" },
  sea_monsoon: {
    lines: { intro: ["motif"], A: ["mel"], A2: ["mel2"], B: ["bmel"], outro: ["tag"] },
    print: { intro: "2:231c202d", A: "8:12d00ae7", A2: "8:90b640ad", B: "8:a0661340", outro: "2:997bbbd1" },
    meta: "84 4/4 D lydian",
  },
};

describe("重编的四首：旋律一个音没改", () => {
  for (const id of REDONE) {
    it(`${id}：旋律行、段落的小节数、速度、拍号与调都与重编之前一样（只换了乐器、鼓与衬底）`, () => {
      const before = REDONE_BEFORE[id];
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        expect(linesPrint(t, before.lines)).toEqual(before.print);
        expect(`${t.qpm} ${t.meter[0]}/${t.meter[1]} ${t.key}`).toBe(before.meta);
      }
    });
  }
});
