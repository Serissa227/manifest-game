// 地方特色第二阶段·美洲的曲目与选曲：阿兹特克、加勒比、巴西的港口曲按风格名选到（图皮南巴诸部按势力 key），巴西沿岸的音乐分区选到《巴西海流》，
// 经典世界的选曲一首不变；新曲与重编的曲子由地方乐器领奏（每一遍都有地方乐器的旋律）；和声只用空五度的四首新曲（三首港口曲与《巴西海流》）里没有三和弦——
// 和弦记号是空五度，衬底实际奏出来的音之间没有三度，旋律声部之间也没有成片的三度、六度；
// 《巴西海流》是自己的曲谱（图皮人划独木舟的歌），不沿用《阿斯特里亚的海岸》；重编的三首旋律与和声不变。
import { describe, expect, it } from "vitest";
import { townStyleOf } from "../art/buildings";
import { INSTRUMENTS } from "./instruments";
import { REGIONAL, REGIONAL_INSTRUMENTS, regionalId } from "./instruments/regional";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { parseChord } from "./theory";
import { realizePass, type TrackDef } from "./score";
import { TRACKS, type TrackId } from "./tracks";
import { MUSIC_ZONE_TRACK, musicTrackOf, PORT_STYLE_TRACK, portTrackOf, ZONE_TRACK } from "./zones";
import { TERRA16_FACTIONS, terra16PortTrack } from "../test/terra16";

const NEW_PORTS = ["port_aztec", "port_caribbean", "port_brazil"] as const;
/** 和声只用空五度的新曲：三首新港口曲与《巴西海流》。 */
const NEW_TRACKS = [...NEW_PORTS, "sea_brazil"] as const;
const REORCHESTRATED = ["sea_caribbean", "sea_andes", "ac_merida"] as const;

/** 曲子用到的地方乐器（有音高的按键，打击乐按鼓点所属的那一件）。 */
function regionalUsed(track: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(track.voices)) {
    if (Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, v.inst)) out.add(v.inst);
    const variants = v.pattern && !("kind" in v.pattern) ? Object.values(v.pattern) : v.pattern ? [v.pattern] : [];
    for (const p of variants) {
      if (p.kind !== "drum") continue;
      for (const [hit] of Object.values(p.hits)) {
        const def = REGIONAL.find((d) => Object.prototype.hasOwnProperty.call(d.drums ?? {}, hit));
        if (def) out.add(regionalId(def));
      }
    }
  }
  return out;
}

/**
 * 这一遍里旋律行的音（声部没有伴奏型、不是打击乐：领奏与对位的线条；衬底的长音、扫弦、分解低音都有伴奏型，不算）：
 * 由地方乐器奏的个数与全部的个数。
 */
function leadShare(track: TrackDef, pass: number): { regional: number; all: number } {
  let regional = 0;
  let all = 0;
  for (const e of realizePass(track, pass).events) {
    const v = track.voices[e.voice];
    if (e.hit || v.pattern || INSTRUMENTS[v.inst]?.kind === "perc") continue;
    all++;
    if (Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, v.inst)) regional++;
  }
  return { regional, all };
}

const pcOf = (m: number) => ((m % 12) + 12) % 12;
/** 三度或六度（小三、大三、小六、大六，不论八度）。 */
const isThird = (a: number, b: number) => [3, 4, 8, 9].includes(pcOf(a - b));

/** 一组时间段的并集的总长（秒）。 */
function unionLength(spans: [number, number][]): number {
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let from = -1;
  let to = -1;
  for (const [s, e] of spans) {
    if (s > to) {
      if (to > from) total += to - from;
      from = s;
      to = e;
    } else to = Math.max(to, e);
  }
  if (to > from) total += to - from;
  return total;
}

/** 这些事件里不同声部的两个音同时响着三度或六度的时间段。 */
function thirdSpans(events: readonly { t: number; d: number; m: number; voice: string }[]): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (b.t >= a.t + a.d) continue;
      if (a.voice === b.voice || !isThird(a.m, b.m)) continue;
      const s = Math.max(a.t, b.t);
      const e = Math.min(a.t + a.d, b.t + b.d);
      if (e > s + 1e-6) spans.push([s, e]);
    }
  }
  return spans;
}

