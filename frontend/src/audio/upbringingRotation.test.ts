// 养成平时的轮换（第九批 2026-11-02，audio/upbringing.ts）：家乡曲的认法、平时的曲目池、洗牌轮换（同一首不连着放、一副里每首都轮到、
// 随机源可注入且结果确定）、换下一首的时机，事件、比赛、节日、结业照旧优先；以及新写的十二首曲子（九首“家乡的日常”、三首通用的平时曲）的写法。
import { describe, expect, it } from "vitest";
import type { Overview } from "../ipc/types";
import { setLocale } from "../i18n/locale";
import { overview } from "../test/fixtures";
import { REGIONAL_INSTRUMENTS } from "./instruments/regional";
import { trackTitle } from "./labels";
import { ORCH_TRACKS } from "./orchestra/tracks";
import { barUnits, chordsOf, lineOf, realizePass, rng, type TrackDef } from "./score";
import { parseKey, pc } from "./theory";
import { TRACK_IDS, TRACKS, type TrackId } from "./tracks";
import {
  everydayPool,
  HOMETOWN_PORT_FALLBACK,
  HOMETOWNS,
  hometownTrack,
  nextRotation,
  peekRotation,
  ROTATE_MIN_S,
  ROTATE_REST_S,
  rotationDue,
  startRotation,
  syncRotation,
  UB_EVERYDAY,
  UB_TITLE_TRACK,
  upbringingBase,
  upbringingScene,
  type UbMusicDigest,
  type UbRotation,
} from "./upbringing";

const digest = (o: Partial<UbMusicDigest> = {}): UbMusicDigest => ({ stage: "home", phase: "plan", festival: false, contestDay: false, contestOpen: false, ...o });

/** 养成中、有一个待回应事件的概览。 */
function withEvent(kind: string, mood?: string): Overview {
  const pending = { day: 1, fleet: 0, kind, key: "ev", title: "事件", text: "", speaker: { name: "汐" }, choices: [], ...(mood ? { mood } : {}) };
  return { ...overview, mode: "upbringing", story: { line: null, pending, last: null, journal: [] } } as unknown as Overview;
}
const plain = { ...overview, mode: "upbringing" } as Overview;

/** 九首“家乡的日常”与三首通用的平时曲。 */
const HOME_TRACKS: readonly TrackId[] = HOMETOWNS.map((h) => h.track);
const NEW_TRACKS: readonly TrackId[] = [...HOME_TRACKS, ...UB_EVERYDAY];

/** 按轮换放下去的前 n 首（含开头那一首）。 */
function play(pool: readonly TrackId[], seed: number, n: number): TrackId[] {
  const rand = rng(seed);
  let rot = startRotation(pool, rand);
  const out = [rot.current];
  while (out.length < n) {
    rot = nextRotation(rot, rand);
    out.push(rot.current);
  }
  return out;
}

