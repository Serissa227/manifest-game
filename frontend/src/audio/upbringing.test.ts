// 养成篇的配乐（audio/upbringing.ts）：养成视图的摘要（阶段、节日、比赛、结业）、平时的曲子、事件的情绪与种类换曲、立即切换。
import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarMark, Overview } from "../ipc/types";
import { overview } from "../test/fixtures";
import { lineOf } from "./score";
import { parseKey, pc } from "./theory";
import { TRACK_IDS, TRACKS } from "./tracks";
import { ACADEMY_THEMES, academyTheme, digestOf, eventTrack, publishUpbringing, UB_EVENT_TRACKS, upbringingBase, upbringingScene, useUbMusic, type UbMusicDigest, type UbMusicSource } from "./upbringing";

const mark = (kind: CalendarMark["kind"], days_left: number, key = kind): CalendarMark => ({ date: [1555, 7, 7], days_left, kind, key, name: key, heart: false, note: null });

const source = (o: Partial<UbMusicSource> = {}): UbMusicSource => ({ stage: "home", phase: "plan", today: [1555, 7, 7], calendar: [], ...o });

const digest = (o: Partial<UbMusicDigest> = {}): UbMusicDigest => ({ stage: "home", phase: "plan", festival: false, contestDay: false, contestOpen: false, ...o });

/** 养成中、有一个待回应事件的概览（mood、kind 按故事 2.0 的写法）。 */
function withEvent(kind: string, mood?: string): Overview {
  const pending = { day: 1, fleet: 0, kind, key: "ev", title: "事件", text: "", speaker: { name: "汐" }, choices: [], ...(mood ? { mood } : {}) };
  return { ...overview, mode: "upbringing", story: { line: null, pending, last: null, journal: [] } } as unknown as Overview;
}

const plain = { ...overview, mode: "upbringing" } as Overview;

describe("养成视图的摘要", () => {
  it("今天（倒计时 0 天）的节日与比赛才算；比赛表里今天开赛、没比完的也算", () => {
    expect(digestOf(source({ calendar: [mark("festival", 3), mark("contest", 12)] }))).toMatchObject({ festival: false, contestDay: false });
    expect(digestOf(source({ calendar: [mark("festival", 0)] }))).toMatchObject({ festival: true, contestDay: false });
    expect(digestOf(source({ calendar: [mark("contest", 0)] }))).toMatchObject({ contestDay: true });
    const contest = (status: "upcoming" | "open" | "done", date: [number, number, number]) => ({ key: "c", name: "歌合", kind: "poem" as const, date, status, prep: 0, result: null });
    expect(digestOf(source({ contests: [contest("open", [1555, 7, 7])] })).contestDay).toBe(true);
    expect(digestOf(source({ contests: [contest("done", [1555, 7, 7])] })).contestDay).toBe(false);
    expect(digestOf(source({ contests: [contest("open", [1555, 7, 8])] })).contestDay).toBe(false);
    expect(digestOf(source(), true).contestOpen).toBe(true);
    expect(digestOf(source({ stage: "academy", phase: "graduation" }))).toMatchObject({ stage: "academy", phase: "graduation" });
  });

  beforeEach(() => useUbMusic.setState({ digest: null }));

  it("发布摘要：没变时不通知，离开养成主画面时收回", () => {
    let n = 0;
    const off = useUbMusic.subscribe(() => n++);
    publishUpbringing(source());
    expect(n).toBe(1);
    // 同样的内容（新的对象）不再通知
    publishUpbringing(source({ calendar: [mark("exam", 0)] }));
    expect(n).toBe(1);
    publishUpbringing(source({ calendar: [mark("festival", 0)] }));
    expect(n).toBe(2);
    expect(useUbMusic.getState().digest?.festival).toBe(true);
    publishUpbringing(null);
    expect(useUbMusic.getState().digest).toBeNull();
    off();
  });
});