/**
 * 这一遍里旋律声部之间同时响着三度或六度的时间（秒）与这一遍的长度。旋律声部：没有伴奏型、不是打击乐，
 * 且这一遍里不止两个音级——全遍只有一两个音级的是持续音与两音的木鼓（海螺号拉的根音、马约瓦坎的低舌与高舌），不算旋律。
 */
function melodicThirds(track: TrackDef, pass: number): { seconds: number; length: number } {
  const p = realizePass(track, pass);
  const mel = p.events.filter((e) => {
    const v = track.voices[e.voice];
    return !e.hit && !v.pattern && INSTRUMENTS[v.inst]?.kind !== "perc";
  });
  const classes = new Map<string, Set<number>>();
  for (const e of mel) {
    if (!classes.has(e.voice)) classes.set(e.voice, new Set());
    classes.get(e.voice)!.add(pcOf(e.m));
  }
  const lines = mel.filter((e) => classes.get(e.voice)!.size > 2);
  return { seconds: unionLength(thirdSpans(lines)), length: p.length };
}

/** 这一遍里衬底（有伴奏型、有音高的声部：持续音、扫弦、拨奏、竖琴、弦乐长音）实际奏出来的音之间同时响着三度或六度的时间（秒）。 */
function bedThirds(track: TrackDef, pass: number): number {
  const bed = realizePass(track, pass).events.filter((e) => !e.hit && !!track.voices[e.voice].pattern);
  return unionLength(thirdSpans(bed));
}

describe("第二阶段·美洲：港口曲与航海曲的选曲", () => {
  it("阿兹特克（aztec、mesoamerican、mexica、nahua）、加勒比（caribbean、taino）、巴西的图皮（tupi、tupinamba、brazilian）各有自己的港口曲", () => {
    const want: Record<string, TrackId> = {
      aztec: "port_aztec",
      mesoamerican: "port_aztec",
      mexica: "port_aztec",
      nahua: "port_aztec",
      caribbean: "port_caribbean",
      taino: "port_caribbean",
      tupi: "port_brazil",
      tupinamba: "port_brazil",
      brazilian: "port_brazil",
    };
    for (const [style, track] of Object.entries(want)) {
      expect(PORT_STYLE_TRACK[style], style).toBe(track);
      expect(portTrackOf("x", style), style).toBe(track);
    }
    // 玛雅、安第斯照旧；殖民地风格与经典世界的风格、势力照旧
    expect(portTrackOf("x", "maya")).toBe("port_maya");
    expect(portTrackOf("x", "inca")).toBe("port_andes");
    expect(portTrackOf("x", "colonial")).toBe("port_frontier");
    expect(portTrackOf("x", "frontier")).toBe("port_frontier");
    expect(portTrackOf("chisha", undefined)).toBe("port_desert");
    expect(portTrackOf(undefined, undefined)).toBe("port_mediterranean");
  });

  it("图皮南巴诸部（寰宇世界的势力 tupinamba）在数据里写 tupi，按风格名选《巴西木的海岸》；只看风格名，经典世界的势力照旧", () => {
    // 配乐的数据接线（2026-10-11）：原来图皮南巴写借来的 islands，由前端按势力 key 认（PORT_FACTION_FALLBACK）；
    // 现在数据写 tupi（街景经 TOWN_ALIASES 画成 frontier），选曲只看风格名（见 DECISIONS“测试期望值变更”）
    expect(TERRA16_FACTIONS.find((f) => f.key === "tupinamba")?.style).toBe("tupi");
    expect(portTrackOf("tupinamba", "tupi")).toBe("port_brazil");
    expect(townStyleOf("tupinamba", "tupi")).toBe("frontier");
    // 停在里约（图皮南巴的港口）
    expect(terra16PortTrack("rio_de_janeiro")).toBe("port_brazil");
    // 不认势力 key：写借来的 islands 就是南洋的一首，没写风格是缺省的地中海
    expect(portTrackOf("tupinamba", "islands")).toBe("port_islands");
    expect(portTrackOf("tupinamba", null)).toBe("port_mediterranean");
    // 风格名在港口曲表里时照风格名（数据改了风格就跟着改）
    expect(portTrackOf("tupinamba", "maya")).toBe("port_maya");
    // 别的势力的 islands 照旧是南洋的港口曲；经典世界的六个势力照旧
    expect(portTrackOf("x", "islands")).toBe("port_islands");
    expect(portTrackOf("bichao", null)).toBe("port_islands");
    for (const [key, track] of [["cuilan", "port_mediterranean"], ["shuangling", "port_nordic"], ["jinsui", "port_lowland"], ["chisha", "port_desert"], ["bichao", "port_islands"], ["yaohua", "port_eastern"]] as const) {
      expect(portTrackOf(key, null), key).toBe(track);
    }
  });

  it("巴西沿岸的音乐分区（brazil、brazilian、brazil_current）选《巴西海流》；经典世界的 newworld 照旧是《阿斯特里亚的海岸》", () => {
    for (const k of ["brazil", "Brazil", "brazilian", "brazil-current", "Brazil Current"]) expect(musicTrackOf(k), k).toBe("sea_brazil");
    expect(MUSIC_ZONE_TRACK.newworld).toBe("sea_new");
    expect(ZONE_TRACK.newworld).toBe("sea_new");
    expect(musicTrackOf("caribbean")).toBe("sea_caribbean");
    expect(musicTrackOf("andes")).toBe("sea_andes");
    expect(Object.values(ZONE_TRACK)).not.toContain("sea_brazil");
  });
});

