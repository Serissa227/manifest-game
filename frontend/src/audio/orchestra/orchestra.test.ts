// 管弦版（真实乐器的采样）：采样清单的完整性与体积、采样的挑选与移调范围、长音的循环安排与交叉淡化曲线、
// 每首管弦版曲目与短乐句的曲谱（小节、和弦、声部、只用管弦乐器、每一遍的每个音都在采样的音域里、旋律声部不丢音、打击乐的鼓点都有采样）。
import { describe, expect, it } from "vitest";
import { badBars } from "../abc";
import { cueShift, instrumentOf, isPhrased, scheduleItems, usesSamples } from "../engine";
import { DRUMS, INSTRUMENTS } from "../instruments";
import { REGIONAL_INSTRUMENTS } from "../instruments/regional";
import { barUnits, chordsOf, lineOf, patternOf, realizePass, type NoteEvent, type TrackDef } from "../score";
import { pc } from "../theory";
import { TRACK_IDS, TRACKS } from "../tracks";
import { CUE_IDS, JINGLES } from "../tracks/jingles";
import { markOf, originOf, sampleUrl } from "./bank";
import { isOrchestral, ORCH_HITS, ORCH_INSTRUMENTS, ORCH_KEYS, type SampledSpec } from "./instruments";
import { filesFor, hitOf, layerFor, pickHit, pickZones, positionsOf } from "./pick";
import { effectiveAttack, fadeCurve, sustainPlan, velocityGain } from "./sampler";
import { SAMPLE_SETS, type SampleZone } from "./samples";
import { ORCH_JINGLES, ORCH_TRACKS } from "./tracks";
import { ORCH_STINGS } from "./tracks/stings";
import { STING_IDS, STINGS } from "../tracks/stings";

const MB = 1000 * 1000;

/** public/audio/orchestra 下的全部 MP3：路径 → base64 的 data URL（Vite 的 ?inline）。 */
const PUBLIC_FILES = import.meta.glob<string>("../../../public/audio/orchestra/**/*.mp3", { query: "?inline", import: "default", eager: true });
const PREFIX = "../../../public/audio/orchestra/";

/** data URL 里的字节数。 */
function dataBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length * 3) / 4 - pad;
}

