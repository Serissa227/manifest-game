// 地方特色第二阶段·奥斯曼军乐与希腊、黎凡特的曲目：海战的奥斯曼变奏《新月的战鼓》、希腊与黎凡特的港口曲《酒色的海湾》、
// 重编的黎凡特航海曲《雪松与珊瑚》——登记、地方乐器领奏、只用空五度（没有西洋的三和弦进行）、各自的乌苏尔与调式、
// 博鲁只吹泛音列上的音、管弦版的衬底比地方乐器轻；《雪松与珊瑚》的卡农琴异音齐奏、旋律不写分解三和弦、领奏各有带装饰的一行；
// 《金角湾的集市》的杜耶克改正；港口曲与海战曲的选法（希腊人的港口按停泊的海区；经典世界照旧是原来的曲子）；
// 红海、亚丁湾、阿拉伯海与波斯湾自己的航海曲《星与三角帆》（乌德琴、奈伊笛、克曼切领奏，D 萨巴，阿尤布节奏；不用黎凡特与爱琴海的乐器）。
import { describe, expect, it } from "vitest";
import type { LocView, StaticView } from "../ipc/types";
import { statics } from "../test/fixtures";
import { INSTRUMENTS } from "./instruments";
import { REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { isOrchestral } from "./orchestra/instruments";
import { ORCH_TRACKS } from "./orchestra/tracks";
import type { AbcLine } from "./abc";
import { barUnits, chordsOf, lineOf, patternOf, realizePass, type TrackDef } from "./score";
import { parseKey, pc } from "./theory";
import { TRACK_IDS, TRACKS, type TrackId } from "./tracks";
import { BATTLE_SEA_TRACK, BATTLE_STYLE_TRACK, battleTrackOf, isBattleTrack, MUSIC_ZONE_TRACK, musicTrackOf, PORT_SEA_TRACK, PORT_STYLE_TRACK, portTrackIn, portTrackOf, REGION_ZONES, seaTrackOf } from "./zones";

const IDS = ["battle_ottoman", "port_levant", "sea_levant", "sea_arabic"] as const;

/** 曲目里用到的乐器（声部的 inst，按曲式里真正奏到的声部）。 */
function played(track: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const form of track.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) out.add(track.voices[/^(?:\w+:)?(\w+)/.exec(tok)![1]].inst);
  return out;
}

/** 曲式里每一处“旋律行:声部”：[段落, 旋律行, 声部]（去掉移八度的写法）。 */
function linePlays(track: TrackDef): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const form of track.forms) {
    for (const st of form) {
      for (const tok of st.play.split(/\s+/)) {
        const m = /^(\w+):(\w+)/.exec(tok);
        if (m) out.push([st.s, m[1], m[2]]);
      }
    }
  }
  return out;
}

/** 一行旋律里的分解三和弦：连着的三个音（同音反复算一个）两步都是三度以上的跳进，三个音正好是一个大三或小三和弦。 */
function arpeggios(line: AbcLine): string[] {
  const ms: number[] = [];
  for (const n of line.notes) if (n.pitches.length === 1 && (ms.length === 0 || ms[ms.length - 1] !== n.pitches[0])) ms.push(n.pitches[0]);
  const triad = (a: number, b: number, c: number) => {
    const set = new Set([pc(a), pc(b), pc(c)]);
    if (set.size !== 3) return false;
    return [...set].some((r) => [3, 4].some((third) => set.has(pc(r + third)) && set.has(pc(r + 7))));
  };
  const out: string[] = [];
  for (let i = 0; i + 2 < ms.length; i++) {
    const [a, b, c] = [ms[i], ms[i + 1], ms[i + 2]];
    if (Math.abs(b - a) >= 3 && Math.abs(c - b) >= 3 && triad(a, b, c)) out.push(`${a} ${b} ${c}`);
  }
  return out;
}

/** 鼓点谱的击点（第几格，从 0 起）。 */
function strokesOf(steps: string): number[] {
  return [...steps.replace(/\s+/g, "")].map((c, i) => (c === "." ? -1 : i)).filter((i) => i >= 0);
}

/** 曲目里用到的鼓点。 */
function hits(track: TrackDef): Set<string> {
  const out = new Set<string>();
  for (let pass = 0; pass < track.forms.length; pass++) for (const e of realizePass(track, pass).events) if (e.hit) out.add(e.hit);
  return out;
}

describe("登记", () => {
  it("两首新曲目在曲目表与管弦版的表里，编号、曲名、调、留白两套一致；海战变奏与《黑帆》一样不留白", () => {
    for (const id of ["battle_ottoman", "port_levant"] as const) {
      expect(TRACK_IDS).toContain(id);
      expect(TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].title).toEqual(TRACKS[id].title);
      expect(ORCH_TRACKS[id].key).toBe(TRACKS[id].key);
    }
    expect(TRACKS.battle_ottoman.rest).toEqual([0, 0]);
    expect(TRACKS.battle_ottoman.title).toEqual({ zh: "新月的战鼓", en: "War Drums of the Crescent" });
    expect(TRACKS.port_levant.title).toEqual({ zh: "酒色的海湾", en: "The Wine-Dark Harbour" });
    // 重编不改编号、曲名与调
    expect(TRACKS.sea_levant.title).toEqual({ zh: "雪松与珊瑚", en: "Cedar and Coral" });
    expect(TRACKS.sea_levant.key).toBe("G hijaz");
    expect(TRACKS.sea_levant.meter).toEqual([10, 8]);
  });
});

