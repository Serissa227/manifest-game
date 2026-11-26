// 地方特色第二阶段的曲子（中南半岛与菲律宾）：暹罗、缅甸、大越、菲律宾四首港口曲，苏禄海的航海曲，重编的《丁香群岛的铜锣》与《吉里的读经声》。
// 编织式写法的小工具；各曲的地方语汇（暹罗的七平均律近似与“钦—恰”、缅甸的突然停顿、越南的北调与南调·怨的 xự、库林唐的八只锣、甘丁甘的四只锣）；
// 港口曲与音乐分区的对应；经典世界的配乐逐音不变。
import { describe, expect, it } from "vitest";
import { townStyleOf } from "../art/buildings";
import { lineOf, realizePass, type TrackDef } from "./score";
import { CORE_DRUMS, CORE_INSTRUMENTS, DRUMS, INSTRUMENTS } from "./instruments";
import { ORCH_INSTRUMENTS } from "./orchestra/instruments";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { TRACKS, type TrackId } from "./tracks";
import { contract, gongCircle, octave, paraphrase, syncopate } from "./tracks/mainland";
import { MUSIC_ZONE_TRACK, musicTrackOf, PORT_STYLE_TRACK, portTrackOf, ZONE_TRACK } from "./zones";
import { TERRA16_FACTIONS, TERRA16_REGIONS, terra16PortTrack } from "../test/terra16";

/** 这一阶段新写或重编的曲子。 */
const MINE = ["port_siam", "port_burma", "port_vietnam", "port_philippines", "sea_sulu", "sea_nusantara", "ac_giri"] as const;

/** 一遍里某个声部的音（按时间）。 */
function notesOf(t: TrackDef, voice: string, pass = 0) {
  return realizePass(t, pass).events.filter((e) => e.voice === voice);
}
const pc = (m: number) => ((m % 12) + 12) % 12;

describe("编织式写法的小工具（暹罗的异音）", () => {
  it("移八度：大小写与 ' , 记号互换，升降号（含四分之一音）原样保留", () => {
    expect(octave("G", -1)).toBe("G,");
    expect(octave("g", -1)).toBe("G");
    expect(octave("g'", -2)).toBe("G");
    expect(octave("_/B", 1)).toBe("_/b");
    expect(octave("_/e", -2)).toBe("_/E,");
    expect(octave("^F,", 2)).toBe("^f");
  });

  it("木琴的加花：每拍两个八分音符，开头落回骨干；密的一种每拍四个十六分音符；小节线照拍数补", () => {
    const ladder = { notes: ["D", "_/E", "G", "A", "_/B", "d"] };
    const core = ["G", "A", "_/B", "d", "_/B", "A", "G", "G"];
    const p = paraphrase(core, ladder);
    const bars = p.split("|").map((b) => b.trim().split(/\s+/));
    expect(bars.length).toBe(2);
    expect(bars[0].length).toBe(8);
    // 每拍第一个音就是骨干
    expect(bars[0].filter((_, i) => i % 2 === 0)).toEqual(["G", "A", "_/B", "d"]);
    // 只差一级时绕到目标的另一侧：G → A 之间经过半降B
    expect(bars[0][1]).toBe("_/B");
    // 同音时用上邻音
    expect(bars[1][7]).toBe("A");
    const d = paraphrase(core, ladder, true);
    expect(d.split("|")[0].trim().split(/\s+/)[0]).toBe("G/2A/2G/2_/B/2");
    const t = { id: "x", title: { zh: "x", en: "x" }, qpm: 96, meter: [4, 4] as const, key: "G mixolydian", voices: {}, sections: { A: { bars: 2, lines: { a: p, b: d, c: gongCircle(core), s: syncopate(core) } } }, forms: [[{ s: "A", play: "" }]], rest: [0, 0] as const };
    for (const l of ["a", "b", "c", "s"]) expect(lineOf(t, "A", l).length, l).toBeCloseTo(16, 6);
  });

  it("围锣句尾隔八度；低音木琴低八度、切分；快一层的骨干每两拍取一个音", () => {
    expect(gongCircle(["G", "A", "_/B", "d"])).toBe("G2 A2 _/B2 [Dd]2");
    expect(syncopate(["G", "A", "_/B", "d", "A", "G", "_/E", "D"])).toBe("z G, A, z _/B,2 D2 | A,2 z G, z _/E, D,2");
    expect(contract(["a", "b", "c", "d", "e", "f"])).toEqual(["b", "d", "f"]);
  });
});