describe("采样清单", () => {
  const zones = Object.values(SAMPLE_SETS).flatMap((s) => s.zones);

  it("清单里的每个文件都在 public/audio/orchestra 下，大小与清单一致；那里也没有清单外的文件", () => {
    expect(zones.length).toBeGreaterThan(300);
    for (const z of zones) {
      const url = PUBLIC_FILES[PREFIX + z.file];
      expect(url, z.file).toBeTruthy();
      expect(url.startsWith("data:audio/mpeg;base64,"), z.file).toBe(true);
      expect(dataBytes(url), z.file).toBe(z.bytes);
      expect(z.hash, z.file).toMatch(/^[0-9a-f]{8}$/);
    }
    const listed = new Set(zones.map((z) => PREFIX + z.file));
    expect(Object.keys(PUBLIC_FILES).filter((f) => !listed.has(f))).toEqual([]);
  });

  it("游戏里新增的音频总共不超过 15 MB（上限 20 MB）", () => {
    const total = zones.reduce((s, z) => s + z.bytes, 0);
    expect(total).toBeLessThanOrEqual(15 * MB);
    expect(total).toBeGreaterThan(3 * MB);
  });

  it("每个采样的数据合理：增益、长度、起音标记、奏稳的时刻、循环段与交叉淡化；有音高的乐器的采样都有音高", () => {
    const pitched = new Set(Object.values(ORCH_INSTRUMENTS).flatMap((s) => (s.mode === "hits" ? [] : [s.set, ...(s.roll ? [s.roll] : [])])));
    const unpitched = new Set(Object.values(ORCH_INSTRUMENTS).flatMap((s) => Object.values(s.hits ?? {})));
    for (const [key, set] of Object.entries(SAMPLE_SETS)) {
      expect(pitched.has(key) || unpitched.has(key), `${key} 没有乐器用`).toBe(true);
      expect(set.zones.length, key).toBeGreaterThan(0);
      for (const z of set.zones) {
        expect(Number.isFinite(z.gain) && z.gain > 0, z.file).toBe(true);
        expect(z.length, z.file).toBeGreaterThan(0.1);
        expect(z.mark, z.file).toBeGreaterThanOrEqual(0);
        expect(z.mark, z.file).toBeLessThan(0.05);
        expect(z.attack, z.file).toBeGreaterThanOrEqual(0);
        if (set.kind === "sustain") {
          const [s, e, xf, rho] = z.loop!;
          expect(s, z.file).toBeGreaterThan(z.attack);
          expect(s - xf, z.file).toBeGreaterThan(0);
          expect(e, z.file).toBeLessThanOrEqual(z.length);
          expect(e - s, z.file).toBeGreaterThanOrEqual(0.8);
          expect(xf, z.file).toBeGreaterThan(0.04);
          expect(rho, z.file).toBeGreaterThanOrEqual(-1);
          expect(rho, z.file).toBeLessThanOrEqual(1);
        } else expect(z.loop, z.file).toBeNull();
        if (pitched.has(key)) expect(Number.isFinite(z.pitch), z.file).toBe(true);
        else expect(z.pitch, z.file).toBeNull();
      }
    }
  });

  it("乐器用到的采样组都在清单里；打击乐的每个鼓点都有采样，旋律行的音名也都对得上鼓点", () => {
    for (const [id, spec] of Object.entries(ORCH_INSTRUMENTS)) {
      if (spec.mode === "hits") {
        for (const [hit, set] of Object.entries(spec.hits ?? {})) expect(SAMPLE_SETS[set], `${id} ${hit}`).toBeTruthy();
        for (const hit of Object.values(spec.keys ?? {})) expect(ORCH_HITS[hit], `${id} ${hit}`).toBeTruthy();
        continue;
      }
      expect(SAMPLE_SETS[spec.set], id).toBeTruthy();
      if (spec.roll) expect(SAMPLE_SETS[spec.roll]?.kind, id).toBe("sustain");
      expect(SAMPLE_SETS[spec.set].kind === "sustain", id).toBe(spec.mode === "sustain");
      expect(spec.level, id).toBeGreaterThan(0);
      expect(spec.range[0], id).toBeLessThan(spec.range[1]);
    }
    expect(Object.keys(ORCH_KEYS).length).toBeGreaterThanOrEqual(12);
  });

  it("URL 带部署的挂载路径与内容哈希", () => {
    const z = SAMPLE_SETS["vn.sus"].zones[0];
    expect(sampleUrl(z.file)).toBe(`${import.meta.env.BASE_URL}audio/orchestra/${z.file}?v=${z.hash}`);
  });
});

