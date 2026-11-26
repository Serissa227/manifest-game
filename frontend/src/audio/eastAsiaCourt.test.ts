// 地方特色第二阶段·东亚宫廷的曲子：雅乐（《宫中的筝》）、琴箫（《社学的读书声》）、《潮待之海》《闽海长风》的地方乐器重编，
// 新的《东海的季风》（经典世界《瑶华季风》的地方乐器版，只给第九批世界）、养成的两首节日曲（日本《夏祭的囃子》、明《上元灯市》）；
// 海区的音乐分区、养成的节日按文化区选曲，以及经典世界的配乐一个音也没动（曲谱与原有乐器的指纹）。
import { describe, expect, it } from "vitest";
import terra16Regions from "../../../data/worlds/terra16/regions.toml?raw";
import { CORE_DRUMS, CORE_INSTRUMENTS, INSTRUMENTS } from "./instruments";
import { REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { chordsOf, lineOf, barUnits, realizePass, seedOf, type TrackDef } from "./score";
import { patternOf, strumVoicing, type ChordSpan, type Pattern } from "./score";
import { chordTone, pc, voiceLead } from "./theory";
import { TRACK_IDS, TRACKS, type TrackId } from "./tracks";
import { digestOf, eventTrack, FESTIVAL_CULTURE_TRACK, festivalTrack, publishUpbringing, upbringingBase, upbringingScene, useUbMusic, type UbMusicDigest, type UbMusicSource } from "./upbringing";
import { MUSIC_ZONE_TRACK, musicTrackOf, ZONE_TRACK } from "./zones";
import { overview } from "../test/fixtures";
import type { Overview } from "../ipc/types";

/** 这一阶段新编或新写的曲子。 */
const COURT: readonly TrackId[] = ["ac_kyoto", "ac_zhangzhou", "sea_japan", "sea_ming", "sea_east_china", "ub_matsuri", "ub_lantern"];

/** 声部用的地方乐器（不算打击乐）。 */
function regionalLeads(t: TrackDef): string[] {
  return [...new Set(Object.values(t.voices).map((v) => v.inst))].filter((i) => Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, i));
}

/** 一首曲子各段旋律行里用到的乐器（按曲式里“旋律行:声部”的写法）。 */
function playedBy(t: TrackDef, line: string): Set<string> {
  const out = new Set<string>();
  for (const form of t.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) if (tok.startsWith(`${line}:`)) out.add(t.voices[tok.slice(line.length + 1).replace(/[+~-].*$/, "")].inst);
  return out;
}

/** 打击乐声部的伴奏型里用到的鼓点。 */
function hitsOf(t: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(t.voices)) {
    const p = v.pattern;
    const list = p && !("kind" in p) ? Object.values(p) : p ? [p] : [];
    for (const x of list) if (x.kind === "drum") for (const [h] of Object.values(x.hits)) out.add(h);
  }
  return out;
}

