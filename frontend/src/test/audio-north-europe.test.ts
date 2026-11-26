// 地方特色第二阶段·北欧的曲子：五首新港口曲（低地国家、英格兰、法兰西、汉萨、罗斯）、重编的《柯克船的号子》与学院短主题·安特卫普、
// 《北风与白鲸》的寰宇重编版《白海的北风》——地方乐器领奏、调式与节奏型是各地自己的（风笛的倚音、钟的“换”、狗的节奏、波尔斯卡的律动、
// 汉萨城市乐手的克鲁姆管、罗斯钟不成和弦的 trezvon……），
// 港口与海区的映射只认寰宇世界的细名，经典世界的配乐一个采样都不变（曲谱与乐器表的指纹与改动前一致）。
import { describe, expect, it } from "vitest";
import { CORE_DRUMS, CORE_INSTRUMENTS } from "../audio/instruments";
import { ORCH_INSTRUMENTS } from "../audio/orchestra/instruments";
import { ORCH_JINGLES, ORCH_TRACKS } from "../audio/orchestra/tracks";
import { lineOf, realizePass, type TrackDef } from "../audio/score";
import { TRACK_IDS, TRACKS, type TrackId } from "../audio/tracks";
import { JINGLES } from "../audio/tracks/jingles";
import { MUSIC_ZONE_TRACK, musicTrackOf, PORT_STYLE_TRACK, portTrackOf, REGION_ZONES, ZONE_TRACK } from "../audio/zones";
import { townStyleOf } from "../art/buildings";
import { TERRA16_FACTIONS, TERRA16_REGIONS, terra16PortTrack } from "./terra16";

const NEW_PORTS = ["port_flanders", "port_england", "port_france", "port_hansa", "port_russia"] as const;
const CHANGED = [...NEW_PORTS, "sea_hansa", "sea_arctic", "ac_antwerp"] as const;

/** 曲目里各声部用到的乐器。 */
const instsOf = (t: TrackDef) => new Set(Object.values(t.voices).map((v) => v.inst));

/** 一段的和弦记号（去掉 *n 的长度）。 */
const chordSymbols = (t: TrackDef, section: string) =>
  (t.sections[section].chords ?? "")
    .split(/[|\s]+/)
    .filter(Boolean)
    .map((c) => c.replace(/\*.*$/, ""));