describe("采样的挑选与移调", () => {
  it("挑离音高最近的采样点，移调不超过上限；采样点上的音不移调", () => {
    const vn = ORCH_INSTRUMENTS["o.vn"];
    for (let m = vn.range[0]; m <= vn.range[1]; m++) {
      for (const layer of [0, 1]) {
        const picks = pickZones(vn.set, m, layer, 0, false, vn.maxShift);
        expect(picks.length, `${m}`).toBe(1);
        const shift = m - picks[0].zone.pitch!;
        expect(Math.abs(shift), `${m}`).toBeLessThanOrEqual(vn.maxShift);
        // 最近：没有别的同层采样点更近
        const others = positionsOf(vn.set).filter((p) => p.layer === picks[0].zone.layer);
        expect(others.every((p) => Math.abs(p.pitch - m) >= Math.abs(shift) - 0.06)).toBe(true);
        expect(picks[0].rate).toBeCloseTo(Math.pow(2, shift / 12), 9);
      }
    }
    const [exact] = pickZones("vn.sus", 69, 1, 0, false, 5);
    expect(Math.abs(Math.log2(exact.rate) * 1200)).toBeLessThan(10);
  });

  it("力度层：按分界选层（弱奏柔、强奏亮）；这一层附近没有采样点时换最近的一层", () => {
    const vn = ORCH_INSTRUMENTS["o.vn"];
    expect(layerFor(vn, 0.4)).toBe(0);
    expect(layerFor(vn, 0.75)).toBe(1);
    expect(pickZones(vn.set, 69, 0, 0, false, vn.maxShift)[0].zone.layer).toBe(0);
    expect(pickZones(vn.set, 69, 1, 0, false, vn.maxShift)[0].zone.layer).toBe(1);
    // 圆号强奏层只到中央 C：更高的音退回弱奏层
    const hn = ORCH_INSTRUMENTS["o.hn"];
    const high = pickZones(hn.set, 76, 1, 0, false, hn.maxShift);
    expect(high[0].zone.layer).toBe(0);
    expect(Math.abs(76 - high[0].zone.pitch!)).toBeLessThanOrEqual(1.1);
  });

  it("两个采样点叠奏：圆号在 C4–D5 的空当里由两头各拉一个，各 −3 dB；只有一个在范围里时单独奏", () => {
    const hn = ORCH_INSTRUMENTS["o.hn"];
    const g = pickZones(hn.set, 67, 0, 0, true, hn.maxShift);
    expect(g.length).toBe(2);
    expect(g.map((p) => Math.round(p.zone.pitch!)).sort()).toEqual([60, 74]);
    for (const p of g) expect(p.weight).toBeCloseTo(Math.SQRT1_2, 6);
    const one = pickZones(hn.set, 66, 0, 0, true, hn.maxShift);
    expect(one.length).toBe(1);
    expect(one[0].weight).toBe(1);
  });

  it("轮换：同一个音的几次录音轮流用；打击乐按力度层与轮换挑", () => {
    const a = pickZones("vn.pizz", 69, 0, 0, false, 4)[0].zone;
    const b = pickZones("vn.pizz", 69, 0, 1, false, 4)[0].zone;
    expect(a.file).not.toBe(b.file);
    expect(pickZones("vn.pizz", 69, 0, 2, false, 4)[0].zone.file).toBe(a.file);
    const soft = pickHit("perc.snare", 0, 0)!;
    const loud = pickHit("perc.snare", 2, 0)!;
    expect(soft.layer).toBe(0);
    expect(loud.layer).toBe(2);
    expect(pickHit("perc.snare", 2, 1)!.file).not.toBe(loud.file);
    // 没有这一层（大鼓只有两层）用最近的层
    expect(pickHit("perc.bd", 2, 0)!.layer).toBe(1);
    // 只从“可用的”（已加载的）里挑
    const only = (z: SampleZone) => z.layer === 0;
    expect(pickZones("vn.sus", 70, 1, 0, false, 5, only)[0].zone.layer).toBe(0);
    expect(pickZones("vn.sus", 70, 1, 0, false, 5, () => false)).toEqual([]);
  });

  it("鼓点：伴奏型给的鼓点名，或打击乐旋律行的音名", () => {
    const perc = ORCH_INSTRUMENTS["o.perc"];
    const ev = (m: number, hit?: string): NoteEvent => ({ t: 0, d: 0.3, v: 0.8, voice: "p", m, hit });
    expect(hitOf(perc, ev(0, "tamb"))).toBe("tamb");
    expect(hitOf(perc, ev(60))).toBe("bd");
    expect(hitOf(perc, ev(65))).toBe("crash");
    expect(hitOf(perc, ev(67))).toBe("swell");
    expect(hitOf(perc, ev(66))).toBeNull();
  });

  it("力度 → 增益：单调，力度 0.8 约 −2.4 dB", () => {
    expect(20 * Math.log10(velocityGain(0.8))).toBeCloseTo(-2.42, 1);
    expect(velocityGain(0.5)).toBeLessThan(velocityGain(0.6));
    expect(velocityGain(0)).toBe(0);
  });

  it("长音的起音随音长收紧：快的经过音从更靠近“奏稳”处开始，不短于 30 毫秒", () => {
    expect(effectiveAttack(0.14, 2)).toBeCloseTo(0.14, 9);
    expect(effectiveAttack(0.14, 0.2)).toBeCloseTo(0.07, 9);
    expect(effectiveAttack(0.14, 0.05)).toBeCloseTo(0.03, 9);
  });

  it("和弦声部：同一音高前后相接的连音合成一个长音（换和弦时的共同音不重新起音），不同音高照常各自起音", () => {
    const track: TrackDef = {
      id: "t-poly",
      title: { zh: "t", en: "t" },
      qpm: 60,
      meter: [4, 4],
      key: "C major",
      voices: { p: { inst: "o.va", poly: true, pattern: { kind: "pad", low: 55, high: 67, size: 3 } } },
      sections: { A: { bars: 2, chords: "C | Am" } },
      forms: [[{ s: "A", play: "p" }]],
      rest: [0, 0],
    };
    const events = realizePass(track, 0).events;
    const items = scheduleItems(track, events);
    // C 大三和弦与 A 小三和弦有两个共同音（C、E）：六个事件合成四个音
    expect(events.length).toBe(6);
    expect(items.length).toBe(4);
    const held = items.filter((i) => "note" in i && i.note.d > 6);
    expect(held.length).toBe(2);
    expect(items.every((i) => "note" in i)).toBe(true);
  });
});