describe("养成的曲子", () => {
  it("十首曲子都在曲目表里，曲名中英文都有", () => {
    for (const id of ["ub_home", "ub_academy", "ub_festival", "ub_heart", "ub_tense", "ub_sad", "ub_mystic", "ub_contest", "ub_graduation", "ub_letter"] as const) {
      expect(TRACK_IDS).toContain(id);
      expect(TRACKS[id].title.zh.length).toBeGreaterThan(0);
      expect(TRACKS[id].title.en?.length).toBeGreaterThan(0);
    }
    for (const id of UB_EVENT_TRACKS) expect(id.startsWith("ub_")).toBe(true);
  });

  it("平时：家乡期放家、学院期放学院；结业优先，其次比赛、节日；还没有摘要时按家乡期", () => {
    expect(upbringingBase(null)).toBe("ub_home");
    expect(upbringingBase(digest())).toBe("ub_home");
    expect(upbringingBase(digest({ stage: "academy" }))).toBe("ub_academy");
    expect(upbringingBase(digest({ stage: "academy", festival: true }))).toBe("ub_festival");
    expect(upbringingBase(digest({ festival: true, contestDay: true }))).toBe("ub_contest");
    expect(upbringingBase(digest({ contestOpen: true }))).toBe("ub_contest");
    expect(upbringingBase(digest({ phase: "graduation", festival: true, contestDay: true }))).toBe("ub_graduation");
    expect(upbringingBase(digest({ stage: "academy", phase: "done" }))).toBe("ub_graduation");
  });

  it("事件按情绪与种类换曲：比赛 > 悲伤、紧张、神秘 > 来信、征兆 > 心动 > 节日里的欢快", () => {
    const d = digest({ stage: "academy" });
    expect(eventTrack(plain, d)).toBeNull();
    expect(eventTrack(withEvent("upbringing", "sad"), d)).toBe("ub_sad");
    expect(eventTrack(withEvent("bond", "tense"), d)).toBe("ub_tense");
    expect(eventTrack(withEvent("upbringing", "mystic"), d)).toBe("ub_mystic");
    expect(eventTrack(withEvent("bond", "tender"), d)).toBe("ub_heart");
    expect(eventTrack(withEvent("omen"), d)).toBe("ub_mystic");
    expect(eventTrack(withEvent("letter"), d)).toBe("ub_letter");
    expect(eventTrack(withEvent("letter", "tender"), d)).toBe("ub_letter");
    // 坏消息的来信：情绪优先
    expect(eventTrack(withEvent("letter", "sad"), d)).toBe("ub_sad");
    expect(eventTrack(withEvent("contest", "tense"), d)).toBe("ub_contest");
    // 欢快的事件：节日里放节日的曲子，平时不换
    expect(eventTrack(withEvent("upbringing", "cheerful"), d)).toBeNull();
    expect(eventTrack(withEvent("upbringing", "cheerful"), { ...d, festival: true })).toBe("ub_festival");
    // 世界新闻、请托、不认识的情绪：不换
    expect(eventTrack(withEvent("history"), d)).toBeNull();
    expect(eventTrack(withEvent("request", "furious"), d)).toBeNull();
    // 旧的事件（chapter / encounter，没有 mood）
    expect(eventTrack(withEvent("chapter"), d)).toBeNull();
  });

  it("事件的曲子与比赛的小游戏立即切换；平时的曲子、节日、比赛日照防频繁切换的规矩", () => {
    const d = digest({ stage: "academy" });
    expect(upbringingScene(plain, d)).toEqual({ track: "ub_academy", urgent: false });
    expect(upbringingScene(withEvent("upbringing", "sad"), d)).toEqual({ track: "ub_sad", urgent: true });
    expect(upbringingScene(withEvent("history"), d)).toEqual({ track: "ub_academy", urgent: false });
    expect(upbringingScene(plain, { ...d, festival: true })).toEqual({ track: "ub_festival", urgent: false });
    expect(upbringingScene(plain, { ...d, contestDay: true })).toEqual({ track: "ub_contest", urgent: false });
    expect(upbringingScene(plain, { ...d, contestOpen: true })).toEqual({ track: "ub_contest", urgent: true });
    // 事件的曲子就是正在放的平时的曲子时不算“立即切换”
    expect(upbringingScene(withEvent("contest"), { ...d, contestDay: true })).toEqual({ track: "ub_contest", urgent: false });
    expect(upbringingScene(withEvent("upbringing", "cheerful"), { ...d, festival: true })).toEqual({ track: "ub_festival", urgent: false });
  });
});