describe("地方乐器领奏", () => {
  it("《新月的战鼓》：祖尔纳、博鲁号领奏，克斯、纳卡雷、达乌尔、齐尔、杰夫根全在（两套都是）", () => {
    for (const t of [TRACKS.battle_ottoman, ORCH_TRACKS.battle_ottoman]) {
      const inst = played(t);
      for (const k of ["zurna", "boru"]) expect(inst.has(k), k).toBe(true);
      const h = hits(t);
      for (const d of ["kos", "kos_hi", "nakkare_hi", "nakkare_lo", "davul_dum", "davul_tek", "zil", "zil_mute", "cevgen", "cevgen_tap"]) expect(h.has(d), d).toBe(true);
    }
  });

  it("《酒色的海湾》：布祖克、里拉琴、劳托领奏，奈伊笛与卡农琴，里拉琴弓上的小铃，达布卡打 3 + 2 + 2", () => {
    for (const t of [TRACKS.port_levant, ORCH_TRACKS.port_levant]) {
      const inst = played(t);
      for (const k of ["buzuq", "lyra", "laouto", "nay", "kanun"]) expect(inst.has(k), k).toBe(true);
      expect(hits(t).has("cevgen_tap")).toBe(true);
    }
    expect(TRACKS.port_levant.meter).toEqual([7, 8]);
    const darb = patternOf(TRACKS.port_levant.voices.darbuka);
    expect(darb?.kind).toBe("drum");
    if (darb?.kind === "drum") expect([...darb.steps].map((c, i) => (c === "." ? -1 : i)).filter((i) => i >= 0).slice(0, 3)).toEqual([0, 3, 5]);
  });

  it("《雪松与珊瑚》重编：布祖克、奈伊笛（新）、里拉琴、乌德琴（新）、卡农琴领奏，不再借用旧的 oud、ney、筝与提琴", () => {
    for (const t of [TRACKS.sea_levant, ORCH_TRACKS.sea_levant]) {
      const inst = played(t);
      for (const k of ["buzuq", "nay", "lyra", "ud", "kanun"]) expect(inst.has(k), k).toBe(true);
      for (const k of ["oud", "ney", "zheng", "fiddle", "strings"]) expect(inst.has(k), k).toBe(false);
      for (const d of ["darb_doum", "darb_tek", "riq", "bendir"]) expect(hits(t).has(d), d).toBe(true);
    }
  });

  it("管弦版里地方乐器的声部与合成版是同一份定义；管弦的声部只做衬底（每个声部的音量都比最轻的地方旋律声部小）", () => {
    for (const id of IDS) {
      const orch = ORCH_TRACKS[id];
      const synth = TRACKS[id];
      const lead: number[] = [];
      for (const [name, v] of Object.entries(orch.voices)) {
        if (isOrchestral(v.inst)) continue;
        expect(v, `${id} ${name}`).toBe(synth.voices[name]);
        if (Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, v.inst) && !v.pattern) lead.push(v.gain ?? 0.5);
      }
      expect(lead.length, id).toBeGreaterThanOrEqual(3);
      for (const [name, v] of Object.entries(orch.voices)) if (isOrchestral(v.inst)) expect(v.gain ?? 0.5, `${id} ${name}`).toBeLessThan(Math.min(...lead));
    }
  });
});