describe("长音的循环与交叉淡化", () => {
  const zone = SAMPLE_SETS["vn.sus"].zones.find((z) => z.layer === 1)!;

  it("短的音只用一段；长的音按循环段一段段接上，每段的淡出与下一段的淡入对齐，覆盖到结束为止", () => {
    const [S, E, xf] = zone.loop!;
    const short = sustainPlan(zone, 1, 10, 0.1, 10.5);
    expect(short.length).toBe(1);
    expect(short[0].stop).toBeCloseTo(10.5, 9);
    for (const rate of [1, 0.84, 1.26]) {
      const until = 10 + 22;
      const plan = sustainPlan(zone, rate, 10, 0.2, until);
      expect(plan.length).toBeGreaterThan(5);
      expect(plan[0].offset).toBeCloseTo(0.2, 9);
      expect(plan[0].fadeIn).toBeNull();
      for (let k = 1; k < plan.length; k++) {
        const prev = plan[k - 1];
        const seg = plan[k];
        expect(seg.offset).toBeCloseTo(S - xf, 9);
        expect(seg.fadeIn![1]).toBeCloseTo(xf / rate, 9);
        expect(prev.fadeOut![0]).toBeCloseTo(seg.fadeIn![0], 9);
        expect(seg.start).toBeCloseTo(seg.fadeIn![0], 9);
        // 前一段在淡出结束时正好放到循环终点
        expect(prev.fadeOut![0] + prev.fadeOut![1]).toBeCloseTo(prev.start + (E - prev.offset) / rate, 9);
      }
      const last = plan[plan.length - 1];
      expect(last.fadeOut).toBeNull();
      expect(last.stop).toBeCloseTo(until, 9);
    }
  });

  it("交叉淡化曲线：不相关的两段等功率，完全相关的两段相加为 1，都从 0 到 1、单调", () => {
    for (const rho of [0, 0.5, 1]) {
      const a = fadeCurve(rho, true);
      const b = fadeCurve(rho, false);
      expect(a[0]).toBeCloseTo(0, 6);
      expect(a[a.length - 1]).toBeCloseTo(1, 6);
      expect(b[0]).toBeCloseTo(1, 6);
      expect(b[b.length - 1]).toBeCloseTo(0, 6);
      for (let i = 1; i < a.length; i++) {
        expect(a[i]).toBeGreaterThanOrEqual(a[i - 1] - 1e-9);
        expect(b[i]).toBeLessThanOrEqual(b[i - 1] + 1e-9);
        // 响度不变：a² + b² + 2ρab = 1
        expect(a[i] * a[i] + b[i] * b[i] + 2 * rho * a[i] * b[i]).toBeCloseTo(1, 5);
      }
    }
  });

  it("浏览器解码后的起音对齐：标记前的静音算作解码器的延迟，夹在 0–0.2 秒", () => {
    const sr = 48000;
    const x = new Float32Array(sr);
    const delay = 1105;
    for (let i = delay + 96; i < x.length; i++) x[i] = 0.5 * Math.sin(i * 0.05) * Math.min(1, (i - delay - 96) / 50);
    const got = markOf([x, x], sr);
    expect(got).toBeGreaterThan((delay + 96) / sr);
    expect(got).toBeLessThan((delay + 160) / sr);
    expect(originOf(got, 0.0021)).toBeCloseTo(got - 0.0021, 9);
    expect(originOf(0.001, 0.002)).toBe(0);
    expect(originOf(5, 0)).toBe(0.2);
  });
});

// ───────────────────────────── 曲谱

/**
 * 地方特色的港口曲（第九批配乐·地方特色第一阶段）：管弦版里地方乐器（合成的，instruments/regional/）领奏、管弦只做衬底，
 * 所以这几首的管弦版允许用地方乐器与打击乐（inst: "perc"）；其余曲目照旧只用管弦版的乐器。
 * 第二阶段按地区重编的学院主题与航海曲（不只是港口曲）同样列在这里。
 */
