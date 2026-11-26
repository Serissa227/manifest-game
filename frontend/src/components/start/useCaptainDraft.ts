// 身世草稿的状态与操作（开局向导与旧存档的补建身世共用）：生日与年龄、五问的回答、自由分配、奇才之法。
// 派生值（身世与星座加点、夹进上限后的分配、最终属性、剩余点数、奇才之法）每次渲染时由 wizard.ts 算出，不另存状态。
// 没有身世数据（旧数据、静态数据还没到）时照常可用：按空的身世数据计算，玩家改动之前草稿总是按当前的身世数据生成。
import { useState } from "react";
import type { CaptainDefsView } from "../../ipc/types";
import {
  backgroundAttrs,
  birthdayDays,
  canDec,
  canInc,
  clampAge,
  finalAttrs,
  fitAlloc,
  geniusChoice,
  isGenius,
  newDraft,
  pointsLeft,
  rollAlloc,
  rollAnswer,
  rollBirthday,
  type CaptainDraft,
} from "./wizard";

/** 没有身世数据时的占位（没有问题、没有星座、没有点数）。 */
const EMPTY_DEFS: CaptainDefsView = {
  points: {
    base: 0,
    free: 0,
    creation_cap: 0,
    max: 0,
    genius_numeracy: 0,
    manual_numeracy: 0,
    learn_numeracy: 0,
    learn_days: 0,
    age_min: 0,
    age_max: 0,
    age_default: 0,
    birthday_morale: 0,
  },
  attributes: [],
  signs: [],
  questions: [],
};

export interface DraftApi {
  defs: CaptainDefsView;
  draft: CaptainDraft;
  /** 身世与星座加点（自由分配之前） */
  bg: number[];
  /** 夹进上限后的自由分配 */
  alloc: number[];
  attrs: number[];
  left: number;
  genius: boolean;
  /** 提交用的奇才之法（算学不够时为空） */
  method: string | null;
  setBirthday: (patch: Partial<Pick<CaptainDraft, "month" | "day">>) => void;
  /** 改年龄（夹进允许的范围） */
  setAge: (age: number) => void;
  randomBirthday: () => void;
  answer: (qi: number, key: string) => void;
  randomAnswer: (qi: number) => void;
  inc: (i: number) => void;
  dec: (i: number) => void;
  randomAlloc: () => void;
  resetAlloc: () => void;
  setMethod: (m: string) => void;
  canInc: (i: number) => boolean;
  canDec: (i: number) => boolean;
}

export function useCaptainDraft(maybeDefs: CaptainDefsView | null | undefined, roll: number): DraftApi {
  const defs = maybeDefs ?? EMPTY_DEFS;
  const [saved, setSaved] = useState<CaptainDraft | null>(null);
  // “随机”按钮各自计数：第几次随机决定结果（确定性）
  const [rolls, setRolls] = useState({ birthday: roll, answer: roll, alloc: roll });
  const base = saved ?? newDraft(defs, roll);
  // 回答按当前的问题数对齐（语言切换后 key 不变）
  const draft: CaptainDraft = { ...base, answers: defs.questions.map((_, i) => base.answers[i] ?? null) };
  const bg = backgroundAttrs(defs, draft.answers, draft.month, draft.day);
  const alloc = fitAlloc(defs, bg, draft.alloc);
  const attrs = finalAttrs(bg, alloc);
  const update = (patch: Partial<CaptainDraft>) => setSaved({ ...draft, alloc, ...patch });
  const bump = (k: keyof typeof rolls) => {
    const next = rolls[k] + 1;
    setRolls({ ...rolls, [k]: next });
    return next;
  };
  const withAnswer = (qi: number, key: string | null) => draft.answers.map((a, i) => (i === qi ? key : a));
  return {
    defs,
    draft,
    bg,
    alloc,
    attrs,
    left: pointsLeft(defs, alloc),
    genius: isGenius(defs, attrs),
    method: geniusChoice(defs, attrs, draft.genius),
    // 换到天数少的月份（世界日历，如公历的二月）时把日子夹进这个月
    setBirthday: (patch) => {
      const month = patch.month ?? draft.month;
      const days = birthdayDays(month);
      const day = patch.day ?? draft.day;
      update(days > 0 && day > days ? { ...patch, day: days } : patch);
    },
    setAge: (age) => update({ age: clampAge(defs, age) }),
    randomBirthday: () => update(rollBirthday(defs, bump("birthday"))),
    answer: (qi, key) => update({ answers: withAnswer(qi, key) }),
    randomAnswer: (qi) => update({ answers: withAnswer(qi, rollAnswer(defs, qi, draft.answers[qi] ?? null, bump("answer"))) }),
    // 加减都以夹进上限后的分配为准：改过身世后退回的点数不会“复活”
    inc: (i) => {
      if (canInc(defs, bg, alloc, i)) update({ alloc: alloc.map((v, k) => (k === i ? v + 1 : v)) });
    },
    dec: (i) => {
      if (canDec(alloc, i)) update({ alloc: alloc.map((v, k) => (k === i ? v - 1 : v)) });
    },
    randomAlloc: () => update({ alloc: rollAlloc(defs, bg, bump("alloc")) }),
    resetAlloc: () => update({ alloc: alloc.map(() => 0) }),
    setMethod: (m) => update({ genius: m }),
    canInc: (i) => canInc(defs, bg, alloc, i),
    canDec: (i) => canDec(alloc, i),
  };
}
