// 地方特色第二阶段·印度（莫卧儿宫廷与南印度、马拉巴尔）：两首新的港口曲与印度沿岸的航海曲《雨季的船歌》——
// 登记、领奏的地方乐器、不写西洋和弦（只有萨与帕的空五度）、拉格（汉萨德瓦尼、达尔巴里·卡纳达、梅格）与 andolan、
// 塔拉（阿迪塔拉十六格一轮、乔塔拉二十四格一轮、帕卡瓦吉的鼓语、达德拉六格一轮）、提哈伊与莫拉落在第一拍上；港口与海区的选曲，经典世界照旧；
// gamaka 的位置：萨与帕不摇、kampita 在三级与七级、梅格二级的 andolan 与四级滑到二级、达尔巴里的 andolan、推弦从拉格里的音推上来；
// andolan 的方向（达尔巴里的降三降六往下摆、梅格的二级往上摆）；调了音的鼓（塔布拉、姆里丹加姆、帕卡瓦吉的右面）调在曲子的萨上。
// 曲谱的通用检查（小节、和弦、声部、音域、强拍半音冲突、确定性、两套的分段时刻……）在 audio.test.ts 与 orchestra.test.ts 里对全部曲目一起做。
import { describe, expect, it } from "vitest";
import { FACTION_STYLE, styleOf, townStyleOf } from "../art/buildings";
import { drum } from "./dsp";
import { INSTRUMENTS } from "./instruments";
import { REGIONAL_DRUMS, REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { chordsOf, lineOf, patternOf, realizePass, type Pattern, type TrackDef } from "./score";
import { parseKey, pc } from "./theory";
import type { LocView, StaticView } from "../ipc/types";
import { statics } from "../test/fixtures";
import { TERRA16_FACTIONS, TERRA16_REGIONS } from "../test/terra16";
import { TRACK_IDS, TRACKS } from "./tracks";
import {
  indiaCoastOf,
  INDIAN_OCEAN_ZONES,
  MUSIC_ZONE_TRACK,
  musicTrackOf,
  PORT_STYLE_TRACK,
  portTrackOf,
  REGION_ZONES,
  seaTrackOf,
  seaZoneOf,
  ZONE_TRACK,
} from "./zones";

const MALABAR = TRACKS.port_malabar;
const MUGHAL = TRACKS.port_mughal;
const SEA = TRACKS.sea_india;
const OURS = [MALABAR, MUGHAL, SEA];

/** 曲式里“旋律行:声部”的全部组合（声部 → 乐器）。 */
function players(t: TrackDef): { section: string; line: string; voice: string; inst: string }[] {
  const out: { section: string; line: string; voice: string; inst: string }[] = [];
  for (const form of t.forms)
    for (const st of form)
      for (const tok of st.play.split(/\s+/)) {
        const m = /^(\w+):(\w+)/.exec(tok);
        if (m) out.push({ section: st.s, line: m[1], voice: m[2], inst: t.voices[m[2]].inst });
      }
  return out;
}

/** 打击乐声部用到的全部鼓点。 */
function hitsOf(t: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(t.voices)) {
    if (v.inst !== "perc" || !v.pattern) continue;
    const ps: Pattern[] = "kind" in v.pattern ? [v.pattern as Pattern] : Object.values(v.pattern as Record<string, Pattern>);
    for (const p of ps) if (p.kind === "drum") for (const [h] of Object.values(p.hits)) out.add(h);
  }
  return out;
}

function drumSteps(t: TrackDef, voice: string, variant?: string): string {
  const p = patternOf(t.voices[voice], variant);
  if (!p || p.kind !== "drum") throw new Error(`${voice}.${variant}`);
  return p.steps;
}

describe("两首新的港口曲与《雨季的船歌》：登记", () => {
  it("编号、曲名与调：合成版与管弦版一致", () => {
    for (const id of ["port_malabar", "port_mughal", "sea_india"] as const) {
      expect(TRACK_IDS).toContain(id);
      expect(TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].title).toEqual(TRACKS[id].title);
      expect(ORCH_TRACKS[id].key).toBe(TRACKS[id].key);
    }
    expect(MALABAR.key).toBe("E major");
    expect(MUGHAL.key).toBe("C minor");
    expect(SEA.key).toBe("E mixolydian");
  });
});