const REGIONAL_PORTS: ReadonlySet<string> = new Set([
  ...["port_japan", "port_ming", "port_ottoman", "port_india", "port_malay", "port_maya", "port_andes", "port_swahili"],
  // 第二阶段（文艺复兴的伊比利亚与意大利）：两首新港口曲，以及改由地方乐器领奏的学院短主题《侯爵府的维韦拉》与两首航海曲（伊比利亚、地中海）
  ...["port_iberia", "port_italy", "ac_seville", "sea_iberia", "sea_med"],
  // 第二阶段（北欧）：五首新港口曲、重编的《柯克船的号子》与学院短主题·安特卫普、《北风与白鲸》的寰宇重编版
  ...["port_flanders", "port_england", "port_france", "port_hansa", "port_russia", "sea_hansa", "sea_arctic", "ac_antwerp"],
  // 地方特色第二阶段（阿拉伯、波斯、马格里布）：三首新港口曲，重编的三首学院主题与《季风之路》
  ...["port_arabia", "port_persia", "port_maghreb", "ac_azhar", "ac_fez", "ac_ship", "sea_monsoon"],
  // 第二阶段·奥斯曼军乐与希腊、黎凡特（与阿拉伯的海的航海曲）
  ...["port_levant", "battle_ottoman", "sea_levant", "sea_arabic"],
  // 地方特色第二阶段·非洲：四首港口曲与一首航海曲
  ...["port_ethiopia", "port_kongo", "port_guinea", "port_benin", "sea_guinea"],
  // 第二阶段（印度：莫卧儿宫廷与南印度）：两首新的港口曲与印度沿岸的航海曲
  ...["port_malabar", "port_mughal", "sea_india"],
  // 地方特色第二阶段（中南半岛与菲律宾）：四首新港口曲、《苏禄海的锣》与重编的《丁香群岛的铜锣》《吉里的读经声》
  ...["port_siam", "port_burma", "port_vietnam", "port_philippines", "sea_nusantara", "ac_giri", "sea_sulu"],
  // 第二阶段·东亚宫廷：重编的学院主题（京都、漳州）与两首航海曲，东海的航海曲与两首节日曲
  ...["ac_kyoto", "ac_zhangzhou", "sea_japan", "sea_ming", "sea_east_china", "ub_matsuri", "ub_lantern"],
  // 地方特色第二阶段（朝鲜、琉球、女真与满洲）：三首新港口曲
  ...["port_korea", "port_ryukyu", "port_jurchen"],
  // 第二阶段·美洲：三首新港口曲与《巴西海流》，改由地方乐器领奏的《尤卡坦的信风》《钦查的筏》《修院的晨课》
  ...["port_aztec", "port_caribbean", "port_brazil", "sea_brazil", "sea_caribbean", "sea_andes", "ac_merida"],
  // 第二阶段·太平洋：港口曲《潟湖的鼓声》与重编的航海曲《星路》（太平洋的乐器领奏）
  ...["port_polynesia", "sea_pacific"],
  // 第九批·养成平时的轮换（2026-11-02）：九首“家乡的日常”（地方乐器领奏；三首通用的平时曲是纯管弦，不在这里）
  ...["ub_home_iberia", "ub_home_lowlands", "ub_home_maghreb", "ub_home_gulf", "ub_home_swahili", "ub_home_maya", "ub_home_ming", "ub_home_japan", "ub_home_moluccas"],
  // 第九批 A01（2026-11-11）多写的曲目里由地方乐器领奏的：各片海的第二首航海曲
  ...["sea_canaries", "sea_tyrrhenian", "sea_aegean", "sea_gulf", "sea_swahili", "sea_channel", "sea_banks", "sea_kuroshio", "sea_lanterns", "sea_malacca", "sea_treasure", "sea_bengal"],
  // 同上：东亚的海上的风暴与海战，七首港口曲的第二首
  ...["storm_typhoon", "battle_east", "port_iberia_eve", "port_indies", "port_japan_eve", "port_ming_tea", "port_ottoman_cafe", "port_malay_night", "port_town", "port_lagoon", "port_estuary", "port_taarab"],
]);