describe("和声与调式", () => {
  it("各首都只用空五度（D5、C5、G5、F5……），没有西洋的三和弦进行", () => {
    for (const id of IDS) {
      const t = TRACKS[id];
      for (const [name, s] of Object.entries(t.sections)) for (const span of chordsOf(s, barUnits(t.meter))) expect(span.chord.tones, `${id} ${name} ${span.chord.symbol}`).toEqual([0, 7]);
    }
  });

  it("调式：海战是 D 希贾兹，港口曲是 D 巴亚提（第二级降四分之一音），B 段写出希扎兹的降 E 与升 F", () => {
    expect(parseKey(TRACKS.battle_ottoman.key).mode).toBe("hijaz");
    expect(parseKey(TRACKS.port_levant.key).mode).toBe("bayati");
    const pitches = (s: string) => new Set(realizePass(TRACKS.port_levant, 0).events.filter((e) => e.voice === s && !e.hit).map((e) => pc(e.m)));
    // 布祖克奏到第二级的 E 半降（3.5），里拉琴在 B 段奏到希扎兹的降 E（3）与升 F（6）
    expect(pitches("buzuq").has(3.5)).toBe(true);
    const lyra = pitches("lyra");
    expect(lyra.has(3) && lyra.has(6)).toBe(true);
  });

  it("博鲁号只吹 D 号泛音列上的音（D、升F、A、C）", () => {
    for (const t of [TRACKS.battle_ottoman, ORCH_TRACKS.battle_ottoman]) {
      for (let pass = 0; pass < t.forms.length; pass++) {
        const boru = realizePass(t, pass).events.filter((e) => t.voices[e.voice].inst === "boru");
        expect(boru.length).toBeGreaterThan(10);
        for (const e of boru) expect([0, 2, 6, 9], `${t.id}#${pass} ${e.m}`).toContain(pc(e.m));
      }
    }
  });

  it("杜耶克乌苏尔：达乌尔一小节八个八分音符，打 咚 嗒 · 嗒 咚 · 嗒 ·（击点 1、2、4、5、7）；泰斯利姆只在这副骨架上加花；克斯每小节至少一声", () => {
    const t = TRACKS.battle_ottoman;
    const strokes = (steps: string) => [...steps.replace(/\s+/g, "")].map((c, i) => (c === "." ? -1 : i)).filter((i) => i >= 0);
    const a = patternOf(t.voices.davul, "a");
    expect(a?.kind).toBe("drum");
    if (a?.kind !== "drum") return;
    expect(a.steps.replace(/\s+/g, "")).toHaveLength(8);
    expect(strokes(a.steps)).toEqual([0, 1, 3, 4, 6]);
    // 第 1、5 个八分音符是“咚”（大槌），第 2、4、7 个是“嗒”（细棍）
    expect([0, 4].map((i) => a.hits[a.steps[i]][0])).toEqual(["davul_dum", "davul_dum"]);
    expect([1, 3, 6].map((i) => a.hits[a.steps[i]][0])).toEqual(["davul_tek", "davul_tek", "davul_tek"]);
    const teslim = patternOf(t.voices.davul, "t");
    expect(teslim?.kind).toBe("drum");
    if (teslim?.kind !== "drum") return;
    expect(teslim.steps.replace(/\s+/g, "")).toHaveLength(8);
    for (const i of [0, 1, 3, 4, 6]) expect(teslim.hits[teslim.steps[i]]?.[0], `泰斯利姆第 ${i + 1} 格`).toBe(a.hits[a.steps[i]][0]);
    // 加的花只是细棍的轻击，比骨架上的“嗒”轻
    for (const i of [2, 5, 7]) {
      const h = teslim.hits[teslim.steps[i]];
      if (!h) continue;
      expect(h[0]).toBe("davul_tek");
      expect(h[1]).toBeLessThan(teslim.hits[teslim.steps[1]][1]);
    }
    const p = realizePass(t, 0);
    const bar = (barUnits(t.meter) * 30) / t.qpm;
    const kos = p.events.filter((e) => e.hit === "kos" || e.hit === "kos_hi");
    const bars = Math.round(p.length / bar);
    const hitBars = new Set(kos.map((e) => Math.floor((e.t + 0.05) / bar)));
    expect(hitBars.size).toBeGreaterThanOrEqual(bars - 1);
  });

  it("《雪松与珊瑚》：卡农琴跟着旋律异音齐奏——每一处都奏旋律行（不弹分解和弦的伴奏型），每小节第一个音与领奏旋律同音名，句尾有碎的上下行", () => {
    const t = TRACKS.sea_levant;
    expect(t.voices.kanun.pattern).toBeUndefined();
    const lead: Record<string, string> = { A: "mel", B: "bmel" };
    const bar = barUnits(t.meter);
    const sounding = (line: AbcLine, u: number) => line.notes.find((n) => n.at <= u + 1e-9 && n.at + n.len > u + 1e-9);
    let plays = 0;
    for (const form of t.forms) {
      for (const st of form) {
        for (const tok of st.play.split(/\s+/)) {
          const m = /^(?:(\w+):)?(\w+)/.exec(tok)!;
          if (m[2] !== "kanun") continue;
          expect(m[1], `${st.s} ${tok}`).toBeTruthy();
          expect(Object.keys(lead)).toContain(st.s);
          plays++;
          const k = lineOf(t, st.s, m[1]);
          const l = lineOf(t, st.s, lead[st.s]);
          for (let b = 0; b < t.sections[st.s].bars; b++) {
            const kn = sounding(k, b * bar);
            const ln = sounding(l, b * bar);
            expect(kn && ln, `${st.s}/${m[1]} 第 ${b + 1} 小节`).toBeTruthy();
            expect(pc(kn!.pitches[0]), `${st.s}/${m[1]} 第 ${b + 1} 小节`).toBe(pc(ln!.pitches[0]));
          }
          // 句尾的碎音：比八分音符短的音
          expect(k.notes.filter((n) => n.len < 1).length, `${st.s}/${m[1]}`).toBeGreaterThanOrEqual(4);
        }
      }
    }
    expect(plays).toBeGreaterThanOrEqual(8);
  });

  it("各首的旋律行都不写分解三和弦（《雪松与珊瑚》B 段原来跟着三和弦写的降 B 大、降 A 大、G 大已改成级进的木卡姆句子；博鲁号除外——自然号只吹得出泛音列，号令本来就是这样）", () => {
    for (const id of IDS) {
      const t = TRACKS[id];
      const plays = linePlays(t);
      for (const [name, s] of Object.entries(t.sections)) {
        for (const line of Object.keys(s.lines ?? {})) {
          const by = plays.filter(([sec, l]) => sec === name && l === line).map(([, , v]) => t.voices[v].inst);
          if (by.length > 0 && by.every((inst) => inst === "boru")) continue;
          expect(arpeggios(lineOf(t, name, line)), `${id} ${name}/${line}`).toEqual([]);
        }
      }
    }
    // 检查本身认得出原来的写法
    const old: TrackDef = { ...TRACKS.sea_levant, id: "sea_levant_old_b", sections: { B: { bars: 3, lines: { b: "d3 f2 d2 _B3 | c3 e2 c2 A3 | B3 d2 B2 G3" } } } };
    expect(arpeggios(lineOf(old, "B", "b"))).toHaveLength(3);
  });

  it("《雪松与珊瑚》：领奏的奈伊笛、里拉琴各奏一行带装饰的旋律（奈伊笛按上来、深揉、往下落；里拉琴倚音、回旋音、往下落）", () => {
    const t = TRACKS.sea_levant;
    const lines = (voice: string) => [...new Set(linePlays(t).filter(([s, , v]) => v === voice && (s === "A" || s === "B")).map(([s, l]) => `${s}/${l}`))];
    const nay = lines("nay");
    expect(nay.length).toBeGreaterThanOrEqual(1);
    for (const sl of nay) {
      const [s, l] = sl.split("/");
      const abc = t.sections[s].lines![l];
      for (const d of ["!bend!", "!vib!", "!fall!", "{"]) expect(abc.includes(d), `${sl} ${d}`).toBe(true);
    }
    const lyra = lines("lyra");
    expect(lyra.length).toBeGreaterThanOrEqual(2);
    for (const sl of lyra) {
      const [s, l] = sl.split("/");
      const abc = t.sections[s].lines![l];
      for (const d of ["~", "{", "!fall!", "("]) expect(abc.includes(d), `${sl} ${d}`).toBe(true);
    }
  });

  it("《金角湾的集市》（第一阶段）的乌苏尔改正：库都姆与达乌尔打 8/8 的杜耶克（击点 1、2、4、5、7，咚在 1、5）；低音落在两个咚上；本迪尔只落在杜耶克的击点上", () => {
    const t = TRACKS.port_ottoman;
    for (const [name, dum, tek] of [
      ["kudum", "kudum_dum", "kudum_tek"],
      ["davul", "davul_dum", "davul_tek"],
    ] as const) {
      const p = patternOf(t.voices[name]);
      expect(p?.kind, name).toBe("drum");
      if (p?.kind !== "drum") return;
      expect(p.steps.replace(/\s+/g, ""), name).toHaveLength(8);
      expect(strokesOf(p.steps), name).toEqual([0, 1, 3, 4, 6]);
      expect([0, 4].map((i) => p.hits[p.steps[i]][0]), name).toEqual([dum, dum]);
      expect([1, 3, 6].map((i) => p.hits[p.steps[i]][0]), name).toEqual([tek, tek, tek]);
    }
    // 低音（合成版的拨奏、管弦版的低音提琴拨奏）落在第 1、5 个八分音符
    const roots = (p: ReturnType<typeof patternOf>) => (p?.kind === "arp" ? p.steps.split(/\s+/).flatMap((x, i) => (x === "1" ? [i] : [])) : null);
    expect(roots(patternOf(t.voices.bass))).toEqual([0, 4]);
    expect(roots(patternOf(ORCH_TRACKS.port_ottoman.voices.cbp))).toEqual([0, 4]);
    const bendir = patternOf(t.voices.bendir);
    expect(bendir?.kind).toBe("drum");
    if (bendir?.kind === "drum") for (const i of strokesOf(bendir.steps)) expect([0, 1, 3, 4, 6], `本迪尔第 ${i + 1} 格`).toContain(i % 8);
  });

  it("合成版的乐器都在乐器表里；地方乐器的声部不用采样", () => {
    for (const id of IDS) for (const v of Object.values(TRACKS[id].voices)) expect(INSTRUMENTS[v.inst], `${id} ${v.inst}`).toBeTruthy();
  });
});