describe("养成曲子的写法", () => {
  /** 一首曲子各段的旋律行里，是否出现“5 → 1 → 2 → 3”的成长动机（按调的主音算，忽略八度与时值）。 */
  function hasGrowth(id: (typeof TRACK_IDS)[number]): boolean {
    const t = TRACKS[id];
    const tonic = parseKey(t.key).tonic;
    for (const [name, s] of Object.entries(t.sections)) {
      for (const l of Object.keys(s.lines ?? {})) {
        const pcs = lineOf(t, name, l).notes.map((n) => pc(n.pitches[0] - tonic));
        for (let i = 0; i + 3 < pcs.length; i++) if (pcs[i] === 7 && pcs[i + 1] === 0 && pcs[i + 2] === 2 && pcs[i + 3] === 4) return true;
      }
    }
    return false;
  }

  it("家、学院、比赛与结业都用成长动机（5 → 1 → 2 → 3），听得出是同一段少年时光", () => {
    for (const id of ["ub_home", "ub_academy", "ub_contest", "ub_graduation"] as const) expect(hasGrowth(id), id).toBe(true);
  });

  it("结业的尾声交给航海的起帆动机（5 → 1 → 5）；养成的曲子一遍不超过两分半、留白不超过 20 秒", () => {
    expect(TRACKS.ub_graduation.sections.coda.lines?.motif).toMatch(/^A,3\/2 D\/2 A6/);
    for (const id of TRACK_IDS.filter((t) => t.startsWith("ub_"))) {
      expect(TRACKS[id].rest[1], id).toBeLessThanOrEqual(20);
    }
  });

  it("紧张、悲伤、神秘与心动的曲子不用打击乐的鼓点；比赛（合成版）不用大鼓与钹的轰击", () => {
    for (const id of ["ub_tense", "ub_sad", "ub_mystic", "ub_heart"] as const) {
      for (const v of Object.values(TRACKS[id].voices)) expect(v.inst === "perc", `${id} ${v.inst}`).toBe(false);
    }
    const hits = Object.values(TRACKS.ub_contest.voices).flatMap((v) => {
      const p = v.pattern;
      const list = p && !("kind" in p) ? Object.values(p) : p ? [p] : [];
      return list.flatMap((x) => (x.kind === "drum" ? Object.values(x.hits).map(([h]) => h) : []));
    });
    expect(hits).not.toContain("cymbal");
    expect(hits).not.toContain("taiko");
  });
});

describe("学院的短主题（第三轮）", () => {
  it("摘要里带上学院与主角的 key；学院、主角换了才通知", () => {
    const v = { ...source({ stage: "academy" }), academy: { key: "kyoto" }, protagonist: { key: "mio" } };
    expect(digestOf(v)).toMatchObject({ academy: "kyoto", protagonist: "mio" });
    expect(digestOf(source())).toMatchObject({ academy: null, protagonist: null });
    useUbMusic.setState({ digest: null });
    let n = 0;
    const off = useUbMusic.subscribe(() => n++);
    publishUpbringing(v);
    publishUpbringing({ ...v });
    publishUpbringing({ ...v, academy: { key: "casa" } });
    expect(n).toBe(2);
    off();
  });

  it("学院期按学院的 key 认出十所学院之一；认不出时按主角认；都认不出（自创主角）时放《学院的回廊》；没有学院时照旧放《课业与钟声》", () => {
    const ac = (academy: string | null, protagonist: string | null = null) => upbringingBase(digest({ stage: "academy", academy, protagonist }));
    expect(ac("kyoto")).toBe("ac_kyoto");
    expect(ac("shexue")).toBe("ac_zhangzhou");
    expect(ac("antwerp_laurel")).toBe("ac_antwerp");
    expect(ac("fez_qarawiyyin")).toBe("ac_fez");
    expect(ac("cairo_azhar")).toBe("ac_azhar");
    expect(ac("giri")).toBe("ac_giri");
    expect(ac("merida_franciscans")).toBe("ac_merida");
    expect(ac("seville_tarifa")).toBe("ac_seville");
    // key 认不出：按主角
    expect(ac("noble_house", "noel")).toBe("ac_seville");
    expect(ac("whatever", "najma")).toBe("ac_ship");
    // 自创主角的学院（塞维利亚贸易总署的领航员课……）
    expect(ac("casa", "template_pilot")).toBe("ac_generic");
    // 没有学院（旧后端）
    expect(ac(null, "mio")).toBe("ub_academy");
    // 家乡期不放学院的曲子
    expect(upbringingBase(digest({ stage: "home", academy: "kyoto" }))).toBe("ub_home");
    // 节日、比赛、结业照旧优先
    expect(upbringingBase(digest({ stage: "academy", academy: "kyoto", festival: true }))).toBe("ub_festival");
  });

  it("九位主角各对一所学院、一首短主题，互不重复，都在曲目表里", () => {
    expect(new Set(ACADEMY_THEMES.map((t) => t.track)).size).toBe(ACADEMY_THEMES.length);
    expect(new Set(ACADEMY_THEMES.map((t) => t.protagonist)).size).toBe(ACADEMY_THEMES.length);
    for (const t of ACADEMY_THEMES) {
      expect(TRACK_IDS).toContain(t.track);
      expect(academyTheme({ academy: "unknown", protagonist: t.protagonist })).toBe(t.track);
    }
    expect(TRACK_IDS).toContain("ac_generic");
  });
});