describe("东亚宫廷的曲子：登记与地方乐器领奏", () => {
  it("三首新曲子在曲目表里（合成版与管弦版都有），曲名中英文都有", () => {
    for (const id of ["sea_east_china", "ub_matsuri", "ub_lantern"] as const) {
      expect(TRACK_IDS).toContain(id);
      expect(TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(TRACKS[id].title.zh.length).toBeGreaterThan(0);
      expect(TRACKS[id].title.en?.length).toBeGreaterThan(0);
    }
  });

  for (const id of COURT) {
    it(`${id}：两套编配都至少三件地方乐器领奏；合成版的衬底不用地方乐器以外的旋律乐器领奏；不写西洋的大小三和弦`, () => {
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) expect(regionalLeads(t).length, `${id} ${t === TRACKS[id] ? "合成版" : "管弦版"}`).toBeGreaterThanOrEqual(3);
      // 和弦记号（有的话）只用空五度、挂留、六和弦与五声音阶里的小七和弦——没有单独的大三、小三和弦
      const bar = barUnits(TRACKS[id].meter);
      for (const s of Object.values(TRACKS[id].sections)) {
        for (const span of chordsOf(s, bar)) {
          const tones = span.chord.tones.join(",");
          expect(tones === "0,4,7" || tones === "0,3,7", `${id} 的和弦 ${span.chord.symbol}`).toBe(false);
        }
      }
    });
  }

  it("《宫中的筝》是雅乐的管弦：筚篥唱骨干、龙笛缠绕、笙奏合竹（每个音簇五六个音）、乐琵琶与乐筝、钲鼓、羯鼓的片来、钓太鼓的“图—咚”；不写和弦", () => {
    const t = TRACKS.ac_kyoto;
    const insts = new Set(Object.values(t.voices).map((v) => v.inst));
    for (const i of ["hichiriki", "ryuteki", "sho", "gakubiwa", "gakuso", "shoko"]) expect(insts.has(i), i).toBe(true);
    const hits = hitsOf(t);
    for (const h of ["kakko", "kakko_rai", "tsuri_me", "tsuri_o"]) expect(hits.has(h), h).toBe(true);
    for (const [name, s] of Object.entries(t.sections)) {
      expect(s.chords, name).toBeUndefined();
      if (s.lines?.sho) for (const n of lineOf(t, name, "sho").notes) expect(n.pitches.length, `${name} 的合竹`).toBeGreaterThanOrEqual(5);
    }
    expect(playedBy(t, "hichi")).toEqual(new Set(["hichiriki"]));
  });

  it("《社学的读书声》是琴箫合奏：古琴的按音、走手音与泛音，箫；没有打击乐，不写和弦", () => {
    const t = TRACKS.ac_zhangzhou;
    const insts = new Set(Object.values(t.voices).map((v) => v.inst));
    for (const i of ["guqin", "guqin_zou", "guqin_fan", "xiao"]) expect(insts.has(i), i).toBe(true);
    expect(insts.has("perc")).toBe(false);
    for (const s of Object.values(t.sections)) expect(s.chords).toBeUndefined();
    // 琴的按音在低八度（-12）弹，走手音跟着同一个八度
    expect(t.forms[0].some((st) => st.play.includes("qin:qin-12") && st.play.includes("zou:zou-12"))).toBe(true);
  });

  it("《潮待之海》：尺八领奏、筝、三味线；阴音阶的 B 段换成能乐的囃子（能管、小鼓与大鼓、缔太鼓）", () => {
    const t = TRACKS.sea_japan;
    expect(playedBy(t, "shaku")).toEqual(new Set(["shakuhachi"]));
    expect(playedBy(t, "noh")).toEqual(new Set(["nohkan"]));
    const hits = hitsOf(t);
    for (const h of ["tsuzumi_pon", "otsuzumi", "shime", "taiko_don", "hyoshigi"]) expect(hits.has(h), h).toBe(true);
    for (const form of t.forms) for (const st of form) if (st.s === "B") expect(st.play).toMatch(/noh:nohkan/);
  });

  it("《闽海长风》：曲笛领唱、二胡与笙应答、洞箫与琵琶的南音、拍板打“板”", () => {
    const t = TRACKS.sea_ming;
    expect(playedBy(t, "lead")).toEqual(new Set(["qudi"]));
    expect(playedBy(t, "hucrew")).toEqual(new Set(["erhu", "sheng"]));
    expect(playedBy(t, "xbmel").has("xiao")).toBe(true);
    expect(hitsOf(t).has("paiban")).toBe(true);
  });

  it("《东海的季风》与经典的《瑶华季风》同一条旋律、同样的段落与速度，只换了乐器", () => {
    const a = TRACKS.sea_east_china;
    const b = TRACKS.sea_east;
    expect(a.qpm).toBe(b.qpm);
    expect(a.meter).toEqual(b.meter);
    expect(a.key).toBe(b.key);
    for (const [name, s] of Object.entries(b.sections)) {
      expect(a.sections[name]?.bars, name).toBe(s.bars);
      if (s.lines?.mel) expect(a.sections[name].lines?.mel, name).toBe(s.lines.mel);
    }
    expect(regionalLeads(b)).toEqual([]);
  });

  it("两首节日曲：日本是祭囃子（篠笛、当钲、缔太鼓、太鼓、拍子木），明是灯市的吹打与细乐（梆笛、唢呐、二胡、大笛、云锣、锣鼓、拍板）", () => {
    const m = TRACKS.ub_matsuri;
    const mi = new Set(Object.values(m.voices).map((v) => v.inst));
    for (const i of ["shinobue", "atarigane", "shamisen"]) expect(mi.has(i), i).toBe(true);
    for (const h of ["shime", "taiko_don", "hyoshigi"]) expect(hitsOf(m).has(h), h).toBe(true);
    const l = TRACKS.ub_lantern;
    const li = new Set(Object.values(l.voices).map((v) => v.inst));
    for (const i of ["bangdi", "suona", "erhu", "dadi", "yunluo", "pipa", "daluo", "xiaoluo"]) expect(li.has(i), i).toBe(true);
    for (const h of ["bangu", "tanggu", "bo", "paiban"]) expect(hitsOf(l).has(h), h).toBe(true);
    // 养成的曲子一遍不超过两分半，留白不超过 20 秒
    for (const t of [m, l]) {
      for (let p = 0; p < t.forms.length; p++) expect(realizePass(t, p).length, t.id).toBeLessThan(150);
      expect(t.rest[1]).toBeLessThanOrEqual(20);
    }
  });
});