describe("港口曲与海战曲的选法", () => {
  it("希腊与黎凡特的风格名有自己的港口曲；经典世界与第一阶段的选法不变", () => {
    for (const s of ["greek", "levant", "levantine", "syrian"]) expect(portTrackOf("x", s), s).toBe("port_levant");
    expect(PORT_STYLE_TRACK.greek).toBe("port_levant");
    expect(portTrackOf("cuilan", null)).toBe("port_mediterranean");
    // 整合后伊比利亚、意大利、阿拉伯各有一首（原来回退到地中海、沙漠，见 DECISIONS“测试期望值变更”）
    expect(portTrackOf("x", "iberian")).toBe("port_iberia");
    expect(portTrackOf("x", "arabic")).toBe("port_arabia");
    expect(portTrackOf("x", "ottoman")).toBe("port_ottoman");
    expect(portTrackOf("x", "italian")).toBe("port_italy");
  });

  it("寰宇里希腊人的港口（威尼斯、热那亚治下，势力风格是地中海）停在爱琴海与黎凡特海（music 写 levant、aegean）：《酒色的海湾》；奥斯曼的港口与别的海照旧", () => {
    for (const music of ["levant", "aegean", "Levant", " aegean ", "LEVANT"]) {
      expect(portTrackIn("venice", "mediterranean", music), music).toBe("port_levant");
      expect(portTrackIn("genoa", "mediterranean", music), music).toBe("port_levant");
      // 寰宇的数据里威尼斯、热那亚写 venetian、genoese（配乐的数据接线，2026-10-11）：意大利的一首在这两片海上同样换成希腊人的
      expect(portTrackIn("venice", "venetian", music), music).toBe("port_levant");
      expect(portTrackIn("genoa", "genoese", music), music).toBe("port_levant");
      // 奥斯曼的伊斯坦布尔、士麦那、贝鲁特照旧
      expect(portTrackIn("ottoman", "ottoman", music), music).toBe("port_ottoman");
      expect(portTrackIn("x", "greek", music), music).toBe("port_levant");
      expect(portTrackIn("x", "nordic", music), music).toBe("port_nordic");
    }
    // 别的海、没写 music：与 portTrackOf 一样。威尼斯、葡萄牙在数据里写 venetian、portuguese（配乐的数据接线，2026-10-11；原来写 mediterranean、
    // 由前端按势力 key 细分，见 DECISIONS“测试期望值变更”）；写粗分的地中海就是地中海的一首，不认势力 key
    for (const music of [null, undefined, "", "mediterranean", "adriatic", "ionian", "arabic", "red_sea", "sea_levant", "iberian"]) {
      expect(portTrackIn("venice", "venetian", music), `${music}`).toBe("port_italy");
      expect(portTrackIn("venice", "mediterranean", music), `${music}`).toBe("port_mediterranean");
    }
    for (const music of [null, undefined, "", "mediterranean", "adriatic", "ionian", "sea_levant", "iberian"]) {
      expect(portTrackIn("portugal", "portuguese", music), `${music}`).toBe("port_iberia");
    }
    // 阿拉伯的海上葡萄牙的港口（马斯喀特）城里是阿拉伯人：换成《乳香与咖啡的码头》（见 arabiaPersiaMaghreb.test.ts）
    for (const music of ["arabic", "red_sea"]) expect(portTrackIn("portugal", "portuguese", music), music).toBe("port_arabia");
    expect(PORT_SEA_TRACK.levant.port_mediterranean).toBe("port_levant");
    // 经典世界：海区不写 music，每个势力的港口曲与 portTrackOf 完全一样
    for (const f of statics.factions) expect(portTrackIn(f.key, f.style, statics.regions[0].music)).toBe(portTrackOf(f.key, f.style));
    for (const style of [null, "mediterranean", "nordic", "lowland", "desert", "islands", "eastern", "frontier", "ottoman", "ming", "japanese"]) {
      expect(portTrackIn("x", style, undefined), `${style}`).toBe(portTrackOf("x", style));
    }
  });

  const loc = (id: number, faction: number, region: number, kind: LocView["kind"] = "port"): LocView => ({ ...statics.locations[0], id, key: `l${id}`, kind, faction, region });
  /** 三个势力：0 奥斯曼、1 威尼斯（地中海）、2 莫卧儿（印度：街景借奥斯曼）；海区 0–2 各写或不写 music。 */
  const world = (music: (string | null)[], locs: LocView[]): StaticView => ({
    ...statics,
    factions: [
      { ...statics.factions[0], id: 0, key: "ottoman", style: "ottoman" },
      { ...statics.factions[1], id: 1, key: "venice", style: "mediterranean" },
      { ...statics.factions[0], id: 2, key: "mughal", style: "mughal" },
    ],
    regions: music.map((m, id) => ({ id, name: `海区${id}`, ...(m === null ? {} : { music: m }) })),
    locations: locs,
  });

  it("经典世界：每个海区、没有海区、没有静态数据，海战曲都是《黑帆》", () => {
    for (let r = 0; r < REGION_ZONES.length + 3; r++) expect(battleTrackOf(r, statics), `${r}`).toBe("battle");
    expect(battleTrackOf(null, statics)).toBe("battle");
    expect(battleTrackOf(undefined, statics)).toBe("battle");
    expect(battleTrackOf(-1, statics)).toBe("battle");
    expect(battleTrackOf(2.5, statics)).toBe("battle");
    expect(battleTrackOf(3, null)).toBe("battle");
  });

  it("海区写了黎凡特、红海或奥斯曼的 music：《新月的战鼓》；别的 music 不变", () => {
    const s = world(["levant", "red_sea", "ottoman", "sea_levant", "iberia", "japan"], []);
    for (const r of [0, 1, 2, 3]) expect(battleTrackOf(r, s), `${r}`).toBe("battle_ottoman");
    expect(battleTrackOf(4, s)).toBe("battle");
    expect(battleTrackOf(5, s)).toBe("battle");
    expect(BATTLE_SEA_TRACK.sea_levant).toBe("battle_ottoman");
  });

  it("没写 music 时按停泊在这片海的港口多半属于谁：奥斯曼多就是《新月的战鼓》；殖民点不算；借奥斯曼街景的莫卧儿不算奥斯曼", () => {
    const s = world([null, null, null], [loc(0, 0, 0), loc(1, 0, 0), loc(2, 1, 0), loc(3, 1, 1), loc(4, 1, 1), loc(5, 0, 1), loc(6, 2, 2), loc(7, 2, 2), loc(8, 0, 2, "site"), loc(9, 0, 2, "site")]);
    expect(battleTrackOf(0, s)).toBe("battle_ottoman");
    expect(battleTrackOf(1, s)).toBe("battle");
    expect(battleTrackOf(2, s)).toBe("battle");
    // 写了别的 music 的海区照样按港口投票（爱琴海是地中海的曲子，但岸上多是奥斯曼的港口）
    const aegean = world(["aegean"], [loc(0, 0, 0), loc(1, 0, 0), loc(2, 1, 0)]);
    expect(battleTrackOf(0, aegean)).toBe("battle_ottoman");
    expect(BATTLE_STYLE_TRACK.ottoman).toBe("battle_ottoman");
  });

  it("海战曲的变奏都在曲目表里、都算海战曲；航海曲与港口曲不算", () => {
    for (const id of [...Object.values(BATTLE_SEA_TRACK), ...Object.values(BATTLE_STYLE_TRACK)] as TrackId[]) {
      expect(TRACK_IDS).toContain(id);
      expect(isBattleTrack(id)).toBe(true);
    }
    expect(isBattleTrack("battle")).toBe(true);
    for (const id of ["sea_levant", "port_levant", "port_ottoman", "storm"] as const) expect(isBattleTrack(id)).toBe(false);
  });
});

