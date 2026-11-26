// 开局向导的纯逻辑：与内核 manifest_core::captain 一致的星座判定（按月与日，摩羯座跨年）、年龄范围与缺省值、加点、上限、
// 自由分配、奇才之法与提交的命令；随机的确定性与范围。
import { describe, expect, it } from "vitest";
import { captainDefs, captainProfile, captainStatics, statics } from "../../test/fixtures";
import {
  AGE_PRESETS,
  DAYS_PER_YEAR,
  answersOk,
  attributeEffect,
  backgroundAttrs,
  birthdayOk,
  canDec,
  canInc,
  clampAge,
  creationOf,
  dayOfYear,
  defaultAge,
  finalAttrs,
  fitAlloc,
  geniusChoice,
  manualTuning,
  newDraft,
  pointsLeft,
  rollAlloc,
  rollAnswer,
  rollBirthday,
  signByKey,
  signOf,
  startEffects,
  wizardSteps,
  zodiacSigns,
} from "./wizard";

const defs = captainDefs;
const signAt = (month: number, day: number) => signOf(defs, month, day)?.key;

describe("开局向导的规则", () => {
  it("步骤：有身世数据七步，没有时四步", () => {
    expect(wizardSteps(defs)).toEqual(["scenario", "look", "birthday", "name", "background", "attrs", "confirm"]);
    expect(wizardSteps(null)).toEqual(["scenario", "look", "name", "confirm"]);
  });

  it("星座按现实的日期划分：每个星座的首日与末日、首日的前一天属于上一个星座", () => {
    const zodiac = zodiacSigns(defs);
    expect(zodiac.map((s) => s.key)).toEqual([
      "aries",
      "taurus",
      "gemini",
      "cancer",
      "leo",
      "virgo",
      "libra",
      "scorpio",
      "sagittarius",
      "capricorn",
      "aquarius",
      "pisces",
    ]);
    // 按首日先后排：上一个星座的末日就在这一个首日的前一天
    const byStart = [...zodiac].sort((a, b) => dayOfYear(...a.start) - dayOfYear(...b.start));
    byStart.forEach((s, i) => {
      const prev = byStart[(i + byStart.length - 1) % byStart.length];
      const end = s.end ?? [0, 0];
      expect(signAt(s.start[0], s.start[1]), `${s.key} 首日`).toBe(s.key);
      expect(signAt(end[0], end[1]), `${s.key} 末日`).toBe(s.key);
      const before = (dayOfYear(s.start[0], s.start[1]) + DAYS_PER_YEAR - 1) % DAYS_PER_YEAR;
      expect(signAt(Math.floor(before / 30) + 1, (before % 30) + 1), `${s.key} 首日的前一天`).toBe(prev.key);
    });
    // 边界的具体日子
    expect([signAt(3, 20), signAt(3, 21), signAt(4, 19), signAt(4, 20)]).toEqual(["pisces", "aries", "aries", "taurus"]);
    expect([signAt(2, 18), signAt(2, 19)]).toEqual(["aquarius", "pisces"]);
    expect([signAt(10, 23), signAt(10, 24), signAt(11, 22), signAt(11, 23)]).toEqual(["libra", "scorpio", "scorpio", "sagittarius"]);
  });

  it("摩羯座跨年：12 月 22 日—1 月 19 日；每一天都恰好属于一个现行星座，从不落到旧版星宫", () => {
    expect([signAt(12, 21), signAt(12, 22), signAt(12, 30), signAt(1, 1), signAt(1, 19), signAt(1, 20)]).toEqual([
      "sagittarius",
      "capricorn",
      "capricorn",
      "capricorn",
      "capricorn",
      "aquarius",
    ]);
    const days = new Map<string, number>();
    for (let n = 0; n < DAYS_PER_YEAR; n++) {
      const s = signOf(defs, Math.floor(n / 30) + 1, (n % 30) + 1);
      expect(s?.legacy).toBe(false);
      days.set(s?.key ?? "", (days.get(s?.key ?? "") ?? 0) + 1);
    }
    expect(days.get("capricorn")).toBe(28);
    expect(days.get("pisces")).toBe(32);
    expect([...days.values()].reduce((a, b) => a + b, 0)).toBe(360);
    expect(days.size).toBe(12);
    // 航海历里没有的日子
    expect([signAt(0, 1), signAt(13, 1), signAt(3, 0), signAt(3, 31)]).toEqual([undefined, undefined, undefined, undefined]);
    // 旧版星宫按 key 仍找得到（旧存档），但不在十二星座里
    expect(signByKey(defs, "lantern")?.name).toBe("提灯座");
    expect(zodiacSigns(defs).some((s) => s.key === "lantern")).toBe(false);
  });

  it("身世与星座加点：起点 + 各选项 + 星座，单项夹在开局上限之内", () => {
    // 6 月 1 日双子座口才 +1
    expect(backgroundAttrs(defs, [null, null, null], 6, 1)).toEqual([1, 1, 1, 1, 1, 2]);
    // 家世算学 +2、少年算学 +2、2 月 12 日水瓶座算学 +1：1 + 5 = 6
    expect(backgroundAttrs(defs, ["lighthouse_scribes", "university", "new_world"], 2, 12)).toEqual([2, 1, 1, 1, 6, 1]);
    // 同一个月，日子不同星座就不同：2 月 19 日双鱼座航海 +1
    expect(backgroundAttrs(defs, ["lighthouse_scribes", "university", "new_world"], 2, 19)).toEqual([3, 1, 1, 1, 5, 1]);
    // 不属于这道题的选项不算
    expect(backgroundAttrs(defs, ["university", null, null], 6, 1)).toEqual([1, 1, 1, 1, 1, 2]);
    // 上限：把开局上限压到 3 时夹住
    const low = { ...defs, points: { ...defs.points, creation_cap: 3 } };
    expect(backgroundAttrs(low, ["lighthouse_scribes", "university", null], 2, 12)[4]).toBe(3);
  });

  it("自由分配：加减的条件、夹进上限、合计不超过 free", () => {
    // 5 月 12 日金牛座交易 +1
    const bg = backgroundAttrs(defs, ["merchant_house", "university", "family_debt"], 5, 12);
    expect(bg).toEqual([1, 4, 1, 2, 3, 1]);
    const alloc = [0, 3, 0, 0, 0, 0];
    expect(finalAttrs(bg, alloc)[1]).toBe(7);
    expect(canInc(defs, bg, alloc, 1)).toBe(false);
    expect(canInc(defs, bg, alloc, 0)).toBe(true);
    expect(canDec(alloc, 1)).toBe(true);
    expect(canDec(alloc, 0)).toBe(false);
    expect(pointsLeft(defs, alloc)).toBe(2);
    // 超出上限的点数退回；负数与小数取整；合计超过 free 时从后面截掉
    expect(fitAlloc(defs, bg, [0, 5, 0, 0, 0, 0])).toEqual([0, 3, 0, 0, 0, 0]);
    expect(fitAlloc(defs, bg, [-2, 1.7, 0, 0, 0, 0])).toEqual([0, 1, 0, 0, 0, 0]);
    expect(fitAlloc(defs, bg, [3, 3, 3, 0, 0, 0])).toEqual([3, 2, 0, 0, 0, 0]);
    // 点数用完时哪项都不能再加
    expect(canInc(defs, bg, [5, 0, 0, 0, 0, 0], 2)).toBe(false);
  });

  it("随机分配：总是分完 free 点、不超上限，同一个 roll 结果相同", () => {
    for (let r = 0; r < 50; r++) {
      const bg = backgroundAttrs(defs, ["lighthouse_scribes", "university", "new_world"], 2, 12);
      const a = rollAlloc(defs, bg, r);
      expect(a.reduce((x, y) => x + y, 0)).toBe(defs.points.free);
      expect(finalAttrs(bg, a).every((v) => v <= defs.points.creation_cap)).toBe(true);
      expect(rollAlloc(defs, bg, r)).toEqual(a);
    }
  });

  it("随机生日与随机回答：在范围里、确定；回答总是这道题的选项，且不与当前相同", () => {
    const months = new Set<number>();
    const signs = new Set<string>();
    const ages = new Set<number>();
    for (let r = 0; r < 200; r++) {
      const b = rollBirthday(defs, r);
      expect(birthdayOk(defs, b)).toBe(true);
      expect(rollBirthday(defs, r)).toEqual(b);
      months.add(b.month);
      signs.add(signOf(defs, b.month, b.day)?.key ?? "");
      ages.add(b.age);
      const a = rollAnswer(defs, 1, "university", r);
      expect(a).toBe("naval_cadet");
    }
    expect(months.size).toBe(12);
    expect(signs.size).toBe(12);
    // “随机生日”照旧随机年龄：16–45 岁都可能，最小与最大都出现过
    expect(Math.min(...ages)).toBe(16);
    expect(Math.max(...ages)).toBe(45);
    expect(rollAnswer(defs, 0, null, 3)).toMatch(/^(merchant_house|lighthouse_scribes)$/);
    expect(rollAnswer(defs, 9, null, 3)).toBeNull();
    const d = newDraft(defs, 7);
    expect(d.answers).toEqual([null, null, null]);
    expect(d.alloc).toEqual([0, 0, 0, 0, 0, 0]);
    expect(birthdayOk(defs, d)).toBe(true);
  });

  it("年龄的缺省值是 18：新草稿不随机年龄（月与日照旧随机）；缺省值与快捷年龄都在范围之内", () => {
    const birthdays = new Set<string>();
    for (let r = 0; r < 50; r++) {
      const d = newDraft(defs, r);
      expect(d.age).toBe(18);
      birthdays.add(`${d.month}-${d.day}`);
    }
    expect(birthdays.size).toBeGreaterThan(10);
    expect(defaultAge(defs)).toBe(18);
    // 数据的缺省值越界时夹进范围；年龄取整
    const odd = (age_default: number) => ({ ...defs, points: { ...defs.points, age_default } });
    expect(defaultAge(odd(12))).toBe(16);
    expect(defaultAge(odd(60))).toBe(45);
    expect([clampAge(defs, 15), clampAge(defs, 16), clampAge(defs, 45), clampAge(defs, 46), clampAge(defs, 29.6)]).toEqual([16, 16, 45, 45, 30]);
    expect(AGE_PRESETS).toEqual([16, 18, 20, 25, 30, 40]);
    expect(AGE_PRESETS.every((a) => birthdayOk(defs, { month: 1, day: 1, age: a }))).toBe(true);
  });

  it("生日与回答的校验：年龄 16–45（15 与 46 不行）", () => {
    expect(birthdayOk(defs, { month: 0, day: 1, age: 20 })).toBe(false);
    expect(birthdayOk(defs, { month: 12, day: 31, age: 20 })).toBe(false);
    expect(birthdayOk(defs, { month: 12, day: 30, age: 15 })).toBe(false);
    expect(birthdayOk(defs, { month: 12, day: 30, age: 16 })).toBe(true);
    expect(birthdayOk(defs, { month: 12, day: 30, age: 45 })).toBe(true);
    expect(birthdayOk(defs, { month: 12, day: 30, age: 46 })).toBe(false);
    expect(answersOk(defs, ["merchant_house", "university", "new_world"])).toBe(true);
    expect(answersOk(defs, ["merchant_house", "university", null])).toBe(false);
    expect(answersOk(defs, ["university", "merchant_house", "new_world"])).toBe(false);
  });

  it("奇才之法：算学到 7 才有；没选或选了不认识的，默认第一种", () => {
    const six = [1, 1, 1, 1, 6, 1];
    const seven = [1, 1, 1, 1, 7, 1];
    expect(geniusChoice(defs, six, "ar1")).toBeNull();
    expect(geniusChoice(defs, seven, "ar1")).toBe("ar1");
    expect(geniusChoice(defs, seven, null)).toBe("ses");
    expect(geniusChoice(defs, seven, "astrology")).toBe("ses");
  });

  it("提交的命令：不完整时为空；出生年份 = 开局年份 − 年龄；分配夹进上限后必须正好分完", () => {
    const draft = { month: 2, day: 12, age: 22, answers: ["lighthouse_scribes", "university", "new_world"], alloc: [4, 0, 0, 0, 1, 0], genius: "ar1" };
    expect(creationOf(defs, draft, 1502)).toEqual({
      birthday: { year: 1480, month: 2, day: 12 },
      answers: ["lighthouse_scribes", "university", "new_world"],
      alloc: [4, 0, 0, 0, 1, 0],
      genius: "ar1",
    });
    expect(creationOf(defs, { ...draft, alloc: [3, 0, 0, 0, 1, 0] }, 1502)).toBeNull();
    expect(creationOf(defs, { ...draft, answers: ["lighthouse_scribes", null, "new_world"] }, 1502)).toBeNull();
    expect(creationOf(defs, { ...draft, age: 60 }, 1502)).toBeNull();
    expect(creationOf(defs, { ...draft, age: 15 }, 1502)).toBeNull();
    expect(creationOf(defs, { ...draft, age: 16 }, 1502)?.birthday).toEqual({ year: 1486, month: 2, day: 12 });
    // 2 月 19 日是双鱼座（算学少 1 点）：同样的分配算学只有 6，不再带奇才之法
    expect(creationOf(defs, { ...draft, day: 19 }, 1502)?.genius).toBeNull();
    // 算学不到 7：不带奇才之法
    expect(creationOf(defs, { ...draft, alloc: [5, 0, 0, 0, 0, 0] }, 1502)?.genius).toBeNull();
  });

  it("开局效果按问题顺序；属性效果的数值与内核公式一致", () => {
    expect(startEffects(defs, ["merchant_house", "university", "family_debt"])).toEqual([
      { kind: "cash_pct", value: 10 },
      { kind: "loan", amount: 8000, months: 12 },
    ]);
    expect(attributeEffect("seamanship", 7)).toEqual({ n: 7 });
    expect(attributeEffect("commerce", 12)).toEqual({ n: 10 });
    expect(attributeEffect("arms", 7)).toEqual({ n: 35 });
    expect(attributeEffect("arms", 11)).toEqual({ n: 50 });
    expect(attributeEffect("eloquence", 3)).toEqual({ bargain: 0.9, hire: 6 });
    expect(attributeEffect("numeracy", 7)).toEqual({ n: 10 });
  });

  it("手调参数：算学到 manual_numeracy 才行；没有主角档案或数据没有身世时不受限", () => {
    const withNumeracy = (n: number) => ({ ...captainProfile, attrs: captainProfile.attrs.map(([k, v]) => [k, k === "numeracy" ? n : v] as [typeof k, number]) });
    expect(manualTuning(captainStatics, withNumeracy(3))).toEqual({ ok: false, need: 4 });
    expect(manualTuning(captainStatics, withNumeracy(4))).toEqual({ ok: true, need: 4 });
    expect(manualTuning(captainStatics, null).ok).toBe(true);
    expect(manualTuning(statics, withNumeracy(1)).ok).toBe(true);
  });
});