/** 管弦版里允许出现的合成声部：地方特色的港口曲里的地方乐器与打击乐。 */
function regionalVoice(track: TrackDef, voice: string): boolean {
  const id = track.voices[voice].inst;
  return REGIONAL_PORTS.has(track.id) && !isOrchestral(id) && (id === "perc" || Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, id));
}

/** 声部的采样乐器（管弦版曲目只用这些；地方特色的港口曲里的地方乐器与打击乐例外，返回 null）。 */
function specOf(track: TrackDef, voice: string): SampledSpec | null {
  const id = track.voices[voice].inst;
  if (regionalVoice(track, voice)) return null;
  expect(isOrchestral(id), `${track.id} 的声部 ${voice}（${id}）不是管弦版的乐器`).toBe(true);
  return ORCH_INSTRUMENTS[id];
}

/** 小节、和弦、声部、伴奏型、鼓点都存在；只用管弦版的乐器。 */
function checkOrchScore(track: TrackDef): void {
  const id = track.id;
  const bar = barUnits(track.meter);
  for (const [name, section] of Object.entries(track.sections)) {
    chordsOf(section, bar);
    for (const l of Object.keys(section.lines ?? {})) {
      const parsed = lineOf(track, name, l);
      expect(badBars(parsed, bar, section.pickup ?? 0), `${id} ${name}/${l}`).toEqual([]);
      expect(parsed.length, `${id} ${name}/${l}`).toBeCloseTo(section.bars * bar, 6);
    }
  }
  for (const [name, v] of Object.entries(track.voices)) {
    const spec = specOf(track, name);
    const variants = v.pattern && !("kind" in v.pattern) ? Object.values(v.pattern) : v.pattern ? [v.pattern] : [];
    if (!spec) {
      // 地方乐器与打击乐（合成）：乐器与鼓点都在合成版的表里
      expect(INSTRUMENTS[v.inst], `${id} 的声部 ${name}`).toBeTruthy();
      for (const p of variants) if (p.kind === "drum") for (const [hit] of Object.values(p.hits)) expect(DRUMS[hit], `${id} 的鼓点 ${hit}`).toBeTruthy();
      continue;
    }
    for (const p of variants) {
      if (p.kind === "drum") {
        expect(spec.mode, `${id} ${name}`).toBe("hits");
        for (const [hit] of Object.values(p.hits)) expect(ORCH_HITS[hit], `${id} 的鼓点 ${hit}`).toBeTruthy();
      }
      if (p.kind === "strum" || p.kind === "arp") expect(spec.mode === "shot" || !isPhrased(spec, v.poly) || !/\+/.test(p.steps), `${id} ${name}：旋律声部不能奏双音`).toBe(true);
      if (p.kind === "pad") expect(v.poly, `${id} ${name}：和弦长音要写 poly`).toBe(true);
    }
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

/** 每一遍的每个音：在乐器的音域里，离最近的采样点不超过移调上限（shifts 为短乐句的移调范围）；打击乐的每一击都对得上鼓点。 */
function checkNotes(track: TrackDef, shifts: readonly number[] = [0]): void {
  for (let pass = 0; pass < track.forms.length; pass++) {
    const p = realizePass(track, pass);
    for (const e of p.events) {
      const spec = specOf(track, e.voice);
      if (!spec) {
        // 地方乐器（合成）：音高在合成乐器的音域里（与合成版同一条规矩），打击乐的鼓点都在
        const where = `${track.id}#${pass} ${e.voice}（${track.voices[e.voice].inst}）音高 ${e.m}`;
        if (INSTRUMENTS[track.voices[e.voice].inst].kind === "perc") expect(DRUMS[e.hit ?? ""], where).toBeTruthy();
        else for (const k of shifts) {
          expect(e.m + k, where).toBeGreaterThanOrEqual(26);
          expect(e.m + k, where).toBeLessThanOrEqual(100);
        }
        continue;
      }
      if (spec.mode === "hits") {
        const hit = hitOf(spec, e);
        expect(hit && ORCH_HITS[hit], `${track.id}#${pass} ${e.voice} 的鼓点（音高 ${e.m}）`).toBeTruthy();
        continue;
      }
      const set = spec.roll && e.deco?.includes("trem") ? spec.roll : spec.set;
      for (const k of shifts) {
        const m = e.m + k;
        const where = `${track.id}#${pass} ${e.voice}（${track.voices[e.voice].inst}）音高 ${m}`;
        expect(m, where).toBeGreaterThanOrEqual(spec.range[0]);
        expect(m, where).toBeLessThanOrEqual(spec.range[1]);
        for (const layer of [0, 1, 2]) expect(pickZones(set, m, layer, 0, !!spec.pair, spec.maxShift).length, where).toBeGreaterThan(0);
      }
    }
  }
}

/** 旋律声部（按乐句调度的长音）同时只有一个音：同时开始的音会被丢掉，曲谱里不能有。 */
function checkMonophony(track: TrackDef): void {
  for (let pass = 0; pass < track.forms.length; pass++) {
    const byVoice = new Map<string, NoteEvent[]>();
    for (const e of realizePass(track, pass).events) {
      const v = track.voices[e.voice];
      if (!isPhrased(instrumentOf(v.inst)!, v.poly)) continue;
      const list = byVoice.get(e.voice) ?? [];
      list.push(e);
      byVoice.set(e.voice, list);
    }
    for (const [voice, list] of byVoice) {
      for (let i = 1; i < list.length; i++) expect(Math.abs(list[i].t - list[i - 1].t), `${track.id}#${pass} ${voice} 在 ${list[i].t.toFixed(2)} 秒有同时的两个音`).toBeGreaterThanOrEqual(0.012);
    }
    // 调度单位：旋律声部成乐句，其余逐音
    for (const item of scheduleItems(track, realizePass(track, pass).events)) {
      const v = track.voices[item.voice];
      specOf(track, item.voice);
      expect(isPhrased(instrumentOf(v.inst)!, v.poly), `${track.id}#${pass} ${item.voice}`).toBe("phrase" in item);
    }
  }
}

/** 旋律行（不含打击乐、定音鼓、钟、刮奏）落在小节第一拍、至少一拍长的音，与当时的和弦不能构成小二度 / 大七度的冲突。 */
function downbeatClashes(track: TrackDef): string[] {
  const out: string[] = [];
  const bar = barUnits(track.meter);
  for (const [name, section] of Object.entries(track.sections)) {
    const spans = chordsOf(section, bar);
    if (!spans.length) continue;
    for (const l of Object.keys(section.lines ?? {})) {
      const players = new Set<string>();
      for (const form of track.forms) for (const st of form) if (st.s === name) for (const tok of st.play.split(/\s+/)) if (tok.startsWith(`${l}:`)) players.add(tok.slice(l.length + 1).replace(/[+~-].*$/, ""));
      const melodic = [...players].some((v) => {
        const spec = ORCH_INSTRUMENTS[track.voices[v]?.inst ?? ""];
        const synth = INSTRUMENTS[track.voices[v]?.inst ?? ""];
        return (spec && spec.mode === "sustain") || (!!synth && (synth.kind === "wind" || synth.kind === "bowed" || synth.kind === "brass"));
      });
      if (!melodic || ["timp", "gliss"].includes(l)) continue;
      const parsed = lineOf(track, name, l);
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
          if (clash) out.push(`${track.id} ${name}/${l} 第 ${Math.floor(u / bar) + 1} 小节：音 ${p} 与 ${span.chord.symbol}`);
        }
      }
    }
  }
  return out;
}