describe("北欧的新曲子：地方乐器领奏，调式与节奏型", () => {
  it("每首的领奏乐器、调与拍子", () => {
    const want: Record<string, { key: string; meter: readonly [number, number]; leads: string[] }> = {
      port_flanders: { key: "G mixolydian", meter: [4, 4], leads: ["bagpipe", "pipe_drone", "crumhorn", "beiaard"] },
      port_england: { key: "D mixolydian", meter: [3, 2], leads: ["tabor_pipe", "rebeck", "bandora", "beiaard"] },
      port_france: { key: "G major", meter: [6, 8], leads: ["hurdygurdy", "hurdy_drone", "cornemuse", "galoubet"] },
      port_hansa: { key: "D minor", meter: [3, 4], leads: ["nyckelharpa", "langeleik", "bukkehorn", "crumhorn"] },
      port_russia: { key: "A minor", meter: [2, 4], leads: ["zhaleika", "gudok", "gusli", "kolokol"] },
      sea_hansa: { key: "A dorian", meter: [4, 4], leads: ["nyckelharpa", "bagpipe", "crumhorn", "bukkehorn"] },
      sea_arctic: { key: "D dorian", meter: [6, 8], leads: ["nyckelharpa", "bukkehorn", "gusli", "pipe_drone"] },
      ac_antwerp: { key: "F major", meter: [4, 4], leads: ["virginal", "beiaard", "crumhorn"] },
    };
    for (const id of CHANGED) {
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        expect(t.key, id).toBe(want[id].key);
        expect(t.meter, id).toEqual(want[id].meter);
        const used = instsOf(t);
        for (const lead of want[id].leads) expect(used.has(lead), `${id} 的 ${lead}`).toBe(true);
      }
      // 复古合成版不用采样（衬底是合成的），管弦版的衬底是管弦
      expect([...instsOf(TRACKS[id])].some((i) => i.startsWith("o.")), id).toBe(false);
      expect([...instsOf(ORCH_TRACKS[id])].some((i) => i.startsWith("o.")), id).toBe(true);
    }
  });

  it("没有西洋三和弦的音乐只写空五度：手摇弦琴与风笛的布雷舞、尼克尔哈帕的波尔斯卡、风笛领奏的段落、罗斯的钟声与长歌", () => {
    const fifthsOnly = (id: TrackId, sections: string[]) => {
      for (const s of sections) for (const c of chordSymbols(TRACKS[id], s)) expect(c, `${id} ${s}`).toMatch(/^[A-G][#b]?5$/);
    };
    fifthsOnly("port_france", Object.keys(TRACKS.port_france.sections));
    fifthsOnly("port_hansa", Object.keys(TRACKS.port_hansa.sections));
    fifthsOnly("port_flanders", ["intro", "A", "coda"]);
    fifthsOnly("port_russia", ["zvon", "song", "coda"]);
  });

  it("风笛不能吐音：风笛奏的旋律里，紧接着的两个同样的音之间一定有倚音切开", () => {
    const piped: [TrackDef, string, string][] = [
      [TRACKS.port_flanders, "A", "mel"],
      [TRACKS.port_flanders, "coda", "end"],
      [TRACKS.sea_hansa, "refrain", "refp"],
    ];
    for (const [t, s, l] of piped) {
      const notes = lineOf(t, s, l).notes;
      let cuts = 0;
      for (let i = 1; i < notes.length; i++) {
        const a = notes[i - 1];
        const b = notes[i];
        if (Math.abs(a.at + a.len - b.at) > 1e-6 || a.pitches.join() !== b.pitches.join()) continue;
        expect(b.grace.length, `${t.id} ${s}/${l} 第 ${i} 个音`).toBeGreaterThan(0);
        cuts++;
      }
      expect(cuts, `${t.id} ${s}/${l}`).toBeGreaterThan(0);
    }
  });

  it("英格兰的塔楼鸣钟：引子是“鸣圆”与 plain hunt 的“换”——每一换都是六口钟各响一次，相邻两换只有相邻的钟交换位置", () => {
    const ring = lineOf(TRACKS.port_england, "intro", "ring").notes;
    expect(ring.length % 6).toBe(0);
    const changes: number[][] = [];
    for (let i = 0; i < ring.length; i += 6) changes.push(ring.slice(i, i + 6).map((n) => n.pitches[0]));
    const bells = [...changes[0]].sort((a, b) => b - a);
    // 第一换是“鸣圆”：从最高的钟依次到最低
    expect(changes[0]).toEqual(bells);
    for (const c of changes) expect([...c].sort((a, b) => b - a)).toEqual(bells);
    for (let k = 1; k < changes.length; k++) {
      for (const b of bells) expect(Math.abs(changes[k].indexOf(b) - changes[k - 1].indexOf(b)), `第 ${k} 换`).toBeLessThanOrEqual(1);
    }
    // 不只是一直鸣圆：后面真的“换”了
    expect(changes.some((c) => c.join() !== changes[0].join())).toBe(true);
  });

  it("英格兰的号笛舞是 3/2 拍：两段都以“两个二分音符加一拍空”收住", () => {
    for (const [s, l] of [["A", "mel"], ["B", "bmel"]] as const) {
      const notes = lineOf(TRACKS.port_england, s, l).notes;
      const bar = 12;
      const last = notes.filter((n) => n.at >= 7 * bar);
      expect(last.map((n) => n.len), `${s}/${l}`).toEqual([4, 4]);
      expect(last[1].at + last[1].len, `${s}/${l}`).toBe(7 * bar + 8);
    }
  });

  it("法兰西的布雷舞：手摇弦琴的“狗”重拍落在每个三拍的第一拍（6/8 的第一、第四个八分音符）", () => {
    const chien = TRACKS.port_france.voices.chien.pattern;
    if (!chien || "kind" in chien) throw new Error("chien");
    const a = chien.a;
    if (a.kind !== "drum") throw new Error("chien.a");
    const cells = [...a.steps];
    expect(cells.length % 6).toBe(0);
    for (let i = 0; i < cells.length; i += 3) expect(a.hits[cells[i]]?.[1] ?? 0, `第 ${i} 格`).toBeGreaterThanOrEqual(0.7);
    expect(Object.values(a.hits).every(([hit]) => hit.startsWith("chien_"))).toBe(true);
  });

  it("汉萨的波尔斯卡：3/4 拍，第二拍略早（律动）；两把尼克尔哈帕", () => {
    const t = TRACKS.port_hansa;
    expect(t.groove?.[1] ?? 0).toBeLessThan(0);
    expect(Object.values(t.voices).filter((v) => v.inst === "nyckelharpa").length).toBe(2);
  });

  it("汉萨的码头不只是斯堪的纳维亚：每一遍都有一段德意志汉萨城市的城市乐手（克鲁姆管三声部领、长鼓），之后再回到尼克尔哈帕", () => {
    for (const t of [TRACKS.port_hansa, ORCH_TRACKS.port_hansa]) {
      const instOf = (tok: string) => t.voices[tok.split(":").pop()!.replace(/[.+~-].*$/, "")]?.inst;
      const hitsOf = (tok: string) => {
        const v = t.voices[tok.replace(/[.+~-].*$/, "")];
        const p = v?.pattern;
        if (!p) return [];
        const pats = "kind" in p ? [p] : Object.values(p);
        return pats.flatMap((x) => (x.kind === "drum" ? Object.values(x.hits).map(([h]) => h) : []));
      };
      t.forms.forEach((form, pass) => {
        const town = form.findIndex((st) => {
          const toks = st.play.split(/\s+/);
          const crums = toks.filter((tok) => tok.includes(":") && instOf(tok) === "crumhorn");
          // 克鲁姆管领：三声部，这一段没有尼克尔哈帕
          return crums.length >= 3 && !toks.some((tok) => instOf(tok) === "nyckelharpa") && toks.some((tok) => hitsOf(tok).includes("trommel"));
        });
        expect(town, `${t.id}#${pass}`).toBeGreaterThan(0);
        const back = form.slice(town + 1).some((st) => st.play.split(/\s+/).some((tok) => tok.includes(":") && instOf(tok) === "nyckelharpa"));
        expect(back, `${t.id}#${pass}`).toBe(true);
      });
    }
  });

  it("罗斯：钟声开头；长歌慢下来（扎列伊卡与古多克的异音）；舞曲的第二段转到 C 大调一侧（游移调式）", () => {
    const t = TRACKS.port_russia;
    for (const form of t.forms) {
      const song = form.find((st) => st.s === "song");
      expect(song?.tempo ?? 1).toBeLessThan(0.75);
    }
    expect(t.forms[0][0].s).toBe("zvon");
    expect(chordSymbols(t, "B")[0]).toBe("C");
    expect(chordSymbols(t, "A")[0]).toBe("Am");
  });

  it("罗斯的钟不按和弦配：钟声与尾声里几口钟的音合起来不含完整的大小三和弦；小钟的 trezvon 是反复的节奏型", () => {
    const t = TRACKS.port_russia;
    const bellVoices = new Set(Object.entries(t.voices).filter(([, v]) => v.inst === "kolokol").map(([k]) => k));
    for (const s of ["zvon", "coda"]) {
      const lines = new Set<string>();
      for (const form of t.forms) {
        for (const st of form) {
          if (st.s !== s) continue;
          for (const tok of st.play.split(/\s+/)) {
            const [l, v] = tok.split(":");
            if (v && bellVoices.has(v.replace(/[.+~-].*$/, ""))) lines.add(l);
          }
        }
      }
      // 大钟、中钟、小钟
      expect(lines.size, s).toBeGreaterThanOrEqual(3);
      const pcs = new Set<number>();
      for (const l of lines) for (const n of lineOf(t, s, l).notes) for (const p of n.pitches) pcs.add(((Math.round(p) % 12) + 12) % 12);
      for (const r of pcs) {
        for (const third of [3, 4]) expect(pcs.has((r + third) % 12) && pcs.has((r + 7) % 12), `${s}：音级 ${r} 上的三和弦`).toBe(false);
      }
    }
    // trezvon：小钟在钟声段第 5–7 小节每小节的节奏一模一样（反复的节奏型），每小节至少六下
    const bar = 4;
    const small = lineOf(t, "zvon", "small").notes;
    const rhythm = (k: number) => small.filter((n) => n.at >= k * bar && n.at < (k + 1) * bar).map((n) => n.at - k * bar);
    expect(rhythm(4).length).toBeGreaterThanOrEqual(6);
    expect(rhythm(5)).toEqual(rhythm(4));
    expect(rhythm(6)).toEqual(rhythm(4));
  });

  it("每首每一遍都能展开；两套编配的一遍一样长；港口曲一遍 40–100 秒", () => {
    for (const id of CHANGED) {
      for (let pass = 0; pass < TRACKS[id].forms.length; pass++) {
        const a = realizePass(TRACKS[id], pass);
        const b = realizePass(ORCH_TRACKS[id], pass);
        expect(Math.abs(a.length - b.length), `${id}#${pass}`).toBeLessThan(0.02);
        if ((NEW_PORTS as readonly string[]).includes(id)) {
          expect(a.length, `${id}#${pass}`).toBeGreaterThan(40);
          expect(a.length, `${id}#${pass}`).toBeLessThan(100);
        }
      }
    }
  });
});

describe("《白海的北风》：经典世界《北风与白鲸》的旋律换成北方的地方乐器", () => {
  it("段落、旋律与和声与《北风与白鲸》一样，速度、拍子、调一样；乐器全换了（提琴、圆号、卡恩特勒琴、钢片琴都不用）", () => {
    const a = TRACKS.sea_arctic;
    const n = TRACKS.sea_north;
    expect(a.title.zh).not.toBe(n.title.zh);
    expect([a.qpm, a.meter, a.key, a.hall]).toEqual([n.qpm, n.meter, n.key, n.hall]);
    for (const s of Object.keys(n.sections)) expect(a.sections[s], s).toEqual(n.sections[s]);
    const used = instsOf(a);
    for (const old of ["fiddle", "horns", "kantele", "celesta"]) expect(used.has(old), old).toBe(false);
  });

  it("只给寰宇世界的音乐分区用：最北的海路的名字指向它，经典的 north 地域与海区表照旧是《北风与白鲸》", () => {
    for (const k of ["arctic", "white_sea", "barents", "barents_sea", "norwegian_sea", "north_cape", "Arctic Ocean"]) expect(musicTrackOf(k), k).toBe("sea_arctic");
    expect(musicTrackOf("north")).toBe("sea_north");
    expect(ZONE_TRACK.north).toBe("sea_north");
    expect(REGION_ZONES.every(([, z]) => ZONE_TRACK[z] !== "sea_arctic")).toBe(true);
    expect(Object.values(ZONE_TRACK)).not.toContain("sea_arctic");
  });
});

describe("北欧的港口曲：风格名 → 港口曲", () => {
  it("寰宇世界的细名各有一首：佛兰德斯 / 尼德兰 / 低地 → 斯海尔德河，英格兰、法兰西、汉萨与波罗的海与斯堪的纳维亚、罗斯", () => {
    const want: Record<string, TrackId> = {
      flemish: "port_flanders",
      dutch: "port_flanders",
      low_countries: "port_flanders",
      english: "port_england",
      french: "port_france",
      hanseatic: "port_hansa",
      baltic: "port_hansa",
      scandinavian: "port_hansa",
      northern: "port_hansa",
      russian: "port_russia",
    };
    for (const [style, track] of Object.entries(want)) {
      expect(portTrackOf("x", style), style).toBe(track);
      expect(PORT_STYLE_TRACK[style], style).toBe(track);
      expect(TRACK_IDS).toContain(track);
    }
  });

  it("经典的风格名与经典世界的势力照旧走经典的港口曲（低地、北地）", () => {
    expect(portTrackOf("x", "lowland")).toBe("port_lowland");
    expect(portTrackOf("x", "nordic")).toBe("port_nordic");
    expect(portTrackOf("jinsui", null)).toBe("port_lowland");
    expect(portTrackOf("shuangling", undefined)).toBe("port_nordic");
    expect(portTrackOf("cuilan", null)).toBe("port_mediterranean");
    for (const style of ["lowland", "nordic", "mediterranean", "desert", "islands", "eastern", "frontier"]) expect(PORT_STYLE_TRACK[style], style).toBeUndefined();
    // 新的航海曲与港口曲不进经典的地域表
    for (const id of [...NEW_PORTS, "sea_arctic"]) expect(Object.values(ZONE_TRACK) as string[]).not.toContain(id);
    expect(Object.values(MUSIC_ZONE_TRACK).filter((t) => t.startsWith("port_"))).toEqual([]);
  });

  it("寰宇的真实数据（配乐的数据接线，2026-10-11）：北欧诸国写文化细名，五首港口曲都放得到；最北的海路放《白海的北风》，北海与英吉利海峡放《柯克船的号子》", () => {
    // 势力在数据里写的风格名，与街景的去处（TOWN_ALIASES 已有的映射）：英格兰由 nordic、法兰西由地中海改画低地，汉萨由低地改画北地
    const styles = new Map(TERRA16_FACTIONS.map((f) => [f.key, f.style]));
    const want: Record<string, readonly [string, string]> = {
      england: ["english", "lowland"],
      france: ["french", "lowland"],
      netherlands: ["dutch", "lowland"],
      hanse: ["hanseatic", "nordic"],
      denmark_norway: ["scandinavian", "nordic"],
      sweden: ["scandinavian", "nordic"],
      moscovy: ["russian", "nordic"],
    };
    for (const [key, [style, town]] of Object.entries(want)) {
      expect(styles.get(key), key).toBe(style);
      expect(townStyleOf(key, style), key).toBe(town);
    }
    const ports: Record<string, TrackId> = {
      london: "port_england",
      bristol: "port_england",
      antwerp: "port_flanders",
      amsterdam: "port_flanders",
      dieppe: "port_france",
      bordeaux: "port_france",
      marseille: "port_france",
      lubeck: "port_hansa",
      hamburg: "port_hansa",
      bergen: "port_hansa",
      stockholm: "port_hansa",
      arkhangelsk: "port_russia",
      // 苏格兰、爱尔兰诸领主、利沃尼亚、波兰与立陶宛照旧写 nordic：经典的北地港口曲
      galway: "port_nordic",
      riga: "port_nordic",
      danzig: "port_nordic",
    };
    for (const [place, track] of Object.entries(ports)) expect(terra16PortTrack(place), place).toBe(track);
    const music = new Map(TERRA16_REGIONS.map((r) => [r.key, r.music]));
    for (const k of ["iceland_sea", "norwegian_sea", "white_barents"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_arctic");
    for (const k of ["north_sea", "english_channel", "baltic", "bothnia"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_hansa");
    // 新大陆一侧与爱尔兰海照旧写 north：经典的《北风与白鲸》
    for (const k of ["labrador", "grand_banks", "st_lawrence", "irish_sea"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_north");
  });
});

// ───────────────────────────── 经典世界的配乐不变

/** FNV-1a（32 位）。 */
function fnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 谐波表一类的函数按若干点取值，换成数组（改了函数的内容，指纹就变）。 */
function sampleFn(fn: (n: number, f: number) => number): number[] {
  const out: number[] = [];
  for (const f0 of [65, 110, 220, 440, 880, 1760]) for (let n = 1; n <= 16; n++) out.push(Number(fn(n, n * f0).toPrecision(12)));
  return out;
}

function fingerprint(value: unknown): string {
  return fnv(JSON.stringify(value, (_k, v: unknown) => (typeof v === "function" ? sampleFn(v as (n: number, f: number) => number) : v)));
}

/** 经典世界用到的曲目：主题曲、七首航海曲、风暴、七首港口曲、海战。 */
const CLASSIC: readonly TrackId[] = ["title", "sea", "sea_north", "sea_south", "sea_islands", "sea_east", "sea_new", "ocean", "storm", "port_mediterranean", "port_nordic", "port_lowland", "port_desert", "port_islands", "port_eastern", "port_frontier", "battle"];

/** 一首曲子的指纹：定义本身加上每一遍展开后的全部音符事件（两套编配）。 */
function trackPrint(t: TrackDef): string {
  const passes = t.forms.map((_, p) => realizePass(t, p));
  return fingerprint({ def: t, passes });
}

describe("经典世界的配乐逐采样不变", () => {
  it("经典世界的曲目（两套编配）、短乐句与原有的乐器表、鼓点表、管弦版的乐器表，指纹与第二阶段之前一致", () => {
    const prints: Record<string, string> = {};
    for (const id of CLASSIC) {
      prints[`synth:${id}`] = trackPrint(TRACKS[id]);
      prints[`orch:${id}`] = trackPrint(ORCH_TRACKS[id]);
    }
    for (const [id, t] of Object.entries(JINGLES)) prints[`jingle:${id}`] = trackPrint(t);
    for (const [id, t] of Object.entries(ORCH_JINGLES)) prints[`ojingle:${id}`] = trackPrint(t);
    prints.coreInstruments = fingerprint(CORE_INSTRUMENTS);
    prints.coreDrums = fingerprint(CORE_DRUMS);
    prints.orchInstruments = fingerprint(ORCH_INSTRUMENTS);
    expect(fingerprint(prints)).toBe(CLASSIC_PRINT);
  });

  it("经典世界的地域与海区表照旧", () => {
    expect(ZONE_TRACK).toEqual({ inner: "sea", north: "sea_north", south: "sea_south", islands: "sea_islands", eastern: "sea_east", newworld: "sea_new", ocean: "ocean" });
    expect(REGION_ZONES.length).toBe(23);
  });
});

/** 第二阶段之前（main 上 bbad47d）的指纹；经典世界的配乐有意改动时才更新，并在 docs/DECISIONS.md 记一笔。
 * 2026-11-26：经典曲目清单撤下一首（原 2f11f0f3），其余各首的逐首指纹见别的测试，没有变。 */
const CLASSIC_PRINT = "958f8c15";