describe("地方乐器领奏", () => {
  it("《豆蔻山下的港》：萨拉斯瓦蒂维纳琴与纳达斯瓦拉姆唱旋律（第二遍伊达卡也唱），打击乐是姆里丹加姆、甘吉拉、陶罐鼓、塔维尔、小钹与琴达", () => {
    const leads = new Set(players(MALABAR).map((p) => p.inst));
    for (const k of ["saraswati_veena", "nadaswaram", "edakka", "jaltarang"]) expect(leads.has(k), k).toBe(true);
    const hits = hitsOf(MALABAR);
    for (const h of ["mrd_nam", "mrd_thom", "kanj_bass", "ghatam_ta", "thavil_ta", "talam", "chenda_valam"]) expect(hits.has(h), h).toBe(true);
    // 持续音是坦布拉与奥图
    expect(MALABAR.voices.tanpura.inst).toBe("tanpura");
    expect(MALABAR.voices.ottu.inst).toBe("ottu");
  });

  it("《红砂岩的宫廷》：鲁德拉维纳琴与萨朗吉唱旋律（还有拉巴卜与鼓楼的谢赫奈），打击乐是帕卡瓦吉与纳卡拉", () => {
    const leads = new Set(players(MUGHAL).map((p) => p.inst));
    // 拉巴卜的键整合时改成 seni_rabab（与马格里布的 rabab 重名，见 DECISIONS“测试期望值变更”）
    for (const k of ["rudra_veena", "sarangi", "seni_rabab", "shehnai"]) expect(leads.has(k), k).toBe(true);
    const hits = hitsOf(MUGHAL);
    for (const h of ["pakh_ta", "pakh_din", "pakh_ge", "naq_dhum", "naq_tak"]) expect(hits.has(h), h).toBe(true);
  });

  it("《雨季的船歌》：萨朗吉、班苏里、维纳琴（应和）与多塔拉唱旋律，水碗落雨；船歌打塔布拉（萨 = E 的那只）的达德拉，划船歌打琴达与小钹", () => {
    const leads = new Set(players(SEA).map((p) => p.inst));
    for (const k of ["sarangi", "bansuri", "saraswati_veena", "dotara", "jaltarang"]) expect(leads.has(k), k).toBe(true);
    expect(SEA.voices.tanpura.inst).toBe("tanpura");
    const hits = hitsOf(SEA);
    for (const h of ["tabla_e_na", "bayan_ge", "chenda_edam", "chenda_valam", "talam"]) expect(hits.has(h), h).toBe(true);
  });

  it("每一首的每一遍：唱旋律的都是地方乐器", () => {
    for (const t of OURS) for (const p of players(t)) expect(Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, p.inst), `${t.id} ${p.section}/${p.line}:${p.voice}`).toBe(true);
  });

  it("管弦版：地方乐器的声部与合成版是同一份；管弦只做衬底（每个管弦声部的音量不超过 0.16）", () => {
    for (const t of OURS) {
      const orch = ORCH_TRACKS[t.id as keyof typeof ORCH_TRACKS];
      for (const [name, v] of Object.entries(orch.voices)) {
        if (v.inst.startsWith("o.")) expect(v.gain ?? 0.5, `${t.id} ${name}`).toBeLessThanOrEqual(0.16);
        else expect(v, `${t.id} ${name}`).toBe(t.voices[name]);
      }
    }
  });
});

describe("不写西洋和弦：只有萨与帕的空五度", () => {
  it("三首的每一段：和弦都是主音上的空五度（E5、C5、E5）", () => {
    for (const [t, root] of [[MALABAR, 4], [MUGHAL, 0], [SEA, 4]] as const) {
      for (const [name, s] of Object.entries(t.sections)) {
        for (const span of chordsOf(s, (t.meter[0] * 8) / t.meter[1])) {
          expect(span.chord.tones, `${t.id} ${name}`).toEqual([0, 7]);
          expect(span.chord.root, `${t.id} ${name}`).toBe(root);
        }
      }
    }
  });
});