describe("地方特色第二阶段的曲子", () => {
  for (const id of MINE) {
    it(`${id}：不写西洋的和弦（只有空五度的持续音）；至少两件有音高的地方乐器奏旋律；合成版的衬底很轻`, () => {
      const t = TRACKS[id];
      for (const [name, s] of Object.entries(t.sections)) expect(s.chords, `${id} ${name}`).toBeUndefined();
      const melodic = new Set<string>();
      for (const form of t.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) {
        const m = /^(\w+):(\w+)/.exec(tok);
        if (m && Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, t.voices[m[2]].inst)) melodic.add(t.voices[m[2]].inst);
      }
      expect(melodic.size, id).toBeGreaterThanOrEqual(3);
      // 合成版的衬底（持续音、拨奏）声部音量都不超过 0.22
      for (const v of Object.values(t.voices)) if (v.inst === "drone" || v.inst === "pizz") expect(v.gain ?? 0.5, `${id} ${v.inst}`).toBeLessThanOrEqual(0.22);
      // 管弦版的衬底也很轻
      for (const v of Object.values(ORCH_TRACKS[id].voices)) if (v.inst.startsWith("o.")) expect(v.gain ?? 0.5, `${id} ${v.inst}`).toBeLessThanOrEqual(0.22);
    });
  }

  it("《湄南河的水市》：旋律按暹罗的七平均律近似（带四分之一音的半降B、半降E），“恰”落在每小节的第四拍、“钦”落在第二拍", () => {
    const t = TRACKS.port_siam;
    // 七平均律从 G 起的七个音级（约 0、171、343、514、686、857、1029 音分）的近似：G A 半降B C D 半降E F
    const ok = new Set([7, 9, 10.5, 0, 2, 3.5, 5]);
    let quarter = 0;
    for (const v of ["khong", "ranat", "thum", "pi", "khlui", "sawu"]) {
      for (const pass of [0, 1]) for (const e of notesOf(t, v, pass)) {
        expect(ok.has(pc(e.m)), `${v} ${e.m}`).toBe(true);
        if (pc(e.m) % 1 !== 0) quarter++;
      }
    }
    expect(quarter).toBeGreaterThan(50);
    // A 段（song chan）：每小节第二拍钦、第四拍恰
    const pass = realizePass(t, 0);
    const a = pass.steps[1];
    const bar = (60 / t.qpm) * 4;
    const ching = pass.events.filter((e) => e.voice === "ching" && e.t >= a.t - 0.05 && e.t < a.t + 8 * bar - 0.05);
    expect(ching.length).toBe(16);
    for (const e of ching) {
      const beat = Math.round(((e.t - a.t) % bar) / (bar / 4));
      expect(e.hit === "chap" ? beat : beat + 2, `${e.hit} 在第 ${beat + 1} 拍`).toBe(3);
    }
  });

  it("《勃固的鼓圈》：A′ 的第四小节后半全体突然停住——两套编配、两遍，连衬底（持续音、管弦版的弦乐）在内一个音也不响；下一小节帕玛一响再一起进来", () => {
    for (const t of [TRACKS.port_burma, ORCH_TRACKS.port_burma]) {
      for (const p of [0, 1]) {
        const pass = realizePass(t, p);
        const form = t.forms[p % t.forms.length];
        // A′ 分成 A2a（三小节）、A2s（停顿的一小节）、A2b（四小节），两套编配分段相同
        const i = form.findIndex((s) => s.s === "A2s");
        expect(form[i - 1].s, `${t.id} 第 ${p + 1} 遍`).toBe("A2a");
        expect(form[i + 1].s, `${t.id} 第 ${p + 1} 遍`).toBe("A2b");
        const from = pass.steps[i].t;
        const to = pass.steps[i + 1].t;
        // 停顿：A2s 的后半（这一小节在渐快，前半略长于一半）到 A2b 的第一拍之前（留出时间抖动的余量）
        const gapFrom = from + 0.52 * (to - from);
        const gapTo = to - 0.01;
        // 按“正在响”查，不只查起音：持续音一铺就是整段，起音在停顿之前也会响进停顿里
        const sounding = pass.events.filter((e) => e.t < gapTo && e.t + e.d > gapFrom);
        expect(sounding.map((e) => `${e.voice}@${e.t.toFixed(2)}+${e.d.toFixed(2)}`), `${t.id} 第 ${p + 1} 遍`).toEqual([]);
        // A2s 一小节里不放衬底的声部
        const bed = Object.keys(t.voices).filter((v) => ["drone", "pizz"].includes(t.voices[v].inst) || t.voices[v].inst.startsWith("o."));
        expect(pass.events.filter((e) => e.t >= from - 0.01 && e.t < to - 0.01 && bed.includes(e.voice) && e.voice !== "bass" && e.voice !== "cbp")).toEqual([]);
        // 帕玛在 A2b 的第一拍一响，持续音同时回来
        const back = pass.events.filter((e) => e.voice === "patma" && e.t > gapTo - 0.01 && e.t < to + 0.3);
        expect(back.length, `${t.id} 第 ${p + 1} 遍`).toBe(1);
        const droneBack = pass.events.filter((e) => bed.includes(e.voice) && e.voice !== "bass" && e.voice !== "cbp" && Math.abs(e.t - to) < 0.02);
        expect(droneBack.length, `${t.id} 第 ${p + 1} 遍`).toBeGreaterThan(0);
      }
    }
  });

  it("《会安的河埠》：北调（C D F G A）的段落不用降 E、降 B；南调·怨的段落里独弦琴扳着降 B 与 xự（半降 E，不是平均律的降 E）唱", () => {
    const t = TRACKS.port_vietnam;
    const bac = new Set([0, 2, 5, 7, 9]);
    for (const l of ["mel", "sao"]) for (const n of lineOf(t, "A", l).notes) for (const m of n.pitches) expect(bac.has(pc(m)), `${l} ${m}`).toBe(true);
    const oan = lineOf(t, "B", "oan").notes;
    const pcs = new Set(oan.flatMap((n) => n.pitches.map(pc)));
    // 怨调的 xự 不是平均律的降 E：写成半降 E（比 C 高约 350 音分，介于降 E 与 E 之间）；降 B 照旧
    expect(pcs.has(3.5) && pcs.has(10)).toBe(true);
    // 怨调段落里独弦琴与檀筝用同一个 xự：没有平均律的降 E 或还原 E
    for (const l of ["oan", "low2"]) for (const n of lineOf(t, "B", l).notes) for (const m of n.pitches) expect([3, 4], `${l} ${m}`).not.toContain(pc(m));
    expect(oan.filter((n) => n.deco.some((d) => d === "bend" || d === "fall" || d === "vib")).length).toBeGreaterThanOrEqual(6);
    // xự 上又按又颤
    expect(oan.filter((n) => pc(n.pitches[0]) === 3.5 && n.deco.some((d) => d === "bend" || d === "vib")).length).toBeGreaterThanOrEqual(2);
    expect(t.voices.bau.inst).toBe("dan_bau");
  });

  it("《会安的河埠》：月琴跟着独弦琴的旋律加花（异音）——只用北调的五个音，每拍的落音大都与旋律同音，不逐小节换根音", () => {
    const t = TRACKS.port_vietnam;
    const bac = new Set([0, 2, 5, 7, 9]);
    const nguyet = lineOf(t, "A", "nguyet").notes;
    const mel = lineOf(t, "A", "mel").notes;
    for (const n of nguyet) for (const m of [...n.pitches, ...n.grace]) expect(bac.has(pc(m)), `nguyet ${m}`).toBe(true);
    // 某一时刻正在响的音（单位是八分音符）
    const at = (ns: typeof mel, u: number) => ns.find((n) => n.at <= u + 1e-6 && u < n.at + n.len - 1e-6);
    let same = 0;
    let beats = 0;
    for (let u = 0; u < 64; u += 2) {
      const a = at(nguyet, u);
      const b = at(mel, u);
      if (!a || !b) continue;
      beats++;
      if (pc(a.pitches[0]) === pc(b.pitches[0])) same++;
    }
    expect(beats).toBe(32);
    expect(same, `${same} / ${beats}`).toBeGreaterThanOrEqual(24);
    // 跟旋律在同一个音区（不是低音线）：月琴的音都不低于旋律最低音下面的纯四度
    const low = Math.min(...mel.flatMap((n) => n.pitches));
    for (const n of nguyet) for (const m of n.pitches) expect(m, `nguyet ${m}`).toBeGreaterThanOrEqual(low - 5);
    // 北调段落的低音拨奏只落在持续音的 C 与 G 上
    for (const n of lineOf(t, "A", "low").notes) for (const m of n.pitches) expect([0, 7], `low ${m}`).toContain(pc(m));
  });

  it("《霍洛的锣》与《苏禄海的锣》：库林唐只用它那八只锣的音；阿贡在低处；巴本迪尔在锣乐的段落里一直不停", () => {
    const gongs = (t: TrackDef) => new Set(notesOf(t, "kul").concat(notesOf(t, "kul", 1)).map((e) => e.m));
    expect(gongs(TRACKS.port_philippines).size).toBeLessThanOrEqual(8);
    expect(gongs(TRACKS.sea_sulu).size).toBeLessThanOrEqual(8);
    // 两首用的是同一套八只锣
    for (const m of gongs(TRACKS.sea_sulu)) expect(gongs(TRACKS.port_philippines).has(m), `sea_sulu ${m}`).toBe(true);
    for (const t of [TRACKS.port_philippines, TRACKS.sea_sulu]) {
      for (const e of notesOf(t, "agung")) expect(e.m, t.id).toBeLessThanOrEqual(48);
      const steps = t.forms[0].filter((s) => s.play.includes("kul:kul") && s.s !== "intro" && s.s !== "coda");
      for (const s of steps) expect(s.play, `${t.id} ${s.s}`).toMatch(/\bbabendil\b/);
    }
  });

  it("甘丁甘一套只有四只吊锣：《霍洛的锣》与《苏禄海的锣》都不超过四个音高，苏禄海用的就是霍洛那一套", () => {
    const set = (t: TrackDef) => new Set(notesOf(t, "gand").concat(notesOf(t, "gand", 1)).map((e) => e.m));
    const jolo = set(TRACKS.port_philippines);
    const sulu = set(TRACKS.sea_sulu);
    expect(jolo.size).toBeLessThanOrEqual(4);
    expect(sulu.size).toBeLessThanOrEqual(4);
    expect(sulu.size).toBeGreaterThan(0);
    for (const m of sulu) expect(jolo.has(m), `sea_sulu gand ${m}`).toBe(true);
    // 管弦版共用同一份甘丁甘的声部
    for (const id of ["port_philippines", "sea_sulu"] as const) for (const m of new Set(notesOf(ORCH_TRACKS[id], "gand").map((e) => e.m))) expect(jolo.has(m), `${id} 管弦版 gand ${m}`).toBe(true);
  });

  it("重编的《丁香群岛的铜锣》与《吉里的读经声》：骨干旋律一个音也没改，改由萨龙与斯连特姆奏，咬合与锣的标点由同一条骨干生成", () => {
    expect(TRACKS.sea_nusantara.sections.A.lines!.bal).toBe("E2 F2 G2 B2 | c2 B2 G2 F2 | E2 G2 B2 c2 | B4 G4 | c2 B2 c2 e2 | e2 f2 e2 c2 | B2 G2 F2 G2 | E8");
    expect(TRACKS.sea_nusantara.sections.B.lines!.bal2).toBe("c2 e2 c2 B2 | G2 B2 G2 F2 | E2 F2 G2 B2 | G4 E4 | c2 B2 G2 B2 | c4 B4 | G2 F2 E2 F2 | E8");
    expect(TRACKS.ac_giri.sections.A.lines!.bal).toBe("F2 G2 A2 c2 | d2 c2 A2 F2 | G2 A2 d2 A2 | c4 G4 | A2 c2 d2 f2 | d2 c2 A2 c2 | G2 A2 c2 G2 | F8");
    // 苏灵笛的旋律：去掉装饰后与原来的木笛一音不差
    const plain = (t: TrackDef, s: string, l: string) => lineOf(t, s, l).notes.map((n) => `${n.at}:${n.len}:${n.pitches.join(",")}`);
    const old = { ...TRACKS.sea_nusantara, sections: { A: { bars: 8, lines: { s: "B6 c2 | e4 B4 | G6 F2 | E8 | z4 e3 f | g4 e4 | e4 c2 B2 | B8" } } } };
    expect(plain(TRACKS.sea_nusantara, "A", "suling")).toEqual(plain(old, "A", "s"));
    for (const id of ["sea_nusantara", "ac_giri"] as const) {
      const t = TRACKS[id];
      expect(t.voices.saron.inst).toBe("saron");
      expect(t.voices.slenthem.inst).toBe("slenthem");
      expect(t.voices.gong.inst).toBe("gong_ageng");
      expect(t.voices.suling.inst).toBe("suling");
    }
    expect(TRACKS.ac_giri.voices.terbang.inst).toBe("perc");
  });
});