describe("家乡曲", () => {
  it("九位主角按主角的 key 各对一首家乡曲，互不重复，都在曲目表里", () => {
    const want: Record<string, TrackId> = {
      noel: "ub_home_iberia",
      lieve: "ub_home_lowlands",
      tariq: "ub_home_maghreb",
      najma: "ub_home_gulf",
      baraka: "ub_home_swahili",
      ix_nikte: "ub_home_maya",
      lin_wandeng: "ub_home_ming",
      mio: "ub_home_japan",
      kaicili: "ub_home_moluccas",
    };
    expect(HOMETOWNS.length).toBe(9);
    expect(new Set(HOME_TRACKS).size).toBe(9);
    for (const [who, track] of Object.entries(want)) {
      expect(hometownTrack({ protagonist: who, culture: null }), who).toBe(track);
      expect(TRACK_IDS).toContain(track);
    }
  });

  it("主角的 key 先认（家乡期的 culture 是地点的粗分风格名，学院期是学院的文化区）：塔里克在阿尔及尔（ottoman）也是马格里布", () => {
    expect(hometownTrack({ protagonist: "tariq", culture: "ottoman" })).toBe("ub_home_maghreb");
    expect(hometownTrack({ protagonist: "najma", culture: "desert" })).toBe("ub_home_gulf");
    expect(hometownTrack({ protagonist: "baraka", culture: "east_african" })).toBe("ub_home_swahili");
    expect(hometownTrack({ protagonist: "kaicili", culture: "southeast_asian" })).toBe("ub_home_moluccas");
  });

  it("自创主角按 culture 认（不分大小写，空格、连字符当下划线）：学院与家乡的文化区写法都认", () => {
    const by = (culture: string) => hometownTrack({ protagonist: "template_pilot", culture });
    expect(by("iberian")).toBe("ub_home_iberia");
    expect(by("Portuguese")).toBe("ub_home_iberia");
    expect(by("low_countries")).toBe("ub_home_lowlands");
    expect(by("lowland")).toBe("ub_home_lowlands");
    expect(by("north_african")).toBe("ub_home_maghreb");
    expect(by("arabian")).toBe("ub_home_gulf");
    expect(by("east-african")).toBe("ub_home_swahili");
    expect(by("mesoamerican")).toBe("ub_home_maya");
    expect(by("chinese")).toBe("ub_home_ming");
    expect(by("ming")).toBe("ub_home_ming");
    expect(by("japanese")).toBe("ub_home_japan");
    expect(by("southeast asian")).toBe("ub_home_moluccas");
    expect(by("malay")).toBe("ub_home_moluccas");
  });

  it("还没有家乡曲的文化先借同一文化的港口曲；盖着好几种文化的粗分风格名（mediterranean、desert）与认不出的都没有家乡曲", () => {
    const by = (culture: string | null) => hometownTrack({ protagonist: null, culture });
    expect(by("korean")).toBe("port_korea");
    expect(by("ryukyuan")).toBe("port_ryukyu");
    expect(by("indian")).toBe("port_india");
    expect(by("andean")).toBe("port_andes");
    expect(by("italian")).toBe("port_italy");
    expect(by("nordic")).toBe("port_hansa");
    expect(by("northern")).toBe("port_hansa");
    expect(by("ottoman")).toBe("port_ottoman");
    for (const t of Object.values(HOMETOWN_PORT_FALLBACK)) expect(TRACK_IDS).toContain(t);
    expect(by("mediterranean")).toBeNull();
    expect(by("desert")).toBeNull();
    expect(by("atlantis")).toBeNull();
    expect(by(null)).toBeNull();
    expect(by("  ")).toBeNull();
  });
});

describe("平时的曲目池", () => {
  it("家乡期：《晨光里的家》打头，然后是家乡曲、三首通用的平时曲、主题曲《船货清单》", () => {
    expect(everydayPool(digest({ protagonist: "noel" }))).toEqual(["ub_home", "ub_home_iberia", "ub_study", "ub_dusk", "ub_breeze", "title"]);
    expect(UB_TITLE_TRACK).toBe("title");
    expect(UB_EVERYDAY).toEqual(["ub_study", "ub_dusk", "ub_breeze"]);
  });

  it("学院期：这所学院的短主题打头；认不出家乡时没有家乡曲；还没有摘要时按家乡期；不重复", () => {
    expect(everydayPool(digest({ stage: "academy", academy: "kyoto", protagonist: "mio" }))).toEqual(["ac_kyoto", "ub_home_japan", "ub_study", "ub_dusk", "ub_breeze", "title"]);
    expect(everydayPool(digest({ stage: "academy", academy: "casa", protagonist: "template_pilot", culture: "atlantis" }))).toEqual(["ac_generic", "ub_study", "ub_dusk", "ub_breeze", "title"]);
    expect(everydayPool(digest({ stage: "academy", academy: null }))[0]).toBe("ub_academy");
    expect(everydayPool(null)).toEqual(["ub_home", "ub_study", "ub_dusk", "ub_breeze", "title"]);
    for (const d of [digest({ protagonist: "mio" }), digest({ stage: "academy", academy: "giri", protagonist: "kaicili" }), null]) {
      const pool = everydayPool(d);
      expect(new Set(pool).size).toBe(pool.length);
    }
  });
});