describe("东海与黄海的音乐分区", () => {
  it("东海、黄海一类的分区名对到《东海的季风》；经典世界的 eastern 地域照旧是《瑶华季风》", () => {
    for (const k of ["east_china_sea", "East China Sea", "donghai", "yellow_sea", "huanghai", "bohai", "east_asia"]) expect(musicTrackOf(k), k).toBe("sea_east_china");
    expect(ZONE_TRACK.eastern).toBe("sea_east");
    expect(MUSIC_ZONE_TRACK.eastern).toBe("sea_east");
    expect(musicTrackOf("eastern")).toBe("sea_east");
    // 明与日本照旧
    expect(musicTrackOf("china")).toBe("sea_ming");
    expect(musicTrackOf("japan")).toBe("sea_japan");
  });

  it("寰宇的东亚海区（data/worlds/terra16/regions.toml 的 music）都放地方乐器领奏的东亚航海曲", () => {
    // 每个 [[regions]] 块取 key 与 music
    const music = new Map<string, string>();
    for (const block of terra16Regions.split(/^\[\[regions\]\]/m).slice(1)) {
      const key = /^key\s*=\s*"([^"]+)"/m.exec(block)?.[1];
      const zone = /^music\s*=\s*"([^"]+)"/m.exec(block)?.[1];
      if (key && zone) music.set(key, zone);
    }
    const EAST_ASIA: readonly TrackId[] = ["sea_ming", "sea_japan", "sea_east_china"];
    // 中国沿海：南海北部、台湾海峡、北部湾是《闽海长风》；东海、黄海、渤海与辽东湾是《东海的季风》
    // （配乐的数据接线，2026-10-11：这四片海的 music 由 china 改成 east_china_sea，按交接时的约定收紧——原来两首都算对，见 DECISIONS“测试期望值变更”）
    for (const k of ["south_china_north", "taiwan_strait", "tonkin"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_ming");
    for (const k of ["east_china_sea", "yellow_sea", "bohai", "liaodong_bay"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_east_china");
    // 日本的海
    for (const k of ["japan_sea", "seto_inland", "kuroshio"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_japan");
    // 写了中国、日本或东海一类分区名的海区，全都对到这三首之一
    const zones = new Set(["china", "chinese", "ming", "japan", "japanese", ...Object.keys(MUSIC_ZONE_TRACK).filter((z) => MUSIC_ZONE_TRACK[z] === "sea_east_china")]);
    for (const [k, z] of music) if (zones.has(z.toLowerCase())) expect(EAST_ASIA, k).toContain(musicTrackOf(z));
  });
});

describe("养成的节日按文化区选曲（没有文化区时与原来一样）", () => {
  const digest = (o: Partial<UbMusicDigest> = {}): UbMusicDigest => ({ stage: "academy", phase: "plan", festival: true, contestDay: false, contestOpen: false, ...o });
  const source = (o: Partial<UbMusicSource> = {}): UbMusicSource => ({ stage: "academy", phase: "plan", today: [1555, 7, 7], calendar: [{ date: [1555, 7, 7], days_left: 0, kind: "festival", key: "tanabata", name: "七夕", heart: true, note: null }], ...o });
  const cheerful = { ...overview, mode: "upbringing", story: { line: null, pending: { day: 1, fleet: 0, kind: "upbringing", key: "ev", title: "事件", text: "", speaker: { name: "澪" }, choices: [], mood: "cheerful" }, last: null, journal: [] } } as unknown as Overview;
  const plain = { ...overview, mode: "upbringing" } as Overview;

  it("文化区名 → 节日曲：日本《夏祭的囃子》、明《上元灯市》；不区分大小写；认不出或没有时为《节日的街》", () => {
    expect(festivalTrack("japan")).toBe("ub_matsuri");
    expect(festivalTrack(" Japanese ")).toBe("ub_matsuri");
    expect(festivalTrack("MING")).toBe("ub_lantern");
    expect(festivalTrack("china")).toBe("ub_lantern");
    expect(festivalTrack("ottoman")).toBe("ub_festival");
    expect(festivalTrack("")).toBe("ub_festival");
    expect(festivalTrack(null)).toBe("ub_festival");
    expect(festivalTrack(undefined)).toBe("ub_festival");
    for (const id of Object.values(FESTIVAL_CULTURE_TRACK)) expect(TRACK_IDS).toContain(id);
  });

  it("养成视图没给 culture：摘要里没有这个字段，节日照旧放《节日的街》（京都的学院、七夕也一样）", () => {
    const d = digestOf({ ...source(), academy: { key: "kyoto" }, protagonist: { key: "mio" } });
    expect("culture" in d).toBe(false);
    expect(upbringingBase(d)).toBe("ub_festival");
    expect(upbringingBase(digest())).toBe("ub_festival");
    expect(eventTrack(cheerful, digest())).toBe("ub_festival");
    expect(upbringingScene(plain, digest())).toEqual({ track: "ub_festival", urgent: false });
  });

  it("给了 culture：节日放这个文化区的曲子（平时、欢快的事件都一样）；结业与比赛照旧优先；不是节日时照旧放学院的曲子", () => {
    expect(digestOf(source({ culture: "japan" })).culture).toBe("japan");
    expect(digestOf(source({ culture: "  " }))).not.toHaveProperty("culture");
    expect(upbringingBase(digest({ culture: "japan" }))).toBe("ub_matsuri");
    expect(upbringingBase(digest({ culture: "ming" }))).toBe("ub_lantern");
    expect(upbringingBase(digest({ culture: "ottoman" }))).toBe("ub_festival");
    expect(eventTrack(cheerful, digest({ culture: "ming" }))).toBe("ub_lantern");
    expect(upbringingScene(cheerful, digest({ culture: "ming" }))).toEqual({ track: "ub_lantern", urgent: false });
    expect(upbringingBase(digest({ culture: "japan", contestDay: true }))).toBe("ub_contest");
    expect(upbringingBase(digest({ culture: "japan", phase: "done" }))).toBe("ub_graduation");
    expect(upbringingBase(digest({ culture: "japan", festival: false, academy: "kyoto" }))).toBe("ac_kyoto");
  });

  it("文化区换了才通知（摘要的比较带上文化区）", () => {
    useUbMusic.setState({ digest: null });
    let n = 0;
    const off = useUbMusic.subscribe(() => n++);
    publishUpbringing(source());
    publishUpbringing(source());
    publishUpbringing(source({ culture: "japan" }));
    publishUpbringing(source({ culture: "japan" }));
    publishUpbringing(source({ culture: "ming" }));
    expect(n).toBe(3);
    off();
    useUbMusic.setState({ digest: null });
  });
});

// ───────────────────────────── 实际奏出来的和声（10-11 复核）
// 只查和弦记号不够：笙的长音（pad）只取和弦的前几个音（D6 取三个音就是 D 大三和弦），扬琴分解的“10”是高八度的三音。
// 这里按伴奏型实际会奏出的音来查——每个和弦底下，所有伴奏声部（长音、分解、低音、扫弦、持续音）合起来的音级集合里
// 不能含有大三或小三和弦；再把每一遍真正展开出来，同一声部同时起的三个以上的音（长音和弦、旋律行里写的和弦）里也不能含有大三或小三和弦。

/** 这一批查和声的曲子：东亚宫廷的七首，加上第一阶段同样用笙与扬琴伴奏的《月港的市声》。 */
const HARMONY_CHECKED: readonly TrackId[] = [...COURT, "port_ming"];

/** 音级集合里含有的大三或小三和弦（没有时为空）。 */
function triadsIn(pcs: ReadonlySet<number>): string[] {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const out: string[] = [];
  for (let r = 0; r < 12; r++) {
    if (!pcs.has(r) || !pcs.has((r + 7) % 12)) continue;
    if (pcs.has((r + 4) % 12)) out.push(names[r]);
    if (pcs.has((r + 3) % 12)) out.push(`${names[r]}m`);
  }
  return out;
}

/** 曲式里的演奏记号 → 声部、变体与移调（与 score.ts 的写法相同）。 */
function playToken(tok: string): { line?: string; voice: string; variant?: string; shift: number } {
  const m = /^(?:(\w+):)?(\w+)(?:\.(\w+))?([+-]\d+)?(?:~(-?\d+))?$/.exec(tok);
  if (!m) throw new Error(tok);
  return { line: m[1], voice: m[2], variant: m[3], shift: m[4] ? Number(m[4]) : 0 };
}

/** 一个伴奏型在一段的每个和弦底下实际奏出的音级（下标与 spans 对齐）。 */
function patternPcs(p: Pattern, spans: readonly ChordSpan[], units: number, shift: number): Set<number>[] {
  const out = spans.map(() => new Set<number>());
  const spanAt = (u: number) => {
    let k = -1;
    spans.forEach((s, i) => {
      if (s.at <= u + 1e-9) k = i;
    });
    return k;
  };
  switch (p.kind) {
    case "pad":
      spans.forEach((s, i) => voiceLead(s.chord, p.low, p.high, null, p.size ?? 3).forEach((m) => out[i].add(pc(m + shift))));
      break;
    case "strum":
      spans.forEach((s, i) => strumVoicing(s.chord, p.low, p.high).forEach((m) => out[i].add(pc(m + shift))));
      break;
    case "drone":
      spans.forEach((_, i) => p.notes.forEach((m) => out[i].add(pc(m + shift))));
      break;
    case "arp": {
      const grid = p.grid ?? 1;
      const cells = p.steps.split(/\s+/).filter(Boolean);
      const steps = Math.round(units / grid);
      for (let i = 0; i < steps; i++) {
        const cell = cells[i % cells.length];
        if (cell === "." || cell === "-") continue;
        const k = spanAt(i * grid);
        if (k < 0) continue;
        const c = spans[k].chord;
        for (const part of cell.split("+")) out[k].add(pc((part === "B" ? c.bass : c.root + chordTone(c, part)) + shift));
      }
      break;
    }
    case "drum":
      break;
  }
  return out;
}

describe("东亚宫廷的曲子：实际奏出来的和声里没有西洋的大小三和弦", () => {
  for (const id of HARMONY_CHECKED) {
    it(`${id}：每个和弦底下，伴奏声部合起来奏出的音不含大三、小三和弦（两套编配、每一种曲式）`, () => {
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        const style = t === TRACKS[id] ? "合成版" : "管弦版";
        const bar = barUnits(t.meter);
        t.forms.forEach((form, fi) =>
          form.forEach((st, si) => {
            const section = t.sections[st.s];
            const spans = chordsOf(section, bar);
            if (spans.length === 0) return;
            const units = section.bars * bar;
            const union = spans.map(() => new Set<number>());
            for (const tok of st.play.split(/\s+/).filter(Boolean)) {
              const play = playToken(tok);
              if (play.line) continue;
              const p = patternOf(t.voices[play.voice], play.variant);
              if (!p) continue;
              patternPcs(p, spans, units, play.shift).forEach((set, i) => set.forEach((x) => union[i].add(x)));
            }
            union.forEach((set, i) => {
              expect(triadsIn(set), `${id} ${style} 第 ${fi + 1} 种曲式第 ${si + 1} 步（${st.s}）${spans[i].chord.symbol}：${[...set].join(",")}`).toEqual([]);
            });
          }),
        );
      }
    });

    it(`${id}：展开的每一遍里，同一声部同时起的三个以上的音不含大三或小三和弦（雅乐笙的合竹是音簇，不算）`, () => {
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        for (let p = 0; p < t.forms.length; p++) {
          const groups = new Map<string, Set<number>>();
          for (const e of realizePass(t, p).events) {
            if (e.hit) continue;
            // 雅乐的笙（sho）奏合竹：五六个音叠成的音簇，本来就会碰巧含着三和弦的音，不是和声进行
            if (t.voices[e.voice].inst === "sho") continue;
            const k = `${e.voice}@${e.t.toFixed(4)}`;
            let g = groups.get(k);
            if (!g) groups.set(k, (g = new Set()));
            g.add(pc(Math.round(e.m)));
          }
          for (const [k, g] of groups) {
            // 三个音正好是三和弦，四个以上的音（六和弦、七和弦一类）里含着三和弦，都算
            if (g.size < 3) continue;
            expect(triadsIn(g), `${id} ${t === TRACKS[id] ? "合成版" : "管弦版"} 第 ${p + 1} 遍 ${k}：${[...g].join(",")}`).toEqual([]);
          }
        }
      }
    });
  }
});