describe("港口曲与音乐分区", () => {
  it("暹罗、缅甸、菲律宾的风格名有自己的港口曲；大越的风格名（数据里还没有）也对上了；占婆还没有自己的一首，与街景一样回退到马来；马来、爪哇、摩鹿加照旧", () => {
    const want: Record<string, TrackId> = {
      siamese: "port_siam",
      burmese: "port_burma",
      philippine: "port_philippines",
      vietnamese: "port_vietnam",
      dai_viet: "port_vietnam",
      champa: "port_malay",
      malay: "port_malay",
      javanese: "port_malay",
      moluccan: "port_malay",
      ming: "port_ming",
    };
    for (const [style, track] of Object.entries(want)) expect(portTrackOf("x", style), style).toBe(track);
    // 占婆不在港口曲表里：经 TOWN_ALIASES（champa → malay）回退，与街景同一个去处
    expect(Object.prototype.hasOwnProperty.call(PORT_STYLE_TRACK, "champa")).toBe(false);
    for (const id of ["port_siam", "port_burma", "port_philippines", "port_vietnam"]) expect(Object.values(PORT_STYLE_TRACK)).toContain(id);
    // 这几个风格名的街景都有着落（不会退到地中海）：大越借明，占婆、暹罗、缅甸、菲律宾借马来
    const town: Record<string, string> = { vietnamese: "ming", dai_viet: "ming", champa: "malay", siamese: "malay", burmese: "malay", philippine: "malay" };
    for (const [style, want] of Object.entries(town)) expect(townStyleOf("nowhere", style), style).toBe(want);
  });

  it("苏禄海一带的分区名对到《苏禄海的锣》；“东南亚”照旧是《丁香群岛的铜锣》；经典世界的“群岛”地域照旧是《信风群岛》", () => {
    for (const k of ["sulu", "Sulu Sea", "celebes-sea", "philippines", "mindanao", "visayas"]) expect(musicTrackOf(k), k).toBe("sea_sulu");
    for (const k of ["southeast_asia", "malacca", "java", "moluccas", "nusantara"]) expect(musicTrackOf(k), k).toBe("sea_nusantara");
    expect(ZONE_TRACK.islands).toBe("sea_islands");
    expect(MUSIC_ZONE_TRACK.islands).toBe("sea_islands");
  });

  it("寰宇的真实数据（配乐的数据接线，2026-10-11）：停大城、勃固、会安、汤都、马尼拉、宿务放各自的港口曲；苏禄海、菲律宾海放《苏禄海的锣》", () => {
    // 势力在数据里写的风格名（原来都写借来的 malay 或 ming，这四首与《苏禄海的锣》在寰宇里放不到）
    const styles = new Map(TERRA16_FACTIONS.map((f) => [f.key, f.style]));
    const want: Record<string, string> = {
      ayutthaya: "siamese",
      taungoo: "burmese",
      arakan: "burmese",
      sulu: "philippine",
      maguindanao: "philippine",
      luzon: "philippine",
      cebu_rajahnate: "philippine",
      dai_viet_mac: "vietnamese",
      le_trinh: "vietnamese",
    };
    for (const [key, style] of Object.entries(want)) expect(styles.get(key), key).toBe(style);
    const ports: Record<string, TrackId> = {
      ayutthaya_port: "port_siam",
      pegu: "port_burma",
      hoi_an: "port_vietnam",
      tondo: "port_philippines",
      manila: "port_philippines",
      cebu: "port_philippines",
    };
    for (const [place, track] of Object.entries(ports)) expect(terra16PortTrack(place), place).toBe(track);
    // 街景照旧：暹罗、缅甸、菲律宾借马来，大越借明
    for (const [key, style] of Object.entries(want)) expect(townStyleOf(key, style), key).toBe(style === "vietnamese" ? "ming" : "malay");
    // 海区：苏禄海写 sulu、菲律宾海写 philippines；苏拉威西海照旧写 nusantara（由数据定）
    const music = new Map(TERRA16_REGIONS.map((r) => [r.key, r.music]));
    expect(music.get("sulu")).toBe("sulu");
    expect(music.get("philippine_sea")).toBe("philippines");
    for (const k of ["sulu", "philippine_sea"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_sulu");
    expect(musicTrackOf(music.get("celebes"))).toBe("sea_nusantara");
  });
});

// ───────────────────────────── 经典世界的配乐逐音不变

/** FNV-1a（32 位）。 */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 乐器参数的指纹：谐波表（函数）按一组音高取值。 */
function instPrint(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "function" ? [110, 220, 440, 880].flatMap((f0) => Array.from({ length: 16 }, (_, i) => +(x as (n: number, f: number) => number)(i + 1, (i + 1) * f0).toPrecision(10))) : x));
}

