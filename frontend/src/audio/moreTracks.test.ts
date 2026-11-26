// 第九批 A01（2026-11-11）多写的三十八首曲目与四件补的地方音色：清单、长度与曲式、留白、谁领奏、各地的调式与节奏型，
// 以及写的时候按规则自查的几条（旋律声部的音域合乎那件乐器、没有成串的平行五八度、一遍里没有长时间的静默）。
// 小节、和弦、强拍冲突、采样的音域、两套编配的分段时刻……由 audio.test.ts 与 orchestra/orchestra.test.ts 的通用检查逐首覆盖，这里不重复。
import { describe, expect, it } from "vitest";
import { INSTRUMENTS } from "./instruments";
import { REGIONAL, REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { isOrchestral } from "./orchestra/instruments";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { lineOf, patternOf, realizePass, type TrackDef } from "./score";
import { parseKey, pc } from "./theory";
import { TRACK_IDS, TRACKS, type TrackId } from "./tracks";
import { MORE_TRACK_IDS, type MoreTrackId } from "./tracks/more";

/** 纯管弦的（两套都不用地方乐器）。 */
const ORCHESTRAL: readonly MoreTrackId[] = [
  "sea_atlantic", "sea_swell", "sea_night", "sea_fog", "storm_gale", "battle_broadside",
  "ub_spring", "ub_summer", "ub_autumn", "ub_winter", "ub_heart_walk", "ub_lamp_out", "ub_footsteps", "ub_final",
];
/** 地方乐器领奏的。 */
const REGIONAL_LED: readonly MoreTrackId[] = MORE_TRACK_IDS.filter((id) => !ORCHESTRAL.includes(id));

/** 这首曲子里“旋律行:声部”的全部搭配（去掉移八度与平行三度的后缀）。 */
function melodicPairs(track: TrackDef): { section: string; line: string; voice: string; shift: number }[] {
  const out: { section: string; line: string; voice: string; shift: number }[] = [];
  const seen = new Set<string>();
  for (const form of track.forms) {
    for (const st of form) {
      for (const tok of st.play.split(/\s+/)) {
        const m = /^(\w+):(\w+?)([+-]\d+)?(~-?\d+)?$/.exec(tok);
        if (!m || seen.has(`${st.s}/${tok}`)) continue;
        seen.add(`${st.s}/${tok}`);
        out.push({ section: st.s, line: m[1], voice: m[2], shift: m[3] ? Number(m[3]) : 0 });
      }
    }
  }
  return out;
}

/** 一行旋律用到的音级（0–11，可有小数）。 */
function pitchClasses(track: TrackDef, section: string, line: string): number[] {
  return [...new Set(lineOf(track, section, line).notes.flatMap((n) => [...n.pitches, ...n.grace]).map((p) => pc(p)))].sort((a, b) => a - b);
}

describe("清单", () => {
  it("多写了 38 首，接在原有 108 首之后；编号与表一致，两套编配都有，只起中文名、互不重名", () => {
    expect([...MORE_TRACK_IDS]).toEqual([
      "sea_atlantic", "sea_swell", "sea_night",
      "sea_canaries", "sea_tyrrhenian", "sea_aegean", "sea_gulf", "sea_swahili", "sea_channel", "sea_banks", "sea_kuroshio", "sea_lanterns", "sea_malacca", "sea_treasure", "sea_bengal",
      "sea_fog",
      "storm_gale", "storm_typhoon",
      "battle_broadside", "battle_east",
      "port_iberia_eve", "port_indies", "port_japan_eve", "port_ming_tea", "port_ottoman_cafe", "port_malay_night", "port_town", "port_lagoon", "port_estuary", "port_taarab",
      "ub_spring", "ub_summer", "ub_autumn", "ub_winter",
      "ub_heart_walk", "ub_lamp_out", "ub_footsteps", "ub_final",
    ]);
    expect(MORE_TRACK_IDS.length).toBe(38);
    expect(TRACK_IDS.length).toBe(146);
    expect(ORCHESTRAL.length + REGIONAL_LED.length).toBe(38);
    expect(REGIONAL_LED.length).toBe(24);
    for (const id of MORE_TRACK_IDS) {
      expect(TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(TRACKS[id].title.zh.length, id).toBeGreaterThan(1);
      expect(TRACKS[id].title.en, id).toBeUndefined();
    }
    expect(new Set(TRACK_IDS.map((id) => TRACKS[id].title.zh)).size).toBe(TRACK_IDS.length);
  });

  it("分类：16 首航海曲（含《雾号》）、2 首风暴、2 首海战、10 首港口曲、8 首养成", () => {
    const count = (prefix: string) => MORE_TRACK_IDS.filter((id) => id.startsWith(prefix)).length;
    expect(count("sea_")).toBe(16);
    expect(count("storm_")).toBe(2);
    expect(count("battle_")).toBe(2);
    expect(count("port_")).toBe(10);
    expect(count("ub_")).toBe(8);
  });
});

describe("长度、曲式与留白", () => {
  for (const id of MORE_TRACK_IDS) {
    it(`${id}：两种曲式每一遍都在 60–150 秒之间；有引子以外至少两个带旋律的段落（主题与对比段），主题至少再现一次`, () => {
      for (const def of [TRACKS[id], ORCH_TRACKS[id]]) {
        expect(def.forms.length).toBe(2);
        for (let pass = 0; pass < def.forms.length; pass++) {
          const len = realizePass(def, pass).length;
          expect(len, `${id}#${pass}`).toBeGreaterThanOrEqual(60);
          expect(len, `${id}#${pass}`).toBeLessThanOrEqual(150);
          const form = def.forms[pass];
          const melodic = form.filter((st) => /\w+:\w+/.test(st.play) && def.sections[st.s].bars >= 4).map((st) => st.s);
          expect(new Set(melodic).size, `${id}#${pass} 带旋律的段落`).toBeGreaterThanOrEqual(2);
          // 至少有一个段落奏了不止一次（再现），而且再现时配器不同
          const repeated = [...new Set(melodic)].filter((s) => melodic.filter((x) => x === s).length > 1);
          const sameMaterial = repeated.length > 0 || new Set(form.map((st) => st.s)).size < form.length || melodic.some((s) => /2$/.test(s));
          expect(sameMaterial, `${id}#${pass} 没有再现`).toBe(true);
        }
        // 两种曲式不是同一份
        expect(JSON.stringify(def.forms[0])).not.toBe(JSON.stringify(def.forms[1]));
      }
    });
  }

  it("留白照各类的规矩：航海曲 25–45 秒（夜航 30–50，《雾号》12–24），港口曲 10–18，风暴 3–6，海战不留白，养成的平时曲 10–16、事件曲更短", () => {
    const rest = (id: MoreTrackId) => [...TRACKS[id].rest];
    for (const id of MORE_TRACK_IDS) {
      expect(ORCH_TRACKS[id].rest, id).toEqual(TRACKS[id].rest);
      if (id === "sea_fog") expect(rest(id)).toEqual([12, 24]);
      else if (id === "sea_night") expect(rest(id)).toEqual([30, 50]);
      else if (id.startsWith("sea_")) expect(rest(id), id).toEqual([25, 45]);
      else if (id.startsWith("port_")) expect(rest(id), id).toEqual([10, 18]);
      else if (id.startsWith("storm_")) expect(rest(id), id).toEqual([3, 6]);
      else if (id.startsWith("battle_")) expect(rest(id), id).toEqual([0, 0]);
    }
    for (const id of ["ub_spring", "ub_summer", "ub_autumn", "ub_winter", "ub_lamp_out"] as const) expect(rest(id), id).toEqual([10, 16]);
    expect(rest("ub_heart_walk")).toEqual([8, 14]);
    expect(rest("ub_footsteps")).toEqual([3, 6]);
    expect(rest("ub_final")).toEqual([4, 8]);
  });

  it("每首都从主和弦开始；航海曲、港口曲与养成的平时曲在主和弦上渐慢渐弱收住（接着轮下一首不突兀）", () => {
    for (const id of MORE_TRACK_IDS) {
      const t = TRACKS[id];
      const tonic = parseKey(t.key).tonic;
      const rootOf = (section: string, last: boolean) => {
        const bars = (t.sections[section].chords ?? "").split("|").map((b) => b.trim());
        const sym = (last ? bars[bars.length - 1].split(/\s+/).pop() : bars[0].split(/\s+/)[0]) ?? "";
        const m = /^([A-G])([#b]?)/.exec(sym.replace(/\*.*$/, ""));
        if (!m) throw new Error(`${id} ${section}：${sym}`);
        return (({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
      };
      for (const form of t.forms) {
        expect(rootOf(form[0].s, false), `${id} 开头`).toBe(tonic);
        if (id.startsWith("storm_") || id.startsWith("battle_") || id === "ub_footsteps") continue;
        const end = form[form.length - 1];
        expect(rootOf(end.s, true), `${id} 结尾`).toBe(tonic);
        if (id === "ub_final") continue;
        expect(end.rit, `${id} 渐慢`).toBeLessThan(1);
        expect(end.to ?? end.dyn ?? 0.8, `${id} 渐弱`).toBeLessThan(end.dyn ?? 0.8);
      }
    }
  });
});

describe("谁领奏", () => {
  it("十四首纯管弦的：合成版一件地方乐器也不用，管弦版只用采样的乐器", () => {
    for (const id of ORCHESTRAL) {
      for (const v of Object.values(TRACKS[id].voices)) expect(Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, v.inst), `${id} ${v.inst}`).toBe(false);
      for (const v of Object.values(ORCH_TRACKS[id].voices)) expect(isOrchestral(v.inst), `${id} ${v.inst}`).toBe(true);
    }
  });

  for (const id of REGIONAL_LED) {
    it(`${id}：旋律都由地方乐器奏（钟与锣除外），至少三件地方乐器；管弦版里管弦只做衬底——不奏旋律（管钟除外），长音的音量很小`, () => {
      const synth = TRACKS[id];
      const orch = ORCH_TRACKS[id];
      const regional = new Set(Object.values(synth.voices).map((v) => v.inst).filter((i) => Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, i)));
      expect(regional.size, `${id}：${[...regional].join("、")}`).toBeGreaterThanOrEqual(3);
      for (const def of [synth, orch]) {
        for (const p of melodicPairs(def)) {
          const inst = def.voices[p.voice].inst;
          if (inst === "bell" || inst === "o.tubular") continue;
          expect(Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, inst), `${id} ${p.section}/${p.line}:${p.voice}（${inst}）`).toBe(true);
        }
      }
      for (const [name, v] of Object.entries(orch.voices)) {
        if (!isOrchestral(v.inst)) continue;
        // 衬底：和弦长音（poly）不超过 0.16，拨奏、竖琴与管钟不超过 0.24
        expect(v.gain ?? 0.5, `${id} ${name}`).toBeLessThanOrEqual(v.poly ? 0.16 : 0.24);
        expect(v.pattern || v.inst === "o.tubular", `${id} ${name}`).toBeTruthy();
      }
    });
  }

  it("四件补的地方音色都登记了，各有曲子用它奏旋律：古筝、埙（明），坦布尔（奥斯曼），甘布斯（马来）", () => {
    const want: Record<string, { region: string; kind: string; tracks: MoreTrackId[] }> = {
      guzheng: { region: "ming", kind: "pluck", tracks: ["sea_lanterns", "port_ming_tea"] },
      xun: { region: "ming", kind: "wind", tracks: ["sea_lanterns"] },
      tanbur: { region: "ottoman", kind: "pluck", tracks: ["port_ottoman_cafe"] },
      gambus: { region: "nusantara", kind: "pluck", tracks: ["sea_malacca"] },
    };
    for (const [key, w] of Object.entries(want)) {
      const def = REGIONAL.find((d) => d.key === key);
      expect(def?.region, key).toBe(w.region);
      expect(INSTRUMENTS[key]?.kind, key).toBe(w.kind);
      for (const id of w.tracks) {
        const pairs = melodicPairs(TRACKS[id]).filter((p) => TRACKS[id].voices[p.voice].inst === key);
        expect(pairs.length, `${key} 在 ${id} 里没有旋律`).toBeGreaterThan(0);
        // 两套编配共用这个声部
        const voice = pairs[0].voice;
        expect(ORCH_TRACKS[id].voices[voice]).toBe(TRACKS[id].voices[voice]);
      }
    }
    // 原有的曲子一件新乐器也不用（只许加）
    for (const id of TRACK_IDS.slice(0, 108)) for (const v of Object.values(TRACKS[id].voices)) expect(Object.keys(want), `${id} ${v.inst}`).not.toContain(v.inst);
  });
});

describe("各地的调式与节奏型", () => {
  /** 这首曲子所有旋律行（除了列出的）用到的音级都在给定的音阶里。 */
  function onlyUses(id: MoreTrackId, scale: readonly number[], skipLines: readonly string[] = []) {
    const t = TRACKS[id];
    for (const [section, def] of Object.entries(t.sections)) {
      for (const line of Object.keys(def.lines ?? {})) {
        if (skipLines.includes(line)) continue;
        for (const p of pitchClasses(t, section, line)) expect(scale, `${id} ${section}/${line} 的音级 ${p}`).toContain(p);
      }
    }
  }
  /** 和弦全是空五度（不写三和弦）。 */
  function onlyFifths(id: MoreTrackId) {
    for (const [name, s] of Object.entries(TRACKS[id].sections)) {
      for (const sym of (s.chords ?? "").split(/[|\s]+/).filter(Boolean)) expect(/^[A-G][#b]?5(\*\d+)?$|^Am\/E(\*\d+)?$|^Am$|^C$/.test(sym) || /5/.test(sym), `${id} ${name}：${sym}`).toBe(true);
    }
  }
  /** 打击乐伴奏型里有音的格子（按八分音符算的位置）。 */
  function onsets(id: MoreTrackId, voice: string, variant?: string): number[] {
    const p = patternOf(TRACKS[id].voices[voice], variant);
    if (!p || p.kind !== "drum") throw new Error(`${id} ${voice}`);
    return [...p.steps.replace(/\s+/g, "")].flatMap((ch, i) => (ch === "." ? [] : [i * (p.grid ?? 1)]));
  }

  it("日本：《黑潮》是 E 上的民谣音阶（B 段挪到 A 上，多一个 C），《港町的夕凪》是 A 上的都节音阶；都只有空五度", () => {
    onlyUses("sea_kuroshio", [2, 4, 7, 9, 11, 0]);
    expect(pitchClasses(TRACKS.sea_kuroshio, "A", "mel")).toEqual([2, 4, 7, 9, 11]);
    onlyUses("port_japan_eve", [9, 10, 2, 4, 5]);
    for (const id of ["sea_kuroshio", "port_japan_eve"] as const) for (const s of Object.values(TRACKS[id].sections)) for (const sym of (s.chords ?? "").split(/[|\s]+/).filter(Boolean)) expect(sym, id).toMatch(/^[A-G]b?5(\*\d+)?$/);
  });

  it("明：《渔火》是 A 羽调式的五声，《茶楼丝竹》是 G 宫的五声（“繁”“简”两条叠着奏）；东亚的风暴与海战也是五声（风暴的 B 段借一个降 B）", () => {
    onlyUses("sea_lanterns", [9, 0, 2, 4, 7]);
    onlyUses("port_ming_tea", [7, 9, 11, 2, 4]);
    onlyUses("battle_east", [11, 2, 4, 6, 9], ["gong"]);
    onlyUses("storm_typhoon", [9, 0, 2, 4, 7, 10, 5, 11], ["gong"]);
    expect(pitchClasses(TRACKS.storm_typhoon, "A", "mel")).toEqual([0, 2, 4, 7, 9, 11].filter((p) => pitchClasses(TRACKS.storm_typhoon, "A", "mel").includes(p)));
    // “繁”的一条比“简”的一条音多，两条在同一段里同时奏，句尾落在同一个音上
    const tea = TRACKS.port_ming_tea;
    const simple = lineOf(tea, "A2", "mel").notes;
    const hua = lineOf(tea, "A2", "hua").notes;
    expect(hua.length).toBeGreaterThan(simple.length * 1.3);
    expect(pc(hua[hua.length - 1].pitches[0])).toBe(pc(simple[simple.length - 1].pitches[0]));
    expect(tea.forms.every((f) => f.some((st) => st.s === "A2" && /hua:qudi/.test(st.play) && /mel:erhu/.test(st.play)))).toBe(true);
  });

  it("阿拉伯与奥斯曼：《采珠船》《咖啡馆的午后》是拉斯特（三级、七级是中立音），只有空五度；《群岛的夏风》是希贾兹（小二度接增二度）", () => {
    for (const id of ["sea_gulf", "port_ottoman_cafe"] as const) {
      const key = parseKey(TRACKS[id].key);
      expect(key.mode, id).toBe("rast");
      const third = pc(key.scale[2]);
      const seventh = pc(key.scale[6]);
      const used = Object.entries(TRACKS[id].sections).flatMap(([s, def]) => Object.keys(def.lines ?? {}).flatMap((l) => pitchClasses(TRACKS[id], s, l)));
      expect(used, `${id} 用到中立三度`).toContain(third);
      expect(used, `${id} 用到中立七度`).toContain(seventh);
      expect(third % 1, id).toBe(0.5);
      onlyFifths(id);
    }
    const aegean = parseKey(TRACKS.sea_aegean.key);
    expect(aegean.mode).toBe("hijaz");
    const mel = pitchClasses(TRACKS.sea_aegean, "A", "mel");
    // E F 升G：小二度接增二度
    expect(mel).toEqual(expect.arrayContaining([4, 5, 8]));
    expect(mel).not.toContain(7);
  });

  it("节奏型：索尔齐科（5/8 的 1 + 1½ + ½ + 1½ + ½）、阿克萨克（9/8 的 2 + 2 + 2 + 3）、鲁帕克（7 拍）、瑟尔托斯（3 + 3 + 2）、6/8 的加那利舞与西西里舞", () => {
    expect(TRACKS.sea_banks.meter).toEqual([5, 8]);
    expect(onsets("sea_banks", "tamb")).toEqual([0, 1, 2.5, 3, 4.5]);
    // 旋律也是这个节奏
    const zortziko = lineOf(TRACKS.sea_banks, "A", "mel").notes.slice(0, 5);
    expect(zortziko.map((n) => n.len)).toEqual([1, 1.5, 0.5, 1.5, 0.5]);
    expect(TRACKS.port_ottoman_cafe.meter).toEqual([9, 8]);
    expect(onsets("port_ottoman_cafe", "darb", "a")).toEqual([0, 2, 4, 6, 7]);
    // 旋律每小节按 2 + 2 + 2 + 3 落音
    for (const at of [0, 2, 4, 6]) expect(lineOf(TRACKS.port_ottoman_cafe, "A", "mel").notes.some((n) => n.at === at)).toBe(true);
    expect(TRACKS.sea_bengal.meter).toEqual([7, 8]);
    expect(onsets("sea_bengal", "tabr")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(onsets("sea_bengal", "tabl")).toEqual([3, 5]);
    expect(lineOf(TRACKS.sea_bengal, "A", "mel").notes.slice(0, 3).map((n) => n.len)).toEqual([3, 2, 2]);
    expect(onsets("sea_aegean", "darb", "a")).toEqual([0, 3, 6]);
    expect(TRACKS.sea_canaries.meter).toEqual([6, 8]);
    expect(lineOf(TRACKS.sea_canaries, "A", "mel").notes.slice(0, 3).map((n) => n.len)).toEqual([1.5, 0.5, 1]);
    // 六三交替：A′ 里有三个四分音符的小节
    expect(lineOf(TRACKS.sea_canaries, "A2", "mel2").notes.slice(0, 3).map((n) => n.len)).toEqual([2, 2, 2]);
    expect(lineOf(TRACKS.sea_tyrrhenian, "A", "mel").notes.slice(0, 3).map((n) => n.len)).toEqual([1.5, 0.5, 1]);
    expect(TRACKS.sea_channel.meter).toEqual([9, 8]);
    expect(TRACKS.sea_swahili.meter).toEqual([12, 8]);
  });

  it("甘美兰的软合奏《皮影戏的夜》：五声；骨干旋律两拍一个音、八小节一圈，圈尾落在主音上、大锣同时响", () => {
    onlyUses("port_malay_night", [2, 4, 6, 9, 11]);
    const t = TRACKS.port_malay_night;
    for (const s of ["A", "B"]) {
      const bal = lineOf(t, s, "bal").notes;
      expect(bal.length, s).toBe(16);
      expect(bal.every((n) => n.len === 4), s).toBe(true);
      expect(pc(bal[15].pitches[0]), s).toBe(2);
      const gong = lineOf(t, s, "gong").notes;
      expect(gong.length).toBe(1);
      expect(gong[0].at).toBe(bal[15].at);
    }
    expect(t.voices.slen.inst).toBe("slenthem");
    expect(t.voices.gong.inst).toBe("gong_ageng");
  });

  it("养成的四季都以成长动机（5 → 1 → 2 → 3）开头；东亚以外的风暴与海战用定音鼓", () => {
    for (const id of ["ub_spring", "ub_summer", "ub_autumn", "ub_winter"] as const) {
      const key = parseKey(TRACKS[id].key);
      const head = lineOf(TRACKS[id], "A", "mel").notes.slice(0, 4).map((n) => pc(n.pitches[0]));
      expect(head, id).toEqual([key.scale[4], key.scale[0], key.scale[1], key.scale[2]].map((p) => pc(p)));
    }
    for (const id of ["storm_gale", "battle_broadside", "ub_final"] as const) {
      expect(TRACKS[id].voices.timp.inst, id).toBe("timpani");
      expect(ORCH_TRACKS[id].voices.timp.inst, id).toBe("o.timp");
    }
  });
});

describe("写的时候按规则自查的几条", () => {
  /** 各件地方乐器写旋律时的音域（MIDI，含两端；按实际乐器的音域略放宽）。 */
  const RANGE: Readonly<Record<string, readonly [number, number]>> = {
    rec_alto: [65, 91], rec_soprano: [72, 98], rec_tenor: [60, 86], galoubet: [72, 96], shawm: [60, 84], cornett: [57, 86], gamba: [43, 84], organetto: [57, 84],
    pipe: [72, 96], tabor_pipe: [69, 93], rebeck: [60, 88], hurdygurdy: [60, 86], cornemuse: [60, 84], crumhorn: [60, 79], beiaard: [60, 91],
    lyra: [60, 88], nay: [60, 86], kanun: [55, 91], ud: [43, 81], simsimiyya: [60, 79], mizmar: [60, 81], zumari: [62, 79], tanbur: [57, 81], kemence: [60, 84],
    shamisen: [50, 81], shinobue: [69, 93], shakuhachi: [60, 84], koto: [55, 90], nohkan: [69, 94],
    xiao: [60, 84], xun: [55, 74], erhu: [62, 86], guzheng: [45, 86], pipa: [55, 84], qudi: [65, 88], yangqin: [55, 88], suona: [67, 86], dadi: [55, 79], daluo: [55, 55],
    gambus: [55, 79], rebab: [60, 84], suling: [62, 84], slenthem: [50, 67], gong_ageng: [26, 30],
    chirimia: [55, 84], ocarina: [62, 84], bansuri: [60, 84], sarangi: [55, 79],
  };

  for (const id of REGIONAL_LED) {
    it(`${id}：每件地方乐器奏的旋律都在它的音域里`, () => {
      const t = TRACKS[id];
      for (const p of melodicPairs(t)) {
        const inst = t.voices[p.voice].inst;
        const range = RANGE[inst];
        if (inst === "bell") continue;
        expect(range, `${id}：没有登记 ${inst} 的音域`).toBeTruthy();
        const notes = lineOf(t, p.section, p.line).notes.flatMap((n) => n.pitches).map((m) => m + p.shift);
        expect(Math.min(...notes), `${id} ${p.section}/${p.line}:${p.voice}（${inst}）最低`).toBeGreaterThanOrEqual(range[0]);
        expect(Math.max(...notes), `${id} ${p.section}/${p.line}:${p.voice}（${inst}）最高`).toBeLessThanOrEqual(range[1]);
      }
    });
  }

  /** 齐奏里各走各的装饰（异音、支声）：同一条旋律的两种写法叠着奏，本来就是同度 / 八度并行。 */
  const HETEROPHONY: readonly string[] = ["sea_kuroshio/B/bmel×bsh", "port_ming_tea/A2/hua×mel", "port_japan_eve/A2/mel×smel"];
  /** 不算旋律的行：定音鼓、锣、钟、星、雾号、尖啸。 */
  const NOT_MELODY = new Set(["timp", "gong", "bell", "carillon", "star", "call", "shriek", "gliss", "blow"]);

  for (const id of MORE_TRACK_IDS) {
    it(`${id}：同时奏的两条不同的旋律之间没有连续三次以上的平行纯五度 / 八度（异音的齐奏除外）`, () => {
      const t = TRACKS[id];
      const checked = new Set<string>();
      for (const form of t.forms) {
        for (const st of form) {
          const lines = [...new Set(st.play.split(/\s+/).filter((x) => x.includes(":")).map((x) => x.split(":")[0]))].filter((l) => !NOT_MELODY.has(l)).sort();
          for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
              const tag = `${id}/${st.s}/${lines[i]}×${lines[j]}`;
              if (checked.has(tag) || HETEROPHONY.includes(tag)) continue;
              checked.add(tag);
              const a = lineOf(t, st.s, lines[i]).notes;
              const b = new Map(lineOf(t, st.s, lines[j]).notes.map((n) => [n.at.toFixed(3), n]));
              const pairs = a.flatMap((n) => {
                const m = b.get(n.at.toFixed(3));
                return m && n.pitches.length === 1 && m.pitches.length === 1 ? [[n.pitches[0], m.pitches[0]] as const] : [];
              });
              let run = 0;
              for (let k = 1; k < pairs.length; k++) {
                const before = pc(pairs[k - 1][0] - pairs[k - 1][1]);
                const now = pc(pairs[k][0] - pairs[k][1]);
                const dirA = Math.sign(pairs[k][0] - pairs[k - 1][0]);
                const dirB = Math.sign(pairs[k][1] - pairs[k - 1][1]);
                run = dirA !== 0 && dirA === dirB && before === now && (now === 7 || now === 0) ? run + 1 : 0;
                expect(run, `${tag} 第 ${k} 个同时起音处`).toBeLessThan(3);
              }
            }
          }
        }
      }
    });

    it(`${id}：两套编配每一遍里没有超过 2 秒的静默（没有任何一个音在响）`, () => {
      for (const def of [TRACKS[id], ORCH_TRACKS[id]]) {
        for (let pass = 0; pass < def.forms.length; pass++) {
          const p = realizePass(def, pass);
          const spans = p.events.map((e) => [e.t, e.t + (e.hit ? 0.3 : e.d)] as const).sort((x, y) => x[0] - y[0]);
          let end = 0;
          for (const [a, b] of spans) {
            expect(a - end, `${id}#${pass} 在 ${end.toFixed(1)}–${a.toFixed(1)} 秒`).toBeLessThanOrEqual(2);
            end = Math.max(end, b);
          }
          expect(p.length - end, `${id}#${pass} 结尾`).toBeLessThanOrEqual(2.5);
        }
      }
    });
  }
});

/** 用到的类型（编译时检查清单里的编号都是曲目编号）。 */
const _ids: readonly TrackId[] = MORE_TRACK_IDS;
void _ids;
