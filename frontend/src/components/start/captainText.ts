// 身世相关的文字：开局效果、属性效果、星座的日期、生日与年龄（向导、船长卡、确认页共用）。
import { eraName, t, tk } from "../../i18n";
import type { CaptainDefsView, CaptainEffectView, CaptainSignView, StaticView } from "../../ipc/types";
import { attributeEffect } from "./wizard";

/** 一项开局效果写成一句话（海区、商品按当前语言的名字）。 */
export function effectText(e: CaptainEffectView, statics: StaticView | null): string {
  const n = e.value ?? 0;
  switch (e.kind) {
    case "cash_pct":
      return n >= 0 ? t("cap.eff.cash_up", { n }) : t("cap.eff.cash_down", { n: -n });
    case "reputation":
      return n >= 0 ? t("cap.eff.rep_up", { n }) : t("cap.eff.rep_down", { n: -n });
    case "fame":
      return t("cap.eff.fame", { n });
    case "morale":
      return t("cap.eff.morale", { n });
    case "chart":
      return t("cap.eff.chart", { region: (e.region !== undefined ? statics?.regions[e.region]?.name : undefined) ?? "?" });
    case "rumor":
      return t("cap.eff.rumor");
    case "goods":
      return t("cap.eff.goods", { good: (e.good !== undefined ? statics?.goods[e.good]?.name : undefined) ?? "?", qty: e.qty ?? 0 });
    case "loan":
      return t("cap.eff.loan", { amount: e.amount ?? 0, months: e.months ?? 0 });
  }
}

/** 属性的主要效果（与内核公式一致的数值）；世界自己的属性没有固定的效果文字，为空串。 */
export function attributeEffectText(key: string, value: number): string {
  const vars = attributeEffect(key, value);
  return vars ? tk(`cap.fx.${key}`, vars) : "";
}

/** 算学的门槛带来的能力（达到的才列出）。 */
export function numeracyPerks(defs: CaptainDefsView, value: number, atCreation: boolean): string[] {
  const p = defs.points;
  const out: string[] = [];
  if (value >= p.manual_numeracy) out.push(t("cap.fx.manual"));
  if (value >= p.learn_numeracy) out.push(t("cap.fx.learn"));
  if (atCreation && value >= p.genius_numeracy) out.push(t("cap.fx.genius"));
  return out;
}

/** 属性名（找不到时用 key）。 */
export function attributeName(defs: CaptainDefsView, key: string): string {
  return defs.attributes.find((a) => a.key === key)?.name ?? key;
}

/** 出生日期的完整写法：“生于航海历 1480 年 3 月 12 日”。 */
export function bornText(era: string | undefined, year: number, month: number, day: number): string {
  return t("cap.bd.born", { era: eraName(era ?? ""), year, month, day });
}

/** 出生年份（随年龄变）：“生于航海历 1484 年”。 */
export function bornYearText(era: string | undefined, year: number): string {
  return t("cap.bd.bornYear", { era: eraName(era ?? ""), year });
}

/** 现行星座的日期区间：“3月21日–4月19日”（英文 “21 Mar – 19 Apr”）；旧版星宫没有日期，为空串。 */
export function signDatesText(s: CaptainSignView): string {
  if (!s.start || !s.end) return "";
  return t("cap.bd.signDates", { fromMonth: s.start[0], fromDay: s.start[1], toMonth: s.end[0], toDay: s.end[1] });
}