describe("洗牌轮换", () => {
  const pool = everydayPool(digest({ protagonist: "noel" }));

  it("先放这个阶段的曲子；同一个种子结果相同，不同的种子顺序不同", () => {
    expect(startRotation(pool, rng(1)).current).toBe("ub_home");
    expect(play(pool, 7, 40)).toEqual(play(pool, 7, 40));
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => play(pool, s, 12).join(",")));
    expect(orders.size).toBeGreaterThan(4);
  });

  it("同一首不连着放两遍；开头的一副里每首都轮到；之后每一副（池里的曲子数减一首）也是每首都轮到", () => {
    for (const seed of [1, 2, 3, 42, 1553, 20261102]) {
      const seq = play(pool, seed, 6 + 5 * 20);
      for (let i = 1; i < seq.length; i++) expect(seq[i], `种子 ${seed} 第 ${i} 首`).not.toBe(seq[i - 1]);
      expect(new Set(seq.slice(0, pool.length)).size, `种子 ${seed}`).toBe(pool.length);
      // 放得够多以后每一首都轮得到，次数也差不多（不会一直是那几首）
      const count = new Map<TrackId, number>();
      for (const t of seq) count.set(t, (count.get(t) ?? 0) + 1);
      for (const t of pool) {
        expect(count.get(t) ?? 0, `种子 ${seed} ${t}`).toBeGreaterThanOrEqual(15);
        expect(count.get(t) ?? 0, `种子 ${seed} ${t}`).toBeLessThanOrEqual(26);
      }
    }
  });

  it("接下来轮到的那一首（后台先取采样）就是下一首；池里只有一首时不动、没有下一首", () => {
    const rand = rng(9);
    let rot: UbRotation = startRotation(pool, rand);
    for (let i = 0; i < 30; i++) {
      const next = peekRotation(rot);
      rot = nextRotation(rot, rand);
      expect(rot.current).toBe(next);
      expect(rot.queue.length).toBeGreaterThan(0);
      expect(rot.queue).not.toContain(rot.current);
    }
    const one = startRotation(["ub_home"], rng(1));
    expect(nextRotation(one, rng(1))).toBe(one);
    expect(peekRotation(one)).toBeNull();
    expect(peekRotation(null)).toBeNull();
  });

  it("曲目池变了：池没变时照旧（同一个对象）；认出了家乡（多了一首）时正在放的接着放；换了阶段从新阶段的曲子重新开始", () => {
    const rand = rng(3);
    const before = everydayPool(digest({ protagonist: "template_pilot" }));
    let rot = nextRotation(startRotation(before, rand), rand);
    const playing = rot.current;
    expect(syncRotation(rot, [...before], rand)).toBe(rot);
    const known = everydayPool(digest({ protagonist: "template_pilot", culture: "iberian" }));
    rot = syncRotation(rot, known, rand);
    expect(rot.current).toBe(playing);
    expect([...rot.queue, rot.current].sort()).toEqual([...known].sort());
    const academy = everydayPool(digest({ stage: "academy", academy: "seville_tarifa", protagonist: "template_pilot", culture: "iberian" }));
    rot = syncRotation(rot, academy, rand);
    expect(rot.current).toBe("ac_seville");
    // 还没有轮换时开始一轮
    expect(syncRotation(null, known, rand).current).toBe("ub_home");
  });

  it("什么时候换下一首：正在放的就是轮到的这一首，奏完一遍在留白里停了 ROTATE_REST_S 秒，并且从开始放它起放了 ROTATE_MIN_S 秒", () => {
    expect(ROTATE_REST_S).toBe(3);
    expect(ROTATE_MIN_S).toBe(60);
    expect(rotationDue({ track: "ub_dusk", rested: 3 }, "ub_dusk", 0, 95)).toBe(true);
    // 还在奏、刚奏完（余音还没散）
    expect(rotationDue({ track: "ub_dusk", rested: 0 }, "ub_dusk", 0, 95)).toBe(false);
    expect(rotationDue({ track: "ub_dusk", rested: 2.9 }, "ub_dusk", 0, 95)).toBe(false);
    // 放的是事件的曲子（轮换停着不走）
    expect(rotationDue({ track: "ub_sad", rested: 10 }, "ub_dusk", 0, 95)).toBe(false);
    expect(rotationDue({ track: null, rested: 0 }, "ub_dusk", 0, 95)).toBe(false);
    // 学院的短主题（二三十秒一遍）：放不满一分钟再奏一遍
    expect(rotationDue({ track: "ac_kyoto", rested: 5 }, "ac_kyoto", 0, 35)).toBe(false);
    expect(rotationDue({ track: "ac_kyoto", rested: 5 }, "ac_kyoto", 0, 80)).toBe(true);
  });
});