describe("拉格", () => {
  const pcsOf = (t: TrackDef) => {
    const out = new Set<number>();
    for (const [name, s] of Object.entries(t.sections))
      for (const l of Object.keys(s.lines ?? {})) {
        const parsed = lineOf(t, name, l);
        for (const n of parsed.notes) for (const m of [...n.pitches, ...n.grace]) out.add(pc(m));
      }
    return out;
  };

  it("《豆蔻山下的港》只用汉萨德瓦尼的五个音（萨 = E：E 升F 升G B 升D），没有四级与六级", () => {
    const hamsadhwani = new Set([4, 6, 8, 11, 3]);
    for (const p of pcsOf(MALABAR)) expect(hamsadhwani.has(p), `${p}`).toBe(true);
    expect(pcsOf(MALABAR).size).toBe(5);
  });

  it("《红砂岩的宫廷》只用达尔巴里·卡纳达的七个音（萨 = C：降 E、降 A、降 B）；一拍以上的降三级与降六级都“摇”着奏（!vib!）", () => {
    const darbari = new Set([0, 2, 3, 5, 7, 8, 10]);
    for (const p of pcsOf(MUGHAL)) expect(darbari.has(p), `${p}`).toBe(true);
    for (const [name, s] of Object.entries(MUGHAL.sections))
      for (const l of Object.keys(s.lines ?? {}))
        for (const n of lineOf(MUGHAL, name, l).notes) {
          const p = pc(n.pitches[0]);
          if ((p === 3 || p === 8) && n.len >= 2) expect(n.deco, `${name}/${l} 第 ${n.at} 格`).toContain("vib");
        }
  });

  it("《雨季的船歌》只用梅格的五个音（萨 = E：E 升F A B D），没有三级与六级；船歌的长音多带滑音与揉音", () => {
    const megh = new Set([4, 6, 9, 11, 2]);
    for (const p of pcsOf(SEA)) expect(megh.has(p), `${p}`).toBe(true);
    expect(pcsOf(SEA).size).toBe(5);
    let deco = 0;
    for (const n of lineOf(SEA, "A", "mel").notes) if (n.len >= 3 && (n.deco.includes("bend") || n.deco.includes("vib"))) deco++;
    expect(deco).toBeGreaterThanOrEqual(4);
  });

  it("维纳琴与纳达斯瓦拉姆的旋律里 gamaka 很多：推上来（!bend!）与 kampita（!vib!）都有", () => {
    let bend = 0;
    let vib = 0;
    for (const [name, s] of Object.entries(MALABAR.sections))
      for (const l of Object.keys(s.lines ?? {}))
        for (const n of lineOf(MALABAR, name, l).notes) {
          if (n.deco.includes("bend")) bend++;
          if (n.deco.includes("vib")) vib++;
        }
    expect(bend).toBeGreaterThanOrEqual(8);
    expect(vib).toBeGreaterThanOrEqual(8);
  });
});