describe("阿拉伯的海：《星与三角帆》", () => {
  const t = TRACKS.sea_arabic;

  /** 某个声部在一遍里奏到的音级（可有小数）。 */
  const pcsOf = (track: TrackDef, voice: string, pass = 0) => new Set(realizePass(track, pass).events.filter((e) => e.voice === voice && !e.hit).map((e) => pc(e.m)));

  it("在曲目表与管弦版的表里，编号、曲名、调、拍号、留白两套一致", () => {
    expect(TRACK_IDS).toContain("sea_arabic");
    expect(t.id).toBe("sea_arabic");
    expect(ORCH_TRACKS.sea_arabic.id).toBe("sea_arabic");
    expect(t.title).toEqual({ zh: "星与三角帆", en: "Stars and Lateen Sails" });
    expect(ORCH_TRACKS.sea_arabic.title).toEqual(t.title);
    expect(ORCH_TRACKS.sea_arabic.key).toBe(t.key);
    expect(ORCH_TRACKS.sea_arabic.meter).toEqual(t.meter);
    expect(ORCH_TRACKS.sea_arabic.rest).toEqual(t.rest);
    expect(parseKey(t.key).mode).toBe("bayati");
    expect(t.meter).toEqual([4, 4]);
  });

  it("乌德琴、奈伊笛、克曼切、卡农琴领奏（两套都是）；不用黎凡特与爱琴海的布祖克、里拉琴、劳托，也不借旧的 oud、ney 与提琴", () => {
    for (const track of [t, ORCH_TRACKS.sea_arabic]) {
      const inst = played(track);
      for (const k of ["ud", "nay", "kemence", "kanun"]) expect(inst.has(k), `${track.id} ${k}`).toBe(true);
      for (const k of ["buzuq", "lyra", "laouto", "oud", "ney", "fiddle", "strings", "zheng"]) expect(inst.has(k), `${track.id} ${k}`).toBe(false);
      for (const d of ["darb_doum", "darb_tek", "darb_ka", "tari", "tari_tek", "riq"]) expect(hits(track).has(d), `${track.id} ${d}`).toBe(true);
    }
    // 每一遍里乌德琴、奈伊笛、克曼切、卡农琴都奏到
    for (let pass = 0; pass < t.forms.length; pass++) {
      const voices = new Set(realizePass(t, pass).events.filter((e) => !e.hit).map((e) => e.voice));
      for (const v of ["ud", "nay", "kemence", "kanun"]) expect(voices.has(v), `#${pass} ${v}`).toBe(true);
    }
  });

  it("阿尤布节奏：达布卡十六分音符一格、一小节两轮“咚 · · 卡 咚 · 嗒 ·”；三种变体的“咚”与“嗒”都在同样的位置", () => {
    const cellsOf = (steps: string) => steps.replace(/\s+/g, "");
    const a = patternOf(t.voices.darbuka, "a");
    expect(a?.kind).toBe("drum");
    if (a?.kind !== "drum") return;
    expect(a.grid).toBe(0.5);
    expect(cellsOf(a.steps)).toHaveLength(16);
    expect(strokesOf(a.steps)).toEqual([0, 3, 4, 6, 8, 11, 12, 14]);
    const kind = (p: typeof a, i: number) => p.hits[cellsOf(p.steps)[i]]?.[0];
    for (const i of [0, 4, 8, 12]) expect(kind(a, i), `第 ${i + 1} 格`).toBe("darb_doum");
    for (const i of [6, 14]) expect(kind(a, i), `第 ${i + 1} 格`).toBe("darb_tek");
    for (const i of [3, 11]) expect(kind(a, i), `第 ${i + 1} 格`).toBe("darb_ka");
    for (const variant of ["soft", "b"]) {
      const p = patternOf(t.voices.darbuka, variant);
      expect(p?.kind, variant).toBe("drum");
      if (p?.kind !== "drum") return;
      expect(p.grid, variant).toBe(0.5);
      expect(cellsOf(p.steps), variant).toHaveLength(16);
      for (const i of [0, 4, 8, 12]) expect(kind(p, i), `${variant} 第 ${i + 1} 格`).toBe("darb_doum");
      for (const i of [6, 14]) expect(kind(p, i), `${variant} 第 ${i + 1} 格`).toBe("darb_tek");
      // 加的花只是比“嗒”轻的“卡”
      for (const i of strokesOf(p.steps)) if (![0, 4, 6, 8, 12, 14].includes(i)) expect(kind(p, i), `${variant} 第 ${i + 1} 格`).toBe("darb_ka");
    }
    // 塔尔框鼓的“咚”落在阿尤布的“咚”上
    for (const variant of ["a", "b"]) {
      const p = patternOf(t.voices.tari, variant);
      expect(p?.kind, variant).toBe("drum");
      if (p?.kind !== "drum") return;
      const cells = cellsOf(p.steps);
      for (const i of strokesOf(p.steps)) if (p.hits[cells[i]][0] === "tari") expect([0, 4, 8, 12], `${variant} 第 ${i + 1} 格`).toContain(i);
    }
  });

  it("萨巴：A 段奏到 E 半降（3.5）与降 G（6）、不奏还原 G；B 段升到还原 G 的巴亚提，到第 7 小节才沿降 G 落回；乌德琴、奈伊笛、克曼切、卡农琴都奏到这两个音", () => {
    const a = new Set(lineOf(t, "A", "mel").notes.flatMap((n) => n.pitches.map(pc)));
    expect(a.has(3.5) && a.has(6)).toBe(true);
    expect(a.has(7)).toBe(false);
    const b = lineOf(t, "B", "bmel").notes;
    const bp = new Set(b.flatMap((n) => n.pitches.map(pc)));
    expect(bp.has(7) && bp.has(6)).toBe(true);
    const bar = barUnits(t.meter);
    for (const n of b) if (n.pitches.some((p) => pc(p) === 6)) expect(Math.floor(n.at / bar), "B 段的降 G").toBe(6);
    for (const v of ["ud", "nay", "kemence", "kanun"]) {
      const p = pcsOf(t, v);
      expect(p.has(3.5) && p.has(6), v).toBe(true);
    }
  });

  it("萨巴的降 G 不与衬底撞：降 G 响着的时候，空五度里没有 F 与还原 G（A 段整段 D5）", () => {
    const bar = barUnits(t.meter);
    for (const [name, s] of Object.entries(t.sections)) {
      const spans = chordsOf(s, bar);
      for (const line of Object.keys(s.lines ?? {})) {
        for (const n of lineOf(t, name, line).notes) {
          if (!n.pitches.some((p) => pc(p) === 6)) continue;
          const span = spans.filter((x) => x.at <= n.at + 1e-9).pop()!;
          const tones = span.chord.tones.map((x) => pc(span.chord.root + x));
          expect(tones.includes(5) || tones.includes(7), `${name}/${line} ${n.at} ${span.chord.symbol}`).toBe(false);
        }
      }
    }
    for (const span of chordsOf(t.sections.A, bar)) expect(span.chord.symbol).toBe("D5");
  });

  it("卡农琴跟着旋律异音齐奏：每一处都奏旋律行（没有伴奏型），每小节第一个音与领奏旋律同音名，句尾有碎的上下行", () => {
    expect(t.voices.kanun.pattern).toBeUndefined();
    const lead: Record<string, string> = { A: "mel", B: "bmel" };
    const bar = barUnits(t.meter);
    const sounding = (line: AbcLine, u: number) => line.notes.find((n) => n.at <= u + 1e-9 && n.at + n.len > u + 1e-9);
    let plays = 0;
    for (const form of t.forms) {
      for (const st of form) {
        for (const tok of st.play.split(/\s+/)) {
          const m = /^(?:(\w+):)?(\w+)/.exec(tok)!;
          if (m[2] !== "kanun") continue;
          expect(m[1], `${st.s} ${tok}`).toBeTruthy();
          expect(Object.keys(lead)).toContain(st.s);
          plays++;
          const k = lineOf(t, st.s, m[1]);
          const l = lineOf(t, st.s, lead[st.s]);
          for (let b = 0; b < t.sections[st.s].bars; b++) {
            const kn = sounding(k, b * bar);
            const ln = sounding(l, b * bar);
            expect(kn && ln, `${st.s}/${m[1]} 第 ${b + 1} 小节`).toBeTruthy();
            expect(pc(kn!.pitches[0]), `${st.s}/${m[1]} 第 ${b + 1} 小节`).toBe(pc(ln!.pitches[0]));
          }
          expect(k.notes.filter((n) => n.len < 1).length, `${st.s}/${m[1]}`).toBeGreaterThanOrEqual(4);
        }
      }
    }
    expect(plays).toBeGreaterThanOrEqual(8);
  });

  it("奈伊笛与克曼切各奏带装饰的旋律行（奈伊笛按上来、深揉、往下落；克曼切回旋音、倚音、圆滑、往下落）；各行与乌德琴的旋律同一副骨架", () => {
    const lines = (voice: string) => [...new Set(linePlays(t).filter(([sec, , v]) => v === voice && (sec === "A" || sec === "B")).map(([sec, l]) => `${sec}/${l}`))];
    const check = (voice: string, decos: string[], min: number) => {
      const ls = lines(voice);
      expect(ls.length, voice).toBeGreaterThanOrEqual(min);
      for (const sl of ls) {
        const [sec, l] = sl.split("/");
        const abc = t.sections[sec].lines![l];
        for (const d of decos) expect(abc.includes(d), `${voice} ${sl} ${d}`).toBe(true);
      }
    };
    check("nay", ["!bend!", "!vib!", "!fall!", "{"], 2);
    check("kemence", ["~", "{", "!fall!", "("], 2);
    // 同一副骨架：各行每小节第一个音与乌德琴的旋律行同音名
    const bar = barUnits(t.meter);
    const first = (line: AbcLine, b: number) => line.notes.find((n) => n.at <= b * bar + 1e-9 && n.at + n.len > b * bar + 1e-9);
    for (const [sec, lead, others] of [
      ["A", "mel", ["nmel", "kem", "kmel"]],
      ["B", "bmel", ["bkem", "bnay", "kbmel"]],
    ] as const) {
      const l = lineOf(t, sec, lead);
      for (const o of others) {
        const x = lineOf(t, sec, o);
        for (let b = 0; b < t.sections[sec].bars; b++) expect(pc(first(x, b)!.pitches[0]), `${sec}/${o} 第 ${b + 1} 小节`).toBe(pc(first(l, b)!.pitches[0]));
      }
    }
  });

  it("选法：红海、亚丁湾、阿拉伯海与波斯湾（music 写 arabic、red_sea、aden、persian_gulf）是《星与三角帆》；黎凡特与奥斯曼的海照旧是《雪松与珊瑚》；遇敌都是《新月的战鼓》", () => {
    for (const m of ["arabic", "red_sea", "aden", "persian_gulf", "Red Sea", "Persian-Gulf", " ARABIC "]) expect(musicTrackOf(m), m).toBe("sea_arabic");
    for (const m of ["levant", "ottoman", "Levant"]) expect(musicTrackOf(m), m).toBe("sea_levant");
    // 布祖克与里拉琴领奏的《雪松与珊瑚》只剩黎凡特与奥斯曼的分区名指到它
    for (const [k, id] of Object.entries(MUSIC_ZONE_TRACK)) if (id === "sea_levant") expect(["levant", "ottoman"], k).toContain(k);
    expect(BATTLE_SEA_TRACK.sea_arabic).toBe("battle_ottoman");
    const s: StaticView = { ...statics, regions: ["arabic", "levant", "red_sea", "iberia"].map((m, id) => ({ id, name: `海区${id}`, music: m })) };
    expect(seaTrackOf(0, null, s)).toBe("sea_arabic");
    expect(seaTrackOf(1, null, s)).toBe("sea_levant");
    expect(seaTrackOf(2, null, s)).toBe("sea_arabic");
    expect(seaTrackOf(3, null, s)).toBe("sea_iberia");
    for (const r of [0, 1, 2]) expect(battleTrackOf(r, s), `${r}`).toBe("battle_ottoman");
    expect(battleTrackOf(3, s)).toBe("battle");
    // 阿拉伯的海上停泊的地中海风格港口（葡萄牙的霍尔木兹之类）不换成希腊的港口曲：与只按势力选的一样
    for (const m of ["arabic", "red_sea", "aden", "persian_gulf"]) {
      expect(portTrackIn("portugal", "mediterranean", m), m).toBe(portTrackOf("portugal", "mediterranean"));
      expect(portTrackIn("portugal", "mediterranean", m), m).not.toBe("port_levant");
    }
  });
});
