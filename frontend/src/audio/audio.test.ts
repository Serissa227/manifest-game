// 音乐：乐理、ABC 记谱、全部曲谱与短乐句的完整性（小节、和弦、声部、乐器、鼓点、强拍上的和声）、展开的确定性，
// 大编制的乐器（齐奏、滚奏、大厅混响）、短乐句的移调，以及合成算法。
import { describe, expect, it } from "vitest";
import { badBars, parseAbc } from "./abc";
import { biquad, creak, drum, filter, gull, mallet, noise, peak, pluck, reverbIR, slap } from "./dsp";
import { cueShift, DUCK, HALL, scheduleItems, unisonOffsets } from "./engine";
import { DRUMS, INSTRUMENTS, type SustainSpec } from "./instruments";
import { barUnits, chordsOf, lineOf, patternOf, realizePass, type TrackDef } from "./score";
import { chordTone, diatonicShift, parseChord, parseKey, pc, voiceLead } from "./theory";
import { TRACK_IDS, TRACKS } from "./tracks";
import { MORE_TRACK_IDS } from "./tracks/more";
import { CUE_IDS, JINGLES } from "./tracks/jingles";
import { STING_IDS, STINGS } from "./tracks/stings";

const SR = 32000;

describe("乐理", () => {
  it("调号：各调式推出正确的升降", () => {
    expect(parseKey("D dorian").signature).toMatchObject({ B: 0, C: 0, F: 0 });
    expect(parseKey("G mixolydian").signature).toMatchObject({ F: 0 });
    expect(parseKey("E minor").signature).toMatchObject({ F: 1 });
    expect(parseKey("A dorian").signature).toMatchObject({ F: 1, C: 0 });
    expect(parseKey("F major").signature).toMatchObject({ B: -1 });
    expect(parseKey("D major").signature).toMatchObject({ F: 1, C: 1 });
    // 巴亚提：E 降四分之一音、B 降半音
    expect(parseKey("D bayati").signature).toMatchObject({ E: -0.5, B: -1, F: 0 });
    expect(() => parseKey("H lydian")).toThrow();
    expect(() => parseKey("D blues")).toThrow();
  });

  it("调内平行：下方三度、导音的三度", () => {
    const d = parseKey("D dorian");
    expect(diatonicShift(d, 72, -2)).toBe(69); // C5 → A4
    expect(diatonicShift(d, 71, 2)).toBe(74); // B4 → D5
    const a = parseKey("A minor");
    expect(diatonicShift(a, 68, -2)).toBe(64); // 升 G4 → E4
    const e = parseKey("E minor");
    expect(diatonicShift(e, 63, -2)).toBe(59); // 升 D4 → B3
  });

  it("和弦记号与和弦音记号", () => {
    const dm = parseChord("Dm");
    expect(dm.tones).toEqual([0, 3, 7]);
    expect(chordTone(dm, "10")).toBe(15);
    expect(chordTone(dm, "5,")).toBe(-5);
    const sus = parseChord("Dsus4");
    expect(chordTone(sus, "3")).toBe(5);
    const slash = parseChord("A/C#");
    expect(pc(slash.bass)).toBe(1);
    expect(chordTone(slash, "b")).toBe(-8);
    const power = parseChord("D5");
    expect(chordTone(power, "3")).toBe(7);
    expect(() => parseChord("Dm13")).toThrow();
  });

  it("长音和弦就近进行：C → Am 保留共同音", () => {
    const c = voiceLead(parseChord("C"), 57, 74, null, 3);
    const am = voiceLead(parseChord("Am"), 57, 74, c, 3);
    const common = am.filter((m) => c.includes(m));
    expect(common.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ABC 记谱", () => {
  const key = parseKey("D dorian");
  it("时值、八度、休止与小节线", () => {
    const l = parseAbc("A | d3 e f2 | z C,2 c'2", key);
    expect(l.notes.map((n) => n.pitches[0])).toEqual([69, 74, 76, 77, 48, 84]);
    expect(l.notes.map((n) => n.len)).toEqual([1, 3, 1, 2, 2, 2]);
    expect(l.bars).toEqual([1, 7]);
    expect(l.length).toBe(12);
    expect(badBars(l, 6, 1)).toEqual([]);
  });

  it("升降号作用到小节线为止；调号来自调", () => {
    const l = parseAbc("^c c B | c _B B", key);
    expect(l.notes.map((n) => n.pitches[0])).toEqual([73, 73, 71, 72, 70, 70]);
    const bay = parseAbc("E _/B =E", parseKey("D bayati"));
    expect(bay.notes.map((n) => n.pitches[0])).toEqual([63.5, 70.5, 64]);
  });

  it("连音线、三连音、附点节奏、和弦、倚音、装饰与连线", () => {
    const l = parseAbc("A2-A2 (3def [DFA]2 d>e {g}f ~a2 (fg) !slide!a", key);
    const lens = l.notes.map((n) => n.len);
    expect(lens.slice(0, 4)).toEqual([4, 2 / 3, 2 / 3, 2 / 3]);
    expect(l.notes[4].pitches).toEqual([62, 65, 69]);
    expect(lens.slice(5, 7)).toEqual([1.5, 0.5]);
    expect(l.notes[7].grace).toEqual([79]);
    expect(l.notes[8].deco).toContain("roll");
    expect(l.notes[9].slur).toBe(true);
    expect(l.notes[10].slur).toBe(false);
    expect(l.notes[11].deco).toContain("slide");
  });

  it("写错时报错：反复记号、不认识的字符与装饰", () => {
    expect(() => parseAbc("|: d e :|", key)).toThrow();
    expect(() => parseAbc("d & e", key)).toThrow();
    expect(() => parseAbc("!wobble!d", key)).toThrow();
  });
});

/** 旋律行（mel 等）里落在小节第一拍、至少一拍长的音，与当时的和弦不能构成小二度 / 大七度的冲突。 */
function downbeatClashes(track: TrackDef): string[] {
  const out: string[] = [];
  const bar = barUnits(track.meter);
  for (const [name, section] of Object.entries(track.sections)) {
    const spans = chordsOf(section, bar);
    if (!spans.length) continue;
    for (const line of Object.keys(section.lines ?? {})) {
      const inst = new Set<string>();
      for (const form of track.forms) for (const st of form) if (st.s === name) for (const tok of st.play.split(/\s+/)) if (tok.startsWith(`${line}:`)) inst.add(tok);
      // 打击乐、定音鼓与钟的单独一行不算旋律
      if (["timp", "bell", "gong", "call", "gliss", "car"].includes(line)) continue;
      const parsed = lineOf(track, name, line);
      const pickup = section.pickup ?? 0;
      for (const n of parsed.notes) {
        const u = n.at - pickup;
        if (u < 0 || u % bar !== 0 || n.len < 2) continue;
        const span = spans.filter((s) => s.at <= u + 1e-9).pop();
        if (!span) continue;
        const tones = span.chord.tones.map((t) => pc(span.chord.root + t));
        for (const p of n.pitches) {
          const q = pc(p);
          if (tones.some((t) => Math.abs(t - q) < 1e-6)) continue;
          const clash = tones.some((t) => {
            const d = Math.min(pc(q - t), pc(t - q));
            return d > 0.9 && d < 1.1;
          });
          if (clash) out.push(`${track.id} ${name}/${line} 第 ${Math.floor(u / bar) + 1} 小节：音 ${p} 与 ${span.chord.symbol}`);
        }
      }
    }
  }
  return out;
}

/** 一首曲目（或短乐句）的每行旋律小节完整、和弦小节数正确，乐器、声部、伴奏型与鼓点都存在。 */
function checkScore(track: TrackDef): void {
  const id = track.id;
  const bar = barUnits(track.meter);
  for (const [name, section] of Object.entries(track.sections)) {
    chordsOf(section, bar);
    for (const line of Object.keys(section.lines ?? {})) {
      const parsed = lineOf(track, name, line);
      expect(badBars(parsed, bar, section.pickup ?? 0), `${id} ${name}/${line}`).toEqual([]);
      expect(parsed.length, `${id} ${name}/${line}`).toBeCloseTo(section.bars * bar, 6);
    }
  }
  for (const [name, v] of Object.entries(track.voices)) {
    expect(INSTRUMENTS[v.inst], `${id} 的声部 ${name}`).toBeTruthy();
    const variants = v.pattern && !("kind" in v.pattern) ? Object.values(v.pattern) : v.pattern ? [v.pattern] : [];
    for (const p of variants) if (p.kind === "drum") for (const [hit] of Object.values(p.hits)) expect(DRUMS[hit], `${id} 的鼓点 ${hit}`).toBeTruthy();
  }
  for (const form of track.forms) {
    for (const st of form) {
      expect(track.sections[st.s], `${id} 的段落 ${st.s}`).toBeTruthy();
      for (const tok of st.play.split(/\s+/)) {
        const m = /^(?:(\w+):)?(\w+)(?:\.(\w+))?/.exec(tok)!;
        const voice = track.voices[m[2]];
        expect(voice, `${id} ${st.s} 的 ${tok}`).toBeTruthy();
        if (m[1]) expect(track.sections[st.s].lines?.[m[1]], `${id} ${st.s} 的旋律行 ${m[1]}`).toBeTruthy();
        else expect(patternOf(voice, m[3]), `${id} ${st.s} 的伴奏型 ${tok}`).toBeTruthy();
      }
    }
  }
}

/** 持续音乐器（吹奏、弓弦、铜管）按乐句调度，其余逐音。 */
const PHRASED = new Set(["wind", "bowed", "brass"]);

/** 第九批·养成平时的轮换（2026-11-02）新写的十二首与第九批 A01（2026-11-11）多写的曲目：寰宇先只做中文，只起了中文名。 */
const ZH_ONLY = ["ub_home_iberia", "ub_home_lowlands", "ub_home_maghreb", "ub_home_gulf", "ub_home_swahili", "ub_home_maya", "ub_home_ming", "ub_home_japan", "ub_home_moluccas", "ub_study", "ub_dusk", "ub_breeze", ...MORE_TRACK_IDS] as const;

describe("曲谱", () => {
  it("原有 108 首曲目，后面接着第九批 A01 多写的（数量与清单在 moreTracks.test.ts 里查）（主题曲、七首航海曲、风暴、七首港口曲、海战；第九批十二首新海区的航海曲、十首养成的情境音乐、八首新文化的港口曲、十所学院的短主题与彼界；地方特色第二阶段：伊比利亚与意大利的两首港口曲，北欧的五首港口曲与最北海路的一首，阿拉伯、波斯、马格里布的三首港口曲，奥斯曼军乐的海战变奏、黎凡特的港口曲与阿拉伯的海的航海曲，非洲的四首港口曲与几内亚湾的航海曲，莫卧儿宫廷与南印度的两首港口曲与印度沿岸的航海曲，暹罗、缅甸、大越、菲律宾南部的四首港口曲与苏禄海的航海曲，东亚宫廷的东海航海曲与日本、明的两首节日曲，朝鲜、琉球、女真与满洲的三首港口曲，美洲的阿兹特克、泰诺、图皮三首港口曲与巴西沿岸的航海曲，太平洋的港口曲；养成平时轮换的九首家乡曲与三首通用的平时曲），编号与表一致", () => {
    expect(TRACK_IDS.length).toBe(108 + MORE_TRACK_IDS.length);
    expect(TRACK_IDS.slice(108)).toEqual([...MORE_TRACK_IDS]);
    // 地方特色第二阶段（北欧）：低地国家、英格兰、法兰西、汉萨、罗斯的港口曲，最北的海路
    for (const id of ["port_flanders", "port_england", "port_france", "port_hansa", "port_russia", "sea_arctic"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段（奥斯曼军乐与希腊、黎凡特；红海、亚丁湾、阿拉伯海与波斯湾的航海曲）
    for (const id of ["port_levant", "battle_ottoman", "sea_arabic"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段（非洲）：埃塞俄比亚、刚果与安哥拉、曼丁与塞内冈比亚、贝宁湾的港口曲，几内亚湾的航海曲
    for (const id of ["port_ethiopia", "port_kongo", "port_guinea", "port_benin", "sea_guinea"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段（中南半岛与菲律宾）：暹罗、缅甸、大越、菲律宾南部的港口曲，苏禄海的航海曲
    for (const id of ["port_siam", "port_burma", "port_vietnam", "port_philippines", "sea_sulu"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段·东亚宫廷：东海的航海曲与日本、明的两首节日曲
    for (const id of ["sea_east_china", "ub_matsuri", "ub_lantern"] as const) expect(TRACK_IDS).toContain(id);
    for (const id of TRACK_IDS) expect(TRACKS[id].id).toBe(id);
    for (const id of ["sea", "sea_north", "sea_south", "sea_islands", "sea_east", "sea_new", "ocean", "storm"] as const) expect(TRACK_IDS).toContain(id);
    // 第九批：伊比利亚与大西洋沿岸、印度洋（季风）、明的沿海、日本的内海
    for (const id of ["sea_iberia", "sea_monsoon", "sea_ming", "sea_japan"] as const) expect(TRACK_IDS).toContain(id);
    // 第九批第二轮：地中海、北海与波罗的海、黎凡特与红海、东南亚、加勒比、安第斯沿岸、远洋太平洋、黑暗之海
    for (const id of ["sea_med", "sea_hansa", "sea_levant", "sea_nusantara", "sea_caribbean", "sea_andes", "sea_pacific", "sea_dark"] as const) expect(TRACK_IDS).toContain(id);
    // 第九批：养成的情境音乐
    const ub = ["ub_home", "ub_academy", "ub_festival", "ub_heart", "ub_tense", "ub_sad", "ub_mystic", "ub_contest", "ub_graduation", "ub_letter"] as const;
    for (const id of ub) expect(TRACK_IDS).toContain(id);
    // 第九批第三轮：新文化的港口曲、学院的短主题、彼界
    const ports = ["port_japan", "port_ming", "port_ottoman", "port_swahili", "port_malay", "port_maya", "port_andes", "port_india"] as const;
    const academies = ["ac_kyoto", "ac_antwerp", "ac_ship", "ac_zhangzhou", "ac_merida", "ac_seville", "ac_fez", "ac_giri", "ac_azhar", "ac_generic"] as const;
    for (const id of [...ports, ...academies, "realm_elves"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段：文艺复兴的伊比利亚与意大利的港口曲
    for (const id of ["port_iberia", "port_italy"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段：阿拉伯（与马穆鲁克的埃及）、波斯、马格里布的港口曲
    for (const id of ["port_arabia", "port_persia", "port_maghreb"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段：莫卧儿宫廷与南印度（马拉巴尔）的港口曲、印度沿岸的航海曲
    for (const id of ["port_mughal", "port_malabar", "sea_india"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段：朝鲜、琉球、女真与满洲的港口曲
    for (const id of ["port_korea", "port_ryukyu", "port_jurchen"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段·美洲：阿兹特克、加勒比、巴西的港口曲，巴西沿岸的航海曲
    for (const id of ["port_aztec", "port_caribbean", "port_brazil", "sea_brazil"] as const) expect(TRACK_IDS).toContain(id);
    // 地方特色第二阶段：太平洋的港口曲
    expect(TRACK_IDS).toContain("port_polynesia");
    // 第九批·养成平时的轮换（2026-11-02）：九首“家乡的日常”与三首通用的平时曲
    for (const id of ZH_ONLY) expect(TRACK_IDS).toContain(id);
    // 曲名：中文都有、互不重名；原有的 96 首都有英文名、英文名互不重名；寰宇先只做中文以后新写的曲子只起中文名（英文界面回退中文）
    const zh = new Set(TRACK_IDS.map((id) => TRACKS[id].title.zh));
    expect(zh.size).toBe(TRACK_IDS.length);
    const named = TRACK_IDS.filter((id) => !(ZH_ONLY as readonly string[]).includes(id));
    expect(named.length).toBe(96);
    for (const id of named) expect(TRACKS[id].title.en?.length, id).toBeGreaterThan(0);
    for (const id of ZH_ONLY) expect(TRACKS[id].title.en, id).toBeUndefined();
    const en = new Set(named.map((id) => TRACKS[id].title.en));
    expect(en.size).toBe(named.length);
  });

  for (const id of TRACK_IDS) {
    const track = TRACKS[id];
    it(`${id}：每行旋律小节完整，和弦小节数正确，乐器、声部、伴奏型与鼓点都存在`, () => {
      checkScore(track);
    });

    it(`${id}：强拍上的长音不与和弦构成半音冲突`, () => {
      expect(downbeatClashes(track)).toEqual([]);
    });

    it(`${id}：每一遍都能展开，事件有序、时值为正、音高在乐器音域内，结果确定`, () => {
      for (let pass = 0; pass < track.forms.length; pass++) {
        const p = realizePass(track, pass);
        expect(p.events.length).toBeGreaterThan(20);
        expect(p.length).toBeGreaterThan(15);
        expect(p.length).toBeLessThan(260);
        for (let i = 0; i < p.events.length; i++) {
          const e = p.events[i];
          if (i > 0) expect(e.t).toBeGreaterThanOrEqual(p.events[i - 1].t);
          expect(e.t).toBeGreaterThanOrEqual(0);
          expect(e.d).toBeGreaterThan(0);
          expect(e.v).toBeGreaterThan(0);
          expect(e.v).toBeLessThan(1.4);
          const inst = INSTRUMENTS[track.voices[e.voice].inst];
          if (inst.kind !== "perc") {
            expect(e.m, `${id} ${e.voice}`).toBeGreaterThanOrEqual(26);
            expect(e.m, `${id} ${e.voice}`).toBeLessThanOrEqual(100);
          } else expect(DRUMS[e.hit ?? ""]).toBeTruthy();
        }
        expect(realizePass(track, pass)).toEqual(p);
      }
    });
  }

  it("吹奏、弓弦与铜管声部按乐句成组，拨弦、击奏、长音与鼓点逐音（主题曲：有乐句，也有逐音的竖琴）", () => {
    const p = realizePass(TRACKS.title, 0);
    const items = scheduleItems(TRACKS.title, p.events);
    const phrases = items.filter((i) => "phrase" in i);
    expect(phrases.length).toBeGreaterThan(5);
    expect(items.some((i) => "note" in i && i.voice === "harp")).toBe(true);
  });

  // 每首曲目各自一项（断言与原来放在一项里时完全相同）：第九批第三轮曲目到了 59 首，
  // 全放在一项里约 1.7 秒，机器忙时会超过 5 秒的默认时限，见 docs/DECISIONS.md“第九批配乐（第三轮）”。
  for (const id of TRACK_IDS) {
    it(`${id}：吹奏、弓弦与铜管声部按乐句成组，拨弦、击奏、长音与鼓点逐音（每一遍）`, () => {
      const track = TRACKS[id];
      for (let pass = 0; pass < track.forms.length; pass++) {
        for (const item of scheduleItems(track, realizePass(track, pass).events)) {
          const kind = INSTRUMENTS[track.voices[item.voice].inst].kind;
          expect(PHRASED.has(kind), `${id}#${pass} 的 ${item.voice}（${kind}）`).toBe("phrase" in item);
        }
      }
    });
  }
});

describe("短乐句（出港、入港、发现、大赚）", () => {
  it("四个短乐句都在，编号与表一致，都写在 D 大调上", () => {
    expect([...CUE_IDS]).toEqual(["depart", "arrive", "discover", "fortune"]);
    for (const id of CUE_IDS) {
      expect(JINGLES[id].id).toBe(`cue_${id}`);
      expect(JINGLES[id].key).toBe("D major");
      expect(JINGLES[id].rest).toEqual([0, 0]);
      // 不与曲目重名（不会出现在“曲目”下拉框里）
      expect(TRACK_IDS as readonly string[]).not.toContain(JINGLES[id].id);
    }
  });

  for (const id of CUE_IDS) {
    const jingle = JINGLES[id];
    it(`${id}：小节、和弦、声部与乐器完整，强拍上没有半音冲突`, () => {
      checkScore(jingle);
      expect(jingle.forms.length).toBe(1);
      expect(downbeatClashes(jingle)).toEqual([]);
    });

    it(`${id}：只有几秒（2–8 秒），移调之后音高仍在乐器音域内，结果确定`, () => {
      const p = realizePass(jingle, 0);
      expect(p.length).toBeGreaterThan(2);
      expect(p.length).toBeLessThan(8);
      expect(p.events.length).toBeGreaterThan(5);
      for (const e of p.events) {
        expect(e.t).toBeGreaterThanOrEqual(0);
        expect(e.d).toBeGreaterThan(0);
        const inst = INSTRUMENTS[jingle.voices[e.voice].inst];
        if (inst.kind !== "perc") {
          // 移调范围是 −6…+5 个半音
          expect(e.m - 6, `${id} ${e.voice}`).toBeGreaterThanOrEqual(26);
          expect(e.m + 5, `${id} ${e.voice}`).toBeLessThanOrEqual(100);
        }
      }
      expect(realizePass(jingle, 0)).toEqual(p);
    });
  }

  it("移到正在放的曲子的调上：大调式移到同一主音，小调式移到关系大调，移动量在 −6…+5 之间", () => {
    expect(cueShift("D major", "D major")).toBe(0);
    expect(cueShift("G mixolydian", "D major")).toBe(5);
    expect(cueShift("F major", "D major")).toBe(3);
    // A 小调 → C 大调：下移一个全音
    expect(cueShift("A minor", "D major")).toBe(-2);
    // C 小调 → 降 E 大调
    expect(cueShift("C minor", "D major")).toBe(1);
    // D 多利亚 → F 大调；D 希贾兹 → F 大调
    expect(cueShift("D dorian", "D major")).toBe(3);
    expect(cueShift("D hijaz", "D major")).toBe(3);
    for (const id of TRACK_IDS) {
      const k = cueShift(TRACKS[id].key, "D major");
      expect(k).toBeGreaterThanOrEqual(-6);
      expect(k).toBeLessThanOrEqual(5);
    }
    // 压低约 10 dB
    expect(20 * Math.log10(DUCK)).toBeCloseTo(-10, 0);
  });
});

describe("学院的短主题", () => {
  it("十段都是 20–40 秒一遍（两种曲式都是），留白不超过 14 秒", () => {
    for (const id of TRACK_IDS.filter((t) => t.startsWith("ac_"))) {
      const t = TRACKS[id];
      for (let pass = 0; pass < t.forms.length; pass++) {
        const len = realizePass(t, pass).length;
        expect(len, `${id}#${pass}`).toBeGreaterThanOrEqual(20);
        expect(len, `${id}#${pass}`).toBeLessThanOrEqual(40.5);
      }
      expect(t.rest[1], id).toBeLessThanOrEqual(14);
    }
  });
});

describe("时间线的短乐句（改写历史、没能改变、照着史实、期限迫近）", () => {
  it("四个都在，编号与表一致，都按 D 大调登记（移调按它算），不在曲目表里", () => {
    expect([...STING_IDS]).toEqual(["history_win", "history_loss", "history_as_is", "deadline"]);
    for (const id of STING_IDS) {
      expect(STINGS[id].id).toBe(`sting_${id}`);
      expect(STINGS[id].key).toBe("D major");
      expect(STINGS[id].rest).toEqual([0, 0]);
      expect(TRACK_IDS as readonly string[]).not.toContain(STINGS[id].id);
    }
  });

  for (const id of STING_IDS) {
    const sting = STINGS[id];
    it(`${id}：小节、和弦、声部与乐器完整，强拍上没有半音冲突；3–6 秒；移调 −6…+5 之后音高仍在乐器音域内`, () => {
      checkScore(sting);
      expect(sting.forms.length).toBe(1);
      expect(downbeatClashes(sting)).toEqual([]);
      const p = realizePass(sting, 0);
      expect(p.length).toBeGreaterThanOrEqual(3);
      expect(p.length).toBeLessThanOrEqual(6);
      expect(p.events.length).toBeGreaterThan(5);
      for (const e of p.events) {
        const inst = INSTRUMENTS[sting.voices[e.voice].inst];
        if (inst.kind !== "perc") {
          expect(e.m - 6, `${id} ${e.voice}`).toBeGreaterThanOrEqual(26);
          expect(e.m + 5, `${id} ${e.voice}`).toBeLessThanOrEqual(100);
        }
      }
      expect(realizePass(sting, 0)).toEqual(p);
    });
  }
});

describe("大编制的乐器", () => {
  const sustain = (id: string): SustainSpec => {
    const inst = INSTRUMENTS[id];
    if (inst.kind === "pluck" || inst.kind === "mallet" || inst.kind === "perc") throw new Error(id);
    return inst;
  };

  it("小提琴组、大提琴组、圆号组、小号、簧片与弦乐群都在，种类与校准音量合理", () => {
    expect(sustain("violins").kind).toBe("bowed");
    expect(sustain("celli").kind).toBe("bowed");
    expect(sustain("horns").kind).toBe("brass");
    expect(sustain("trumpet").kind).toBe("brass");
    expect(sustain("reed").kind).toBe("wind");
    expect(sustain("strings").kind).toBe("pad");
    for (const id of ["violins", "celli", "horns", "trumpet", "reed", "strings"]) {
      const s = sustain(id);
      expect(s.level, id).toBeGreaterThan(0.05);
      expect(s.level, id).toBeLessThan(1);
      // 谐波表在各音区都是有限的非负数，基频最强或接近最强
      for (const f0 of [65, 131, 262, 523, 1047]) {
        const amps = Array.from({ length: 24 }, (_, i) => s.amps(i + 1, (i + 1) * f0));
        expect(amps.every((a) => Number.isFinite(a) && a >= 0), `${id} ${f0}`).toBe(true);
        expect(amps[0], `${id} ${f0}`).toBeGreaterThan(0);
      }
    }
    // 小号比圆号组亮：高次谐波相对更强
    const bright = (id: string) => sustain(id).amps(8, 8 * 440) / sustain(id).amps(1, 440);
    expect(bright("trumpet")).toBeGreaterThan(bright("horns") * 2);
  });

  it("齐奏：各振荡器的音分偏移对称、均匀地摊开；没写齐奏的长音沿用一对 ±detune/2，独奏乐器只有一个", () => {
    expect(unisonOffsets(sustain("violins"))).toEqual([-7, 0, 7]);
    expect(unisonOffsets(sustain("horns"))).toEqual([-4, 4]);
    const strings = unisonOffsets(sustain("strings"));
    expect(strings.length).toBe(4);
    expect(strings[0]).toBeCloseTo(-8);
    expect(strings[3]).toBeCloseTo(8);
    expect(strings[1] - strings[0]).toBeCloseTo(strings[2] - strings[1]);
    expect(unisonOffsets(sustain("choir"))).toEqual([-4.5, 4.5]);
    expect(unisonOffsets(sustain("fiddle"))).toEqual([0]);
    expect(unisonOffsets(sustain("flute"))).toEqual([0]);
  });

  it("定音鼓会滚奏（!trem! 记号），其他击奏乐器不会", () => {
    const timp = INSTRUMENTS.timpani;
    expect(timp.kind === "mallet" && timp.roll).toBeGreaterThan(8);
    for (const id of ["bell", "carillon", "celesta", "marimba", "gong"]) {
      const inst = INSTRUMENTS[id];
      expect(inst.kind === "mallet" && inst.roll === undefined, id).toBe(true);
    }
    // 滚奏记号能写进曲谱：连线连起来的滚奏是一个长音
    const l = parseAbc("!trem!D,,8- | D,,6 !accent!D,,2", parseKey("D major"));
    expect(l.notes.length).toBe(2);
    expect(l.notes[0].len).toBe(14);
    expect(l.notes[0].deco).toContain("trem");
    expect(l.notes[1].deco).toContain("accent");
  });

  it("写了 hall 的曲子（主题曲、外洋、北方的海、风暴）用大厅混响", () => {
    for (const id of ["title", "ocean", "sea_north", "storm"] as const) expect(TRACKS[id].hall, id).toBe(true);
    for (const id of ["sea", "port_mediterranean", "battle"] as const) expect(TRACKS[id].hall, id).toBeFalsy();
  });
});

/** 自相关求基频。 */
function pitchOf(x: Float32Array, sr: number, from: number, len: number): number {
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(sr / 2000); lag < Math.floor(sr / 50); lag++) {
    let s = 0;
    for (let n = from; n < from + len; n++) s += x[n] * x[n + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return sr / bestLag;
}

function energy(x: Float32Array, a: number, b: number): number {
  let e = 0;
  for (let n = a; n < b; n++) e += x[n] * x[n];
  return e / Math.max(1, b - a);
}

describe("合成", () => {
  it("拨弦：音高准确、逐渐衰减、没有非数", () => {
    for (const id of ["harp", "lute", "guitar", "oud", "zheng", "mandolin", "pizz"]) {
      const inst = INSTRUMENTS[id];
      if (inst.kind !== "pluck") throw new Error(id);
      const x = pluck(inst.spec, 220, SR, 1);
      expect(x.every(Number.isFinite), id).toBe(true);
      expect(peak(x)).toBeCloseTo(0.8, 1);
      const f = pitchOf(x, SR, 2000, 2000);
      expect(Math.abs(1200 * Math.log2(f / 220)), `${id} 基频 ${f}`).toBeLessThan(25);
      expect(energy(x, x.length - 2000, x.length)).toBeLessThan(energy(x, 0, 2000) * 0.05);
    }
  });

  it("击奏与鼓点：有限、峰值归一、足够短", () => {
    for (const id of ["bell", "carillon", "celesta", "marimba", "timpani", "gong"]) {
      const inst = INSTRUMENTS[id];
      if (inst.kind !== "mallet") throw new Error(id);
      const x = mallet(inst.spec, 440, SR, 2);
      expect(x.every(Number.isFinite), id).toBe(true);
      expect(peak(x)).toBeCloseTo(0.8, 1);
      expect(x.length / SR).toBeLessThanOrEqual(6.1);
    }
    for (const [hit, spec] of Object.entries(DRUMS)) {
      const x = drum(spec, SR, 3);
      expect(x.every(Number.isFinite), hit).toBe(true);
      expect(peak(x), hit).toBeCloseTo(0.8, 1);
      expect(x.length / SR, hit).toBeLessThan(3.1);
    }
  });

  it("噪声与混响", () => {
    for (const k of ["white", "pink", "brown"] as const) {
      const x = noise(k, 1, SR, 4);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(peak(x)).toBeGreaterThan(0.05);
      expect(peak(x)).toBeLessThan(1.5);
    }
    const [l, r] = reverbIR(SR, 2.4, 5);
    expect(l.length).toBe(r.length);
    expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
    // 尾部比开头弱得多
    expect(energy(l, l.length - 3000, l.length)).toBeLessThan(energy(l, 500, 3500) * 0.01);
  });

  it("大厅混响：比房间长，预延迟 30 毫秒内是静音，尾巴比房间更暗；房间混响的缺省形状不变", () => {
    const [room] = reverbIR(SR, 2.4, 5);
    const [hl, hr] = reverbIR(SR, 3.4, 9, HALL);
    expect(hl.length).toBeGreaterThan(room.length);
    expect(hl.length).toBe(hr.length);
    expect(hl.every(Number.isFinite) && hr.every(Number.isFinite)).toBe(true);
    const pre = Math.floor(SR * HALL.pre);
    expect(hl.subarray(0, pre).every((v) => v === 0)).toBe(true);
    expect(peak(hl.subarray(pre, pre + Math.floor(SR * 0.1)))).toBeGreaterThan(0);
    // 尾巴的高频：相邻采样之差的能量与信号能量之比（越暗越小）
    const hf = (x: Float32Array, a: number, b: number) => {
      let d = 0;
      for (let n = a + 1; n < b; n++) d += (x[n] - x[n - 1]) ** 2;
      return d / Math.max(1e-12, energy(x, a, b) * (b - a));
    };
    expect(hf(hl, hl.length - 4000, hl.length)).toBeLessThan(hf(room, room.length - 4000, room.length));
    // 显式写出缺省形状，结果与不写相同（房间混响没有被改动）
    const [same] = reverbIR(SR, 2.4, 5, { pre: 0.012, early: 0.05, dark: 1500 });
    expect(same).toEqual(room);
  });

  it("拨弦的起音淡入：第一个采样是 0，头 1.5 毫秒里不会一下跳得很高（明亮的西特琴、曼陀林也一样）", () => {
    for (const id of ["cittern", "mandolin", "harp", "guitar"]) {
      const inst = INSTRUMENTS[id];
      if (inst.kind !== "pluck") throw new Error(id);
      const x = pluck(inst.spec, 330, SR, 7);
      expect(Math.abs(x[0]), id).toBe(0);
      // 头 1.5 毫秒是渐强：前四分之一的平均幅度远小于后四分之一
      const onset = Math.floor(SR * 0.0015);
      const q = Math.floor(onset / 4);
      const mean = (a: number, b: number) => x.subarray(a, b).reduce((s, v) => s + Math.abs(v), 0) / (b - a);
      expect(mean(0, q), id).toBeLessThan(mean(onset - q, onset) * 0.5);
    }
  });
});

describe("环境声的采样", () => {
  /** 某一段里 2 kHz 以上的能量占比。 */
  const highShare = (x: Float32Array) => {
    const hp = filter(Float32Array.from(x), biquad("highpass", 2000, 0.7, 0, SR));
    return energy(hp, 0, hp.length) / Math.max(1e-12, energy(x, 0, x.length));
  };

  it("木头的吱呀：有限、峰值归一、半秒到一秒多，慢起慢收；同一个种子结果相同，不同种子不同", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const x = creak(SR, seed);
      expect(x.every(Number.isFinite), `${seed}`).toBe(true);
      expect(peak(x)).toBeCloseTo(0.8, 1);
      expect(x.length / SR).toBeGreaterThan(0.4);
      expect(x.length / SR).toBeLessThan(1.25);
      const edge = Math.floor(x.length * 0.05);
      const mid = Math.floor(x.length / 2);
      expect(energy(x, 0, edge)).toBeLessThan(energy(x, mid - edge, mid + edge));
      // 木头的声音：大部分能量在 2 kHz 以下
      expect(highShare(x)).toBeLessThan(0.3);
    }
    expect(creak(SR, 3)).toEqual(creak(SR, 3));
    expect(creak(SR, 3)).not.toEqual(creak(SR, 4));
  });

  it("海鸥的一声叫：音高先升后落（“嗷——”），基频在 0.55–1.9 kHz，长 0.2–0.45 秒", () => {
    /** 一小段的基频：归一化自相关在 0.55–1.9 kHz 对应的延迟里，取第一个接近最高的（避免错成低八度）。 */
    const f0 = (x: Float32Array, from: number, len: number) => {
      const lags: [number, number][] = [];
      for (let lag = Math.floor(SR / 1900); lag <= Math.ceil(SR / 550); lag++) {
        let num = 0;
        let e1 = 0;
        let e2 = 0;
        for (let n = from; n < from + len; n++) {
          num += x[n] * x[n + lag];
          e1 += x[n] * x[n];
          e2 += x[n + lag] * x[n + lag];
        }
        lags.push([lag, num / Math.sqrt(e1 * e2 + 1e-12)]);
      }
      const best = Math.max(...lags.map(([, r]) => r));
      return SR / lags.find(([, r]) => r >= best * 0.92)![0];
    };
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const x = gull(SR, seed);
      expect(x.every(Number.isFinite), `${seed}`).toBe(true);
      expect(peak(x)).toBeCloseTo(0.8, 1);
      expect(x.length / SR).toBeGreaterThan(0.2);
      expect(x.length / SR).toBeLessThan(0.46);
      const win = Math.floor(SR * 0.012);
      const at = (frac: number) => f0(x, Math.floor((x.length - win - 80) * frac), win);
      const start = at(0.03);
      const top = Math.max(at(0.16), at(0.22), at(0.28), at(0.34));
      const end = at(0.85);
      expect(top, `${seed}：升上去（${start.toFixed(0)} → ${top.toFixed(0)}）`).toBeGreaterThan(start * 1.1);
      expect(end, `${seed}：落下来（${top.toFixed(0)} → ${end.toFixed(0)}）`).toBeLessThan(top * 0.9);
    }
  });

  it("拍船身：起得快、落得慢，能量大多在低频；有限、峰值归一", () => {
    for (const seed of [21, 22, 23, 24]) {
      const x = slap(SR, seed);
      expect(x.every(Number.isFinite), `${seed}`).toBe(true);
      expect(peak(x)).toBeCloseTo(0.8, 1);
      expect(x.length / SR).toBeGreaterThan(0.2);
      expect(x.length / SR).toBeLessThan(0.6);
      const q = Math.floor(x.length / 4);
      expect(energy(x, 0, q)).toBeGreaterThan(energy(x, 3 * q, 4 * q) * 4);
      expect(highShare(x)).toBeLessThan(0.15);
    }
  });
});