describe("gamaka 放在哪些音上：萨与帕不摇，推弦从拉格里的音推上来", () => {
  /** 三首的全部旋律音（段落 / 行 / 音）。 */
  const notesOf = (t: TrackDef) =>
    Object.entries(t.sections).flatMap(([name, s]) => Object.keys(s.lines ?? {}).flatMap((l) => lineOf(t, name, l).notes.map((n, i, all) => ({ where: `${name}/${l} 第 ${n.at} 格`, n, next: all[i + 1] }))));
  const RAGA: [TrackDef, Set<number>][] = [
    [MALABAR, new Set([4, 6, 8, 11, 3])],
    [MUGHAL, new Set([0, 2, 3, 5, 7, 8, 10])],
    [SEA, new Set([4, 6, 9, 11, 2])],
  ];

  it("!bend! 从低一个全音处推上来：三首里推弦的音，低一个全音也在拉格里（汉萨德瓦尼只推二级、三级，梅格不推四级与七级）", () => {
    for (const [t, raga] of RAGA)
      for (const { where, n } of notesOf(t)) if (n.deco.includes("bend")) expect(raga.has(pc(n.pitches[0] - 2)), `${t.id} ${where}`).toBe(true);
  });

  it("《豆蔻山下的港》：kampita（!vib!）只在三级（升 G）与七级（升 D）上，萨与帕（prakriti）平直；不少于八处", () => {
    let k = 0;
    for (const { where, n } of notesOf(MALABAR))
      if (n.deco.includes("vib")) {
        expect([8, 3], where).toContain(pc(n.pitches[0]));
        k++;
      }
    expect(k).toBeGreaterThanOrEqual(8);
  });

  it("《雨季的船歌》：萨与帕（achal）不加摇音；andolan 在二级 Re（升 F）上，至少三处是从四级 Ma 滑下来的（连线 A → 升 F）", () => {
    let andolan = 0;
    let meend = 0;
    for (const { where, n, next } of notesOf(SEA)) {
      if (n.deco.includes("vib")) expect([4, 11], where).not.toContain(pc(n.pitches[0]));
      if (n.deco.includes("andolan")) {
        expect(pc(n.pitches[0]), where).toBe(6);
        andolan++;
      }
      if (next && pc(n.pitches[0]) === 9 && n.slur && next.at === n.at + n.len && pc(next.pitches[0]) === 6 && next.deco.includes("andolan")) meend++;
    }
    expect(andolan).toBeGreaterThanOrEqual(4);
    expect(meend).toBeGreaterThanOrEqual(3);
  });

  it("《红砂岩的宫廷》：一拍以上的降三、降六都是 andolan（慢摇，不是一般的揉）；andolan 只在降三、降六上", () => {
    for (const { where, n } of notesOf(MUGHAL)) {
      const p = pc(n.pitches[0]);
      if ((p === 3 || p === 8) && n.len >= 2) expect(n.deco, where).toContain("andolan");
      if (n.deco.includes("vib")) expect(n.deco, where).toContain("andolan");
      if (n.deco.includes("andolan")) expect([3, 8], where).toContain(p);
    }
  });

  it("andolan 的方向：达尔巴里的降三、降六往下摆（!andolan!，不带 up），梅格的二级往上摆（!andolan-up!，带 up）", () => {
    let down = 0;
    let up = 0;
    for (const { where, n } of notesOf(MUGHAL))
      if (n.deco.includes("andolan")) {
        expect(n.deco, where).not.toContain("up");
        down++;
      }
    for (const { where, n } of notesOf(SEA))
      if (n.deco.includes("andolan")) {
        expect(n.deco, where).toContain("up");
        up++;
      }
    expect(down).toBeGreaterThanOrEqual(10);
    expect(up).toBeGreaterThanOrEqual(4);
    // up 只跟着 andolan 出现（三首都是）
    for (const t of OURS) for (const { where, n } of notesOf(t)) if (n.deco.includes("up")) expect(n.deco, `${t.id} ${where}`).toContain("andolan");
  });
});

describe("调了音的鼓调在曲子的萨上", () => {
  const SR = 44100;
  /** 右面（右手鼓）调了音的鼓点 → 量它的萨用的那一下（鼓心长鸣的 Tun / Din，基音就是萨）。左面与没调音的鼓不在表里。 */
  const TUNED: Readonly<Record<string, string>> = {
    tabla_na: "tabla_tun",
    tabla_tin: "tabla_tun",
    tabla_tun: "tabla_tun",
    tabla_te: "tabla_tun",
    tabla_e_na: "tabla_e_tun",
    tabla_e_tin: "tabla_e_tun",
    tabla_e_tun: "tabla_e_tun",
    tabla_e_te: "tabla_e_tun",
    mrd_nam: "mrd_din",
    mrd_din: "mrd_din",
    mrd_chapu: "mrd_din",
    mrd_ki: "mrd_din",
    pakh_ta: "pakh_din",
    pakh_din: "pakh_din",
    pakh_tit: "pakh_din",
  };
  /** 鼓点在 0.08–0.4 秒里功率最大的频率（90–400 Hz，每 1 Hz 扫一次，Goertzel 加汉宁窗）。 */
  const saOf = (hit: string): number => {
    const x = drum(REGIONAL_DRUMS[hit], SR, 1);
    const a = Math.floor(0.08 * SR);
    const b = Math.min(x.length, Math.floor(0.4 * SR));
    let best = 0;
    let at = 0;
    for (let f = 90; f <= 400; f++) {
      const w = (2 * Math.PI * f) / SR;
      let re = 0,
        im = 0;
      for (let n = a; n < b; n++) {
        const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n - a)) / (b - a));
        re += x[n] * h * Math.cos(w * n);
        im -= x[n] * h * Math.sin(w * n);
      }
      const p = re * re + im * im;
      if (p > best) {
        best = p;
        at = f;
      }
    }
    return at;
  };

  it("塔布拉、姆里丹加姆、帕卡瓦吉的右面调在萨上：port_india（D）、《豆蔻山下的港》（E）、《红砂岩的宫廷》（C）、《雨季的船歌》（E），两套编配都查", () => {
    const measured = new Map<string, number>();
    for (const id of ["port_india", "port_malabar", "port_mughal", "sea_india"] as const)
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        const tonic = parseKey(t.key).tonic;
        const tuned = [...hitsOf(t)].filter((h) => h in TUNED);
        expect(tuned.length, id).toBeGreaterThan(0);
        for (const h of tuned) {
          const ref = TUNED[h];
          if (!measured.has(ref)) measured.set(ref, saOf(ref));
          const midi = 69 + 12 * Math.log2(measured.get(ref)! / 440);
          // 量出来的萨落在十二平均律的某个音上（±35 音分），这个音与曲子的主音同名
          expect(Math.abs(midi - Math.round(midi)), `${id} ${h}：${measured.get(ref)} Hz`).toBeLessThan(0.35);
          expect(pc(Math.round(midi)), `${id} ${h}：${measured.get(ref)} Hz`).toBe(tonic);
        }
      }
  });
});