describe("轮换与事件、比赛、节日、结业", () => {
  const d = digest({ stage: "academy", academy: "kyoto", protagonist: "mio" });
  const rot = (current: TrackId): UbRotation => ({ ...startRotation(everydayPool(d), rng(5)), current });

  it("平时放轮换轮到的那一首；没给轮换时与原来一样放这个阶段的曲子；轮到的不在池里（换了阶段还没同步）时放池的第一首", () => {
    expect(upbringingBase(d)).toBe("ac_kyoto");
    expect(upbringingBase(d, rot("ub_home_japan"))).toBe("ub_home_japan");
    expect(upbringingBase(d, rot("title"))).toBe("title");
    expect(upbringingBase(digest({ protagonist: "mio" }), rot("ac_kyoto"))).toBe("ub_home");
    // 还没有摘要（养成主画面暂时收回）：接着放轮到的那一首；也没有轮换时按家乡期
    expect(upbringingBase(null, rot("ub_dusk"))).toBe("ub_dusk");
    expect(upbringingBase(null)).toBe("ub_home");
  });

  it("结业、比赛、节日照旧优先于轮换", () => {
    const r = rot("ub_breeze");
    expect(upbringingBase({ ...d, phase: "graduation" }, r)).toBe("ub_graduation");
    expect(upbringingBase({ ...d, phase: "done" }, r)).toBe("ub_graduation");
    expect(upbringingBase({ ...d, contestDay: true }, r)).toBe("ub_contest");
    expect(upbringingBase({ ...d, contestOpen: true }, r)).toBe("ub_contest");
    expect(upbringingBase({ ...d, festival: true }, r)).toBe("ub_festival");
    expect(upbringingBase({ ...d, festival: true, culture: "japanese" }, r)).toBe("ub_matsuri");
  });

  it("事件的曲子优先、立即切换；不换曲的事件（世界新闻、平时的欢快）照旧放轮换轮到的那一首", () => {
    const r = rot("ub_study");
    expect(upbringingScene(plain, d, r)).toEqual({ track: "ub_study", urgent: false });
    expect(upbringingScene(withEvent("upbringing", "sad"), d, r)).toEqual({ track: "ub_sad", urgent: true });
    expect(upbringingScene(withEvent("letter"), d, r)).toEqual({ track: "ub_letter", urgent: true });
    expect(upbringingScene(withEvent("bond", "tender"), d, r)).toEqual({ track: "ub_heart", urgent: true });
    expect(upbringingScene(withEvent("contest"), d, r)).toEqual({ track: "ub_contest", urgent: true });
    expect(upbringingScene(withEvent("history"), d, r)).toEqual({ track: "ub_study", urgent: false });
    expect(upbringingScene(withEvent("upbringing", "cheerful"), d, r)).toEqual({ track: "ub_study", urgent: false });
    expect(upbringingScene(withEvent("upbringing", "cheerful"), { ...d, festival: true }, r)).toEqual({ track: "ub_festival", urgent: false });
  });
});

// ───────────────────────────── 新写的十二首

/** 声部用的地方乐器（不算打击乐）。 */
function regionalLeads(t: TrackDef): string[] {
  return [...new Set(Object.values(t.voices).map((v) => v.inst))].filter((i) => Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, i));
}

/** 一首曲子的旋律行里是否出现“5 → 1 → 2 → 3”的成长动机（按调的主音算，忽略八度与时值）。 */
function hasGrowth(t: TrackDef): boolean {
  const tonic = parseKey(t.key).tonic;
  for (const [name, s] of Object.entries(t.sections)) {
    for (const l of Object.keys(s.lines ?? {})) {
      const pcs = lineOf(t, name, l).notes.map((n) => pc(n.pitches[0] - tonic));
      for (let i = 0; i + 3 < pcs.length; i++) if (pcs[i] === 7 && pcs[i + 1] === 0 && pcs[i + 2] === 2 && pcs[i + 3] === 4) return true;
    }
  }
  return false;
}