describe("第二阶段·美洲：新曲与重编的曲子由地方乐器领奏", () => {
  for (const id of [...NEW_TRACKS, ...REORCHESTRATED]) {
    it(`${id}：两套编配的每一遍，旋律音大半由地方乐器奏；地方乐器（含打击乐）至少四件，两套用的一样`, () => {
      expect([...regionalUsed(ORCH_TRACKS[id])].sort()).toEqual([...regionalUsed(TRACKS[id])].sort());
      for (const [style, track] of [["synth", TRACKS[id]], ["orch", ORCH_TRACKS[id]]] as const) {
        expect(regionalUsed(track).size, `${id} ${style}`).toBeGreaterThanOrEqual(4);
        for (let pass = 0; pass < track.forms.length; pass++) {
          const { regional, all } = leadShare(track, pass);
          // 《修院的晨课》的圣咏是修士的一边（人声 / 中提琴与大提琴组），玛雅的一边占一半上下
          const floor = id === "ac_merida" ? 0.4 : 0.7;
          expect(regional / all, `${id} ${style}#${pass}：${regional} / ${all}`).toBeGreaterThan(floor);
        }
      }
    });
  }

  it("三首新港口曲与《巴西海流》的和声只用空五度（不写西洋的三和弦）", () => {
    for (const id of NEW_TRACKS) {
      for (const [name, section] of Object.entries(TRACKS[id].sections)) {
        for (const bar of (section.chords ?? "").split("|")) {
          for (const sym of bar.trim().split(/\s+/).filter(Boolean)) {
            const chord = parseChord(sym.replace(/\*\d+(?:\.\d+)?$/, ""));
            expect(chord.tones, `${id} ${name}：${sym}`).toEqual([0, 7]);
          }
        }
      }
    }
  });

  it("三首新港口曲与《巴西海流》：衬底实际奏出来的音（持续音、扫弦、拨奏、竖琴、弦乐长音）之间没有三度、六度（两套编配的每一遍）", () => {
    for (const id of NEW_TRACKS) {
      for (const [style, track] of [["synth", TRACKS[id]], ["orch", ORCH_TRACKS[id]]] as const) {
        // 换和弦时前后两个音交接的几毫秒（起音的时间抖动）不算：一整遍加起来不到 0.1 秒
        for (let pass = 0; pass < track.forms.length; pass++) expect(bedThirds(track, pass), `${id} ${style}#${pass}`).toBeLessThan(0.1);
      }
    }
  });

  it("三首新港口曲与《巴西海流》：旋律声部之间没有成片的三度、六度（不在下方三度配和声）；《岛上的阿雷伊托》与《巴西海流》里一处也没有", () => {
    // 两套编配的每一遍：同时响着三度或六度的时间不到一遍的 15%（轮唱、错开着吹、海螺号拉长音时偶然碰上的）；
    // 阿雷伊托的众人只齐唱（同度、八度），巴西海流的两支竹笛只有同度与四度
    for (const id of NEW_TRACKS) {
      for (const [style, track] of [["synth", TRACKS[id]], ["orch", ORCH_TRACKS[id]]] as const) {
        for (let pass = 0; pass < track.forms.length; pass++) {
          const { seconds, length } = melodicThirds(track, pass);
          const label = `${id} ${style}#${pass}：${seconds.toFixed(1)} / ${length.toFixed(1)} 秒`;
          expect(seconds / length, label).toBeLessThan(0.15);
          if (id === "port_caribbean" || id === "sea_brazil") expect(seconds, label).toBeLessThan(0.05);
        }
      }
    }
  });

  it("重编的《尤卡坦的信风》《钦查的筏》《修院的晨课》：调、拍子、速度、各段的小节数、和弦与原有的旋律行一字不差（只添了新的行）", () => {
    // 重编前（main 的 bbad47d）同样算法的指纹；added 是这一轮新添的行（海螺号的根音、普图图的一声、排箫的轮吹——A 段与 B 段各一对）
    const before: Record<string, { print: string; added: readonly string[] }> = {
      sea_caribbean: { print: "3bb002aa", added: ["B.roots"] },
      sea_andes: { print: "83d48b36", added: ["intro.call", "A.ira", "A.arka", "B.ira", "B.arka"] },
      ac_merida: { print: "7ad3c1ce", added: [] },
    };
    const fnv = (text: string): string => {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= text.charCodeAt(i) >>> 8;
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    };
    for (const [id, { print, added }] of Object.entries(before)) {
      const def = TRACKS[id as TrackId];
      const sections = Object.keys(def.sections)
        .sort()
        .map((name) => {
          const s = def.sections[name];
          const lines = Object.keys(s.lines ?? {})
            .filter((l) => !added.includes(`${name}.${l}`))
            .sort()
            .map((l) => `${l}=${s.lines![l]}`)
            .join(";");
          return `${name}:${s.bars}:${s.chords ?? ""}:${lines}`;
        })
        .join("|");
      expect(fnv(`${def.key}/${def.meter.join("/")}/${def.qpm}/${sections}`), id).toBe(print);
      for (const a of added) expect(def.sections[a.split(".")[0]].lines?.[a.split(".")[1]], `${id} ${a}`).toBeTruthy();
    }
  });

  it("《巴西海流》是自己的曲谱（图皮人划独木舟的歌）：不沿用《阿斯特里亚的海岸》的段落、旋律与和弦，不用它的 6/8 吉格鼓点；两套的段落与曲式相同", () => {
    const a = TRACKS.sea_brazil;
    const b = TRACKS.sea_new;
    expect(a.title.zh).not.toBe(b.title.zh);
    expect(a.sections).not.toBe(b.sections);
    const linesOf = (t: TrackDef) => Object.values(t.sections).flatMap((s) => Object.values(s.lines ?? {}));
    const chordsOf = (t: TrackDef) => Object.values(t.sections).map((s) => s.chords ?? "");
    for (const line of linesOf(a)) expect(linesOf(b), line).not.toContain(line);
    for (const c of chordsOf(a)) expect(chordsOf(b), c).not.toContain(c);
    // 匀的二拍子：4/4，竹筒与沙铃的鼓点每个都是整小节长（八个八分音符的整数倍）
    expect(a.meter).toEqual([4, 4]);
    for (const v of Object.values(a.voices)) {
      const variants = v.pattern && !("kind" in v.pattern) ? Object.values(v.pattern) : v.pattern ? [v.pattern] : [];
      for (const p of variants) if (p.kind === "drum") expect(p.steps.replace(/\s+/g, "").length % 8, p.steps).toBe(0);
    }
    expect(ORCH_TRACKS.sea_brazil.sections).toBe(a.sections);
    expect(ORCH_TRACKS.sea_brazil.forms.map((f) => f.map((s) => s.s))).toEqual(a.forms.map((f) => f.map((s) => s.s)));
  });
});