/** 一首曲子（合成版与管弦版）的指纹：曲谱、每一遍展开的音符事件、用到的乐器与鼓点的参数。 */
function trackPrint(id: TrackId): string {
  const parts: string[] = [];
  for (const def of [TRACKS[id], ORCH_TRACKS[id]]) {
    parts.push(JSON.stringify(def));
    const hits = new Set<string>();
    for (let p = 0; p < def.forms.length; p++) {
      const pass = realizePass(def, p);
      parts.push(JSON.stringify(pass));
      for (const e of pass.events) if (e.hit) hits.add(e.hit);
    }
    for (const v of Object.values(def.voices)) parts.push(instPrint(INSTRUMENTS[v.inst] ?? ORCH_INSTRUMENTS[v.inst]));
    for (const h of [...hits].sort()) parts.push(instPrint(DRUMS[h]));
  }
  return fnv(parts.join("|"));
}

/** 经典世界的曲目：主题曲、七首航海曲、风暴、七首港口曲、海战。 */
const CLASSIC: readonly TrackId[] = [
  "title",
  "sea",
  "sea_north",
  "sea_south",
  "sea_islands",
  "sea_east",
  "sea_new",
  "ocean",
  "storm",
  "port_mediterranean",
  "port_nordic",
  "port_lowland",
  "port_desert",
  "port_islands",
  "port_eastern",
  "port_frontier",
  "battle",
];