describe("塔拉", () => {
  it("阿迪塔拉：两小节 4/4 是一轮（十六个八分音符），各段都是整轮；姆里丹加姆、甘吉拉、陶罐鼓、塔维尔、小钹的鼓型都是一轮或两轮", () => {
    expect(MALABAR.meter).toEqual([4, 4]);
    for (const [name, s] of Object.entries(MALABAR.sections)) expect(s.bars % 2, name).toBe(0);
    for (const v of ["mr", "ml", "kanj", "ghat", "thav", "talam"]) {
      const pat = MALABAR.voices[v].pattern as Record<string, Pattern>;
      for (const [variant, p] of Object.entries(pat)) if (p.kind === "drum") expect(p.steps.length % 16, `${v}.${variant}`).toBe(0);
    }
  });

  it("小钹在阿迪塔拉拍手的拍（第一、五、七拍）上敲开的“叮”，其余的拍敲闷的“嚓”", () => {
    const steps = drumSteps(MALABAR, "talam", "a");
    const open = [...steps].map((c, i) => (c === "C" ? i : -1)).filter((i) => i >= 0);
    expect(open).toEqual([0, 8, 12]);
  });

  it("达德拉：一小节 6/8 是一轮（六拍）；塔布拉 Na Tin Na | Na Tin Na、左手在 Dha Dhin | Dha 上；划船歌的琴达左面在两个附点四分音符的拍上", () => {
    expect(SEA.meter).toEqual([6, 8]);
    const r = drumSteps(SEA, "tabla");
    const l = drumSteps(SEA, "bayan");
    expect(r).toBe("ninnin");
    expect([...l].map((c, i) => (c === "G" ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 3]);
    expect([...drumSteps(SEA, "che")].map((c, i) => (c === "E" ? i : -1)).filter((i) => i >= 0)).toEqual([0, 3]);
    // 划船歌：领唱两小节、应和两小节，不重叠
    const row = lineOf(SEA, "B", "row").notes;
    const resp = lineOf(SEA, "B", "resp").notes;
    for (const a of row) for (const b of resp) expect(a.at + a.len <= b.at || b.at + b.len <= a.at, `${a.at} / ${b.at}`).toBe(true);
  });

  it("乔塔拉：两小节 6/4 是一轮（十二拍、二十四格）；帕卡瓦吉的鼓语 Dha Dha | Din Ta | Kit Dha | Din Ta | Tita Kata | Gadi Gana", () => {
    expect(MUGHAL.meter).toEqual([6, 4]);
    const r = drumSteps(MUGHAL, "pr", "theka");
    const l = drumSteps(MUGHAL, "pl", "theka");
    expect(r.length).toBe(24);
    expect(l.length).toBe(24);
    const bol = (i: number) => `${r[i]}${l[i]}`;
    // Dha = 右 Ta + 左 Ge
    for (const i of [0, 2, 10]) expect(bol(i), `第 ${i} 格`).toBe("nG");
    // Din（右面空击，左手不打）
    for (const i of [4, 12]) expect(bol(i), `第 ${i} 格`).toBe("d.");
    // Ta
    for (const i of [6, 14]) expect(bol(i), `第 ${i} 格`).toBe("n.");
    // Kit、Kata：左手闷拍在前
    for (const i of [8, 18]) expect(l[i], `第 ${i} 格`).toBe("k");
    // Gadi Gana：左手的 Ge 在前、右手跟着
    expect([l[20], r[21], l[22], r[23]]).toEqual(["G", "d", "G", "n"]);
  });
});

describe("提哈伊与莫拉：同一句连奏三遍，落在第一拍上", () => {
  /** 一行里某个乐句（音高序列）每次出现的起点（单位）。 */
  const starts = (t: TrackDef, section: string, line: string, phrase: readonly number[]) => {
    const notes = lineOf(t, section, line).notes;
    const out: number[] = [];
    for (let i = 0; i + phrase.length <= notes.length; i++) if (phrase.every((p, k) => pc(notes[i + k].pitches[0]) === p)) out.push(notes[i].at);
    return { notes, out };
  };

  it("《红砂岩的宫廷》的提哈伊：“降三 四 二 萨”三遍、间隔相等，第三遍的萨正好落在第三小节的第一拍（下一轮的萨姆）上", () => {
    const { notes, out } = starts(MUGHAL, "tihai", "ti", [3, 5, 2, 0]);
    expect(out.length).toBe(3);
    expect(out[1] - out[0]).toBe(out[2] - out[1]);
    const lastSa = notes.find((n) => n.at === out[2] + 4)!;
    expect(lastSa.at).toBe(24);
    expect(pc(lastSa.pitches[0])).toBe(0);
    // 帕卡瓦吉在每一遍的开头与萨姆上打 Dha（右 Ta + 左 Ge）
    const r = drumSteps(MUGHAL, "pr", "tihai");
    const l = drumSteps(MUGHAL, "pl", "tihai");
    for (const i of [...out, 24]) expect(`${r[i]}${l[i]}`, `第 ${i} 格`).toBe("nG");
    // 萨姆之后不再打
    expect(r.slice(25).replace(/\./g, "")).toBe("");
  });

  it("《豆蔻山下的港》的科尔瓦伊与斯瓦拉的莫拉：同一句三遍、间隔相等，最后一个音正好在段末结束（下一段从第一拍起）", () => {
    for (const [section, line, phrase] of [["korvai", "kv", [8, 11, 3, 4]], ["swaram", "sw", [11, 3, 4]]] as const) {
      const { notes, out } = starts(MALABAR, section, line, phrase);
      const three = out.slice(-3);
      expect(three.length, section).toBe(3);
      expect(three[1] - three[0], section).toBe(three[2] - three[1]);
      const last = notes[notes.length - 1];
      expect(last.at + last.len, section).toBe(MALABAR.sections[section].bars * 8);
    }
  });

  it("两首都能展开（每一遍），长度一分钟到一分半多，结果确定", () => {
    for (const t of [MALABAR, MUGHAL])
      for (let pass = 0; pass < t.forms.length; pass++) {
        const p = realizePass(t, pass);
        expect(p.length, `${t.id}#${pass}`).toBeGreaterThan(55);
        expect(p.length, `${t.id}#${pass}`).toBeLessThan(100);
        expect(realizePass(t, pass)).toEqual(p);
      }
  });
});

describe("选曲：港口与海区", () => {
  it("风格名：indian 照旧是 port_india（《棉布与靛蓝的码头》），mughal / deccan 是《红砂岩的宫廷》，马拉巴尔、喀拉拉、泰米尔、卡纳提克、锡兰是《豆蔻山下的港》", () => {
    expect(PORT_STYLE_TRACK.indian).toBe("port_india");
    for (const s of ["mughal", "deccan"]) expect(portTrackOf("x", s), s).toBe("port_mughal");
    for (const s of ["malabar", "kerala", "tamil", "south_indian", "carnatic", "sinhalese"]) expect(portTrackOf("x", s), s).toBe("port_malabar");
    expect(portTrackOf("x", "indian")).toBe("port_india");
  });

  it("terra16 的印度诸国在数据里写细名：北方的宫廷与德干放《红砂岩的宫廷》，南印度与锡兰放《豆蔻山下的港》，古吉拉特与孟加拉照旧", () => {
    // 配乐的数据接线（2026-10-11）：原来这些势力都写 indian，由前端按势力 key 细分（PORT_FACTION_REFINE）；
    // 现在数据写 mughal、hindustani（苏尔）、deccan、carnatic（维查耶纳伽尔）、malabar、sinhalese，选曲只看风格名（见 DECISIONS“测试期望值变更”）
    const want: Record<string, readonly [string, string]> = {
      mughal: ["mughal", "port_mughal"],
      sur: ["hindustani", "port_mughal"],
      bijapur: ["deccan", "port_mughal"],
      ahmadnagar: ["deccan", "port_mughal"],
      golconda: ["deccan", "port_mughal"],
      bidar: ["deccan", "port_mughal"],
      berar: ["deccan", "port_mughal"],
      vijayanagara: ["carnatic", "port_malabar"],
      calicut: ["malabar", "port_malabar"],
      cochin: ["malabar", "port_malabar"],
      kotte: ["sinhalese", "port_malabar"],
      kandy: ["sinhalese", "port_malabar"],
      gujarat: ["indian", "port_india"],
      bengal: ["indian", "port_india"],
    };
    const styleOfKey = new Map(TERRA16_FACTIONS.map((f) => [f.key, f.style]));
    for (const [key, [style, track]] of Object.entries(want)) {
      expect(styleOfKey.get(key), key).toBe(style);
      expect(portTrackOf(key, style), key).toBe(track);
    }
    // 不认势力 key：写 indian 就是《棉布与靛蓝的码头》，写别的风格就照那个风格
    expect(portTrackOf("calicut", "indian")).toBe("port_india");
    expect(portTrackOf("mughal", "indian")).toBe("port_india");
    expect(portTrackOf("calicut", "japanese")).toBe("port_japan");
    // 街景照旧与 indian 一样借奥斯曼
    for (const [key, [style]] of Object.entries(want)) expect(townStyleOf(key, style), key).toBe("ottoman");
  });

  it("经典世界照旧：经典的势力按经典的规则选港口曲；七种地域的航海曲不变", () => {
    for (const key of Object.keys(FACTION_STYLE)) {
      expect(portTrackOf(key, null)).toBe(`port_${styleOf(key, null)}`);
      expect(portTrackOf(key, undefined)).toBe(`port_${styleOf(key, undefined)}`);
    }
    expect(ZONE_TRACK).toEqual({ inner: "sea", north: "sea_north", south: "sea_south", islands: "sea_islands", eastern: "sea_east", newworld: "sea_new", ocean: "ocean" });
  });

  it("海区：印度沿岸（马拉巴尔、科罗曼德尔、孟加拉湾、锡兰）放《雨季的船歌》；印度洋与阿拉伯海照旧是《季风之路》", () => {
    for (const z of ["india", "indian_coast", "malabar", "coromandel", "bengal", "bay_of_bengal", "ceylon"]) expect(MUSIC_ZONE_TRACK[z], z).toBe("sea_india");
    expect(musicTrackOf("Bay of Bengal")).toBe("sea_india");
    expect(musicTrackOf("Ceylon")).toBe("sea_india");
    for (const z of ["indian_ocean", "indian", "arabian_sea", "monsoon", "swahili"]) expect(musicTrackOf(z), z).toBe("sea_monsoon");
    // terra16 的古吉拉特海、马拉巴尔海、锡兰海、孟加拉湾在数据里写明了印度沿岸的分区名（原来写笼统的 indian，靠下面的按港口细分）
    const music = new Map(TERRA16_REGIONS.map((r) => [r.key, r.music]));
    for (const k of ["gujarat", "malabar", "ceylon", "bengal_bay"]) expect(musicTrackOf(music.get(k)), k).toBe("sea_india");
  });

  describe("海区只写了笼统的印度洋（别的世界；terra16 原来的古吉拉特海、马拉巴尔海、锡兰海、孟加拉湾也是 music = \"indian\"）：按停泊的港口再分", () => {
    /** 六个势力：卡利卡特、古吉拉特、孟加拉（印度诸国）、葡萄牙、基尔瓦（斯瓦希里）、马尔代夫（海岛风格）。 */
    const base = statics.factions[0];
    const factions = (
      [
        ["calicut", "indian"],
        ["gujarat", "indian"],
        ["bengal", "indian"],
        ["portugal", "iberian"],
        ["kilwa", "swahili"],
        ["maldives", "islands"],
      ] as const
    ).map(([key, style], id) => ({ ...base, id, key, name: key, style }));
    const F = { calicut: 0, gujarat: 1, bengal: 2, portugal: 3, kilwa: 4, maldives: 5 } as const;
    /** 海区（id 按顺序）的 music 与停泊在那里的地点（势力、种类）。 */
    const world = (seas: [string | null, [keyof typeof F, LocView["kind"]][]][]): StaticView => {
      const locations: LocView[] = [];
      seas.forEach(([, locs], region) =>
        locs.forEach(([f, kind]) =>
          locations.push({ id: locations.length, key: `l${locations.length}`, name: "", kind, x: 0, y: 0, faction: F[f], shipyard: false, region }),
        ),
      );
      // 内陆城市（region 为 null）不算任何一片海
      locations.push({ id: locations.length, key: "inland", name: "", kind: "city", x: 0, y: 0, faction: F.portugal, shipyard: false, region: null });
      return { ...statics, factions, regions: seas.map(([m], id) => ({ id, name: `海区${id}`, ...(m === null ? {} : { music: m }) })), locations };
    };

    it("印度诸国的港口多过别的（葡萄牙占着的港口按葡萄牙算）：放《雨季的船歌》；按港口曲算，棉布与靛蓝、宫廷、马拉巴尔三首的势力都是印度", () => {
      const s = world([
        ["indian", [["calicut", "port"], ["gujarat", "port"], ["portugal", "port"]]], // 马拉巴尔海：卡利卡特、焦尔……与果阿
        ["indian", [["bengal", "port"], ["bengal", "port"]]], // 孟加拉湾：吉大港、胡格利
        ["Indian Ocean", [["gujarat", "city"]]], // 写法不区分大小写，空格当下划线；城市也算
        ["monsoon", [["calicut", "port"], ["kilwa", "site"], ["kilwa", "site"]]], // 殖民点不算
      ]);
      for (let r = 0; r < 4; r++) {
        expect(indiaCoastOf(r, s), `海区${r}`).toBe(true);
        expect(seaTrackOf(r, { x: 0, y: 0 }, s), `海区${r}`).toBe("sea_india");
      }
      expect(INDIAN_OCEAN_ZONES.map((z) => MUSIC_ZONE_TRACK[z])).toEqual(["sea_monsoon", "sea_monsoon", "sea_monsoon"]);
    });

    it("不是印度沿岸：斯瓦希里海岸、印度与别的一样多、没有港口的远洋、马尔代夫（海岛风格）——照旧是《季风之路》", () => {
      const s = world([
        ["indian", [["kilwa", "port"], ["kilwa", "port"], ["gujarat", "port"]]], // 斯瓦希里海
        ["indian", [["calicut", "port"], ["portugal", "port"]]], // 一样多
        ["indian", []], // 南印度洋
        ["indian", [["maldives", "port"]]], // 马尔代夫海
        ["indian_ocean", [["kilwa", "site"], ["kilwa", "site"]]], // 只有殖民点
      ]);
      for (let r = 0; r < 5; r++) {
        expect(indiaCoastOf(r, s), `海区${r}`).toBe(false);
        expect(seaTrackOf(r, { x: 0, y: 0 }, s), `海区${r}`).toBe("sea_monsoon");
      }
    });

    it("只细分笼统的印度洋：别的分区名、更细的分区名与直接写的曲目编号照写的放", () => {
      const india: [keyof typeof F, LocView["kind"]][] = [["calicut", "port"], ["bengal", "port"]];
      const s = world([
        ["arabian_sea", india],
        ["swahili", india],
        ["sea_monsoon", india],
        ["iberia", india],
        ["malabar", []],
        ["Bay of Bengal", [["kilwa", "port"]]],
      ]);
      expect([0, 1, 2, 3, 4, 5].map((r) => seaTrackOf(r, null, s))).toEqual(["sea_monsoon", "sea_monsoon", "sea_monsoon", "sea_iberia", "sea_india", "sea_india"]);
    });

    it("没写 music 的海区（经典世界）不看港口：与经典的规则完全一样", () => {
      const s = world([
        [null, [["calicut", "port"], ["calicut", "port"]]],
        [null, [["bengal", "port"]]],
      ]);
      for (const r of [0, 1]) for (const pos of [{ x: 10, y: 10 }, null]) expect(seaTrackOf(r, pos, s)).toBe(ZONE_TRACK[seaZoneOf(r, pos, s)]);
      for (let r = 0; r < REGION_ZONES.length; r++) expect(seaTrackOf(r, null, statics)).toBe(ZONE_TRACK[REGION_ZONES[r][1]]);
    });
  });

  it("用到的地方乐器都在乐器表里", () => {
    for (const t of OURS) for (const v of Object.values(t.voices)) expect(INSTRUMENTS[v.inst], `${t.id} ${v.inst}`).toBeTruthy();
  });
});