describe("东亚宫廷的曲子：南音的支声与灯市的鱼咬尾（10-11 复核）", () => {
  it("《闽海长风》的 B 段是南音：洞箫、琵琶、三弦与二胡（代二弦）支声、拍板打“板”，没有笙的和音、扬琴的分解与堂鼓", () => {
    for (const t of [TRACKS.sea_ming, ORCH_TRACKS.sea_ming]) {
      const bSteps = t.forms.flat().filter((st) => st.s === "B");
      expect(bSteps.length).toBeGreaterThan(0);
      for (const st of bSteps) {
        const voices = st.play.split(/\s+/).map((tok) => playToken(tok).voice);
        for (const v of ["sheng", "arp", "va", "chorus", "yq", "drum"]) expect(voices, `${st.play}`).not.toContain(v);
        expect(st.play).toMatch(/gu:sanxian/);
        expect(st.play).toMatch(/clap\.ban/);
        expect(st.play).toMatch(/bmel:pipa/);
      }
    }
    expect(TRACKS.sea_ming.voices.sanxian.inst).toBe("sanxian");
    expect(REGIONAL_INSTRUMENTS.sanxian).toBeTruthy();
  });

  it("《上元灯市》的旋律是“鱼咬尾”：A、B 两段两小节一句，下一句的头一个音与上一句的尾音同音（可差八度）", () => {
    const t = TRACKS.ub_lantern;
    const phrase = 2 * barUnits(t.meter);
    for (const [section, lines] of [
      ["A", ["mel", "hu"]],
      ["B", ["bmel", "qmel"]],
    ] as const) {
      for (const name of lines) {
        const notes = lineOf(t, section, name).notes;
        const count = t.sections[section].bars / 2;
        for (let k = 1; k < count; k++) {
          const prev = notes.filter((n) => n.at >= (k - 1) * phrase && n.at < k * phrase);
          const next = notes.filter((n) => n.at >= k * phrase && n.at < (k + 1) * phrase);
          const tail = prev[prev.length - 1].pitches[0];
          const head = next[0].pitches[0];
          expect(pc(head), `${section}/${name} 第 ${k} 句的尾音 ${tail} → 第 ${k + 1} 句的头 ${head}`).toBe(pc(tail));
        }
      }
    }
  });
});