/** 第九批地方特色第二阶段动手之前（main 的 bbad47d）量下的指纹。 */
const CLASSIC_PRINTS: Readonly<Record<string, string>> = {
  title: "6c548b9d",
  sea: "54e22ba1",
  sea_north: "34b2c1d2",
  sea_south: "1f2c85da",
  sea_islands: "799532f0",
  sea_east: "87adbc64",
  sea_new: "c2d6954d",
  ocean: "aed90ca0",
  storm: "3ec77599",
  port_mediterranean: "2bf01f1e",
  port_nordic: "ab372454",
  port_lowland: "564a4705",
  port_desert: "c43ddbd0",
  port_islands: "d136ab82",
  port_eastern: "f71a6cdb",
  port_frontier: "46a952cf",
  battle: "b682c657",
};
/** 原有的乐器表与鼓点表的指纹（同上）。 */
const CORE_PRINTS = { instruments: "7d139506", drums: "6e4214fa" } as const;

describe("经典世界的配乐逐音不变", () => {
  it("经典世界的十八首曲子（两套编配）：曲谱、每一遍的音符事件、用到的乐器与鼓点的参数与第二阶段之前完全一样", () => {
    const now = Object.fromEntries(CLASSIC.map((id) => [id, trackPrint(id)]));
    expect(now).toEqual(CLASSIC_PRINTS);
  });

  it("原有的乐器表与鼓点表一件没少、一个参数没动（地方乐器只追加）", () => {
    expect(fnv(instPrint(CORE_INSTRUMENTS))).toBe(CORE_PRINTS.instruments);
    expect(fnv(instPrint(CORE_DRUMS))).toBe(CORE_PRINTS.drums);
    for (const k of Object.keys(CORE_INSTRUMENTS)) expect(INSTRUMENTS[k], k).toBe(CORE_INSTRUMENTS[k]);
    for (const k of Object.keys(CORE_DRUMS)) expect(DRUMS[k], k).toBe(CORE_DRUMS[k]);
  });
});