describe("管弦版的曲目", () => {
  for (const id of TRACK_IDS) {
    const track = ORCH_TRACKS[id];
    if (!track) continue;
    describe(id, () => {
      it("与合成版同一个编号、曲名与调（短乐句的移调、点唱机都照旧）", () => {
        expect(track.id).toBe(id);
        expect(track.title).toEqual(TRACKS[id].title);
        expect(track.key).toBe(TRACKS[id].key);
        expect(track.rest).toEqual(TRACKS[id].rest);
      });

      it("小节、和弦、声部、伴奏型与鼓点完整，只用管弦版的乐器", () => {
        checkOrchScore(track);
      });

      it("每一遍的每个音都在乐器的音域里、离最近的采样点不超过移调上限；打击乐的每一击都有采样", () => {
        checkNotes(track);
      });

      it("旋律声部同时只有一个音（不会丢音）；和弦声部逐音", () => {
        checkMonophony(track);
      });

      it("强拍上的长音不与和弦构成半音冲突", () => {
        expect(downbeatClashes(track)).toEqual([]);
      });

      it("每一遍都能展开，长度合理，结果确定；要加载的采样不超过 5 MB", () => {
        for (let pass = 0; pass < track.forms.length; pass++) {
          const p = realizePass(track, pass);
          expect(p.events.length).toBeGreaterThan(40);
          expect(p.length).toBeGreaterThan(15);
          expect(p.length).toBeLessThan(260);
          expect(realizePass(track, pass)).toEqual(p);
        }
        const files = filesFor(track);
        expect(files.length).toBeGreaterThan(10);
        const bytes = files.reduce((s, f) => s + (Object.values(SAMPLE_SETS).flatMap((x) => x.zones).find((z) => z.file === f)?.bytes ?? 0), 0);
        expect(bytes).toBeLessThanOrEqual(5 * MB);
      });
    });
  }
});