describe("新写的十二首：登记、长度与能循环", () => {
  it("都在曲目表里（合成版与管弦版都有，编号一致），只起了中文名、互不重名", () => {
    expect(NEW_TRACKS.length).toBe(12);
    for (const id of NEW_TRACKS) {
      expect(TRACK_IDS).toContain(id);
      expect(TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(TRACKS[id].title.zh.length, id).toBeGreaterThan(1);
      expect(TRACKS[id].title.en, id).toBeUndefined();
    }
    expect(new Set(NEW_TRACKS.map((id) => TRACKS[id].title.zh)).size).toBe(12);
  });

  it("英文界面：只起了中文名的曲子显示中文名，原有的曲子照旧显示英文名", () => {
    try {
      setLocale("en");
      expect(trackTitle("ub_dusk")).toBe("傍晚回家的路");
      expect(trackTitle("ub_home_japan")).toBe("缘侧与潮声");
      expect(trackTitle("ub_home")).toBe("Morning Light at Home");
    } finally {
      setLocale("zh-CN");
    }
    expect(trackTitle("ub_home")).toBe("晨光里的家");
  });

  for (const id of NEW_TRACKS) {
    it(`${id}：每一遍（两种曲式）75–150 秒，与原有的养成曲子相当或更长；留白 8–16 秒；两套编配一样长`, () => {
      const t = TRACKS[id];
      expect(t.forms.length).toBe(2);
      for (let p = 0; p < t.forms.length; p++) {
        const len = realizePass(t, p).length;
        expect(len, `${id}#${p}`).toBeGreaterThanOrEqual(75);
        expect(len, `${id}#${p}`).toBeLessThanOrEqual(150);
        expect(Math.abs(realizePass(ORCH_TRACKS[id], p).length - len), `${id}#${p}`).toBeLessThan(0.05);
      }
      expect(t.rest[0]).toBeGreaterThanOrEqual(8);
      expect(t.rest[1]).toBeLessThanOrEqual(16);
    });

    it(`${id}：能循环不突兀——每一遍都从主音上的和弦开始、在主音上的和弦结束（最后一段渐慢、渐弱）`, () => {
      const t = TRACKS[id];
      const tonic = parseKey(t.key).tonic;
      const bar = barUnits(t.meter);
      for (const form of t.forms) {
        const first = chordsOf(t.sections[form[0].s], bar)[0];
        const spans = chordsOf(t.sections[form[form.length - 1].s], bar);
        const last = spans[spans.length - 1];
        expect(pc(first.chord.root), `${id} 开头 ${first.chord.symbol}`).toBe(tonic);
        expect(pc(last.chord.root), `${id} 结尾 ${last.chord.symbol}`).toBe(tonic);
        const end = form[form.length - 1];
        expect(end.rit ?? 1, id).toBeLessThan(1);
        expect(end.to ?? end.dyn ?? 1, id).toBeLessThan(end.dyn ?? 1);
      }
    });
  }

  for (const id of HOME_TRACKS) {
    it(`${id}：家乡曲由地方乐器领奏——两套编配都至少三件地方乐器，合成版的衬底不用地方乐器以外的旋律乐器唱主旋律`, () => {
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) expect(regionalLeads(t).length, `${id} ${t === TRACKS[id] ? "合成版" : "管弦版"}`).toBeGreaterThanOrEqual(3);
      // 主旋律（mel 一行）在两套编配里都由地方乐器奏
      for (const t of [TRACKS[id], ORCH_TRACKS[id]]) {
        for (const form of t.forms) {
          for (const st of form) {
            for (const tok of st.play.split(/\s+/)) {
              if (!tok.startsWith("mel:")) continue;
              const voice = tok.slice(4).replace(/[+~-].*$/, "");
              const inst = t.voices[voice].inst;
              // 海湾的“骚特”里本来就有竖拉的提琴（合成版 fiddle，管弦版真的小提琴）与乌德琴一起唱
              if (id === "ub_home_gulf" && (inst === "fiddle" || inst === "o.vn")) continue;
              expect(Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, inst), `${id} ${st.s} 的 ${tok}（${inst}）`).toBe(true);
            }
          }
        }
      }
    });
  }

  it("三首通用的平时曲都用养成篇的成长动机（5 → 1 → 2 → 3），听得出是同一段少年时光；不用打击乐", () => {
    for (const id of UB_EVERYDAY) {
      expect(hasGrowth(TRACKS[id]), id).toBe(true);
      for (const v of Object.values(TRACKS[id].voices)) expect(v.inst === "perc", `${id} ${v.inst}`).toBe(false);
    }
  });
});