// ───────────────────────────── 经典世界的配乐一个音也没动

/** 经典世界放的曲子：七首航海曲、风暴、七首港口曲、海战、主题曲。 */
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

/** 一份数据的指纹（JSON 的 FNV-1a，十六进制）。 */
function fp(x: unknown): string {
  return seedOf(JSON.stringify(x)).toString(16);
}

/** 持续音乐器的谐波表按几个音高取样（函数本身没法比较），数取到 1e-9。 */
function sampled(inst: (typeof CORE_INSTRUMENTS)[string]): unknown {
  if (inst.kind === "pluck" || inst.kind === "mallet" || inst.kind === "perc") return inst;
  const amps = [110, 220, 440, 880].map((f0) => Array.from({ length: 12 }, (_, i) => Math.round(inst.amps(i + 1, (i + 1) * f0) * 1e9) / 1e9));
  return { ...inst, amps };
}

describe("经典世界的配乐不变", () => {
  it("经典世界的曲子（合成版与管弦版）的曲谱与原来一模一样（指纹）", () => {
    const got = Object.fromEntries(CLASSIC.map((id) => [id, `${fp(TRACKS[id])}/${fp(ORCH_TRACKS[id])}`]));
    expect(got).toEqual(CLASSIC_PRINTS);
  });

  it("原有的乐器与鼓点（合成版）与原来一模一样，地方乐器没有顶替任何一件", () => {
    expect(fp(Object.fromEntries(Object.entries(CORE_INSTRUMENTS).map(([k, v]) => [k, sampled(v)])))).toBe(CORE_INSTRUMENTS_PRINT);
    expect(fp(CORE_DRUMS)).toBe(CORE_DRUMS_PRINT);
    for (const k of Object.keys(CORE_INSTRUMENTS)) expect(INSTRUMENTS[k], k).toBe(CORE_INSTRUMENTS[k]);
  });
});

/** 第九批配乐第二阶段之前（main 上 bbad47d）的指纹。 */
const CLASSIC_PRINTS: Readonly<Record<string, string>> = {
  title: "b28103e5/1ca79d04",
  sea: "725fe51e/4e79f5f8",
  sea_north: "15c2a97f/85743d78",
  sea_south: "7cadf045/3b6afb9e",
  sea_islands: "b11ca324/edf2a124",
  sea_east: "90961120/9c40a4c7",
  sea_new: "f1cefc0f/dd7e526f",
  ocean: "98afbed8/f5fcc931",
  storm: "72fc9484/b75164d2",
  port_mediterranean: "f0f8d766/36ec974f",
  port_nordic: "35b48468/58d3bd8",
  port_lowland: "afb2f414/6b366c11",
  port_desert: "113f6bed/8cfe0974",
  port_islands: "50d25877/95ab51b1",
  port_eastern: "1e5d52d9/a07534a2",
  port_frontier: "7817f113/be859be7",
  battle: "bc47529c/3c3d7ce0",
};
const CORE_INSTRUMENTS_PRINT = "7825692";
const CORE_DRUMS_PRINT = "6e4214fa";