describe("地方特色的港口曲：管弦版里地方乐器领奏、管弦只做衬底", () => {
  for (const id of REGIONAL_PORTS) {
    it(`${id}：地方乐器与打击乐的声部与合成版共用（同一份定义），衬底是管弦的采样；合成版不用采样`, () => {
      const orch = ORCH_TRACKS[id as keyof typeof ORCH_TRACKS];
      const synth = TRACKS[id as keyof typeof TRACKS];
      expect(usesSamples(orch)).toBe(true);
      expect(usesSamples(synth)).toBe(false);
      const regional = Object.keys(orch.voices).filter((v) => regionalVoice(orch, v));
      // 至少两件地方乐器领奏（不算打击乐）
      expect(regional.filter((v) => orch.voices[v].inst !== "perc").length, id).toBeGreaterThanOrEqual(2);
      for (const v of regional) expect(orch.voices[v], `${id} 的声部 ${v}`).toBe(synth.voices[v]);
      // 两套编配的分段时刻一样（可以在段落开头互相接上）
      for (let pass = 0; pass < synth.forms.length; pass++) {
        const a = realizePass(orch, pass);
        const b = realizePass(synth, pass);
        expect(a.steps.length).toBe(b.steps.length);
        a.steps.forEach((s, i) => expect(Math.abs(s.t - b.steps[i].t), `${id}#${pass} 第 ${i} 段`).toBeLessThan(0.02));
      }
    });
  }
});

describe("管弦版的短乐句", () => {
  for (const id of CUE_IDS) {
    const jingle = ORCH_JINGLES[id];
    if (!jingle) continue;
    it(`${id}：与合成版同一个编号与调；小节、声部完整；移调 −6…+5 之后每个音都在采样的音域里`, () => {
      expect(jingle.id).toBe(JINGLES[id].id);
      expect(jingle.key).toBe("D major");
      expect(jingle.rest).toEqual([0, 0]);
      expect(jingle.forms.length).toBe(1);
      checkOrchScore(jingle);
      checkNotes(jingle, [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
      checkMonophony(jingle);
      expect(downbeatClashes(jingle)).toEqual([]);
      const p = realizePass(jingle, 0);
      expect(p.length).toBeGreaterThan(2);
      expect(p.length).toBeLessThan(8);
      for (const tid of TRACK_IDS) {
        const k = cueShift(TRACKS[tid].key, jingle.key);
        expect(k).toBeGreaterThanOrEqual(-6);
        expect(k).toBeLessThanOrEqual(5);
      }
    });
  }
});

describe("管弦版的时间线短乐句", () => {
  for (const id of STING_IDS) {
    const sting = ORCH_STINGS[id];
    it(`${id}：与合成版同一个编号与调；小节、声部完整；移调 −6…+5 之后每个音都在采样的音域里；3–6 秒`, () => {
      expect(sting.id).toBe(STINGS[id].id);
      expect(sting.key).toBe("D major");
      expect(sting.rest).toEqual([0, 0]);
      expect(sting.forms.length).toBe(1);
      checkOrchScore(sting);
      checkNotes(sting, [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
      checkMonophony(sting);
      expect(downbeatClashes(sting)).toEqual([]);
      const p = realizePass(sting, 0);
      expect(p.length).toBeGreaterThanOrEqual(3);
      expect(p.length).toBeLessThanOrEqual(6);
      const bytes = filesFor(sting, true).reduce((sum, f) => sum + (Object.values(SAMPLE_SETS).flatMap((x) => x.zones).find((z) => z.file === f)?.bytes ?? 0), 0);
      expect(bytes).toBeLessThanOrEqual(5 * MB);
    });
  }
});
